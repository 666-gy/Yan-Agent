'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto'), http = require('node:http');
const { indexFile } = require('../lib/update-chunks');
const { downloadParallel } = require('../lib/update-parallel');
const { buildDelta } = require('../scripts/prepare-update-delta.cjs');
const { applyDelta } = require('../scripts/apply-update-delta.cjs');
const { downloadUpdate } = require('../lib/update-checker');
async function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-update-'));
  const base = path.join(dir, 'old.exe'), target = path.join(dir, 'new.exe');
  const original = crypto.randomBytes(3 * 1024 ** 2);
  const bytes = Buffer.concat([original.subarray(0, 800000), crypto.randomBytes(900000), original.subarray(800000)]);
  fs.writeFileSync(base, original); fs.writeFileSync(target, bytes);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, base, target, bytes, index: await indexFile(target) };
}
async function serve(t, handler) {
  const server = http.createServer(handler); await new Promise(r => server.listen(0, '127.0.0.1', r));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  return `http://127.0.0.1:${server.address().port}`;
}
test('offline delta reconstructs exact installer and rejects wrong baseline/corrupt payload', async t => {
  const { dir, base, target, bytes } = await fixture(t);
  const delta = path.join(dir, 'patch.yandelta'); const report = await buildDelta(base, target, delta);
  assert.ok(report.reductionPercent > 50);
  await applyDelta(base, delta, path.join(dir, 'rebuilt.exe'));
  assert.deepEqual(fs.readFileSync(path.join(dir, 'rebuilt.exe')), bytes);
  await assert.rejects(applyDelta(target, delta, path.join(dir, 'wrong.exe')), /baseline/);
  const damaged = fs.readFileSync(delta); damaged[damaged.length - 1] ^= 1; fs.writeFileSync(delta, damaged);
  await assert.rejects(applyDelta(base, delta, path.join(dir, 'bad.exe')), /Corrupt/);
  assert.equal(fs.existsSync(path.join(dir, 'bad.exe')), false);
});
test('parallel ranges reuse verified local chunks and limit concurrent downloads', async t => {
  const { dir, base, bytes, index } = await fixture(t); let active = 0, peak = 0, transferred = 0;
  const url = await serve(t, (req, res) => {
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range); assert.ok(match);
    const start = Number(match[1]), end = Number(match[2]); active++; peak = Math.max(peak, active);
    setTimeout(() => { res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}` });
      res.end(bytes.subarray(start, end + 1)); transferred += end - start + 1; active--; }, 15);
  });
  const result = await downloadParallel({ urls: [url], targetPath: path.join(dir, 'result.exe'), index,
    expectedSize: bytes.length, expectedSha512: index.sha512, baselinePath: base, requestClient: () => http, concurrency: 4 });
  assert.ok(result.reusedBytes > bytes.length / 2); assert.equal(transferred, result.downloadedBytes);
  assert.ok(peak >= 1 && peak <= 4); assert.deepEqual(fs.readFileSync(result.path), bytes);
});
test('full download coalesces small chunks into bounded ranges with four workers', async t => {
  const { dir, target } = await fixture(t);
  const bytes = crypto.randomBytes(18 * 1024 * 1024);
  fs.writeFileSync(target, bytes);
  const index = await indexFile(target);
  let requests = 0, active = 0, peak = 0;
  const url = await serve(t, (req, res) => {
    const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    const start = Number(a), end = Number(b);
    assert.ok(end - start + 1 <= 4 * 1024 * 1024);
    requests++; active++; peak = Math.max(peak, active);
    setTimeout(() => {
      res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}` });
      res.end(bytes.subarray(start, end + 1)); active--;
    }, 25);
  });
  const result = await downloadParallel({ urls: [url], targetPath: path.join(dir, 'grouped.exe'), index,
    expectedSize: bytes.length, expectedSha512: index.sha512, requestClient: () => http, concurrency: 4 });
  assert.equal(peak, 4);
  assert.ok(requests <= 6, `Expected at most 6 requests, got ${requests}`);
  assert.ok(requests < index.chunks.length / 5);
  assert.deepEqual(fs.readFileSync(result.path), bytes);
});
test('server ignoring Range falls back to complete verified download', async t => {
  const { dir, bytes, index } = await fixture(t); const json = JSON.stringify(index);
  const url = await serve(t, (req, res) => { res.writeHead(200); res.end(req.url === '/chunks' ? json : bytes); });
  const progress = [];
  const result = await downloadUpdate({ url: url + '/installer', targetPath: path.join(dir, 'fallback.exe'),
    chunkIndex: { url: url + '/chunks', sha256: crypto.createHash('sha256').update(json).digest('hex') },
    expectedSha512: index.sha512, expectedSize: bytes.length, onProgress: p => progress.push(p) });
  assert.ok(progress.some(p => p.stage === 'fallback')); assert.deepEqual(fs.readFileSync(result.path), bytes);
});
test('corrupt ranged data never publishes an installer and cleans partial files', async t => {
  const { dir, bytes, index } = await fixture(t);
  const url = await serve(t, (req, res) => { const [, a, b] = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range);
    res.writeHead(206, { 'content-range': `bytes ${a}-${b}/${bytes.length}` }); res.end(Buffer.alloc(Number(b) - Number(a) + 1)); });
  const targetPath = path.join(dir, 'bad.exe');
  await assert.rejects(downloadParallel({ urls: [url], targetPath, index, expectedSize: bytes.length,
    expectedSha512: index.sha512, requestClient: () => http }), /checksum/);
  assert.equal(fs.existsSync(targetPath), false);
  assert.equal(fs.readdirSync(dir).some(f => f.endsWith('.part')), false);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { createServer } = require('node:http');
const { createVoiceInput, MAX_AUDIO_BYTES } = require('../lib/voice-input');
const { downloadStreamingAsset } = require('../lib/voice-streaming-models');
const { normalize } = require('../lib/voice-preferences');
const root = path.resolve(__dirname, '..');
const official = () => import('../lib/vendor/dsh-voice/lib/provider.mjs');
function wav() {
  const data = Buffer.alloc(32044);
  data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8);
  data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22);
  data.writeUInt32LE(16000, 24); data.writeUInt32LE(32000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34);
  data.write('data', 36); data.writeUInt32LE(data.length - 44, 40); return data;
}
test('voice defaults require explicit activation and restrict language/source choices', () => {
  assert.deepEqual(normalize(), { enabled: false, shortcut: 'Ctrl+Shift+1', language: 'auto', downloadSource: 'auto' });
  assert.deepEqual(normalize({ enabled: 'true', language: 'unknown', downloadSource: 'http://other.test' }), normalize());
});
test('registration defers config migration until runtimes are initialized', async t => {
  let runtimesReady = false, reads = 0;
  const service = createVoiceInput({ appRoot: root, dataDir: os.tmpdir(), providerFactory: () => {},
    loadConfig: () => {
      assert.equal(runtimesReady, true, 'config migration cannot run during registration');
      reads++;
      return { voice: { enabled: false, language: 'zh', downloadSource: 'mirror' } };
    }, saveConfig: () => {} });
  t.after(() => service.dispose());
  assert.equal(reads, 0);
  assert.equal(service.snapshot().ready, false);
  runtimesReady = true;
  assert.deepEqual((await service.status()).preferences, { enabled: false, shortcut: 'Ctrl+Shift+1', language: 'zh', downloadSource: 'mirror' });
  await service.status();
  assert.equal(reads, 1);
});
test('activation never prepares models; preferences persist, cancellation and cache retention work', async t => {
  let cfg = {}, instances = 0, prepared = 0, aborted = 0, disposed = 0;
  const service = createVoiceInput({ appRoot: root, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'yan-voice-test-')),
    loadConfig: () => cfg, saveConfig: value => { cfg = structuredClone(value); },
    providerFactory: () => {
      instances++;
      let state = { phase: 'unprepared' }, listener;
      return { subscribe: fn => { listener = fn; return () => { listener = undefined; }; }, snapshot: () => state,
        inspect() { listener(); },
        prepare(options) { assert.deepEqual(options, { downloadSource: 'https://hf-mirror.com' }); prepared++; state = { phase: 'ready' }; listener(); },
        async cancel() {}, async dispose() { disposed++; },
        transcribe(_input, signal) { return new Promise((_resolve, reject) => { signal.addEventListener('abort', () => { aborted++; reject(signal.reason); }, { once: true }); }); }
      };
    } });
  t.after(() => service.dispose());
  assert.equal((await service.status()).ready, false); assert.equal(instances, 0);
  await service.configure({ enabled: true, language: 'zh', downloadSource: 'mirror' });
  assert.equal(instances, 1); assert.equal(prepared, 0); assert.equal(cfg.voice.language, 'zh');
  await service.prepare(); assert.equal(service.snapshot().ready, true);
  const transcription = service.transcribe({ requestId: 'cancel-test', audio: wav() });
  await new Promise(resolve => setImmediate(resolve));
  service.cancel('cancel-test'); await assert.rejects(transcription); assert.equal(aborted, 1);
  await assert.rejects(service.transcribe({ requestId: 'bad', audio: Buffer.alloc(MAX_AUDIO_BYTES + 1) }), /长度/);
  await assert.rejects(service.transcribe({ requestId: 'bad-wav', audio: Buffer.alloc(46) }), /canonical/);
  await service.configure({ enabled: false });
  assert.equal(disposed, 1); assert.equal(service.snapshot().ready, false); assert.equal(service.snapshot().installed, true);
  await service.prepare();
  assert.equal(cfg.voice.enabled, true, 'install action enables voice without a separate toggle');
  assert.equal(service.snapshot().ready, true);
  await service.configure({ shortcut: 'Ctrl+Alt+2' });
  assert.equal(cfg.voice.shortcut, 'Ctrl+Alt+2');
});
test('official downloader verifies hash/size, reuses cache and never publishes corrupt files', async t => {
  const { downloadAsset } = await official();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-voice-download-'));
  const bytes = Buffer.from('verified speech asset'); let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end(bytes); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const asset = { name: 'model.onnx', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex'), url: `http://127.0.0.1:${server.address().port}/model` };
  const file = await downloadAsset(asset, dir, new AbortController().signal);
  assert.deepEqual(fs.readFileSync(file), bytes);
  await downloadAsset(asset, dir, new AbortController().signal); assert.equal(requests, 1);
  await assert.rejects(downloadAsset({ ...asset, name: 'bad.onnx', sha256: '0'.repeat(64) }, dir, new AbortController().signal));
  assert.equal(fs.existsSync(path.join(dir, 'bad.onnx')), false);
  assert.equal(fs.readdirSync(dir).some(name => name.endsWith('.part')), false);
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(downloadAsset({ ...asset, name: 'cancelled.onnx' }, dir, cancelled.signal));
  assert.equal(requests, 2);
});
test('cancelling an in-progress official download removes its partial file', async t => {
  const { downloadAsset } = await official();
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-voice-abort-'));
  const server = createServer((_req, res) => { res.write('partial download'); res.on('close', () => res.end()); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(dir, { recursive: true, force: true }); });
  const abort = new AbortController();
  await assert.rejects(downloadAsset({ name: 'cancel.onnx', bytes: 100, sha256: '0'.repeat(64), url: `http://127.0.0.1:${server.address().port}/model` }, dir, abort.signal,
    progress => { if (progress.completedBytes > 0) abort.abort(); }));
  assert.deepEqual(fs.readdirSync(dir), []);
});

test('streaming model downloader uses the pinned repository path and resumes partial files', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-stream-download-'));
  const bytes = Buffer.from('streaming model bytes');
  const asset = { name: 'encoder.int8.onnx', bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
  const root = path.join(dir, 'cache'); fs.mkdirSync(root, { recursive: true });
  fs.writeFileSync(path.join(root, `${asset.name}.part`), bytes.subarray(0, 9));
  const requests = [];
  const result = await downloadStreamingAsset(asset, root, {
    sources: ['https://hf-mirror.com'], signal: new AbortController().signal,
    fetchImpl: async (url, options) => {
      requests.push({ url, range: options.headers?.Range });
      const start = Number(options.headers?.Range?.match(/bytes=(\d+)-/)?.[1] || 0);
      return new Response(bytes.subarray(start), { status: start ? 206 : 200, headers: start ? { 'content-range': `bytes ${start}-${bytes.length - 1}/${bytes.length}` } : {} });
    },
  });
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(fs.readFileSync(result).toString(), bytes.toString());
  assert.match(requests[0].url, /hf-mirror\.com\/csukuangfj\/sherpa-onnx-streaming-zipformer-zh-int8-2025-06-30\/resolve\//);
  assert.doesNotMatch(requests[0].url, /csukuangfj\/csukuangfj/);
  assert.equal(requests[0].range, 'bytes=9-');
  assert.equal(fs.existsSync(`${result}.part`), false);
});

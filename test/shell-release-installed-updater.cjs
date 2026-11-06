'use strict';
// Exercise the user's installed updater against the real new installer via
// local HTTP ranges, with the existing cache as a read-only baseline.
const fs = require('node:fs'), path = require('node:path'), os = require('node:os'), http = require('node:http'), crypto = require('node:crypto'), assert = require('node:assert/strict');
(async () => {
  const root = path.resolve(__dirname, '..'), dir = path.join(root, 'dist/shell-release-20261019');
  const feed = JSON.parse(fs.readFileSync(path.join(dir, 'latest.json'))), name = feed.files[0].name;
  const target = path.join(dir, name), baseline = path.join(process.env.APPDATA, 'yan-agent/update-cache/Yan.Agent.Setup.v1.8.0.Beta1-RC1.update-fix.exe');
  const installed = require('D:/Yan Agent/resources/app.asar.unpacked/lib/update-checker.js');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-installed-delta-'));
  let transferred = 0, requests = 0, active = 0, peak = 0;
  const server = http.createServer((req, res) => {
    if (req.url === '/chunks') { res.end(fs.readFileSync(target + '.chunks.json')); return; }
    const match = /^bytes=(\d+)-(\d+)$/.exec(req.headers.range || '');
    if (!match) { res.writeHead(400); res.end(); return; }
    const start = +match[1], end = +match[2]; requests++; active++; peak = Math.max(peak, active); transferred += end - start + 1;
    res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${feed.size}`, 'content-length': end - start + 1 });
    res.once('close', () => active--); fs.createReadStream(target, { start, end }).pipe(res);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}`;
    const result = await installed.downloadUpdate({ url: url + '/installer', targetPath: path.join(temp, name), expectedSha512: feed.sha512, expectedSize: feed.size,
      baselinePath: baseline, chunkIndex: { ...feed.files[0].chunkIndex, url: url + '/chunks' }, concurrency: 4 });
    assert.equal(crypto.createHash('sha512').update(fs.readFileSync(result.path)).digest('base64'), feed.sha512);
    assert.ok(result.reusedBytes > 0); assert.ok(transferred < feed.size); assert.ok(peak <= 4);
    const report = { ok: true, installedBuild: require('D:/Yan Agent/resources/app.asar.unpacked/lib/build-manifest.json').buildId, newBuild: feed.buildId,
      baseline, downloadedBytes: transferred, reusedBytes: result.reusedBytes, installerBytes: feed.size, requests, peak, reconstructed: result.path };
    fs.writeFileSync(path.join(root, '.yanagent/evidence/shell-release-installed-differential.json'), JSON.stringify(report, null, 2)); console.log(report);
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

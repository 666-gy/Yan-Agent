'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const {
  checkForUpdates,
  compareVersions,
  downloadUpdate,
  parseLatestYml,
  resolveFileUrl
} = require('../lib/update-checker');

const SAMPLE_YML = `version: 1.6.0-beta.3
files:
  - url: Yan.Agent.Setup.v1.6.0.Beta3.exe
    sha512: E2WQ0zjkHD0w0iDgg5g8+LfTgakaHzKkhkKDLuimkT+/iDR7nwT8LL5RlYXO9KHURsBu9cSnZKhGJXX9SB9KVA==
    size: 322867034
path: Yan.Agent.Setup.v1.6.0.Beta3.exe
sha512: E2WQ0zjkHD0w0iDgg5g8+LfTgakaHzKkhkKDLuimkT+/iDR7nwT8LL5RlYXO9KHURsBu9cSnZKhGJXX9SB9KVA==
releaseDate: '2026-09-14T13:00:53.656Z'
`;

test('parseLatestYml reads electron-builder feed fields', () => {
  const feed = parseLatestYml(SAMPLE_YML);
  assert.equal(feed.version, '1.6.0-beta.3');
  assert.equal(feed.fileName, 'Yan.Agent.Setup.v1.6.0.Beta3.exe');
  assert.equal(feed.fileUrl, 'Yan.Agent.Setup.v1.6.0.Beta3.exe');
  assert.equal(feed.size, 322867034);
  assert.equal(feed.releaseDate, '2026-09-14T13:00:53.656Z');
  assert.ok(feed.sha512.startsWith('E2WQ0zjkHD0w0iDgg5g8+'));
});

test('compareVersions orders stable and prerelease versions', () => {
  assert.equal(compareVersions('1.6.0-beta.3', '1.6.0-beta.2'), 1);
  assert.equal(compareVersions('1.6.0-beta.2', '1.6.0-beta.3'), -1);
  assert.equal(compareVersions('1.6.0-beta.3', '1.6.0-beta.3'), 0);
  assert.equal(compareVersions('1.6.0-beta.10', '1.6.0-beta.9'), 1);
  assert.equal(compareVersions('1.6.0', '1.6.0-beta.3'), 1);
  assert.equal(compareVersions('1.6.0-beta.3', '1.6.0'), -1);
  assert.equal(compareVersions('1.6.1', '1.6.0-beta.3'), 1);
  assert.equal(compareVersions('v1.7.0', '1.6.0'), 1);
});

test('resolveFileUrl keeps absolute urls and encodes relative names', () => {
  assert.equal(resolveFileUrl('https://example.com/base/', 'https://cdn.example.com/a.exe'), 'https://cdn.example.com/a.exe');
  assert.equal(
    resolveFileUrl('https://example.com/base', 'Yan Agent Setup.exe'),
    'https://example.com/base/Yan%20Agent%20Setup.exe'
  );
});

test('checkForUpdates and downloadUpdate work against a local server', async () => {
  const payload = Buffer.from('yan-agent-update-payload');
  const sha512 = crypto.createHash('sha512').update(payload).digest('base64');
  const yml = SAMPLE_YML
    .replaceAll('Yan.Agent.Setup.v1.6.0.Beta3.exe', 'pkg.bin')
    .replace(/E2WQ0zjkHD0w0iDgg5g8\+LfTgakaHzKkhkKDLuimkT\+\/iDR7nwT8LL5RlYXO9KHURsBu9cSnZKhGJXX9SB9KVA==/g, sha512)
    .replace('size: 322867034', `size: ${payload.length}`);

  const server = http.createServer((req, res) => {
    if (req.url === '/latest.yml') {
      res.writeHead(200, { 'content-type': 'text/yaml' });
      res.end(yml);
      return;
    }
    if (req.url === '/pkg.bin') {
      res.writeHead(200, { 'content-type': 'application/octet-stream', 'content-length': String(payload.length) });
      res.end(payload);
      return;
    }
    res.writeHead(404);
    res.end('not found');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;

  try {
    const info = await checkForUpdates({ baseUrl, currentVersion: '1.6.0-beta.2' });
    assert.equal(info.ok, true);
    assert.equal(info.hasUpdate, true);
    assert.equal(info.latestVersion, '1.6.0-beta.3');
    assert.equal(info.fileName, 'pkg.bin');
    assert.equal(info.sha512, sha512);
    assert.equal(info.size, payload.length);

    const upToDate = await checkForUpdates({ baseUrl, currentVersion: '1.6.0-beta.3' });
    assert.equal(upToDate.ok, true);
    assert.equal(upToDate.hasUpdate, false);

    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-update-test-'));
    const target = path.join(tempDir, 'pkg.bin');
    const progress = [];
    const result = await downloadUpdate({
      url: info.fileUrl,
      targetPath: target,
      expectedSha512: info.sha512,
      expectedSize: info.size,
      onProgress: (p) => progress.push(p.percent)
    });
    assert.equal(result.sha512, sha512);
    assert.equal(result.size, payload.length);
    assert.deepEqual(fs.readFileSync(target), payload);
    assert.ok(progress.length > 0 && progress[progress.length - 1] === 100);

    const mismatchTarget = path.join(tempDir, 'mismatch.bin');
    await assert.rejects(
      downloadUpdate({ url: info.fileUrl, targetPath: mismatchTarget, expectedSha512: 'wrong-hash' }),
      /sha512-mismatch/
    );
    assert.equal(fs.existsSync(mismatchTarget), false);

    const missing = await checkForUpdates({ baseUrl: `${baseUrl}/missing-prefix`, currentVersion: '1.6.0-beta.2' });
    assert.equal(missing.ok, false);
    assert.equal(missing.error, 'http-404');
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

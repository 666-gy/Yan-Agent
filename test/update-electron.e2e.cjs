'use strict';

// Run with node test/update-electron.e2e.cjs; the child exercises real net.request.
if (!process.versions.electron || process.type !== 'browser') {
  const { spawn } = require('child_process');
  const env = { ...process.env };
  delete env.ELECTRON_RUN_AS_NODE;
  const child = spawn(require('electron'), [__filename], { env, stdio: 'inherit' });
  child.on('error', error => { console.error(error); process.exitCode = 1; });
  child.on('exit', code => { process.exitCode = code === 0 ? 0 : 1; });
} else {
  const { app, BrowserWindow } = require('electron');
  const assert = require('assert/strict');
  const crypto = require('crypto');
  const fs = require('fs');
  const http = require('http');
  const os = require('os');
  const path = require('path');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-update-regression-'));
  app.setPath('userData', profile);
  const watchdog = setTimeout(() => { console.error('Electron regression timed out'); app.exit(1); }, 30000);
  app.whenReady().then(async () => {
    const keepAlive = setInterval(() => {}, 100);
    const window = new BrowserWindow({ show: false });
    await window.loadURL('data:text/html,update-regression');
    console.log('Electron regression ready');
    const updater = require('../lib/update-checker');
    const payload = Buffer.from('verified Electron updater payload');
    const sha512 = crypto.createHash('sha512').update(payload).digest('base64');
    const sockets = new Set();
    const server = http.createServer((req, res) => {
      if (req.url.startsWith('/stall/')) return;
      if (req.url === '/partial') {
        res.writeHead(200, { 'content-length': 1000 });
        res.write('partial');
        return;
      }
      if (req.url.startsWith('/large/')) { res.end('x'.repeat(600 * 1024)); return; }
      if (req.url === '/redirect') { res.writeHead(302, { location: '/package' }); res.end(); return; }
      res.writeHead(200, { 'content-length': payload.length });
      res.end(payload);
    });
    server.on('connection', socket => {
      sockets.add(socket);
      socket.on('close', () => sockets.delete(socket));
    });
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = `http://127.0.0.1:${server.address().port}`;
    const targetPath = path.join(profile, 'update.bin');
    try {
      const timeout = await updater.checkForUpdates({ baseUrl: `${baseUrl}/stall`, fallbackBaseUrl: '', timeoutMs: 300 });
      assert.equal(timeout.ok, false);
      assert.equal(timeout.error, 'timeout');
      console.log('PASS feed timeout without recursion');

      await assert.rejects(updater.downloadUpdate({ url: `${baseUrl}/partial`, targetPath, timeoutMs: 500 }), /timeout/);
      assert.equal(fs.existsSync(targetPath), false);
      console.log('PASS partial download timeout and cleanup');

      const large = await updater.checkForUpdates({ baseUrl: `${baseUrl}/large`, fallbackBaseUrl: '', timeoutMs: 5000 });
      assert.equal(large.error, 'feed-too-large');
      console.log('PASS oversized feed cancellation');

      const downloaded = await updater.downloadUpdate({ url: `${baseUrl}/redirect`, targetPath, expectedSha512: sha512, expectedSize: payload.length, timeoutMs: 5000 });
      assert.equal(downloaded.sha512, sha512);
      assert.deepEqual(fs.readFileSync(targetPath), payload);
      console.log('PASS redirected download and checksum');

      await assert.rejects(updater.downloadUpdate({ url: `${baseUrl}/package`, targetPath, expectedSha512: 'wrong', timeoutMs: 5000 }), /sha512-mismatch/);
      assert.equal(fs.existsSync(targetPath), false);
      console.log('PASS checksum failure cleanup');

      for (const socket of sockets) socket.destroy();
      await new Promise(resolve => server.close(resolve));
      const refused = await updater.checkForUpdates({ baseUrl, fallbackBaseUrl: '', timeoutMs: 5000 });
      assert.equal(refused.ok, false);
      assert.match(refused.error, /CONNECTION_REFUSED/);
      console.log('PASS connection refused without crash');
    } finally {
      for (const socket of sockets) socket.destroy();
      server.close();
      clearTimeout(watchdog);
      clearInterval(keepAlive);
    }
    app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}

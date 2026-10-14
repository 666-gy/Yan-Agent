'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-lifecycle-'));
const until = async (fn, timeout = 12000) => {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (await fn()) return; await new Promise(r => setTimeout(r, 100)); }
  throw new Error('Timed out');
};
(async () => {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'text/html');
    res.end(`<title>Lifecycle ${req.url}</title><h1>PDF export test</h1><input id="edit"><script>window.ticks=0;setInterval(()=>window.ticks++,50)</script>`);
  });
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}`;
  const launch = () => _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
  let app;
  try {
    app = await launch(); let page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    const ids = [];
    for (const suffix of ['sleep', 'edited', 'agent', 'active']) {
      await page.evaluate(url => openBrowserUrlInNewTab(url), `${url}/${suffix}`);
      await until(() => app.evaluate(({ webContents }, suffix) => webContents.getAllWebContents().some(w => w.getType() === 'webview' && w.getURL().endsWith('/' + suffix) && !w.isLoading()), suffix));
      ids.push(await app.evaluate(({ webContents }, suffix) => webContents.getAllWebContents().find(w => w.getType() === 'webview' && w.getURL().endsWith('/' + suffix)).id, suffix));
    }
    assert.deepEqual(await app.evaluate(({ webContents }, ids) => ids.map(id => webContents.fromId(id).getZoomMode()), ids), ['isolated','isolated','isolated','isolated']);
    await app.evaluate(({ webContents }, ids) => { webContents.fromId(ids[0]).setZoomFactor(1.25); webContents.fromId(ids[1]).setZoomFactor(0.8); }, ids);
    assert.deepEqual(await app.evaluate(({ webContents }, ids) => ids.slice(0, 2).map(id => webContents.fromId(id).getZoomFactor()), ids), [1.25, 0.8]);
    const pdf = path.join(profile, 'page.pdf');
    await app.evaluate(({ dialog }, pdf) => { dialog.showSaveDialog = async () => ({ canceled: false, filePath: pdf }); }, pdf);
    // Exercise the real menu button as well as the backend output.
    await page.locator('.rs-browser-panel.active [data-browser-action="settings"]').click();
    await page.locator('.rs-browser-panel.active [data-browser-export-pdf]').click();
    await until(() => fs.existsSync(pdf) && fs.statSync(pdf).size > 1000); assert.equal(fs.readFileSync(pdf).subarray(0, 5).toString(), '%PDF-');
    assert.ok(fs.statSync(pdf).size > 1000);
    await app.evaluate(({ dialog }) => { dialog.showSaveDialog = async () => ({ canceled: true }); });
    assert.equal((await page.evaluate(id => window.yan.browserExportPdf(id), ids[3])).canceled, true);
    const denied = await page.evaluate(async () => { try { await window.yan.browserExportPdf(999999); return false; } catch { return true; } });
    assert.equal(denied, true);
    const expected = await app.evaluate(({ BrowserWindow, app, screen }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html'));
      win.unmaximize();
      const area = screen.getPrimaryDisplay().workArea;
      win.setBounds({ x: area.x + 40, y: area.y + 40, width: 1000, height: 720 });
      return { bounds: win.getBounds(), switches: [app.commandLine.hasSwitch('ignore-gpu-blocklist'), app.commandLine.hasSwitch('enable-unsafe-swiftshader')], throttling: win.webContents.getBackgroundThrottling() };
    });
    assert.deepEqual(expected.switches, [false, false]); assert.equal(expected.throttling, false);
    await new Promise(r => setTimeout(r, 700));
    await app.close(); app = await launch(); page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    const restored = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html')).getBounds());
    for (const key of ['x','y','width','height']) assert.ok(Math.abs(restored[key] - expected.bounds[key]) <= 2, JSON.stringify({ restored, expected: expected.bounds }));
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html')).maximize());
    await new Promise(r => setTimeout(r, 700));
    await app.close(); app = await launch(); page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html')).isMaximized()), true);
    await app.close(); app = null;
    const localStateFile = path.join(profile, 'Local State');
    const localState = JSON.parse(fs.readFileSync(localStateFile, 'utf8'));
    const saved = localState.windowStates['yan-main-window'];
    Object.assign(saved, { left: -30000, top: -30000, right: -29000, bottom: -29280, maximized: false });
    fs.writeFileSync(localStateFile, JSON.stringify(localState));
    app = await launch(); page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    assert.equal(await app.evaluate(({ BrowserWindow, screen }) => {
      const b = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('renderer/index.html')).getBounds();
      return screen.getAllDisplays().some(({ workArea: a }) => Math.min(b.x+b.width,a.x+a.width)-Math.max(b.x,a.x)>100 && Math.min(b.y+b.height,a.y+a.height)-Math.max(b.y,a.y)>100);
    }), true, 'disconnected/offscreen display coordinates are recovered');
    console.log('Browser lifecycle passed: independent same-origin zoom, real PDF/cancel, bounds and maximized restart restore, GPU defaults and throttling.');
  } finally { if (app) await app.close(); await new Promise(r => server.close(r)); }
})().catch(error => { console.error(error); process.exitCode = 1; });

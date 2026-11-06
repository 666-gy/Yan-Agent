'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..'), temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-first-paint-'));
const bootstrap = path.join(temp, 'main.cjs');
fs.mkdirSync(path.join(temp, 'data/YanData'), { recursive: true });
fs.writeFileSync(path.join(temp, 'data/YanData/config.json'), JSON.stringify({ theme: 'light' }));
fs.writeFileSync(bootstrap, `
const { app, ipcMain } = require('electron');
global.firstPaintProbe = { ready: false, shows: [] };
ipcMain.on('win:ui-ready', () => { global.firstPaintProbe.ready = true; });
app.on('browser-window-created', (_, win) => {
  win.on('show', () => {
    if (win.webContents.getURL().includes('/renderer/index.html')) global.firstPaintProbe.shows.push({ ready: global.firstPaintProbe.ready, background: win.getBackgroundColor() });
  });
});
require(${JSON.stringify(path.join(root, 'main.js'))});
`);
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [bootstrap], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(temp, 'data') } });
    const page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.waitForFunction(() => quickInputHandlerReady && !!state.currentSession);
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html'));
      for (let i = 0; i < 100 && !win.isVisible(); i++) await new Promise(r => setTimeout(r, 20));
    });
    const probe = await app.evaluate(() => global.firstPaintProbe);
    assert.ok(probe.shows.length); assert.equal(probe.shows[0].ready, true, 'never expose incomplete initial session');
    assert.match(probe.shows[0].background, /ffffff$/i);
    assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html')).webContents.getBackgroundThrottling()), false);
    const stats = await page.evaluate(() => ({ initMs: performance.getEntriesByName('yan-init')[0].duration, session: state.currentSession.id }));
    const welcomeControls = page.locator('#yanStartupHello .hello-window-controls');
    if (await welcomeControls.count()) {
      const max = welcomeControls.locator('[data-window="maximize"]');
      const initial = await max.getAttribute('aria-label');
      await max.click();
      await page.waitForFunction(label => document.querySelector('.hello-window-controls [data-window="maximize"]').getAttribute('aria-label') !== label, initial);
      await max.click();
      await page.waitForFunction(label => document.querySelector('.hello-window-controls [data-window="maximize"]').getAttribute('aria-label') === label, initial);
      await welcomeControls.locator('[data-window="minimize"]').click();
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html'));
        for (let i = 0; i < 100 && !win.isMinimized(); i++) await new Promise(r => setTimeout(r, 20));
        if (!win.isMinimized()) throw new Error('Welcome minimize did not minimize');
        win.restore();
      });
      await welcomeControls.locator('[data-window="close"]').click();
      await app.evaluate(async ({ BrowserWindow }) => {
        const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html'));
        for (let i = 0; i < 100 && win.isVisible(); i++) await new Promise(r => setTimeout(r, 20));
        if (win.isVisible()) throw new Error('Welcome close did not hide to tray');
        win.show();
      });
    }
    for (let i = 0; i < 3; i++) {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html')).minimize());
      await new Promise(r => setTimeout(r, 120));
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html')).restore());
      assert.equal(await page.evaluate(() => state.currentSession.id), stats.session);
      assert.equal(await page.evaluate(() => !!document.querySelector('#app') && !document.querySelector('#yanFatalError')), true);
    }
    await page.evaluate(() => applyTheme('dark'));
    await app.evaluate(async ({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html'));
      for (let i = 0; i < 100 && !/101011$/i.test(win.getBackgroundColor()); i++) await new Promise(r => setTimeout(r, 10));
    });
    assert.match(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().includes('/renderer/index.html')).getBackgroundColor()), /101011$/i);
    const welcome = page.locator('#yanStartupHello .hello-enter');
    if (await welcome.count()) await welcome.click();
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-browser').click();
    assert.equal(await page.locator('#browserPreferences > .browser-section-title').allTextContents().then(x => x.includes('密码')), true);
    console.log('First paint ready gate, theme-matched native background, three minimize/restores and password heading passed:', stats);
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

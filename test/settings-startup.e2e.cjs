'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-settings-startup-'));
fs.mkdirSync(path.join(userData, 'YanData'), { recursive: true });
fs.writeFileSync(path.join(userData, 'YanData/config.json'), JSON.stringify({ appearance: { reduceMotion: 'on' } }));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    // Let startup detection finish while Settings remains detached, as in normal use.
    await page.waitForFunction(() => vsCodeStatus.available);
    const startup = await page.evaluate(() => ({
      detected: vsCodeStatus.available,
      executable: vsCodeStatus.executable,
      connected: settingsOverlay.isConnected,
      savedMotion: state.config.appearance.reduceMotion,
      appliedMotion: document.documentElement.dataset.reduceMotion,
    }));
    console.log('Startup:', JSON.stringify(startup));
    assert.equal(startup.connected, false);
    await page.locator('#settingsBtn').click();
    await page.waitForFunction(() => settingsOverlay.isConnected);
    await page.evaluate(() => closeSettings());
    await page.waitForFunction(() => !settingsOverlay.isConnected);
    await page.locator('#settingsBtn').click();
    await page.waitForFunction(() => settingsOverlay.isConnected);
    assert.equal(startup.savedMotion, 'off');
    assert.equal(startup.appliedMotion, 'false');
    await page.reload();
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady && vsCodeStatus.available);
    await page.locator('#settingsBtn').click();
    await page.waitForFunction(() => settingsOverlay.isConnected);
    assert.equal(await page.evaluate(() => document.documentElement.dataset.reduceMotion), 'false');
    console.log('Delayed settings open, reopen/reload and legacy motion migration passed.');
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

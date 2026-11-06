'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { _electron } = require('playwright');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-update-reopen-'));
  let app;
  try {
    app = await _electron.launch({ executablePath: path.resolve('dist/win-unpacked/Yan Agent.exe'),
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    await app.evaluate(({ ipcMain }) => {
      globalThis.updateTest = { checks: 0, downloads: 0 };
      ipcMain.removeHandler('update:check'); ipcMain.removeHandler('update:download');
      ipcMain.handle('update:check', () => { globalThis.updateTest.checks++; return { ok: true, hasUpdate: true, latestVersion: '1.8.0-beta.1-rc.1' }; });
      ipcMain.handle('update:download', event => {
        globalThis.updateTest.downloads++;
        event.sender.send('update:progress', { percent: 42 });
        return new Promise(resolve => { globalThis.updateTest.finish = resolve; });
      });
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    const openCheck = () => page.evaluate(() => {
      document.querySelector('#titlebarHelpMenuBtn').click();
      document.querySelector('#titlebarHelpMenu [data-titlebar-action="check-update"]').click();
    });
    await openCheck();
    await page.locator('#yan-update-dialog .install').click();
    await page.waitForFunction(() => document.querySelector('#yan-update-dialog .percent').textContent === '42%');
    await page.locator('#yan-update-dialog .close').click();
    await openCheck();
    assert.equal(await page.locator('#yan-update-dialog').isVisible(), true);
    assert.equal(await page.locator('#yan-update-dialog .percent').textContent(), '42%');
    await page.keyboard.press('Escape');
    await app.evaluate(() => globalThis.updateTest.finish({ ok: true }));
    await page.waitForFunction(() => document.querySelector('#yan-update-dialog .install').textContent === '下载完成，安装并重启');
    await openCheck();
    assert.equal(await page.locator('#yan-update-dialog .install').isEnabled(), true);
    const counts = await app.evaluate(() => ({ checks: globalThis.updateTest.checks, downloads: globalThis.updateTest.downloads }));
    assert.deepEqual(counts, { checks: 1, downloads: 1 });
    console.log('PASS close/Escape, reopen download progress and completed installer; no duplicate requests');
  } finally { await app?.close(); fs.rmSync(profile, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

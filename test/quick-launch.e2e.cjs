'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-quick-launch-e2e-'));
const outputDir = path.join(appRoot, 'output', 'playwright');
const screenshotPath = path.join(outputDir, 'quick-launch-settings.png');
fs.mkdirSync(outputDir, { recursive: true });

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof openSettings === 'function');
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="general"]').click();
    await page.locator('#tab-general.active').waitFor();

    assert.equal(await page.locator('#quickLaunchEnabled').isChecked(), true);
    assert.equal(await page.locator('#quickLaunchShortcutLabel').textContent(), 'Ctrl+Shift+Y');
    await page.screenshot({ path: screenshotPath, fullPage: false });

    await page.locator('#quickLaunchEnabled').uncheck();
    await page.waitForFunction(async () => (await window.yan.getQuickLaunch()).settings.enabled === false);

    await page.locator('#quickLaunchShortcutRecorder').click();
    await page.keyboard.press('Control+Alt+K');
    await page.waitForFunction(async () => {
      const state = await window.yan.getQuickLaunch();
      return state.settings.shortcut === 'Control+Alt+K' && state.settings.enabled === false;
    });
    assert.equal(await page.locator('#quickLaunchShortcutLabel').textContent(), 'Ctrl+Alt+K');

    await page.locator('#quickLaunchEnabled').check();
    await page.waitForFunction(async () => {
      const state = await window.yan.getQuickLaunch();
      return state.settings.enabled === true && state.registered === true;
    });
    await page.locator('#quickLaunchEnabled').uncheck();
    await page.waitForFunction(async () => (await window.yan.getQuickLaunch()).settings.enabled === false);

    assert.equal(await page.locator('#quickLaunchReset').count(), 0);
    assert.equal(await page.locator('#quickLaunchPreviewLink').count(), 0);

    await page.locator('#closeSettings').click();
    await page.locator('#winClose').click();
    await page.waitForTimeout(120);
    const mainWindowState = await application.evaluate(({ BrowserWindow }) => {
      const main = BrowserWindow.getAllWindows()
        .filter(window => !window.isDestroyed())
        .sort((left, right) => right.getBounds().width - left.getBounds().width)[0];
      return main ? { visible: main.isVisible(), destroyed: main.isDestroyed() } : null;
    });
    assert.deepEqual(mainWindowState, { visible: false, destroyed: false });

    console.log(JSON.stringify({ ok: true, screenshotPath }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

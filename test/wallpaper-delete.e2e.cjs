'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-wallpaper-delete-e2e-'));

async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_E2E_MODE: '1',
      YAN_E2E_USER_DATA_DIR: userDataDir
    }
  });
}

(async () => {
  let application;
  try {
    application = await launch();
    let page = await application.firstWindow();
    await page.waitForFunction(() => typeof yan !== 'undefined');
    await page.evaluate(async () => {
      const config = await yan.setConfig({ wallpaper: { id: 'sword-and-sakura', removed: [], custom: [] } });
      applyWallpaperConfig(config);
    });
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="general"]').click();
    await page.locator('#wallpaperMarketGrid').waitFor();

    const deleteButton = page.locator('[data-wallpaper-delete="sword-and-sakura"]');
    assert.equal(await deleteButton.count(), 1);
    await deleteButton.click();
    await page.locator('#genericConfirmModal:not(.hidden)').waitFor();
    assert.equal(await page.locator('#genericConfirmCancel').textContent(), '保留');
    await page.locator('#genericConfirmCancel').click();
    assert.equal(await deleteButton.isVisible(), true);

    await deleteButton.click();
    await page.locator('#genericConfirmModal:not(.hidden)').waitFor();
    await page.locator('#genericConfirmAccept').click();
    await page.waitForFunction(() => document.querySelector('[data-wallpaper-id="sword-and-sakura"]')?.hidden === true);
    const afterDelete = await page.evaluate(() => yan.getConfig());
    assert.equal(afterDelete.wallpaper.id, '');
    assert.ok(afterDelete.wallpaper.removed.includes('sword-and-sakura'));

    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page.waitForFunction(() => typeof yan !== 'undefined');
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="general"]').click();
    await page.locator('#wallpaperMarketGrid').waitFor();
    assert.equal(await page.locator('[data-wallpaper-id="sword-and-sakura"]').evaluate(element => element.hidden), true);
    console.log(JSON.stringify({ ok: true, persistedRemoved: 'sword-and-sakura' }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

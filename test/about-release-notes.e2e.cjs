'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-about-docs-e2e-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof window.yan?.openReleaseNotes === 'function');
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="about"]').click();

    const button = page.locator('#aboutReleaseNotesBtn');
    await button.waitFor();
    assert.equal(await button.isEnabled(), true);
    assert.equal(await button.textContent(), '更新文档');
    await button.click();
    await page.waitForFunction(() => !document.querySelector('#aboutReleaseNotesBtn')?.disabled);

    const result = await page.evaluate(() => window.yan.openReleaseNotes());
    assert.deepEqual(result, {
      url: 'https://github.com/666-gy/Yan-Agent/blob/main/README.md'
    });
    console.log(JSON.stringify({ ok: true, result }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

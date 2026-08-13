'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-user-name-e2e-'));
const outputDir = path.join(appRoot, 'output', 'playwright');
const screenshotPath = path.join(outputDir, 'user-name-sidebar.png');
fs.mkdirSync(outputDir, { recursive: true });

async function launch() {
  const application = await electron.launch({
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
  await page.locator('#userNameInput').waitFor();
  await page.waitForFunction(async () => {
    const config = await window.yan.getConfig();
    return document.querySelector('#userNameInput')?.value === config.userName;
  });
  return { application, page };
}

(async () => {
  let application;
  try {
    let launched = await launch();
    application = launched.application;
    let page = launched.page;

    assert.equal(await page.locator('#userNameInput').inputValue(), 'Yanxi');
    assert.match(await page.locator('#greeting').textContent(), /^Good (morning|afternoon|evening), Yanxi$/);

    await page.locator('#userNameInput').click();
    await page.locator('#userNameInput').fill('Alice');
    assert.match(await page.locator('#greeting').textContent(), /^Good (morning|afternoon|evening), Alice$/);
    await page.locator('#userNameInput').press('Enter');
    await page.waitForFunction(async () => (await window.yan.getConfig()).userName === 'Alice');

    const geometry = await page.evaluate(() => {
      const settings = document.querySelector('#settingsBtn').getBoundingClientRect();
      const input = document.querySelector('#userNameInput').getBoundingClientRect();
      return {
        settingsRight: settings.right,
        inputLeft: input.left,
        inputRight: input.right,
        sidebarRight: document.querySelector('#sidebar').getBoundingClientRect().right,
        inputBackground: getComputedStyle(document.querySelector('#userNameInput')).backgroundColor
      };
    });
    assert.ok(geometry.inputLeft >= geometry.sidebarRight - 360);
    assert.ok(geometry.inputRight <= geometry.sidebarRight);
    assert.equal(geometry.inputBackground, 'rgba(0, 0, 0, 0)');
    await page.screenshot({ path: screenshotPath, fullPage: false });

    await application.close();
    application = null;

    launched = await launch();
    application = launched.application;
    page = launched.page;
    assert.equal(await page.locator('#userNameInput').inputValue(), 'Alice');
    assert.match(await page.locator('#greeting').textContent(), /^Good (morning|afternoon|evening), Alice$/);

    console.log(JSON.stringify({ ok: true, screenshotPath }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

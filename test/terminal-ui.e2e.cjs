'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-terminal-ui-e2e-'));

(async () => {
  let application;
  const pageErrors = [];
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
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => typeof openRightSidebarTool === 'function'
      && window.YanTerminal
      && document.querySelector('#rightSidebarLauncher')
      && state.currentSession);

    if (!(await page.locator('#rightSidebarLauncher').isVisible())) {
      await page.locator('#rightSidebarToggleBtn').click();
    }
    await page.locator('#rightSidebarLauncher [data-rs-open-tool="terminal"]').click();
    await page.locator('.rs-tab-unit[data-rs-tab-type="terminal"]').waitFor({ state: 'attached' });
    await page.locator('.rs-panel[id^="rs-terminal-"] .xterm').waitFor({ timeout: 15_000 });

    await page.waitForFunction(() => document.querySelectorAll('.rs-tab-unit[data-rs-tab-type="terminal"]').length === 1);
    await page.waitForTimeout(700);
    await page.keyboard.type('Write-Output "中文终端"');
    await page.keyboard.press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('.terminal-panel .xterm-rows')].some(node => node.textContent.includes('中文终端')), null, { timeout: 15_000 });

    await page.locator('#rightSidebarAddBtn').click();
    await page.locator('#rightSidebarAddMenu [data-rs-open-tool="terminal"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.rs-tab-unit[data-rs-tab-type="terminal"]').length === 2);
    await page.locator('.rs-tab-unit[data-rs-tab-type="terminal"]').last().locator('.rs-work-tab-close').click();
    await page.waitForFunction(() => document.querySelectorAll('.rs-tab-unit[data-rs-tab-type="terminal"]').length === 1);

    assert.equal(await page.locator('.rs-panel[id^="rs-terminal-"][aria-hidden="false"]').count(), 1);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, ordinarySidebarTerminalTabs: 1, chineseOutput: true }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

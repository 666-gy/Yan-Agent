'use strict';

// Right-dock acceptance: the floating expand/close toggle and the sidebar
// welcome launcher are gone; a right-center dock replaces them with the panel
// tools joined in a pill plus a circular close button that only shows
// while the panel holds an explicit tab.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-right-dock-e2e-'));
const outputDir = path.join(appRoot, 'output', 'playwright');
fs.mkdirSync(outputDir, { recursive: true });

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
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => typeof syncRightDock === 'function'
      && typeof openRightSidebarTool === 'function'
      && document.querySelector('#rightDock')
      && state.currentSession);

    assert.equal(await page.locator('#rightSidebarToggleBtn').count(), 0, 'floating toggle must be deleted');
    assert.equal(await page.locator('#rightSidebarLauncher').count(), 0, 'launcher panel must be deleted');
    assert.equal(await page.locator('#rightDock .rs-dock-btn').count(), 3, 'dock must hold the three tools');

    const dockGeometry = await page.evaluate(() => {
      const column = document.querySelector('.chat-main-column').getBoundingClientRect();
      const dock = document.querySelector('#rightDock').getBoundingClientRect();
      const nav = document.querySelector('#turnScaleNav')?.getBoundingClientRect();
      return {
        columnCenterY: column.top + column.height / 2,
        dockCenterY: dock.top + dock.height / 2,
        dockRightGap: column.right - dock.right,
        dockLeftGap: dock.left - column.left,
        navLeftGap: nav ? nav.left - column.left : null,
        closeHidden: document.querySelector('#rightDockClose').classList.contains('hidden')
      };
    });
    assert.ok(Math.abs(dockGeometry.columnCenterY - dockGeometry.dockCenterY) <= 2,
      `dock must be vertically centered, got ${JSON.stringify(dockGeometry)}`);
    assert.ok(dockGeometry.dockRightGap >= 12 && dockGeometry.dockRightGap <= 40,
      `dock must sit slightly inside the chat column's right edge, got ${JSON.stringify(dockGeometry)}`);
    assert.equal(dockGeometry.closeHidden, true, 'close button must stay hidden without a tab');
    assert.equal(await page.locator('#app').evaluate(node => node.classList.contains('rs-hidden')), true);
    const dockShot = path.join(outputDir, 'right-dock-idle.png');
    await page.screenshot({ path: dockShot });

    await page.locator('#rightDock [data-rs-dock-tool="interjection"]').click();
    await page.locator('#rs-interjection.active').waitFor({ timeout: 15_000 });
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('rs-hidden'));
    assert.equal(await page.locator('#rightDockClose').isVisible(), true, 'close button must appear with an open tab');
    assert.equal(await page.locator('#rightDock [data-rs-dock-tool="interjection"]').getAttribute('aria-pressed'), 'true');
    const openShot = path.join(outputDir, 'right-dock-panel-open.png');
    await page.screenshot({ path: openShot });

    await page.locator('#rightDockClose').click();
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('rs-hidden'));
    assert.equal(await page.locator('#rightDockClose').isVisible(), false);
    assert.equal(await page.locator('#rightDock [data-rs-dock-tool="interjection"]').getAttribute('aria-pressed'), 'false');

    await page.locator('#rightDock [data-rs-dock-tool="review"]').click();
    await page.locator('#rs-review.active').waitFor();
    await page.locator('#rightDock [data-rs-dock-tool="review"]').click();
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('rs-hidden'));

    await page.locator('#rightDock [data-rs-dock-tool="interjection"]').click();
    await page.locator('#rs-interjection.active').waitFor();
    while (await page.locator('.rs-tab-unit').count()) {
      await page.locator('.rs-tab-unit .rs-work-tab-close').first().click();
    }
    await page.waitForFunction(() => document.querySelector('#app').classList.contains('rs-hidden'));
    assert.equal(await page.locator('.rs-tab-unit').count(), 0, 'closing the last tab must leave no open tabs');
    assert.equal(await page.locator('#rightDockClose').isVisible(), false);

    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, dockGeometry, dockShot, openShot }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-rs-task-isolation-'));

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
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);

    const result = await page.evaluate(async () => {
      const snapshot = () => ({
        ids: [...document.querySelectorAll('#rightSidebarTabStrip [data-rs-tab]')].map(button => button.dataset.rsTab),
        visible: visibleRightSidebarTabs().map(tab => tab.id),
        active: activeRightSidebarTab,
        open: !document.getElementById('app').classList.contains('rs-hidden')
      });

      const a = await api.createSession(true, '');
      a.messages = [{ role: 'user', content: 'task A' }];
      await api.saveSession(a);
      const b = await api.createSession(true, '');
      b.messages = [{ role: 'user', content: 'task B' }];
      await api.saveSession(b);
      await refreshSessions();

      await loadSession(a.id);
      const browserA = createRightSidebarTab('browser');
      const browserA2 = createRightSidebarTab('browser');
      const subagentsA = createRightSidebarTab('subagents');
      activateRightSidebarTab(browserA.id);
      setRightSidebarOpen(true);
      const aState = snapshot();

      await loadSession(b.id);
      const bState = snapshot();

      // The launch button must recover on a task with no tabs and create a
      // tab owned by B, not resurrect one from A.
      document.getElementById('rightDockLaunch').click();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const bAfterLaunch = snapshot();

      // Directly activating a hidden tab from another task must fail without
      // closing the panel that belongs to the current task.
      const foreign = activateRightSidebarTab(browserA.id);
      const bAfterForeign = snapshot();

      // Simulate a stale active id from another task: the launch button must
      // recover instead of silently doing nothing.
      const staleRecovery = await (async staleId => {
        closeRightSidebar();
        activeRightSidebarTab = staleId;
        document.getElementById('rightDockLaunch').click();
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        return {
          ids: [...document.querySelectorAll('#rightSidebarTabStrip [data-rs-tab]')].map(button => button.dataset.rsTab),
          active: activeRightSidebarTab,
          open: !document.getElementById('app').classList.contains('rs-hidden')
        };
      })(browserA.id);

      await loadSession(a.id);
      const aRestored = snapshot();

      return {
        aId: a.id,
        bId: b.id,
        browserA: browserA.id,
        browserA2: browserA2.id,
        subagentsA: subagentsA.id,
        aState,
        bState,
        bAfterLaunch,
        foreign,
        bAfterForeign,
        staleRecovery,
        aRestored
      };
    });

    assert.deepEqual(result.aState.ids.sort(), [result.browserA, result.browserA2, result.subagentsA].sort());
    assert.equal(result.aState.active, result.browserA);
    assert.equal(result.aState.open, true);

    assert.deepEqual(result.bState.ids, []);
    assert.equal(result.bState.active, null);
    assert.equal(result.bState.open, false);

    assert.equal(result.bAfterLaunch.ids.length, 1);
    assert.ok(!result.bAfterLaunch.ids.includes(result.browserA));
    assert.equal(result.bAfterLaunch.open, true);

    assert.equal(result.foreign, false);
    assert.equal(result.bAfterForeign.open, true);
    assert.equal(result.bAfterForeign.active, result.bAfterLaunch.active);

    assert.equal(result.staleRecovery.open, true);
    assert.equal(result.staleRecovery.active, result.bAfterLaunch.active);
    assert.deepEqual(result.staleRecovery.ids, result.bAfterLaunch.ids);

    assert.deepEqual(result.aRestored.ids.sort(), [result.browserA, result.browserA2, result.subagentsA].sort());
    assert.equal(result.aRestored.active, result.browserA);
    assert.equal(result.aRestored.open, true);
    assert.ok(!result.aRestored.ids.includes(result.bAfterLaunch.active));

    // Alt+C clears every tab of the current task only.
    await page.keyboard.press('Alt+c');
    const afterAltC = await page.evaluate(() => ({
      ids: [...document.querySelectorAll('#rightSidebarTabStrip [data-rs-tab]')].map(button => button.dataset.rsTab),
      active: activeRightSidebarTab,
      open: !document.getElementById('app').classList.contains('rs-hidden')
    }));
    assert.deepEqual(afterAltC.ids, []);
    assert.equal(afterAltC.active, null);
    assert.equal(afterAltC.open, false);

    const bAfterClear = await page.evaluate(async bId => {
      await loadSession(bId);
      return {
        ids: [...document.querySelectorAll('#rightSidebarTabStrip [data-rs-tab]')].map(button => button.dataset.rsTab),
        active: activeRightSidebarTab,
        open: !document.getElementById('app').classList.contains('rs-hidden')
      };
    }, result.bId);
    assert.deepEqual(bAfterClear.ids, [result.bAfterLaunch.active]);
    assert.equal(bAfterClear.active, result.bAfterLaunch.active);
    assert.equal(bAfterClear.open, true);

    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await application?.close().catch(() => {});
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    } catch (error) {
      if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error;
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

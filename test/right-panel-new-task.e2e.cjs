'use strict';
// Regression: creating a task while the right panel is full-screen used to
// leave focus mode on after the panel hid itself, so the chat page stayed
// transparent and non-interactive behind a hidden panel (a blank window).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-right-panel-new-task-'));

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof setBrowserFocusMode === 'function' && typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      await newSession({ forceNew: true });
      state.currentSession.messages = [{ role: 'user', content: 'Focus fixture' }];
      state.currentSession.title = 'Focus fixture';
      await api.saveSession(state.currentSession);
      await refreshSessions();
      setEmptyState(false);
      openRightSidebarTool('browser');
      setBrowserFocusMode(true);
    });
    assert.equal(await page.evaluate(() => document.querySelector('#app').classList.contains('browser-focus-mode')), true,
      'fixture should start in full-screen right panel mode');
    await page.locator('#newTaskNavBtn').click();
    await page.waitForFunction(() => !newSessionPromise);
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const report = await page.evaluate(() => {
      const app = document.querySelector('#app');
      const chat = document.querySelector('#pageChat');
      const header = document.querySelector('#emptyHeader');
      const stage = document.querySelector('#composerStage');
      const input = document.querySelector('#composerInput');
      return {
        focus: browserFocusMode,
        focusClass: app.classList.contains('browser-focus-mode'),
        pointerEvents: getComputedStyle(chat).pointerEvents,
        headerDisplay: getComputedStyle(header).display,
        headerHeight: header.getBoundingClientRect().height,
        stagePosition: getComputedStyle(stage).position,
        inputHeight: input.getBoundingClientRect().height,
        rightSidebarDisplay: getComputedStyle(document.querySelector('#rightSidebar')).display,
        empty: chat.classList.contains('empty')
      };
    });
    assert.equal(report.focus, false, 'full-screen right panel mode must end when the new task has no panel tabs');
    assert.equal(report.focusClass, false, 'browser-focus-mode class must be removed');
    assert.notEqual(report.pointerEvents, 'none', 'chat page must accept interaction again');
    assert.equal(report.headerDisplay, 'flex', 'empty-state header must be visible');
    assert.ok(report.headerHeight > 0, 'empty-state header must have layout height');
    assert.notEqual(report.stagePosition, 'absolute', 'composer must not stay in the full-screen layout');
    assert.ok(report.inputHeight > 0, 'composer input must be visible');
    assert.equal(report.empty, true, 'new task must be the empty chat state');
    await page.screenshot({ path: path.join(root, '.yanagent/evidence/right-panel-new-task-fixed.png') });
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, leftFocusMode: true, ...report }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

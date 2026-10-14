'use strict';

// Task A keeps running while the user works in task B. A must stop paying
// per-frame flush/render cost once it is off screen (that cost is what made
// typing in B stutter), it must leave its work log collapsed, and it must show
// the complete tail again when the user returns to it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-background-task-'));

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
    await page.waitForFunction(() => typeof armResponseWatchdog === 'function' && typeof state === 'object');
    await page.waitForFunction(() => window.__YAN_APP_READY__);

    const probe = await page.evaluate(async () => {
      const frames = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      if (!state.currentSession) await newSession();
      const taskA = state.currentSession;
      taskA.messages = [{ role: 'user', content: 'A 的长任务', ts: Date.now() }];
      clearMessages();
      setEmptyState(false);

      const assistantEl = appendMessage('assistant', '');
      const runCtx = createRunCtx(taskA.id, true, taskA.workspace || '');
      initOpenCodeRunState(runCtx);
      state.activeRuns.set(taskA.id, { sessionRef: taskA, runCtx, assistantEl });
      upsertOpenCodeTimeline(runCtx, 'call-1', {
        type: 'tool_call', stage: 'work', callId: 'c1', name: 'read', args: { path: 'src/a.js' }
      });
      renderAgentRunBody(assistantEl.querySelector('.msg-body'), {
        ...runCtx.activeAgentRun, status: 'working', timeline: runCtx.activeAgentRun.timeline || []
      }, '');

      const buffer = text => runCtx.openCodeStreamAccumulators.set(`probe-${text}`, {
        type: 'part', id: `part-${text}`, kind: 'text', chunks: [text]
      });

      // On screen: a scheduled render flushes the buffered delta.
      buffer('on-screen');
      scheduleOpenCodeRender(runCtx);
      await frames();
      const flushedOnScreen = runCtx.openCodeStreamAccumulators.size === 0;

      // Off screen: leave the buffer alone and no frame loop is scheduled.
      const previousSession = state.currentSession;
      state.currentSession = { id: 'other-task', workspace: '' };
      pauseUiForSession(taskA.id);
      buffer('off-screen');
      scheduleOpenCodeRender(runCtx);
      await frames();
      const bufferedOffScreen = runCtx.openCodeStreamAccumulators.size;
      const headerCollapsed = assistantEl.querySelector('.agent-run-header')?.classList.contains('agent-work-collapsed') === true;

      // Returning to the task shows the tail that arrived while it was away.
      state.currentSession = previousSession;
      bindActiveRunUi(taskA.id);
      const text = String(runCtx.activeAgentRun?.timeline?.map(item => item.content || '').join('') || '');
      const sawOffScreenTail = text.includes('off-screen');
      const reOpenedCollapsed = assistantEl.querySelector('.agent-run-header')?.classList.contains('agent-work-collapsed') === true;
      window.hiddenRunProbe = { runCtx, taskId: taskA.id };
      return { flushedOnScreen, bufferedOffScreen, headerCollapsed, sawOffScreenTail, reOpenedCollapsed };
    });

    assert.equal(probe.flushedOnScreen, true, 'an on-screen run still flushes and renders');
    assert.equal(probe.bufferedOffScreen, 1, 'an off-screen run leaves its stream buffered instead of flushing every frame');
    assert.equal(probe.headerCollapsed, true, 'leaving a running task collapses its work log');
    assert.equal(probe.sawOffScreenTail, true, 'returning to the task renders the tail buffered while it was away');
    assert.equal(probe.reOpenedCollapsed, true, 'the hidden work log stays collapsed when the task is reopened');
    // Playwright forces captured pages visible. Native visibility/freeze is
    // verified separately without that emulation in browser-freeze-native.cjs.
    await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); });
    await page.waitForFunction(() => document.hidden);
    const hidden = await page.evaluate(() => {
      const { runCtx } = window.hiddenRunProbe;
      cancelScheduledOpenCodeRender(runCtx);
      runCtx.openCodeStreamAccumulators.set('hidden-window', { type: 'part', id: 'hidden-window', kind: 'text', chunks: ['hidden-window-tail'] });
      scheduleOpenCodeRender(runCtx);
      return { frame: runCtx.openCodeRenderFrame, timer: runCtx.openCodeRenderTimer, buffered: runCtx.openCodeStreamAccumulators.size };
    });
    assert.equal(hidden.frame, 0); assert.ok(hidden.timer > 0); assert.ok(hidden.buffered > 0);
    await page.waitForFunction(() => window.hiddenRunProbe.runCtx.activeAgentRun.timeline.some(item => String(item.content || '').includes('hidden-window-tail')));
    await page.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event('visibilitychange')); });
    await page.waitForFunction(() => !document.hidden && window.hiddenRunProbe.runCtx.activeAgentRun.timeline.some(item => String(item.content || '').includes('hidden-window-tail')));
    await page.evaluate(() => { state.activeRuns.delete(window.hiddenRunProbe.taskId); delete window.hiddenRunProbe; });
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    await application?.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Windows may still hold the profile briefly */ }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

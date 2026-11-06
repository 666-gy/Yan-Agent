'use strict';

// The reply hard cap: a run that never produces a first reply within the limit
// is auto-aborted with a visible error, and a run that replies in time is left
// alone. YAN_RESPONSE_HARD_LIMIT_MS shrinks the two-minute default for the test.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-response-cap-'));

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
    await page.waitForFunction(() => window.__YAN_APP_READY__ && typeof armResponseWatchdog === 'function' && typeof state === 'object');
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.evaluate(() => document.querySelectorAll('[inert]').forEach(el => { el.inert = false; }));

    const probe = await page.evaluate(async () => {
      window.YAN_RESPONSE_HARD_LIMIT_MS = 700;
      if (!state.currentSession) await newSession();
      const sessionId = state.currentSession.id;
      const setup = () => {
        clearMessages();
        setEmptyState(false);
        state.currentSession.messages = [];
        const assistantEl = appendMessage('assistant', '');
        const runCtx = createRunCtx(sessionId, true, state.currentSession.workspace || '');
        runCtx.runId = 'probe-run';
        state.activeRuns.set(sessionId, { sessionRef: state.currentSession, runCtx, assistantEl });
        return runCtx;
      };

      // Case 1: no reply inside the limit -> auto-abort + error pill.
      const stalled = setup();
      armResponseWatchdog(stalled, sessionId);
      await new Promise(resolve => setTimeout(resolve, 1_500));
      const toastEl = document.querySelector('#toast');
      const stalledResult = {
        aborted: stalled.shouldAbort === true,
        status: stalled.agentState?.status || '',
        reason: stalled.interruptionReason || '',
        toast: toastEl?.textContent || '',
        toastError: toastEl?.classList.contains('toast-error') === true,
        errorText: document.querySelector('.agent-run-error')?.innerText || ''
      };
      // The kernel acknowledges the cancellation after the watchdog has fired.
      // Its generic user-cancel outcome must not overwrite the timeout card.
      stalled.activeAgentRun ||= { timeline: [] };
      const settled = openCodeResultToAgentRun({ status: 'interrupted', interruptionReason: 'user_cancel', error: '用户中止输出' }, stalled);
      const restored = JSON.parse(JSON.stringify(settled));
      const body = state.activeRuns.get(sessionId).assistantEl.querySelector('.msg-body');
      renderAgentRunBody(body, restored);
      stalledResult.settledReason = restored.interruptionReason;
      stalledResult.settledError = restored.error;
      stalledResult.restoredText = body.innerText;
      state.activeRuns.delete(sessionId);

      const manual = setup();
      abortSessionById(sessionId, { silent: true });
      const manualResult = {
        reason: manual.interruptionReason,
        text: document.querySelector('.agent-run-error')?.innerText || ''
      };
      state.activeRuns.delete(sessionId);

      // Case 2: the reply arrives in time -> the cap stands down.
      const answered = setup();
      armResponseWatchdog(answered, sessionId);
      await new Promise(resolve => setTimeout(resolve, 200));
      markOpenCodeResponseStarted(answered);
      await new Promise(resolve => setTimeout(resolve, 1_200));
      const answeredResult = { aborted: answered.shouldAbort === true, armed: !!answered.responseWatchdog };
      state.activeRuns.delete(sessionId);
      state.currentSession.messages = [];
      return { stalledResult, answeredResult, manualResult };
    });

    assert.equal(probe.stalledResult.aborted, true, 'a stalled run is auto-aborted');
    assert.match(probe.stalledResult.toast, /1 分钟内未成功回包/, 'the abort reason is shown');
    assert.equal(probe.stalledResult.toastError, true, 'the abort reason is an error pill, not a neutral one');
    assert.equal(probe.stalledResult.reason, 'response_timeout', 'a stalled run is not recorded as a user cancel');
    assert.match(probe.stalledResult.errorText, /未成功回包/, 'the transcript explains the timeout');
    assert.doesNotMatch(probe.stalledResult.errorText, /用户手动中止/, 'the transcript must not blame the user');
    assert.equal(probe.stalledResult.settledReason, 'response_timeout');
    assert.match(probe.stalledResult.settledError, /未成功回包/);
    assert.match(probe.stalledResult.restoredText, /未成功回包/);
    assert.doesNotMatch(probe.stalledResult.restoredText, /用户.*中止输出/);
    assert.equal(probe.manualResult.reason, 'user_cancel');
    assert.match(probe.manualResult.text, /用户手动中止输出/);

    const shot = path.join(appRoot, '.yanagent', 'evidence', 'response-hard-limit-error-pill.png');
    fs.mkdirSync(path.dirname(shot), { recursive: true });
    await page.screenshot({ path: path.join(path.dirname(shot), 'response-hard-limit-window.png') }).catch(() => {});
    await page.locator('#toast').screenshot({ path: shot }).catch(() => {});

    const neutralAfter = await page.evaluate(() => {
      toast('普通提示');
      return document.querySelector('#toast')?.classList.contains('toast-error') === true;
    });
    assert.equal(neutralAfter, false, 'a plain confirmation drops the error styling');
    assert.equal(probe.answeredResult.aborted, false, 'a run that replied in time is not aborted');
    console.log(JSON.stringify({ ok: true, probe }, null, 2));
  } finally {
    await application?.close().catch(() => {});
    try { fs.rmSync(userDataDir, { recursive: true, force: true }); } catch { /* Windows may still hold the profile briefly */ }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

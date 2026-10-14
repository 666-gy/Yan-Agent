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
    await page.waitForFunction(() => typeof armResponseWatchdog === 'function' && typeof state === 'object');
    await page.locator('#taskBar:not(.hidden)').waitFor();

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
        toast: toastEl?.textContent || '',
        toastError: toastEl?.classList.contains('toast-error') === true
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
      return { stalledResult, answeredResult };
    });

    assert.equal(probe.stalledResult.aborted, true, 'a stalled run is auto-aborted');
    assert.match(probe.stalledResult.toast, /两分钟内未成功回包/, 'the abort reason is shown');
    assert.equal(probe.stalledResult.toastError, true, 'the abort reason is an error pill, not a neutral one');

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

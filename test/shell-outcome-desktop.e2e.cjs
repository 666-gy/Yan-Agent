'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-shell-outcome-ui-'));
  const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }; delete env.ELECTRON_RUN_AS_NODE;
  const app = await electron.launch({ executablePath: process.env.YAN_SHELL_TEST_EXE || require('electron'), args: process.env.YAN_SHELL_TEST_EXE ? [] : [root], cwd: root, env });
  try {
    const page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    const cases = [
      { status: 'failed', result: { error: '内核退出码 7' } },
      { status: 'incomplete' },
      { status: 'aborted' },
      { status: 'aborted', cancelReason: 'user_cancelled', telemetry: { cancelRequestedAt: 123 } },
      { status: 'completed' }
    ];
    for (const turn of cases) {
      const result = await page.evaluate(turn => {
        const sessionId = state.currentSession.id;
        const runCtx = createRunCtx(sessionId, true, state.currentSession.workspace || '');
        runCtx.runId = 'test-' + Date.now();
        const assistantEl = appendMessage('assistant', '');
        renderAgentRunBody(assistantEl.querySelector('.msg-body'), { status: 'working', startedAt: Date.now(), timeline: [] });
        state.activeRuns.set(sessionId, { sessionRef: state.currentSession, runCtx, assistantEl });
        reconcileRunFromCoreTerminal(runCtx.runId, { payload: { turn } });
        return { text: assistantEl.innerText, status: runCtx.agentState.status, reason: runCtx.interruptionReason, active: state.activeRuns.has(sessionId) };
      }, turn);
      assert.equal(result.active, false);
      assert.equal(result.status, turn.status === 'completed' ? 'done' : turn.status === 'aborted' ? 'interrupted' : 'error');
      if (turn.telemetry) assert.match(result.text, /用户手动中止输出/);
      else assert.doesNotMatch(result.text, /用户手动中止输出/);
      if (turn.result?.error) assert.match(result.text, /内核退出码 7/);
    }
    console.log('PASS desktop terminal reconciliation: failed, incomplete, system interruption, user cancellation, completed');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-run-recovery-'));

// A transient provider failure (e.g. an unrecoverable DSML parse attempt) that
// OpenCode retried successfully must not surface as a task failure.
(async () => {
  let application;
  const errors = [];
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      typeof createRunCtx === 'function'
      && typeof initOpenCodeRunState === 'function'
      && typeof applyOpenCodeEvent === 'function'
      && typeof openCodeResultToAgentRun === 'function'
    ));

    const result = await page.evaluate(async () => {
      const message = 'DeepSeek DSML compatibility failed: DeepSeek returned an incomplete Tool Call block.';
      if (!state.currentSession) await newSession();
      const buildCtx = () => {
        const ctx = createRunCtx(state.currentSession.id, true, state.currentSession.workspace || '');
        initOpenCodeRunState(ctx);
        ctx.activeAgentRun.timeline = [{
          type: 'text',
          stage: 'summary',
          content: '任务已完成。',
          openCodeKey: 'summary:result'
        }];
        return ctx;
      };

      const recoveredCtx = buildCtx();
      applyOpenCodeEvent(recoveredCtx, { type: 'session.error', data: { error: { message } } });
      const latched = recoveredCtx.openCodeError;
      applyOpenCodeEvent(recoveredCtx, { type: 'yan.model.recovered', data: { error: message } });
      const cleared = recoveredCtx.openCodeError;
      recoveredCtx.openCodeError = message;
      const recovered = openCodeResultToAgentRun({
        status: 'done',
        text: '任务已完成。',
        toolCalls: [],
        todos: [],
        changes: []
      }, recoveredCtx);

      const terminalCtx = buildCtx();
      terminalCtx.openCodeError = message;
      const terminal = openCodeResultToAgentRun({
        status: 'error',
        text: '',
        toolCalls: [],
        todos: [],
        changes: []
      }, terminalCtx);

      return {
        latched,
        cleared,
        recoveredStatus: recovered.status,
        recoveredError: recovered.error,
        terminalStatus: terminal.status,
        terminalError: terminal.error
      };
    });

    assert.equal(result.latched, 'DeepSeek DSML compatibility failed: DeepSeek returned an incomplete Tool Call block.');
    assert.equal(result.cleared, '');
    assert.equal(result.recoveredStatus, 'done');
    assert.equal(result.recoveredError, '');
    assert.equal(result.terminalStatus, 'error');
    assert.match(result.terminalError, /DSML compatibility failed/u);
    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, ...result }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

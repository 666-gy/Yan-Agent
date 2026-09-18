'use strict';

// Verifies the Core-journal recovery path inside the real renderer: a
// descriptor rebuilt from the durable journal must replay into an interrupted
// assistant message, persist it, and stay idempotent on a second attempt.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-core-journal-recovery-'));

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
      typeof recoverInterruptedOpenCodeRun === 'function'
      && typeof recoverInterruptedOpenCodeRuns === 'function'
      && typeof createRunCtx === 'function'
      && typeof applyOpenCodeEvent === 'function'
      && typeof state !== 'undefined'
      && !!state.currentSession
    ));

    const result = await page.evaluate(async () => {
      const session = state.currentSession;
      session.messages = [{ role: 'user', content: '恢复验证请求', ts: Date.now() }];
      await api.saveSession(session);

      const descriptor = {
        runId: 'run-e2e-recovery',
        yanSessionId: session.id,
        workspace: session.workspace || '',
        startedAt: Date.now() - 60_000,
        lastEventAt: Date.now() - 1_000,
        configSnapshot: { providerId: 'e2e', modelId: 'e2e-model', modelName: 'E2E Model', workMode: 'normal' },
        events: [
          { type: 'yan.opencode.started', data: { sessionID: 'ses_e2e' } },
          { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: '第一段' } },
          { type: 'message.part.updated', data: { part: { id: 'p1', type: 'text', text: '第一段恢复正文' } } },
          { type: 'session.next.tool.called', data: { callID: 'c1', tool: 'bash', input: { command: 'echo hi' } } },
          { type: 'session.next.tool.success', data: { callID: 'c1', result: 'hi' } }
        ],
        journalEvents: 5,
        truncated: false
      };

      const first = await recoverInterruptedOpenCodeRun(descriptor);
      const persisted = await api.getSession(session.id);
      const second = await recoverInterruptedOpenCodeRun(descriptor);
      const persistedAgain = await api.getSession(session.id);

      const last = (persisted.messages || []).at(-1) || {};
      const timeline = Array.isArray(last.agentRun?.timeline) ? last.agentRun.timeline : [];
      return {
        first,
        second,
        persistedTotal: (persisted.messages || []).length,
        persistedAgainTotal: (persistedAgain.messages || []).length,
        role: last.role,
        status: last.agentRun?.status,
        recovered: last.agentRun?.recoveredAfterRestart === true,
        textContent: last.agentRun?.textContent || '',
        hasToolCall: timeline.some(item => item.type === 'tool_call' && item.callId === 'c1'),
        hasToolResult: timeline.some(item => item.type === 'tool_result' && item.callId === 'c1'),
        hasRecoveryNote: timeline.some(item => item.type === 'progress' && /运行日志恢复/.test(String(item.content || ''))),
        modelId: last.agentRun?.modelId || ''
      };
    });

    assert.equal(result.first, true, 'first recovery must produce a message');
    assert.equal(result.second, false, 'second recovery must be an idempotent no-op');
    assert.equal(result.persistedTotal, 2);
    assert.equal(result.persistedAgainTotal, 2, 'no duplicate message after the second attempt');
    assert.equal(result.role, 'assistant');
    assert.equal(result.status, 'interrupted');
    assert.equal(result.recovered, true);
    assert.match(result.textContent, /第一段恢复正文/u);
    assert.equal(result.hasToolCall, true);
    assert.equal(result.hasToolResult, true);
    assert.equal(result.hasRecoveryNote, true);
    assert.equal(result.modelId, 'e2e-model');
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

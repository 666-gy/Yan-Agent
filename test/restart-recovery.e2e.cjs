'use strict';

// End-to-end restart recovery: seeds the durable state of a process that died
// mid-run (session with only the user message + a non-terminal Core Turn with
// its provider journal), launches the real application, and verifies the
// interrupted Turn is replayed into the session and settled in Core.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { YanCore } = require('../lib/yan-core');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-restart-recovery-'));
const dataDir = path.join(userDataDir, 'YanData');
const sessionsDir = path.join(dataDir, 'sessions');
const coreDir = path.join(dataDir, 'yan-core');
const sessionId = 'sess_recoveryseed1';
const runId = `yan-${sessionId}-11111111-2222-3333-4444-555555555555`;
const seedPrompt = '请写一段恢复测试文本';
const seedText = '被中断前的第一段正文';

function seedInterruptedState() {
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, `${sessionId}.json`), JSON.stringify({
    id: sessionId,
    title: '恢复种子任务',
    messages: [{ role: 'user', content: seedPrompt, ts: Date.now() - 120_000 }],
    pinned: false,
    workspace: '',
    createdAt: Date.now() - 120_000,
    updatedAt: Date.now() - 120_000
  }, null, 2));

  const core = new YanCore({ rootDir: coreDir });
  core.startTurn({
    threadId: sessionId,
    turnId: runId,
    workspace: '',
    title: '恢复种子任务',
    configSnapshot: { providerId: 'seed', modelId: 'seed-model', modelName: 'Seed Model', workMode: 'normal' },
    intent: { prompt: seedPrompt, workMode: 'normal' }
  });
  core.ingestProviderEvent(runId, { type: 'yan.opencode.started', data: { sessionID: 'ses_seed' } });
  core.ingestProviderEvent(runId, { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: seedText } });
  core.ingestProviderEvent(runId, { type: 'message.part.updated', data: { part: { id: 'p1', type: 'text', text: seedText } } });
  core.ingestProviderEvent(runId, { type: 'session.next.tool.called', data: { callID: 'c1', tool: 'bash', input: { command: 'echo seed' } } });
  core.ingestProviderEvent(runId, { type: 'session.next.tool.success', data: { callID: 'c1', result: 'seed' } });
  core.persist();
}

async function waitForRecoveredSession(filePath, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const last = Array.isArray(data.messages) ? data.messages.at(-1) : null;
      if (last?.agentRun?.recoveredAfterRestart) return data;
    } catch { /* file may be mid-write */ }
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  return null;
}

(async () => {
  let application;
  const errors = [];
  try {
    seedInterruptedState();
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));

    const sessionPath = path.join(sessionsDir, `${sessionId}.json`);
    const persisted = await waitForRecoveredSession(sessionPath);
    assert.ok(persisted, 'interrupted session was not recovered from the Core journal');

    const last = persisted.messages.at(-1);
    assert.equal(last.role, 'assistant');
    assert.equal(last.agentRun.status, 'interrupted');
    assert.equal(last.agentRun.recoveredAfterRestart, true);
    assert.match(last.agentRun.textContent, new RegExp(seedText, 'u'));
    const timeline = Array.isArray(last.agentRun.timeline) ? last.agentRun.timeline : [];
    assert.ok(timeline.some(item => item.type === 'tool_call' && item.callId === 'c1'), 'tool call missing from replayed timeline');
    assert.ok(timeline.some(item => item.type === 'tool_result' && item.callId === 'c1'), 'tool result missing from replayed timeline');
    assert.ok(timeline.some(item => item.type === 'progress' && /运行日志恢复/.test(String(item.content || ''))), 'recovery note missing');

    // The replayed content must exist exactly once.
    assert.equal(persisted.messages.filter(message => message?.agentRun?.runId === runId).length, 1);

    const coreState = JSON.parse(fs.readFileSync(path.join(coreDir, 'state.json'), 'utf8'));
    assert.equal(coreState.turns[runId].status, 'aborted', 'recovered Turn must settle in Core');
    assert.equal(coreState.turns[runId].result?.status, 'interrupted');

    // Visual acceptance artifact: the recovered conversation as rendered.
    const shotDir = path.join(appRoot, 'output', 'core-recovery');
    fs.mkdirSync(shotDir, { recursive: true });
    await page.evaluate(() => {
      const list = document.querySelector('#messages');
      if (list) list.scrollTop = list.scrollHeight;
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: path.join(shotDir, 'restart-recovery.png') });

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, status: last.agentRun.status, textLength: last.agentRun.textContent.length }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

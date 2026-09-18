'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const outputDir = path.join(appRoot, 'output', 'playwright');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-restored-session-e2e-'));

function run(runId, text, callId, output) {
  return {
    runId,
    status: 'done',
    summaryStarted: true,
    startedAt: Date.now() - 20_000,
    completedAt: Date.now(),
    durationMs: 20_000,
    textContent: text,
    timeline: [
      { type: 'thinking', stage: 'work', content: '恢复后的思考记录。' },
      { type: 'tool_call', stage: 'work', callId, name: 'bash', args: { command: 'Write-Output 200' } },
      { type: 'tool_result', stage: 'work', callId, name: 'bash', output, ok: true },
      { type: 'text', stage: 'summary', content: text }
    ]
  };
}

const session = {
  id: 'sess_restored_work_process',
  title: '重启后恢复的工作会话',
  workspace: appRoot,
  updatedAt: Date.now(),
  messages: [
    { role: 'user', content: '之前的任务', ts: Date.now() - 40_000 },
    { role: 'assistant', content: '之前已完成。', ts: Date.now() - 30_000, duration: 10_000, agentRun: run('restored-old-run', '之前已完成。', 'old-call', '{"ok":true,"output":"done"}') },
    { role: 'user', content: '重启前最后一个任务', ts: Date.now() - 25_000 },
    { role: 'assistant', content: '恢复后已完成。', ts: Date.now() - 20_000, duration: 20_000, agentRun: run('restored-latest-run', '恢复后已完成。', 'latest-call', '200\r\n') }
  ]
};

const sessionsDir = path.join(userDataDir, 'YanData', 'sessions');
fs.mkdirSync(sessionsDir, { recursive: true });
fs.writeFileSync(path.join(sessionsDir, `${session.id}.json`), JSON.stringify(session), 'utf8');
fs.writeFileSync(path.join(userDataDir, 'YanData', 'config.json'), JSON.stringify({ theme: 'dark', language: 'zh-CN' }), 'utf8');

(async () => {
  let application;
  const pageErrors = [];
  let crashed = false;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    page.on('crash', () => { crashed = true; });
    await page.waitForFunction(() => typeof appendMessage === 'function' && typeof state === 'object');
    await page.waitForFunction(() => document.querySelectorAll('.msg.assistant .agent-work-toggle').length === 2);

    const before = await page.evaluate(() => ({
      currentTitle: state.currentSession?.title,
      assistantCount: document.querySelectorAll('.msg.assistant').length,
      toggleCount: document.querySelectorAll('.msg.assistant .agent-work-toggle').length
    }));
    const latestToggle = page.locator('.msg.assistant .agent-work-toggle').last();
    await latestToggle.click();
    await page.waitForFunction(() => document.querySelectorAll('.msg.assistant .agent-work-toggle').item(1)?.textContent === '隐藏工作过程');
    const after = await page.evaluate(() => ({
      label: document.querySelectorAll('.msg.assistant .agent-work-toggle').item(1)?.textContent,
      renderedParts: document.querySelectorAll('.msg.assistant').item(1)?.querySelectorAll('.agent-activity-body > [data-agent-part-key]').length
    }));

    fs.mkdirSync(outputDir, { recursive: true });
    await page.screenshot({ path: path.join(outputDir, 'work-process-restored-session.png'), fullPage: false });
    assert.deepEqual(before, { currentTitle: session.title, assistantCount: 2, toggleCount: 2 });
    assert.equal(after.label, '隐藏工作过程');
    assert.ok(after.renderedParts > 0);
    assert.equal(crashed, false);
    assert.deepEqual(pageErrors, []);
    console.log(JSON.stringify({ ok: true, before, after, crashed, pageErrors, screenshot: path.join(outputDir, 'work-process-restored-session.png') }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

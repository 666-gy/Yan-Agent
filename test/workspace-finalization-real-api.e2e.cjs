'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

if (process.env.YAN_RUN_REAL_API_E2E !== '1') {
  console.log('Skipped: set YAN_RUN_REAL_API_E2E=1 to use the configured text-model API.');
  process.exit(0);
}

const appRoot = path.resolve(__dirname, '..');
const sourceConfig = path.join(process.env.APPDATA || '', 'yan-agent', 'YanData', 'config.json');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workspace-finalization-real-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workspace-target-'));
const targetDataDir = path.join(userDataDir, 'YanData');

async function latestAssistant(page) {
  return page.evaluate(() => {
    const message = [...(state.currentSession?.messages || [])]
      .reverse()
      .find(item => item.role === 'assistant');
    return {
      status: String(message?.agentRun?.status || ''),
      content: String(message?.content || ''),
      openCodeSessionId: String(state.currentSession?.openCodeSessionId || ''),
      timeline: Array.isArray(message?.agentRun?.timeline) ? message.agentRun.timeline : []
    };
  });
}

(async () => {
  let application;
  try {
    assert.equal(fs.existsSync(sourceConfig), true, 'Yan model configuration is missing');
    fs.mkdirSync(targetDataDir, { recursive: true });
    fs.copyFileSync(sourceConfig, path.join(targetDataDir, 'config.json'));
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof submitMessage === 'function' && !!state.currentSession);
    await page.evaluate(async () => {
      state.config = await api.setConfig({ agent: { accessMode: 'full', workMode: 'normal' } });
      window.__blankRun = submitMessage('这是工作区切换测试的第一轮。只回复约定词 BLANK_READY，不调用工具。');
    });
    await page.waitForFunction(() => !state.activeRuns.has(state.currentSession?.id), null, { timeout: 90_000 });
    const blank = await latestAssistant(page);
    assert.equal(blank.status, 'done');
    assert.ok(blank.content.includes('BLANK_READY'), blank.content);
    assert.ok(blank.openCodeSessionId, 'Blank run did not persist an OpenCode session id');

    await page.evaluate(async targetWorkspace => {
      const updated = await api.setSessionWorkspace(state.currentSession.id, targetWorkspace, false);
      state.currentSession.workspace = updated.workspace;
      state.config = await api.activateWorkspace(updated.workspace);
      window.__workspaceRun = submitMessage([
        '继续同一任务。使用 bash 运行 Get-Location，确认当前真实工作目录。',
        '不要修改文件。最终答复同时复述上一轮约定词。'
      ].join('\n'));
    }, workspace);
    await page.waitForFunction(() => !state.activeRuns.has(state.currentSession?.id), null, { timeout: 120_000 });
    const workspaceResult = await latestAssistant(page);

    assert.equal(workspaceResult.status, 'done', workspaceResult.content);
    assert.notEqual(workspaceResult.openCodeSessionId, blank.openCodeSessionId);
    assert.ok(workspaceResult.content.includes('BLANK_READY'), workspaceResult.content);
    const bashResult = workspaceResult.timeline.find(item => (
      item.type === 'tool_result' && item.name === 'bash'
    ));
    assert.ok(bashResult, 'Workspace run did not produce a bash result');
    assert.ok(String(bashResult.output || '').toLowerCase().includes(workspace.toLowerCase()), String(bashResult.output || ''));
    console.log(JSON.stringify({
      ok: true,
      blankSession: blank.openCodeSessionId,
      workspaceSession: workspaceResult.openCodeSessionId,
      workspace,
      status: workspaceResult.status
    }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

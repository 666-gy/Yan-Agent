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
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-interjection-real-'));
const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-interjection-workspace-'));
const targetDataDir = path.join(userDataDir, 'YanData');

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
    await page.waitForFunction(() => document.querySelector('#interjectionForm')?.dataset.bound === 'true'
      && typeof submitMessage === 'function'
      && typeof buildInterjectionSnapshot === 'function');
    await page.evaluate(async targetWorkspace => {
      if (!state.currentSession) await newSession();
      const updated = await api.setSessionWorkspace(state.currentSession.id, targetWorkspace, false);
      state.currentSession.workspace = updated.workspace;
      state.config = await api.activateWorkspace(updated.workspace);
      state.config = await api.setConfig({ agent: { accessMode: 'full', workMode: 'normal' } });
      window.__realInterjectionRun = submitMessage([
        '执行一个安全的内核等待验证。',
        '请使用 bash 工具运行下面这条命令，并等待它自然结束：',
        'node -e "setTimeout(() => console.log(\'WAIT_DONE\'), 30000)"',
        '命令结束后只简短说明等待验证完成。不要改写命令，也不要提前结束等待。'
      ].join('\n'));
    }, workspace);

    await page.waitForFunction(() => {
      const runCtx = getRunCtx(state.currentSession?.id);
      const timeline = runCtx?.activeAgentRun?.timeline || [];
      return timeline.some(item => item.type === 'tool_call' && item.name === 'bash')
        && !timeline.some(item => item.type === 'tool_result' && item.name === 'bash');
    }, null, { timeout: 60_000 });

    await page.locator('#rightDock [data-rs-dock-tool="interjection"]').click();
    await page.locator('#interjectionInput').fill('当前等待命令还在真实运行吗？只依据任务快照回答。');
    await page.locator('#interjectionInput').press('Enter');
    await page.waitForFunction(() => document.querySelectorAll('#interjectionTranscript .msg').length >= 2, null, { timeout: 90_000 });
    const checkLines = await page.locator('#interjectionTranscript .msg.assistant').allTextContents();
    assert.ok(checkLines.some(line => line.trim()), JSON.stringify(checkLines));
    assert.equal(await page.evaluate(() => state.activeRuns.has(state.currentSession.id)), true);

    await page.locator('#interjectionInput').fill('当前命令自然结束后就正常交付，不要增加任何额外测试。');
    await page.locator('#interjectionInput').press('Enter');
    await page.waitForFunction(() => [...document.querySelectorAll('#interjectionTranscript .auxiliary-dialogue-system')]
      .some(node => node.textContent.includes('已送达主 Agent')), null, { timeout: 45_000 });
    assert.equal(await page.evaluate(() => state.activeRuns.has(state.currentSession.id)), true);

    await page.waitForFunction(() => !state.activeRuns.has(state.currentSession?.id), null, { timeout: 150_000 });
    const result = await page.evaluate(() => {
      const assistant = [...(state.currentSession?.messages || [])].reverse().find(message => message.role === 'assistant');
      return {
        status: assistant?.agentRun?.status || '',
        userRequestedFinish: !!assistant?.agentRun?.userRequestedFinish,
        content: String(assistant?.content || '')
      };
    });
    assert.equal(result.status, 'done');
    assert.equal(result.userRequestedFinish, true);
    assert.ok(result.content.length > 0);
    console.log(JSON.stringify({ ok: true, status: result.status, userRequestedFinish: result.userRequestedFinish }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

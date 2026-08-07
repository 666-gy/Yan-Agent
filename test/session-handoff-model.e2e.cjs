'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const sourceConfigPath = path.resolve(String(
  process.env.YAN_E2E_CONFIG_PATH
    || path.join(process.env.APPDATA || '', 'yan-agent', 'YanData', 'config.json')
));
const timeoutMs = Math.max(60_000, Math.min(600_000, Number(process.env.YAN_E2E_MODEL_TIMEOUT_MS) || 360_000));
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-session-handoff-e2e-'));
const userDataDir = path.join(testRoot, 'user-data');
const sourceWorkspace = path.join(testRoot, 'workspaces', '1');
const targetWorkspace = path.join(testRoot, 'workspaces', '2');
const deniedWorkspace = path.join(testRoot, 'workspaces', 'denied');
const secret = `YAN-HANDOFF-${Date.now()}`;

function prepareIsolatedConfig() {
  assert.ok(fs.existsSync(sourceConfigPath), `Yan config is missing: ${sourceConfigPath}`);
  fs.mkdirSync(path.join(userDataDir, 'YanData'), { recursive: true });
  fs.mkdirSync(sourceWorkspace, { recursive: true });
  fs.mkdirSync(targetWorkspace, { recursive: true });
  fs.mkdirSync(deniedWorkspace, { recursive: true });
  const config = JSON.parse(fs.readFileSync(sourceConfigPath, 'utf8'));
  config.workspace = '';
  config.agent = { ...(config.agent || {}), accessMode: 'full', workMode: 'normal' };
  fs.writeFileSync(path.join(userDataDir, 'YanData', 'config.json'), JSON.stringify(config, null, 2), 'utf8');
  return {
    provider: String(config.api?.provider || ''),
    model: String(config.api?.model || '')
  };
}

function readSessions() {
  const directory = path.join(userDataDir, 'YanData', 'sessions');
  return fs.readdirSync(directory)
    .filter(name => name.endsWith('.json'))
    .map(name => JSON.parse(fs.readFileSync(path.join(directory, name), 'utf8')));
}

async function submitAuthorizedNavigation(page, prompt, promiseKey) {
  await page.evaluate(({ taskPrompt, key }) => {
    window[key] = submitMessage(taskPrompt, [], []);
  }, { taskPrompt: prompt, key: promiseKey });
  await page.waitForFunction(() => {
    const panel = document.querySelector('#agentPermissionPanel');
    const title = document.querySelector('#agentPermissionTitle');
    return panel && !panel.classList.contains('hidden')
      && title?.textContent === '进入其他工作区任务';
  }, null, { timeout: timeoutMs });
  await page.locator('#agentPermissionOnce').click();
  return page.evaluate(async ({ timeout, key }) => Promise.race([
    window[key],
    new Promise((_, reject) => setTimeout(() => reject(new Error('Navigation run timed out')), timeout))
  ]), { timeout: timeoutMs, key: promiseKey });
}

(async () => {
  const selection = prepareIsolatedConfig();
  let application;
  const startedAt = Date.now();
  try {
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
    await page.waitForFunction(() => (
      typeof submitMessage === 'function'
      && typeof loadSession === 'function'
      && typeof state === 'object'
      && !!state.config
    ));

    const sourceSessionId = await page.evaluate(async ({ source, marker }) => {
      const session = await window.yan.createSession(true);
      session.title = '跨会话真实测试来源';
      session.workspace = source;
      session.messages = [
        {
          role: 'user',
          content: `这是跨会话验收上下文。验收暗号是 ${marker}，后续进入新任务时必须能记住。`,
          ts: Date.now() - 2000
        },
        {
          role: 'assistant',
          content: `已记住验收暗号 ${marker}。`,
          ts: Date.now() - 1000
        }
      ];
      await window.yan.saveSession(session);
      await refreshSessions();
      await loadSession(session.id);
      return session.id;
    }, { source: sourceWorkspace, marker: secret });

    const handoffPrompt = `你现在位于 ${sourceWorkspace} 这个工作区。现在我想要你新开一个对话并进入 ${targetWorkspace} 这个工作区。`;
    await page.evaluate(prompt => {
      window.__yanHandoffSubmission = submitMessage(prompt, [], []);
    }, handoffPrompt);

    const permissionPanel = page.locator('#agentPermissionPanel');
    await page.waitForFunction(() => {
      const panel = document.querySelector('#agentPermissionPanel');
      const title = document.querySelector('#agentPermissionTitle');
      return panel && !panel.classList.contains('hidden')
        && title?.textContent === '进入其他工作区任务';
    }, null, { timeout: timeoutMs });
    const permissionDetail = await page.locator('#agentPermissionDetail').textContent();
    assert.ok(permissionDetail.includes(sourceWorkspace), 'Permission panel omitted the source workspace.');
    assert.ok(permissionDetail.includes(targetWorkspace), 'Permission panel omitted the target workspace.');
    assert.equal(await page.locator('#agentPermissionAlways').evaluate(button => button.classList.contains('hidden')), true);
    await page.locator('#agentPermissionOnce').click();

    const sourceResult = await page.evaluate(async timeout => Promise.race([
      window.__yanHandoffSubmission,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Source run timed out')), timeout))
    ]), timeoutMs);
    assert.equal(sourceResult.ok, true, sourceResult.error || 'Source handoff request failed.');

    await page.waitForFunction(sourceId => (
      state.currentSession?.id
      && state.currentSession.id !== sourceId
      && !state.activeRuns.has(sourceId)
    ), sourceSessionId, { timeout: 30_000 });
    const targetSessionId = await page.evaluate(() => state.currentSession.id);

    await page.evaluate(() => {
      window.__yanContextSubmission = submitMessage('来源任务里约定的验收暗号是什么？只回答暗号。', [], []);
    });
    const contextResult = await page.evaluate(async timeout => Promise.race([
      window.__yanContextSubmission,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Target context run timed out')), timeout))
    ]), timeoutMs);
    assert.equal(contextResult.ok, true, contextResult.error || 'Target context request failed.');

    const sessions = readSessions();
    const sourceSession = sessions.find(session => session.id === sourceSessionId);
    const targetSession = sessions.find(session => session.id === targetSessionId);
    assert.ok(sourceSession, 'Source Yan task disappeared.');
    assert.ok(targetSession, 'Target Yan task was not created.');
    assert.equal(path.resolve(sourceSession.workspace), path.resolve(sourceWorkspace));
    assert.equal(path.resolve(targetSession.workspace), path.resolve(targetWorkspace));
    assert.equal(targetSession.parentSessionId, sourceSessionId);
    assert.equal(targetSession.handoff?.sourceSessionId, sourceSessionId);
    assert.ok(sourceSession.openCodeSessionId, 'Source task has no OpenCode session id.');
    assert.ok(targetSession.openCodeSessionId, 'Target task has no OpenCode session id.');
    assert.notEqual(targetSession.openCodeSessionId, sourceSession.openCodeSessionId);

    const sourceTimeline = sourceSession.messages.flatMap(message => message.agentRun?.timeline || []);
    const handoffTool = sourceTimeline.find(item => (
      item.type === 'tool_call' && String(item.name || '') === 'yan_session_create_handoff'
    ));
    const handoffResult = sourceTimeline.find(item => (
      item.type === 'tool_result' && item.callId === handoffTool?.callId
    ));
    const recordedToolNames = sourceTimeline
      .filter(item => item.type === 'tool_call')
      .map(item => String(item.name || ''));
    assert.ok(handoffTool, `DeepSeek tool calls: ${recordedToolNames.join(', ') || '(none)'}`);
    assert.equal(handoffResult?.ok, true, String(handoffResult?.output || 'Handoff tool failed.'));
    const targetReply = [...targetSession.messages].reverse().find(message => message.role === 'assistant');
    assert.ok(String(targetReply?.content || '').includes(secret), 'Target task did not recover source context.');

    const sessionCountBeforeReuse = sessions.length;
    const sourceOpenCodeSessionId = sourceSession.openCodeSessionId;
    const targetOpenCodeSessionId = targetSession.openCodeSessionId;
    const returnResult = await submitAuthorizedNavigation(
      page,
      `现在返回 ${sourceWorkspace} 的现有任务。`,
      '__yanReturnToSourceSubmission'
    );
    assert.equal(returnResult.ok, true, returnResult.error || 'Returning to the source workspace failed.');
    await page.waitForFunction(expectedId => (
      state.currentSession?.id === expectedId && !state.activeRuns.has(expectedId)
    ), sourceSessionId, { timeout: 30_000 });
    let sessionsAfterReuse = readSessions();
    assert.equal(sessionsAfterReuse.length, sessionCountBeforeReuse, 'Returning to the parent created a duplicate task.');

    const forwardResult = await submitAuthorizedNavigation(
      page,
      `现在再进入 ${targetWorkspace} 的现有任务。`,
      '__yanReturnToTargetSubmission'
    );
    assert.equal(forwardResult.ok, true, forwardResult.error || 'Returning to the child workspace failed.');
    await page.waitForFunction(expectedId => (
      state.currentSession?.id === expectedId && !state.activeRuns.has(expectedId)
    ), targetSessionId, { timeout: 30_000 });
    sessionsAfterReuse = readSessions();
    assert.equal(sessionsAfterReuse.length, sessionCountBeforeReuse, 'Returning to the child created a duplicate task.');
    assert.equal(sessionsAfterReuse.filter(session => (
      path.resolve(String(session.workspace || '')) === path.resolve(sourceWorkspace)
    )).length, 1);
    assert.equal(sessionsAfterReuse.filter(session => (
      path.resolve(String(session.workspace || '')) === path.resolve(targetWorkspace)
    )).length, 1);
    assert.equal(sessionsAfterReuse.find(session => session.id === sourceSessionId)?.openCodeSessionId, sourceOpenCodeSessionId);
    assert.equal(sessionsAfterReuse.find(session => session.id === targetSessionId)?.openCodeSessionId, targetOpenCodeSessionId);

    const sessionCountBeforeDenial = sessionsAfterReuse.length;
    const denialPrompt = `请再新建一个 Yan 对话并进入 ${deniedWorkspace}。`;
    await page.evaluate(prompt => {
      window.__yanDeniedSubmission = submitMessage(prompt, [], []);
    }, denialPrompt);
    await page.waitForFunction(() => {
      const panel = document.querySelector('#agentPermissionPanel');
      const title = document.querySelector('#agentPermissionTitle');
      return panel && !panel.classList.contains('hidden')
        && title?.textContent === '进入其他工作区任务';
    }, null, { timeout: timeoutMs });
    await page.locator('#agentPermissionDeny').click();
    const deniedResult = await page.evaluate(async timeout => Promise.race([
      window.__yanDeniedSubmission,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Denied run timed out')), timeout))
    ]), timeoutMs);
    assert.equal(deniedResult.ok, true, deniedResult.error || 'Model did not finish after handoff denial.');
    const sessionsAfterDenial = readSessions();
    assert.equal(sessionsAfterDenial.length, sessionCountBeforeDenial);
    assert.equal(sessionsAfterDenial.some(session => (
      path.resolve(String(session.workspace || '')) === path.resolve(deniedWorkspace)
    )), false, 'A denied handoff still created a Yan task.');

    process.stdout.write(`${JSON.stringify({
      ok: true,
      provider: selection.provider,
      model: selection.model,
      durationMs: Date.now() - startedAt,
      sourceSessionId,
      targetSessionId,
      sourceWorkspace,
      targetWorkspace,
      permissionDetail,
      handoffTool: handoffTool.name,
      sourceOpenCodeSessionId,
      targetOpenCodeSessionId,
      targetReply: String(targetReply.content || ''),
      reusedParentTask: true,
      reusedChildTask: true,
      deniedHandoffCreatedTask: false
    })}\n`);
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

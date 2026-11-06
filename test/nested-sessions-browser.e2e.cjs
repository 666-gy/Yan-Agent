'use strict';
// Regression: a nested child run must be able to drive the built-in browser in
// its own window. The browser bridge used to send every agent command to the
// main window, and browser-lifecycle rejected child-hosted webviews.
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-nested-browser-'));
const workspace = path.join(root, 'project');
fs.mkdirSync(workspace);
execFileSync('git', ['init', '-q', workspace], { windowsHide: true });
fs.writeFileSync(path.join(workspace, 'README.md'), 'nested browser fixture\n');

let app, parentId = '';
const stages = new Map(), errors = [];
const pageServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  res.end('<html><body style="background:#fff"><h1>NESTED_BROWSER_PAGE</h1></body></html>');
});
const modelServer = http.createServer(async (req, res) => {
  if (req.method === 'GET') {
    res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model' }] }));
    return;
  }
  let raw = '';
  for await (const chunk of req) raw += chunk;
  let body;
  try { body = JSON.parse(raw); } catch { res.end('data: [DONE]\n\n'); return; }
  const text = body.messages.map(message => typeof message.content === 'string' ? message.content : JSON.stringify(message.content)).join('\n');
  const contexts = [...text.matchAll(/<yan-turn-context task_id="([^"]+)" session_id="([^"]*)">/g)];
  const taskId = contexts.at(-1)?.[1] || '';
  const sessionId = contexts.at(-1)?.[2] || '';
  const tools = body.tools || [];
  const nestedTool = tools.find(tool => tool.function?.name?.endsWith('nested_sessions'));
  const openTool = tools.find(tool => tool.function?.name?.endsWith('open_builtin_browser'));
  const screenshotTool = tools.find(tool => tool.function?.name?.endsWith('browser_screenshot'));
  const last = body.messages.at(-1);
  const reply = (content, toolCall) => {
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finishReason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finishReason }] })}\n\n`);
    if (toolCall) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_' + Math.random().toString(36).slice(2), type: 'function', function: { name: toolCall.name, arguments: toolCall.arguments } }] });
      send({}, 'tool_calls');
    } else {
      send({ role: 'assistant', content });
      send({}, 'stop');
    }
    res.end('data: [DONE]\n\n');
  };
  if (sessionId === parentId) {
    if (nestedTool && !body.messages.some(message => message.role === 'tool')) {
      reply('', { name: nestedTool.function.name, arguments: JSON.stringify({
        operation: 'dispatch', task_id: taskId, request_key: 'browser_probe',
        tasks: [{ title: '浏览器子会话', prompt: 'BROWSER_CHILD 请打开本地页面并截图。' }]
      }) });
      return;
    }
    reply('PARENT_DONE');
    return;
  }
  if (!sessionId) { reply('UTILITY_DONE'); return; }
  const stage = stages.get(sessionId) || 0;
  if (stage === 0 && openTool) {
    stages.set(sessionId, 1);
    reply('', { name: openTool.function.name, arguments: JSON.stringify({
      task_id: taskId, action: 'open', target_type: 'url',
      url_or_path: `http://127.0.0.1:${pageServer.address().port}/`
    }) });
    return;
  }
  if (stage === 1 && last?.role === 'tool' && screenshotTool) {
    stages.set(sessionId, 2);
    reply('', { name: screenshotTool.function.name, arguments: JSON.stringify({ task_id: taskId }) });
    return;
  }
  if (stage === 2 && last?.role === 'tool') {
    stages.set(sessionId, 3);
    reply('CHILD_DONE');
    return;
  }
  reply('CHILD_DONE');
});

(async () => {
  try {
    await new Promise(resolve => pageServer.listen(0, '127.0.0.1', resolve));
    await new Promise(resolve => modelServer.listen(0, '127.0.0.1', resolve));
    app = await _electron.launch({
      executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(root, 'data') }
    });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push('main:' + error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    parentId = await page.evaluate(async ({ baseUrl, workspace }) => {
      const saved = await api.connectionsSave({
        name: 'Nested browser fixture', apiKey: 'fixture', baseUrl, preset: 'openai', apiFormat: 'openai',
        customModels: ['fixture'], modelFlags: { fixture: { enabled: true } }
      });
      if (!saved.ok) throw Error(saved.error);
      const model = (await api.listQuickModels()).models.find(entry => entry.id === 'fixture');
      state.config = await api.setModelRole(model.providerId, model.id, 'text', model.supplierId);
      renderModelBadge();
      state.config.nestedSessions = await api.nestedPreferences({ enabled: true, style: 'grid' });
      await loadSession((await api.createSession(true, workspace)).id);
      return state.currentSession.id;
    }, { baseUrl: `http://127.0.0.1:${modelServer.address().port}/v1`, workspace });
    await page.locator('#composerInput').fill('NESTED_BROWSER_PARENT 请派发一个浏览器子会话。');
    await page.locator('#sendBtn').click();

    let child;
    for (let index = 0; index < 300; index++) {
      child = app.windows().find(window => window.url().includes('index.html?nestedSession='));
      if (child) break;
      await delay(100);
    }
    assert.ok(child, 'child window must open');
    child.on('pageerror', error => errors.push('child:' + error.message));
    await child.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession?.id === api.nestedWindowSessionId);
    await child.locator('#nestedStartGate').waitFor({ state: 'visible' });
    assert.match(await child.locator('#nestedStartGate').innerText(), /子会话开始前你可以继续选择模型/);
    await child.screenshot({ path: path.join(appRoot, '.yanagent', 'evidence', 'nested-start-gate.png') });
    await child.locator('#nestedStartConfirm').click();

    const until = async (check, label) => {
      for (let index = 0; index < 600; index++) {
        if (await check()) return;
        await delay(100);
      }
      throw Error('timeout: ' + label);
    };
    await until(async () => child.evaluate(() => {
      const session = state.currentSession;
      return session?.messages?.some(message => message.agentRun?.timeline?.some(item =>
        item.type === 'tool_result' && item.name?.includes('open_builtin_browser')));
    }), 'child browser tool result');
    await until(async () => child.evaluate(() => {
      const session = state.currentSession;
      return session?.messages?.some(message => message.agentRun?.timeline?.some(item =>
        item.type === 'tool_result' && item.name?.includes('browser_screenshot')));
    }), 'child screenshot result');

    const result = await child.evaluate(() => {
      const session = state.currentSession;
      const results = [];
      for (const message of session.messages) {
        for (const item of message.agentRun?.timeline || []) {
          if (item.type === 'tool_result' && /open_builtin_browser|browser_screenshot/.test(item.name || '')) {
            results.push({ name: item.name, ok: item.ok });
          }
        }
      }
      return { tabs: document.querySelectorAll('[data-rs-tab-type="browser"]').length, results };
    });
    const mainTabs = await page.evaluate(() => document.querySelectorAll('[data-rs-tab-type="browser"]').length);
    assert.ok(result.tabs > 0, 'child window must own the browser tab');
    assert.equal(mainTabs, 0, 'main window must not own the child browser tab');
    assert.ok(result.results.some(entry => entry.name.includes('open_builtin_browser') && entry.ok === true), 'browser open must succeed');
    assert.ok(result.results.some(entry => entry.name.includes('browser_screenshot') && entry.ok === true), 'browser screenshot must succeed');
    assert.deepEqual(errors, []);
    console.log('PASS nested child browser: child-owned tab, open + screenshot succeed, main window untouched');
  } finally {
    await app?.close();
    pageServer.closeAllConnections();
    modelServer.closeAllConnections();
    await new Promise(resolve => pageServer.close(resolve));
    await new Promise(resolve => modelServer.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

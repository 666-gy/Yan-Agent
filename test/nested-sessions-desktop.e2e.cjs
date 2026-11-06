'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-nested-desktop-'));
const workspace = path.join(root, 'project'), evidence = path.join(appRoot, 'output', 'playwright', 'nested-sessions');
fs.mkdirSync(workspace); fs.mkdirSync(evidence, { recursive: true });
execFileSync('git', ['init', '-q', workspace], { windowsHide: true });
fs.writeFileSync(path.join(workspace, 'README.md'), 'Nested session fixture\n');
let app, parentId, hold = true, stage = 0, asked = false;
const waiting = new Map(), requests = [], errors = [];
async function until(check, description) { for (let i = 0; i < 600; i++) { if (await check()) return; await delay(100); } throw Error('timeout: ' + description); }
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model' }, { id: 'fixture2', object: 'model' }] })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  const text = body.messages.map(m => typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).join('\n');
  const contexts = [...text.matchAll(/<yan-turn-context task_id="([^"]+)" session_id="([^"]*)">/g)];
  const context = contexts.at(-1), taskId = context?.[1], sessionId = context?.[2];
  const tool = body.tools?.find(t => t.function?.name.endsWith('nested_sessions'));
  const reply = (content, input, toolName) => {
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (input) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: 'nested_' + stage, type: 'function', function: { name: toolName || tool.function.name, arguments: JSON.stringify(toolName ? input : { ...input, task_id: taskId }) } }] }); send({}, 'tool_calls');
    } else { send({ role: 'assistant', content }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  };
  if (sessionId === parentId && tool && stage === 0) { stage++; reply('', { operation: 'dispatch', request_key: 'desktop_dispatch', tasks: ['前端', '后端', '测试', '审查'].map((name, i) => ({ title: '定点精修' + name, prompt: 'NESTED_CHILD_' + i + ' 请验证独立会话。' })) }); return; }
  if (sessionId === parentId && tool && stage === 1) { stage++; reply('', { operation: 'suspend' }); return; }
  if (sessionId && sessionId !== parentId && body.tools?.length && hold) { waiting.set(sessionId, () => reply('CHILD_RESULT_' + sessionId)); return; }
  if (!asked && sessionId !== parentId && body.tools?.some(t => t.function?.name === 'question') && text.includes('NESTED_QUESTION')) {
    asked = true; reply('', { questions: [{ header: 'Choice', question: '继续测试吗？', options: [{ label: 'Yes', description: 'Continue' }] }] }, 'question'); return;
  }
  reply(sessionId === parentId ? 'PARENT_RESULT_READY' : 'CHILD_RESULT_' + (sessionId || 'utility'));
});
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    app = await _electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(root, 'data') } });
    const page = await app.firstWindow(); page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    parentId = await page.evaluate(async ({ baseUrl, workspace }) => {
      const saved = await api.connectionsSave({ name: 'Nested fixture', apiKey: 'fixture', baseUrl, preset: 'openai', apiFormat: 'openai', customModels: ['fixture', 'fixture2'], modelFlags: { fixture: { enabled: true }, fixture2: { enabled: true } } });
      if (!saved.ok) throw Error(saved.error);
      const model = (await api.listQuickModels()).models.find(m => m.id === 'fixture');
      state.config = await api.setModelRole(model.providerId, model.id, 'text', model.supplierId); renderModelBadge();
      state.config.nestedSessions = await api.nestedPreferences({ enabled: true, style: 'grid' });
      await loadSession((await api.createSession(true, workspace)).id);
      window.__nestedResults = []; api.onOpenCodeCompleted(detail => window.__nestedResults.push(detail));
      return state.currentSession.id;
    }, { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, workspace });
    await page.locator('#composerInput').fill('NESTED_PARENT_START 请派发四个子会话并等待回报。'); await page.locator('#sendBtn').click();
    await until(() => app.windows().filter(p => p.url().includes('index.html?nestedSession=')).length === 4, 'four automatic child windows');
    const children = app.windows().filter(p => p.url().includes('index.html?nestedSession='));
    for (const child of children) {
      child.on('pageerror', error => errors.push(error.message));
      await child.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession?.id === api.nestedWindowSessionId);
      for (const selector of ['#appRail', '#sidebar', '#taskBarNewTask']) assert.equal(await child.locator(selector).isVisible(), false);
      // A hidden left sidebar must not reserve layout space for the fullscreen
      // side panel; the inset is derived from --sidebar-w.
      const fullscreenInset = await child.evaluate(() => {
        const probe = document.createElement('div');
        probe.style.cssText = 'position:absolute;top:0;bottom:0;left:calc(var(--sidebar-w, 256px) + 4px);width:0';
        document.getElementById('app').appendChild(probe);
        const left = probe.getBoundingClientRect().left; probe.remove(); return left;
      });
      assert.ok(fullscreenInset <= 8, `fullscreen side panel must start at the window edge, got ${fullscreenInset}px`);
      assert.equal(await child.locator('#composerInput').isVisible(), true);
      assert.deepEqual(await child.locator('script[src]').evaluateAll(nodes => nodes.map(n => n.src)), await page.locator('script[src]').evaluateAll(nodes => nodes.map(n => n.src)), 'identical original application scripts');
      assert.equal(await child.getByRole('button', { name: '新建任务' }).count(), 0);
      assert.equal(await child.evaluate(() => typeof window.yan.openCodeStartRun), 'function');
      // A dispatched child waits for an explicit model confirmation before its
      // delegated task is sent to the model.
      await child.locator('#nestedStartGate').waitFor({ state: 'visible' });
      assert.match(await child.locator('#nestedStartGate').innerText(), /子会话开始前你可以继续选择模型/);
      assert.equal(await child.locator('#nestedStartConfirm').isVisible(), true);
      if (child === children[0]) {
        // The start gate must let the user switch the child model before the
        // first request; the run must use the newly selected model.
        await child.locator('#modelPill').click();
        await child.locator('#modelQuickModelRoute').click();
        await child.locator('#modelQuickList [data-model-picker-model="fixture2"]').click();
        await child.waitForFunction(() => state.currentSession?.modelSelection?.modelId === 'fixture2');
      }
      const beforeStart = await child.evaluate(() => api.nestedState());
      assert.equal(beforeStart.child.jobs[0].status, 'draft');
      assert.equal(beforeStart.session.messages.filter(message => message.role === 'user').length, 0);
      await child.locator('#nestedStartConfirm').click();
      await until(async () => (await child.evaluate(() => api.nestedState())).child.jobs[0].status === 'running', 'child starts after confirmation');
      const afterStart = await child.evaluate(() => api.nestedState());
      assert.ok(afterStart.session.messages.some(message => message.role === 'user' && String(message.content).includes('NESTED_CHILD')), 'task is sent only after confirmation');
      if (child === children[0]) assert.equal(afterStart.session.modelSelection?.modelId, 'fixture2');
      // Main-window-only surfaces answer neutrally here instead of rejecting on
      // every poll tick, and the Bash panel is bound to this child session.
      assert.deepEqual(await child.evaluate(() => api.browserDownloads()), []);
      assert.deepEqual(await child.evaluate(() => api.externalAgentsList()), []);
      assert.deepEqual(await child.evaluate(() => api.bashList(api.nestedWindowSessionId)), []);
      // The downloads surface is main-window only and must not even mount here.
      assert.equal(await child.locator('.bd-panel').count(), 0);
      assert.match(await child.evaluate(async () => { try { await api.bashList('other-session'); return 'resolved'; } catch (error) { return error.message; } }), /只能操作所属子会话/);
    }
    await until(() => waiting.size === 4, 'four concurrent model requests');
    assert.ok(requests.some(body => body.model === 'fixture2'), 'child uses the model selected in the gate');
    const bounds = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().filter(w => w.webContents.getURL().includes('index.html?nestedSession=')).map(w => w.getBounds()));
    assert.equal(new Set(bounds.map(b => b.x)).size, 2); assert.equal(new Set(bounds.map(b => b.y)).size, 2);
    await children[0].screenshot({ path: path.join(evidence, 'child-window.png') });
    const identity = (await children[0].evaluate(() => api.nestedState())).session.id;
    const guidance = await children[0].evaluate(async () => { const s = await api.nestedState(); return api.openCodeInterject({ runId: s.child.jobs[0].runId, text: 'LIVE_GUIDANCE 只检查前端。', directGuidance: true }); });
    assert.equal(guidance.ok, true);
    assert.equal((await children[0].evaluate(() => api.nestedState())).child.jobs.length, 1);
    await children[1].evaluate(() => abortSessionById(state.currentSession.id));
    await until(async () => (await children[1].evaluate(() => api.nestedState())).child.jobs[0].status === 'interrupted', 'stop only selected child');
    assert.equal((await children[2].evaluate(() => api.nestedState())).child.jobs[0].status, 'running');
    await Promise.all([children[0].waitForEvent('close'), children[0].locator('#winClose').click()]); assert.equal(waiting.size, 4);
    await page.evaluate(id => api.nestedOpen(id), identity);
    const reopened = app.windows().filter(p => p.url().includes('index.html?nestedSession=')).at(-1);
    await reopened.waitForFunction(() => window.__YAN_APP_READY__ && state.currentSession?.id === api.nestedWindowSessionId);
    assert.equal((await reopened.evaluate(() => api.nestedState())).session.id, identity);
    hold = false; for (const reply of waiting.values()) reply();
    await until(async () => (await reopened.evaluate(() => api.nestedState())).child.jobs.every(j => j.status === 'done'), 'child result persistence');
    await reopened.locator('#composerInput').fill('请继续验证第二轮。'); await reopened.locator('#sendBtn').click();
    await until(async () => { const s = await reopened.evaluate(() => api.nestedState()); return s.child.jobs.length === 2 && s.child.jobs.every(j => j.status === 'done'); }, 'child follow-up');
    const latest = await reopened.evaluate(() => api.nestedState());
    fs.writeFileSync(path.join(evidence, 'child-session.json'), JSON.stringify(latest, null, 2));
    assert.equal(latest.session.messages.filter(m => m.content === '请继续验证第二轮。').length, 1);
    assert.equal(new Set(latest.session.messages.filter(m => m.agentRun).map(m => m.agentRun.openCodeSessionId)).size, 1);
    await reopened.locator('#composerInput').fill('NESTED_QUESTION 请询问我是否继续。'); await reopened.locator('#sendBtn').click();
    await until(async () => { if (await reopened.locator('#agentPermissionPanel[data-mode=permission]:not(.hidden)').isVisible()) await reopened.locator('#agentPermissionOnce').click(); return await reopened.locator('#agentPermissionPanel[data-mode=question]:not(.hidden)').isVisible(); }, 'native child permission and question');
    await reopened.locator('.agent-question-option').click();
    await until(async () => { const s = await reopened.evaluate(() => api.nestedState()); return s.child.jobs.length === 3 && s.child.jobs.every(j => j.status === 'done'); }, 'child answer resumes');
    assert.ok(requests.some(body => body.messages?.some(m => m.role === 'tool' && JSON.stringify(m).includes('Yes'))));
    await until(async () => (await page.evaluate(() => window.__nestedResults)).filter(r => r.result?.text?.includes('PARENT_RESULT_READY')).length >= 2, 'parent resumes');
    await page.bringToFront(); await page.screenshot({ path: path.join(evidence, 'parent-sidebar.png') });
    // The wake prompt stays in stored history for the model, but the child
    // report must never be painted as something the user typed.
    const storedWake = await page.evaluate(id => api.getSession(id), parentId);
    assert.ok(storedWake.messages.some(m => m.nestedSource === 'child_report'), 'wake prompt is kept in stored history');
    assert.equal(await page.locator('#messages .msg.user', { hasText: '子会话结果已到达' }).count(), 0, 'wake prompt must not render as a user message');
    assert.ok(await page.locator('#messages .msg.assistant').count() > 0, 'assistant replies still render');
    assert.deepEqual(errors, []);
    const savedParent = await page.evaluate(id => api.getSession(id), parentId);
    assert.ok(savedParent.messages.every(m => !String(m.content).includes('CHILD_RESULT_utility')), 'utility runs must not leak into parent chat');
    fs.writeFileSync(path.join(evidence, 'parent-session.json'), JSON.stringify(savedParent, null, 2));
    // Background-Bash wakes are host input: the real renderer must not paint one
    // as a user bubble even though it stays in the stored transcript.
    const backgroundBashBubbles = await page.evaluate(() => {
      renderMessages([
        { role: 'user', content: 'YAN BACKGROUND BASH COMPLETION injected', nestedSource: 'background_bash', ts: Date.now() },
        { role: 'assistant', content: 'ok', ts: Date.now() }
      ]);
      return [...document.querySelectorAll('#messages .msg.user')].map(el => el.textContent.trim());
    });
    assert.deepEqual(backgroundBashBubbles, [], 'background Bash wake must not render as a user message');
    console.log('PASS real Electron + model/MCP dispatch: 4 worktrees, 4 original application windows, 4 concurrent runs, scoped stop, live guidance, close/reopen, persistent follow-up, permission/question, parent wake');
  } catch (error) {
    fs.writeFileSync(path.join(evidence, 'requests.json'), JSON.stringify(requests, null, 2));
    if (app) fs.writeFileSync(path.join(evidence, 'windows.json'), JSON.stringify(await Promise.all(app.windows().map(async p => ({ url: p.url(), text: await p.locator('body').innerText().catch(() => '') }))), null, 2));
    throw error;
  } finally {
    hold = false; for (const reply of waiting.values()) reply();
    await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

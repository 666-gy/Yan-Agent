'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { _electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-todo-desktop-'));
let app, asked = false;
const requests = [];
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model' }] })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  if (body.tools?.length && !asked) {
    asked = true;
    send({ role: 'assistant', tool_calls: [{ index: 0, id: 'todo_call', type: 'function', function: { name: 'todowrite', arguments: JSON.stringify({ todos: [{ id: 'one', content: 'Check backend persistence', status: 'completed' }, { id: 'two', content: 'Verify remaining work', status: 'pending' }] }) } }] });
    send({}, 'tool_calls');
  } else { send({ role: 'assistant', content: 'DESKTOP_TODO_DONE' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
});
(async () => {
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    app = await _electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async ({ baseUrl, workspace }) => {
      const saved = await api.connectionsSave({ name: 'Todo fixture', apiKey: 'fixture', baseUrl,
        preset: 'openai', apiFormat: 'openai', customModels: ['fixture'], modelFlags: { fixture: { enabled: true } } });
      if (!saved.ok) throw new Error(saved.error);
      const model = (await api.listQuickModels()).models.find(item => item.id === 'fixture');
      state.config = await api.setModelRole(model.providerId, model.id, 'text', model.supplierId);
      renderModelBadge();
      await loadSession((await api.createSession(true, workspace)).id);
      window.__questionComplete = null;
      api.onOpenCodeCompleted(detail => { window.__questionComplete = detail; });
    }, { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, workspace: root });
    await page.locator('#composerInput').fill('Create the task plan.');
    await page.locator('#sendBtn').click();
    await page.waitForFunction(() => !!window.__questionComplete, { timeout: 30000 });
    const result = await page.evaluate(() => window.__questionComplete.result);
    assert.equal(result.status, 'done', JSON.stringify(result));
    assert.match(JSON.stringify(result), /DESKTOP_TODO_DONE/);
    assert.deepEqual(result.todos.map(item => item.status), ['completed', 'pending']);
    await page.waitForFunction(() => state.currentSession.messages.some(message => message.agentRun?.todos?.length === 2));
    const saved = await page.evaluate(async () => {
      const id = state.currentSession.id;
      await loadSession(id);
      return state.currentSession.messages.flatMap(message => message.agentRun?.todos || []);
    });
    assert.equal(saved.length, 2);
    assert.ok(JSON.stringify(saved).includes('Check backend persistence'));
    assert.equal(await page.locator('#agentPermissionPanel:not(.hidden)').count(), 0);
    console.log('PASS actual desktop todo -> completion -> saved session reload');
  } finally {
    await app?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


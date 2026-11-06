'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-scheduled-execution-'));
const requests = [];
let releaseSuggestion, app;
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model' }] })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  const suggestion = JSON.stringify(body.messages).includes('slow-suggestion-fixture');
  if (suggestion) await new Promise(resolve => { releaseSuggestion = resolve; });
  if (res.destroyed) return;
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  send({ role: 'assistant', content: suggestion ? 'KEEP_DEFAULT' : '该玩游戏了！' }); send({}, 'stop');
  res.end('data: [DONE]\n\n');
});
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: data } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    assert.ok(await app.evaluate(({ app }) => app.listenerCount('before-quit') <= 10));
    await page.evaluate(async baseUrl => {
      window.YanStartupHello?.skip?.();
      const saved = await api.connectionsSave({ name: 'Scheduled fixture', apiKey: 'fixture', baseUrl,
        preset: 'openai', apiFormat: 'openai', customModels: ['fixture'], modelFlags: { fixture: { enabled: true } } });
      if (!saved.ok) throw new Error(saved.error);
      const model = (await api.listQuickModels()).models.find(m => m.id === 'fixture');
      state.config = await api.setModelRole(model.providerId, model.id, 'text', model.supplierId);
      const original = runScheduledTask;
      runScheduledTask = async (...args) => { const result = await original(...args); window.__scheduledResult = result; return result; };
      showMainPage('scheduled-tasks'); openScheduledTaskDialog();
      document.querySelector('#scheduledTaskDescription').value = '提醒我玩游戏';
      scheduledTaskModelSelection = { ...model, modelId: model.id };
      await submitScheduledTask();
      window.__scheduledId = scheduledTasks[0].id;
      await api.updateScheduledTask(window.__scheduledId, { newTaskEachRun: false });
    }, `http://127.0.0.1:${server.address().port}/v1`);
    // Wait through the old automatic suggestion delay after creation.
    await new Promise(resolve => setTimeout(resolve, 1500));
    assert.equal(requests.length, 0, 'creation must not start a model request');
    const runFromMenu = async () => {
      await page.evaluate(() => { window.__scheduledResult = null; });
      await page.locator('[data-scheduled-task-menu]').first().click();
      await page.locator('[data-scheduled-task-action="run"]').click();
      await page.waitForFunction(() => window.__scheduledResult, null, { timeout: 60000 });
      assert.equal((await page.evaluate(() => window.__scheduledResult)).ok, true);
    };
    await runFromMenu();
    assert.ok(requests.some(body => JSON.stringify(body.messages).includes('<yan-scheduled-task-execution>')));
    assert.equal(await page.evaluate(() => state.currentSession.messages.at(-1).content), '该玩游戏了！');

    // Force the former race: a slow suggestion for this same owner remains
    // in flight while a second manual execution goes through the real kernel.
    const suggestion = await page.evaluate(() => api.openCodeStartRun({
      runId: 'slow-suggestion-fixture', yanSessionId: state.currentSession.id,
      prompt: 'slow-suggestion-fixture', utility: true, utilityKind: 'prompt-suggestion',
      modelSelection: state.currentSession.modelSelection, workspace: ''
    }));
    assert.equal(suggestion.ok, true, suggestion.error);
    const deadline = Date.now() + 45000;
    while (!releaseSuggestion && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 100));
    assert.ok(releaseSuggestion, 'slow utility reached provider');
    await runFromMenu();
    releaseSuggestion();

    // A failed attempt must remain manually retryable on the same day.
    await page.evaluate(async () => {
      const real = runOpenCodeLoop;
      runOpenCodeLoop = async () => { throw new Error('fixture one-time failure'); };
      try { await runScheduledTask(await api.getScheduledTask(window.__scheduledId), { trigger: 'manual' }); }
      finally { runOpenCodeLoop = real; }
    });
    assert.equal(await page.evaluate(async () => (await api.getScheduledTask(window.__scheduledId)).lastRunStatus), 'error');
    await runFromMenu();
    assert.equal(await page.evaluate(async () => (await api.getScheduledTask(window.__scheduledId)).lastRunStatus), 'success');
    console.log('PASS: creation -> menu execution -> concurrent slow suggestion -> same-day failure/retry through the real Electron/kernel path');
  } finally {
    releaseSuggestion?.();
    await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

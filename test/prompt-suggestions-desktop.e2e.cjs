'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { _electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-suggestion-'));
let app, asked = false;
const requests = [];
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model' }] })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw); requests.push(body);
  res.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
  const suggestion = JSON.stringify(body.messages).includes('下一步建议');
  // DeepSeek can spend more than the former 25-second budget reasoning.
  if (suggestion) await new Promise(resolve => setTimeout(resolve, 26000));
  send({ role: 'assistant', content: suggestion ? '给我一个具体例子' : '我们可以讨论如何学习编程。' }); send({}, 'stop');
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
    await page.waitForFunction(() => document.querySelector('#composerInput').dataset.placeholder.includes('给我一个具体例子'), null, { timeout: 45000 });
    const suggestion = requests.find(body => JSON.stringify(body.messages).includes('下一步建议'));
    assert.ok(suggestion);
    assert.equal(suggestion.tools?.length || 0, 0);
    const originalSessionId = await page.evaluate(() => state.currentSession.id);
    await page.evaluate(async () => {
      const other = await api.createSession(true, '');
      await loadSession(other.id);
    });
    assert.equal(await page.locator('#composerInput').getAttribute('data-placeholder'), '与 Yan Agent 协作');
    await page.locator('#composerInput').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => getComposerText()), '');
    await page.evaluate(async id => { await loadSession(id); }, originalSessionId);
    await page.waitForFunction(() => document.querySelector('#composerInput').dataset.placeholder.includes('给我一个具体例子'));
    await page.locator('#composerInput').focus();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => getComposerText()), '给我一个具体例子');
    console.log('PASS automatic suggestion after real run -> provider response -> placeholder -> Tab');
  } finally {
    await app?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });



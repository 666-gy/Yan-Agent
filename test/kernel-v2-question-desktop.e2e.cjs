'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { _electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(appRoot, '.yanagent'), { recursive: true });
const root = fs.mkdtempSync(path.join(appRoot, '.yanagent', 'question-desktop-'));
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
    send({ role: 'assistant', tool_calls: [{ index: 0, id: 'question_call', type: 'function', function: { name: 'question', arguments: JSON.stringify({ questions: [{ header: 'Choice', question: 'Continue?', options: [{ label: 'Yes', description: 'Continue execution' }] }] }) } }] });
    send({}, 'tool_calls');
  } else { send({ role: 'assistant', content: 'DESKTOP_QUESTION_RESUMED' }); send({}, 'stop'); }
  res.end('data: [DONE]\n\n');
});
(async () => {
  try {
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    app = await _electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.evaluate(() => document.querySelectorAll('[inert]').forEach(el => { el.inert = false; }));
    await page.evaluate(async ({ baseUrl, workspace }) => {
      const saved = await api.connectionsSave({ name: 'Question fixture', apiKey: 'fixture', baseUrl,
        preset: 'openai', apiFormat: 'openai', customModels: ['fixture'], modelFlags: { fixture: { enabled: true } } });
      if (!saved.ok) throw new Error(saved.error);
      const model = (await api.listQuickModels()).models.find(item => item.id === 'fixture');
      state.config = await api.setModelRole(model.providerId, model.id, 'text', model.supplierId);
      renderModelBadge();
      await loadSession((await api.createSession(true, workspace)).id);
      window.__questionComplete = null;
      api.onOpenCodeCompleted(detail => { window.__questionComplete = detail; });
    }, { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, workspace: root });
    await page.locator('#composerInput').fill('Ask a question, then continue with my answer.');
    await page.locator('#sendBtn').click();
    await page.locator('#agentPermissionPanel[data-mode="permission"]:not(.hidden)').waitFor({ timeout: 30000 });
    await page.locator('#agentPermissionOnce').click();
    await page.locator('#agentPermissionPanel[data-mode="question"]:not(.hidden)').waitFor({ timeout: 30000 });
    await page.locator('.agent-question-option').click();
    await page.locator('.question-answer-message').waitFor();
    assert.match(await page.locator('.question-answer-message').innerText(), /Continue\?[\s\S]*Yes/);
    await page.waitForFunction(() => !!window.__questionComplete, { timeout: 30000 });
    const result = await page.evaluate(() => window.__questionComplete.result);
    assert.equal(result.status, 'done', JSON.stringify(result));
    assert.match(JSON.stringify(result), /DESKTOP_QUESTION_RESUMED/);
    assert.ok(requests.some(body => body.messages?.some(item => item.role === 'tool' && JSON.stringify(item).includes('Yes'))));
    assert.equal(await page.locator('.question-answer-message').count(), 1);
    assert.equal(await page.locator('.question-completed-segment .agent-run-header').getAttribute('data-status'), 'done');
    console.log('PASS actual desktop question -> click answer -> next model step -> completion');
  } finally {
    await app?.close(); server.closeAllConnections(); await new Promise(r => server.close(r));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

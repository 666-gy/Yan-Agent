'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { _electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-concurrent-desktop-'));
const waiting = new Map();
let app, hold = true;
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.end(JSON.stringify({ data: [{ id: 'fixture', object: 'model' }] })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  const label = JSON.stringify(body.messages).match(/DESKTOP_CONCURRENT_([AB])/)?.[1];
  const reply = () => {
    if (res.destroyed) return;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture',
      object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant', content: `DESKTOP_COMPLETED_${label || 'utility'}` }); send({}, 'stop');
    res.end('data: [DONE]\n\n');
  };
  if (hold && label && body.tools?.length) waiting.set(label, reply); else reply();
});
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    app = await _electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async ({ baseUrl, workspace }) => {
      const saved = await api.connectionsSave({ name: 'Concurrent fixture', apiKey: 'fixture', baseUrl,
        preset: 'openai', apiFormat: 'openai', customModels: ['fixture'], modelFlags: { fixture: { enabled: true } } });
      if (!saved.ok) throw new Error(saved.error);
      const model = (await api.listQuickModels()).models.find(item => item.id === 'fixture');
      state.config = await api.setModelRole(model.providerId, model.id, 'text', model.supplierId);
      renderModelBadge();
      window.__concurrentResults = [];
      api.onOpenCodeCompleted(detail => window.__concurrentResults.push(detail));
      await loadSession((await api.createSession(true, workspace)).id);
    }, { baseUrl: `http://127.0.0.1:${server.address().port}/v1`, workspace: root });
    await page.locator('#composerInput').fill('DESKTOP_CONCURRENT_A');
    await page.locator('#sendBtn').click();
    const waitForRequests = async count => {
      const deadline = Date.now() + 30000;
      while (waiting.size < count && Date.now() < deadline) await delay(50);
      assert.equal(waiting.size, count, `expected ${count} overlapping model requests`);
    };
    await waitForRequests(1);
    await page.evaluate(async workspace => loadSession((await api.createSession(true, workspace)).id), root);
    await page.locator('#composerInput').fill('DESKTOP_CONCURRENT_B');
    await page.locator('#sendBtn').click();
    await waitForRequests(2);
    assert.equal(await page.evaluate(() => window.__concurrentResults.length), 0, 'B must start while A is still running');
    const prewarm = await page.evaluate(async () => Promise.all(Array.from({ length: 12 }, () =>
      api.openCodePrewarm({ workspace: state.currentSession.workspace, yanSessionId: state.currentSession.id }))));
    assert.ok(prewarm.every(result => result.ok), JSON.stringify(prewarm));
    hold = false; for (const reply of waiting.values()) reply();
    await page.waitForFunction(() => window.__concurrentResults.length === 2, { timeout: 30000 });
    const results = await page.evaluate(() => window.__concurrentResults);
    assert.ok(results.every(detail => detail.result.status === 'done'), JSON.stringify(results));
    assert.ok(results.some(detail => JSON.stringify(detail.result).includes('DESKTOP_COMPLETED_A')));
    assert.ok(results.some(detail => JSON.stringify(detail.result).includes('DESKTOP_COMPLETED_B')));
    assert.equal(new Set(results.map(detail => detail.result.openCodeSessionId)).size, 2);
    console.log('PASS desktop: A held open -> switch conversation -> B arrives -> repeated prewarm -> both complete');
  } finally {
    hold = false; for (const reply of waiting.values()) reply();
    await app?.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

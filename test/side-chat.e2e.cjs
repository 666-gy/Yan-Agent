'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-side-chat-'));
const evidence = path.join(appRoot, '.yanagent', 'evidence');
fs.mkdirSync(evidence, { recursive: true });
let app;
const errors = [];
const wireRequests = [];
const server = http.createServer(async (req, res) => {
  if (req.method === 'GET') { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify({ data: ['side-chat-model', 'independent-model'].map(id => ({ id, object: 'model' })) })); return; }
  let raw = ''; for await (const chunk of req) raw += chunk;
  const body = JSON.parse(raw);
  wireRequests.push(body);
  const question = JSON.stringify(body.messages?.at(-1) || '');
  res.writeHead(200, { 'content-type': 'text/event-stream' });
  const delta = content => res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk', model: 'side-chat-model', created: 1, choices: [{ index: 0, delta: { content }, finish_reason: null }] }) + '\n\n');
  delta('**SIDE_REPLY_91427**');
  if (question.includes('WAIT_91427')) return;
  res.end('data: [DONE]\n\n');
});
async function launch() {
  app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
  const page = await app.firstWindow();
  page.on('pageerror', error => errors.push(error.message));
  await page.waitForFunction(() => document.querySelector('#rs-interjection')?.dataset.bound === 'true' && typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
  return page;
}
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  let page = await launch();
  await page.evaluate(async baseUrl => {
    const saved = await api.connectionsSave({ name: 'Local side chat fixture', apiKey: 'fixture', baseUrl, preset: 'openai', apiFormat: 'openai' });
    if (!saved?.ok) throw new Error('Fixture connection: ' + saved?.error);
    const main = (await api.listQuickModels()).models.find(model => model.id === 'side-chat-model');
    state.config = await api.setModelRole(main.providerId, main.id, 'text', main.supplierId || '');
    renderModelBadge();
  }, `http://127.0.0.1:${server.address().port}/v1`);
  await page.evaluate(async () => {
    if (!state.currentSession) await newSession();
    setComposerText('MAIN_DRAFT_untouched');
    openRightSidebarTool('interjection');
  });
  await page.locator('#sideChatComposerInput').waitFor({ state: 'visible' });
  await page.evaluate(() => {
    const item = { role: 'agent', text: '', agentRun: { sideChat: true, runId: 'toggle-regression', status: 'working', startedAt: Date.now(), timeline: [{ type: 'thinking', content: 'Working details', stage: 'work' }], uiTimelineRevision: 1 } };
    const message = createInterjectionMessageElement(item);
    document.querySelector('#interjectionTranscript').append(message);
    const header = message.querySelector('.agent-run-header');
    const click = () => message.querySelector('.agent-work-toggle').click();
    const check = (hidden, label) => {
      if (header.classList.contains('agent-work-collapsed') !== hidden) throw new Error(label);
      if (message.querySelector('.agent-work-toggle').getAttribute('aria-expanded') !== String(!hidden)) throw new Error(label + ' aria');
    };
    check(false, 'initial work visible');
    click();
    check(true, 'side chat work did not collapse');
    item.agentRun.timeline[0].content += ' streamed';
    item.agentRun.uiTimelineRevision++;
    updateInterjectionStreamItem(item);
    check(true, 'stream reopened hidden work');
    click();
    check(false, 'side chat work did not expand');
    finalizeInterjectionItem(item);
    click();
    check(true, 'completed side chat work did not collapse');
    message.remove();
  });
  assert.equal(await page.locator('#sideChatComposerHost #sideChatComposer').count(), 1);
  assert.equal(await page.locator('#sideChatComposerInput').textContent(), '');
  assert.equal(await page.locator('.side-chat-empty p').textContent(), '侧边聊天是临时聊天，关闭应用后会消失。');
  assert.equal(await page.locator('#sideChatMode').count(), 0);
  assert.equal(await page.evaluate(() => {
    const template = document.createElement('template');
    template.innerHTML = RIGHT_SIDEBAR_TOOLS.interjection.icon;
    return document.querySelector('.side-chat-empty svg').isEqualNode(template.content.firstElementChild);
  }), true);
  const chooserReady = page.waitForEvent('filechooser');
  await page.locator('#sideChatAttachBtn').click();
  const chooser = await chooserReady;
  assert.equal(chooser.isMultiple(), true);
  await chooser.setFiles([]);
  assert.equal(await page.locator('#sideChatAttachmentMenu').count(), 0);
  await page.locator('#sideChatComposerInput').fill('First line\nSecond line\nThird line');
  const singleLine = await page.locator('#sideChatComposerInput').evaluate(node => ({
    height: node.getBoundingClientRect().height, lineHeight: parseFloat(getComputedStyle(node).lineHeight),
    scrollHeight: node.scrollHeight, text: node.innerText
  }));
  assert.ok(Math.abs(singleLine.height - singleLine.lineHeight) < 1);
  assert.ok(singleLine.scrollHeight > singleLine.height * 2);
  assert.match(singleLine.text, /First line\nSecond line\nThird line/);
  await page.locator('#sideChatComposerInput').fill('');
  const agentConfig = await page.evaluate(() => JSON.stringify({ selection: getAgentModelSelection(), reasoning: getReasoningSpeedMode(), config: state.config }));
  const savedConfig = await page.evaluate(async () => JSON.stringify(await api.getConfig()));
  await page.locator('#sideChatModelPill').click();
  await page.locator('#sideChatModelQuickModelRoute').click();
  await page.locator('#sideChatModelQuickList button').filter({ hasText: 'independent-model' }).click();
  await page.locator('#sideChatModelPill').click();
  await page.locator('#sideChatReasoningSpeedSlider').fill('0');
  await page.locator('#sideChatModelPill').click();
  await page.locator('#sideChatComposerInput').click();
  await page.keyboard.type('click works');
  assert.equal(await page.locator('#sideChatComposerInput').textContent(), 'click works');
  assert.equal(await page.evaluate(() => getSideChatSelection().modelId), 'independent-model');
  assert.equal(await page.evaluate(() => getAgentModelSelection().modelId), 'side-chat-model');
  assert.equal(await page.evaluate(() => JSON.stringify({ selection: getAgentModelSelection(), reasoning: getReasoningSpeedMode(), config: state.config })), agentConfig);
  assert.equal(await page.evaluate(async () => JSON.stringify(await api.getConfig())), savedConfig);
  await page.locator('#sideChatComposerInput').fill('SIDE_SECRET_91427');
  await page.evaluate(() => closeRightSidebar());
  await page.locator('#sideChatComposerInput').waitFor({ state: 'hidden' });
  assert.equal(await page.locator('#composerInput').textContent(), 'MAIN_DRAFT_untouched');
  await page.evaluate(() => openRightSidebarTool('interjection'));
  await page.locator('#sideChatComposerInput').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#sideChatComposerInput').textContent(), 'SIDE_SECRET_91427');
  await page.locator('#sideChatComposerInput').fill('');
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; setBrowserFocusMode(true); });
  await page.waitForTimeout(500);
  assert.match(await page.locator('#sideChatComposerInput').evaluate(node => getComputedStyle(node, '::before').content), /随心输入/);
  const geometry = await page.locator('#rs-interjection').evaluate(panel => {
    const p = panel.getBoundingClientRect(), c = panel.querySelector('#sideChatComposer').getBoundingClientRect();
    const e = panel.querySelector('.side-chat-empty').getBoundingClientRect();
    return { panel: { x: p.x, y: p.y, width: p.width, height: p.height, bottom: p.bottom }, composer: { x: c.x, y: c.y, width: c.width, height: c.height, bottom: c.bottom }, empty: { y: e.y, height: e.height }, overflow: panel.scrollWidth - panel.clientWidth };
  });
  console.log(JSON.stringify({ geometry }));
  assert.ok(geometry.composer.y > geometry.empty.y + geometry.empty.height - 2);
  assert.ok(geometry.composer.bottom <= geometry.panel.bottom);
  assert.equal(geometry.overflow, 0);
  await page.screenshot({ path: path.join(evidence, 'side-chat-empty.png') });
  await page.evaluate(() => setBrowserFocusMode(false));
  for (const width of [320, 375, 414, 768]) {
    await page.evaluate(width => document.documentElement.style.setProperty('--rs-w', `${width}px`), width);
    await page.waitForTimeout(150);
    const fit = await page.locator('#rs-interjection').evaluate(panel => {
      const p = panel.getBoundingClientRect(), composer = panel.querySelector('#sideChatComposer').getBoundingClientRect();
      const send = panel.querySelector('#sideChatSendBtn').getBoundingClientRect();
      return { overflow: panel.scrollWidth - panel.clientWidth, right: p.right, composerRight: composer.right, sendRight: send.right, composerBottom: composer.bottom, sendBottom: send.bottom };
    });
    assert.equal(fit.overflow, 0, JSON.stringify({ width, fit }));
    assert.ok(fit.sendRight <= fit.composerRight + 1 && fit.sendBottom <= fit.composerBottom + 1, JSON.stringify({ width, fit }));
  }
  await page.screenshot({ path: path.join(evidence, 'side-chat-docked.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; setBrowserFocusMode(true); });
  await page.screenshot({ path: path.join(evidence, 'side-chat-dark.png') });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'light'; });
  await page.evaluate(async () => {
    await addSideChatAttachments([new File(['MEMORY_ATTACHMENT_91427'], 'private.txt', { type: 'text/plain' })]);
    if (!sideChatEditorThread.attachments[0]?.data || sideChatEditorThread.attachments[0]?.path) throw new Error('Attachment was persisted');
    const thread = interjectionThreadFor(null);
    const item = { role: 'agent', text: '', requestId: 'test-stream', streaming: true,
      agentRun: { runId: 'test-stream', status: 'working', startedAt: Date.now(), timeline: [], uiTimelineRevision: 0, sideChat: true } };
    thread.items.push({ role: 'user', text: 'SIDE_TRANSCRIPT_91427' }, item);
    interjectionRequests.set('test-stream', { thread, item, runId: '' });
    renderInterjectionTranscript();
    handleInterjectionStreamEvent({ requestId: 'test-stream', runId: '', event: { type: 'reasoning.delta', data: { delta: '正在核对当前任务提供的上下文。' } } });
    handleInterjectionStreamEvent({ requestId: 'test-stream', runId: '', event: { type: 'text.delta', data: { delta: '**正式 Agent 渲染**\n\n```js\nconst result = 42;\n```\n\n| 状态 | 说明 |\n|---|---|\n| Side Chat | 独立讨论 |\n' } } });
    handleInterjectionStreamEvent({ requestId: 'test-stream', runId: '', event: { type: 'completed', data: {} } });
    interjectionRequests.delete('test-stream');
  });
  assert.equal(await page.locator('#interjectionTranscript .agent-run-header').count(), 1);
  assert.ok(await page.locator('#interjectionTranscript strong').count());
  assert.ok(await page.locator('#interjectionTranscript pre').count());
  assert.ok(await page.locator('#interjectionTranscript table').count());
  await page.screenshot({ path: path.join(evidence, 'side-chat-output.png') });
  // Main completion/new runs must not erase a side conversation.
  assert.equal(await page.evaluate(() => { const count = interjectionThreadFor(null).items.length; return interjectionThreadFor({ sessionId: state.currentSession.id, runId: 'new-run' }).items.length === count; }), true);
  const parentMessages = await page.evaluate(() => state.currentSession.messages.length);
  await page.locator('#sideChatComposerInput').fill('SIDE_HTTP_91427');
  await page.locator('#sideChatSendBtn').click();
  await page.waitForFunction(() => !interjectionThreadFor(currentInterjectionRun()).pending && interjectionThreadFor(null).items.some(item => item.text.includes('SIDE_REPLY_91427')));
  assert.equal(wireRequests.length, 1);
  assert.equal(wireRequests[0].model, 'independent-model');
  assert.match(JSON.stringify(wireRequests[0]), /MEMORY_ATTACHMENT_91427/);
  assert.equal(await page.evaluate(() => state.currentSession.messages.length), parentMessages);
  await page.locator('#sideChatComposerInput').fill('WAIT_91427');
  await page.locator('#sideChatSendBtn').click();
  await page.waitForFunction(() => interjectionThreadFor(null).items.at(-1).text.includes('SIDE_REPLY_91427'));
  await page.locator('#sideChatSendBtn.stop-mode').click();
  await page.waitForFunction(() => !interjectionThreadFor(null).pending);
  assert.equal(await page.evaluate(() => interjectionThreadFor(null).items.at(-1).agentRun.status), 'interrupted');
  // With no active task, the composer remains available for side discussion.
  await page.locator('#sideChatComposerInput').fill('NOT_DELIVERED_91427');
  assert.equal(await page.locator('#sideChatSendBtn').isDisabled(), false);
  assert.equal(wireRequests.length, 2);
  await app.close(); app = null;
  const forbidden = ['SIDE_SECRET_91427', 'SIDE_TRANSCRIPT_91427', 'MEMORY_ATTACHMENT_91427', 'SIDE_HTTP_91427', 'SIDE_REPLY_91427', 'WAIT_91427', 'NOT_DELIVERED_91427'];
  function inspect(dir) { for (const name of fs.readdirSync(dir, { withFileTypes: true })) { const file = path.join(dir, name.name); if (name.isDirectory()) inspect(file); else { const data = fs.readFileSync(file); for (const marker of forbidden) assert.equal(data.includes(Buffer.from(marker)), false, `Side data persisted in ${file}`); } } }
  inspect(userData);
  page = await launch();
  await page.evaluate(() => openRightSidebarTool('interjection'));
  await page.locator('#sideChatComposerInput').waitFor({ state: 'visible' });
  assert.equal(await page.locator('#interjectionTranscript .msg').count(), 0);
  assert.equal(await page.locator('#sideChatComposerInput').textContent(), '');
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ ok: true, evidence, checked: ['independent composers', 'draft isolation', 'empty layout', 'memory attachments', 'native Agent output', 'no disk records', 'restart clears history'] }));
})().catch(error => { console.error(error); console.error(errors); process.exitCode = 1; }).finally(async () => {
  await app?.close().catch(() => {});
  server.closeAllConnections(); server.close();
  fs.rmSync(userData, { recursive: true, force: true });
});

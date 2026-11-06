'use strict';
const { _electron } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-call-desktop-'));
const output = path.join(root, 'output/playwright/voice-call'); fs.mkdirSync(output, { recursive: true });
(async () => {
 let app;
 try {
  app = await _electron.launch({ executablePath: require('electron'), args: [path.join(__dirname, 'fixtures/voice-call-desktop.cjs')], cwd: root, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
  const main = await app.firstWindow();
  await main.waitForFunction(() => window.__YAN_APP_READY__);
  assert.equal(await main.locator('#voiceCallPanel').count(), 0, 'no in-app overlay');
  const result = await main.evaluate(() => api.voiceCallOpen({ sessionId: state.currentSession.id })); assert.equal(result.ok, true, result.error);
  const call = app.windows().find(p => p !== main); assert.ok(call);
  await call.waitForSelector('#callAvatar path');
  const details = await app.evaluate(({ BrowserWindow }) => {
   const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话');
   return { parent: !!w.getParentWindow(), top: w.isAlwaysOnTop(), bounds: w.getBounds() };
  });
  assert.equal(details.parent, false); assert.equal(details.top, true); assert.ok(Math.abs(details.bounds.width - 304) <= 1);
  assert.equal(await call.evaluate(() => typeof window.yan), 'undefined', 'dedicated preload exposes no general app API');
  for (const id of ['callMic']) assert.equal(await call.locator('#'+id).isDisabled(), false);
  const first = await call.locator('#callAvatar').innerHTML(); await call.waitForTimeout(200);
  assert.notEqual(await call.locator('#callAvatar').innerHTML(), first);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() !== 'Yan 语音通话').minimize());
  assert.equal(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话').isVisible()), true, 'main minimization leaves desktop call visible');
  await call.screenshot({ path: path.join(output, 'desktop-panel.png') });
  await call.locator('#callCaptions').click();
  await call.waitForFunction(() => document.querySelector('#callCaptions').getAttribute('aria-pressed') === 'true');
  await call.waitForTimeout(400);
  assert.ok(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话').getBounds().height) >= 473);
  const update = async value => app.evaluate(({ BrowserWindow }, data) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话').webContents.send('voice-call:transcript', data), value);
  await update({ id: 'u1', role: 'user', text: 'Yan，', final: false });
  await call.waitForFunction(() => document.querySelector('.call-user')?.textContent === 'Yan，');
  await update({ id: 'u1', role: 'user', text: 'Yan，晚上好。', final: true });
  await update({ id: 'a1', role: 'assistant', text: '晚上好呀，今天过得怎么样？有没有什么有趣的事情想和我分享呀？', final: true });
  await call.waitForSelector('.call-reply time');
  assert.equal(await call.locator('.call-user').count(), 1);
  await call.locator('.call-copy').click();
  assert.match(await app.evaluate(({ clipboard }) => clipboard.readText()), /晚上好呀/);
  await call.screenshot({ path: path.join(output, 'desktop-captions.png') });
  await call.locator('#callShare').click();
  assert.equal(await call.locator('#callShare').getAttribute('aria-pressed'), 'true');
  assert.equal(await call.locator('#callShareNotice').count(), 0);
  assert.equal(await call.locator('#miniCallShare').getAttribute('aria-pressed'), 'true');
  await call.screenshot({ path: path.join(output, 'desktop-sharing.png') });

  await call.locator('#callCaptions').click(); await call.waitForTimeout(400);
  assert.equal(await call.locator('#callTranscript').isVisible(), false);
  assert.ok(Math.abs(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话').getBounds().height) - 394) <= 1);
  await call.locator('#callCaptions').click(); await call.waitForTimeout(400);
  assert.equal(await call.locator('.call-user').textContent(), 'Yan，晚上好。');
  assert.equal(await call.locator('#callShare').getAttribute('aria-pressed'), 'true', 'sharing persists across caption toggles');
  await call.locator('#callMinimize').click();
  await call.waitForSelector('#voiceCallMini:not([hidden])');
  await call.locator('#miniCallShare').click();
  await call.locator('#callExpand').click();
  await call.waitForSelector('#voiceCallPanel:not([hidden])');
  assert.equal(await call.locator('#callShareNotice').count(), 0);
  assert.equal(await call.locator('#callShare').getAttribute('aria-pressed'), 'false');

  await call.locator('#callCaptions').click(); await call.waitForTimeout(400);

  await call.locator('#callCaptions').click(); await call.waitForTimeout(350);
  assert.equal(await call.locator('#callStatePill').isVisible(), false);
  const md = '**粗体**\n\n- 第一项\n- 第二项\n\n```js\nconst x = 1;\n```';
  const html = await main.evaluate(text => renderMarkdown(text), md);
  await update({ id: 'md-test', role: 'assistant', text: md, html, final: true });
  await call.waitForSelector('.call-reply-text strong');
  assert.equal(await call.locator('.call-reply-text strong').textContent(), '粗体');
  assert.equal(await call.locator('.call-reply footer:visible').count(), 1);
  await update({ id: 'next-turn', role: 'user', text: '下一轮', final: false });
  await call.waitForFunction(() => [...document.querySelectorAll('.call-reply footer')].every(x => x.hidden));
  await call.locator('#callTranscript').hover();
  assert.equal(await call.locator('.scrollbar-visible').count(), 0);
  await call.mouse.wheel(0, 120);
  await call.waitForSelector('#callTranscript.scrollbar-visible');
  await call.locator('#callCaptions').hover();
  assert.equal(await call.locator('.scrollbar-visible').count(), 0);
  await call.locator('#callCaptions').click(); await call.waitForTimeout(350);
  await call.locator('#callMinimize').click(); await call.waitForSelector('#voiceCallMini:not([hidden])');
  assert.ok(Math.abs(await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话').getBounds().height) - 88) <= 1);
  const still = await call.locator('#callMiniAvatar').innerHTML(); await call.waitForTimeout(200);
  assert.equal(await call.locator('#callMiniAvatar').innerHTML(), still);
  await call.screenshot({ path: path.join(output, 'desktop-pill.png') });
  // Simulate a desktop drag near the edge, then expand and verify clamping.
  await app.evaluate(({ BrowserWindow, screen }) => {
   const w = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话'), a = screen.getPrimaryDisplay().workArea;
   w.setPosition(a.x + a.width - 328, a.y + a.height - 88);
  });
  await call.locator('#callExpand').click(); await call.waitForSelector('#voiceCallPanel:not([hidden])');
  assert.equal(await app.evaluate(({ BrowserWindow, screen }) => {
   const b = BrowserWindow.getAllWindows().find(w => w.getTitle() === 'Yan 语音通话').getBounds(), a = screen.getDisplayMatching(b).workArea;
   return b.x >= a.x && b.y >= a.y && b.x+b.width <= a.x+a.width && b.y+b.height <= a.y+a.height;
  }), true);
  await main.evaluate(() => api.voiceCallOpen({ sessionId: state.currentSession.id }));
  assert.equal(app.windows().length, 2, 'reopening reuses one window');
  assert.equal(await main.evaluate(() => api.voiceCallOpen({ sessionId: state.currentSession.id })).then(r => r.ok), true);
  // Exercise the real window IPC and renderer routing without a network model call.
  const originalId = await main.evaluate(() => {
   window.callTestSession = state.currentSession;
   window.callTestSubmit = runOpenCodeLoop;
   window.callTestModel = getAgentModelSelection;
   getAgentModelSelection = () => ({ modelType: 'text' });
   runOpenCodeLoop = async (session, el, ctx) => {
    const last = session.messages.at(-1);
    window.callTestReceived = { text: last.content, id: session.id, profile: ctx.utilityKind };
    window.callTestImages = last.attachments;
    return { content: '正文回复', agentRun: { status: 'done' } };
   };
   state.currentSession = { id: 'another-task', messages: [] };
   return window.callTestSession.id;
  });
  const reply = await call.evaluate(() => window.voiceCall.utterance('测试语音任务'));
  assert.equal(reply.ok, true, reply.error); assert.equal(reply.text, '正文回复');
  assert.deepEqual(await main.evaluate(() => window.callTestReceived), { text: '测试语音任务', id: '', profile: 'voice-call' });
  const historyId = await main.evaluate(async () => {
   const records = await api.listSessions();
   const history = records.find(item => item.title.startsWith('妍宝通话 · '));
   if (!history) throw Error('missing voice history');
   return history.id;
  });
  assert.notEqual(historyId, originalId);
  const history = await main.evaluate(id => api.getSession(id), historyId);
  assert.deepEqual(history.messages.map(m => m.content), ['测试语音任务', '正文回复']);
  assert.ok(!history.openCodeSessionId, 'history cannot reuse the voice kernel');
  await app.evaluate(({ desktopCapturer, nativeImage, screen }) => {
   desktopCapturer.getSources = async () => [{ display_id: String(screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).id), thumbnail: nativeImage.createFromBuffer(Buffer.alloc(16, 255), { width: 2, height: 2 }) }];
  });
  const sharedReply = await call.evaluate(() => window.voiceCall.utterance('看看屏幕', true));
  assert.equal(sharedReply.ok, true, sharedReply.error);
  const attachments = await main.evaluate(() => window.callTestImages);
  assert.equal(attachments.length, 1); assert.equal(attachments[0].kind, 'image'); assert.equal(attachments[0].mimeType, 'image/jpeg');
  await call.evaluate(() => window.voiceCall.utterance('停止共享后', false));
  assert.equal(await main.evaluate(() => window.callTestImages.length), 0);
  await main.evaluate(() => {
   runOpenCodeLoop = async (session, el, ctx) => new Promise(resolve => {
    window.callTestPending = true;
    ctx.runAbortController = new AbortController();
    ctx.runAbortController.signal.addEventListener('abort', () => {
      window.callTestAborted = true;
      resolve({ content: '', agentRun: { status: 'interrupted' } });
    });
   });
  });
  const pendingReply = call.evaluate(() => window.voiceCall.utterance('请开始长任务'));
  await main.waitForFunction(() => window.callTestPending);
  assert.equal((await call.evaluate(() => window.voiceCall.action('interrupt'))).ok, true);
  assert.equal((await pendingReply).ok, false);
  assert.equal(await main.evaluate(() => window.callTestAborted), true, 'interrupt cancels only the independent voice run');
  await main.evaluate(() => { state.currentSession = window.callTestSession; runOpenCodeLoop = window.callTestSubmit; getAgentModelSelection = window.callTestModel; });
  await Promise.all([call.waitForEvent('close'), call.locator('#callHangup').click()]);
  await main.waitForFunction(() => document.querySelector('#voiceCallButton').getAttribute('aria-expanded') === 'false');
  assert.equal(app.windows().length, 1);
  const savedHistory = await main.evaluate(id => api.getSession(id), historyId);
  assert.equal(savedHistory.messages.length, 8, 'all turns and interruption survive hangup');
  assert.equal(savedHistory.messages.at(-1).content, '（本次回复已打断）');
  await main.evaluate(() => api.voiceCallOpen({ sessionId: state.currentSession.id })); assert.equal(app.windows().length, 2, 'can reopen after hangup');
  console.log('PASS independent desktop window, always-on-top, main minimized, pill resize, static frame, edge clamping, singleton, hangup/reopen, isolated preload.');
 } finally { await app?.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });

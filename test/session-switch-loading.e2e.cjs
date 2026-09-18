'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-session-switch-'));

// Switching tasks used to keep the previous conversation on screen until the
// async session load finished (seconds). The loading placeholder must replace
// it synchronously, including when a new conversation is created.
(async () => {
  let application;
  const errors = [];
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userDataDir }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => (
      typeof newSession === 'function'
      && typeof loadSession === 'function'
      && typeof saveCurrentSession === 'function'
    ));

    await page.evaluate(async () => {
      await newSession();
      state.currentSession.messages.push({ role: 'user', content: '第一个会话的消息A', ts: Date.now() });
      await saveCurrentSession();
      window.__sessionA = state.currentSession.id;
    });
    await page.evaluate(async () => {
      await newSession();
      state.currentSession.messages.push({ role: 'user', content: '第二个会话的消息B', ts: Date.now() });
      await saveCurrentSession();
      renderMessages(state.currentSession.messages);
      window.__sessionB = state.currentSession.id;
    });
    assert.notEqual(
      await page.evaluate(() => window.__sessionA),
      await page.evaluate(() => window.__sessionB),
      'the two conversations must be distinct sessions'
    );
    await page.waitForFunction(() => (
      document.querySelector('#messages .msg.user')?.textContent?.includes('第二个会话的消息B') === true
    ));

    const switchState = await page.evaluate(async () => {
      const pending = loadSession(window.__sessionA);
      const hasMask = !!document.querySelector('#messages .session-loading');
      const oldGone = !document.querySelector('#messages .msg');
      await pending;
      return {
        hasMask,
        oldGone,
        messageA: document.querySelector('#messages .msg.user')?.textContent?.includes('第一个会话的消息A') === true,
        messageBGone: !document.querySelector('#messages')?.textContent.includes('第二个会话的消息B'),
        maskGone: !document.querySelector('#messages .session-loading')
      };
    });
    assert.equal(switchState.hasMask, true, JSON.stringify(switchState));
    assert.equal(switchState.oldGone, true, JSON.stringify(switchState));
    assert.equal(switchState.messageA, true, JSON.stringify(switchState));
    assert.equal(switchState.messageBGone, true, JSON.stringify(switchState));
    assert.equal(switchState.maskGone, true, JSON.stringify(switchState));

    const createState = await page.evaluate(async () => {
      const pending = newSession();
      const hasMask = !!document.querySelector('#messages .session-loading');
      const oldGone = !document.querySelector('#messages .msg');
      await pending;
      return {
        hasMask,
        oldGone,
        maskGone: !document.querySelector('#messages .session-loading'),
        empty: document.querySelector('#pageChat')?.classList.contains('empty') === true,
        messageAGone: !document.querySelector('#messages')?.textContent.includes('第一个会话的消息A')
      };
    });
    assert.equal(createState.hasMask, true, JSON.stringify(createState));
    assert.equal(createState.oldGone, true, JSON.stringify(createState));
    assert.equal(createState.maskGone, true, JSON.stringify(createState));
    assert.equal(createState.empty, true, JSON.stringify(createState));
    assert.equal(createState.messageAGone, true, JSON.stringify(createState));

    await page.evaluate(async () => {
      state.currentSession.messages = Array.from({ length: 70 }, (_, i) => ({
        role: i % 2 ? 'assistant' : 'user', content: `long message ${i}\n` + 'A long line of text.\n'.repeat(25), ts: Date.now() + i
      }));
      renderMessages(state.currentSession.messages);
      setEmptyState(false);
    });
    await page.waitForFunction(() => document.querySelectorAll('#messages > .msg').length === 70);
    await page.waitForFunction(() => {
      const sc = document.querySelector('#chatScroll');
      return sc.scrollHeight > sc.clientHeight && sc.scrollHeight - sc.scrollTop - sc.clientHeight < 4;
    });
    // Late image/tool layout after the initial bottom jump must stay pinned.
    await page.evaluate(() => {
      const block = document.createElement('div');
      block.id = 'late-layout'; block.style.height = '1500px';
      document.querySelector('#messages > .msg:last-child').appendChild(block);
    });
    await page.waitForFunction(() => {
      const sc = document.querySelector('#chatScroll');
      return sc.scrollHeight - sc.scrollTop - sc.clientHeight < 4;
    });
    await page.evaluate(() => {
      const sc = document.querySelector('#chatScroll');
      sc.dispatchEvent(new WheelEvent('wheel', { deltaY: -500 }));
      sc.scrollTop = Math.max(200, sc.scrollTop - 800);
      document.querySelector('#late-layout').style.height = '2500px';
    });
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => {
      const sc = document.querySelector('#chatScroll');
      return sc.scrollHeight - sc.scrollTop - sc.clientHeight > 400;
    }), true, 'manual scrolling must stop entry follow');
    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, switchState, createState }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

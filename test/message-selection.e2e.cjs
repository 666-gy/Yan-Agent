'use strict';

// Message selection acceptance, verified in the real window:
//   1. selecting text in an Agent/user message pops a floating
//      "添加到对话 / 复制选中" toolbar;
//   2. user message text is directly selectable with the mouse;
//   3. withdrawing a user turn is limited to the latest round AND only when the
//      user stopped that turn: completed, errored and restart-recovered turns
//      hide the withdraw button, and an earlier round can never delete the
//      rounds that came after it.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-message-selection-'));

const scenarioMessages = () => [
  { role: 'user', content: 'FIRST ROUND QUESTION', ts: 1 },
  { role: 'assistant', content: 'FIRST ROUND ANSWER', ts: 2 },
  { role: 'user', content: 'SECOND ROUND QUESTION', ts: 3 },
  { role: 'assistant', content: 'SECOND ROUND ANSWER', ts: 4 }
];

// The same conversation, but with the last turn stopped by the user, so the
// withdraw button is available on the final user message.
const resendScenarioMessages = () => [
  { role: 'user', content: 'FIRST ROUND QUESTION', ts: 1 },
  { role: 'assistant', content: 'FIRST ROUND ANSWER', ts: 2, agentRun: { status: 'done' } },
  { role: 'user', content: 'SECOND ROUND QUESTION', ts: 3 },
  { role: 'assistant', content: 'SECOND ROUND ANSWER', ts: 4, agentRun: { status: 'interrupted' } }
];

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
      typeof renderMessages === 'function'
      && typeof setComposerText === 'function'
      && typeof state !== 'undefined'
      && !!document.querySelector('#composerInput')
      && quickInputHandlerReady === true
    ));

    await page.evaluate(async (messages) => {
      await newSession();
      state.currentSession.messages = messages;
      renderMessages(state.currentSession.messages);
      // Select the first text node of one message body and let the app react to
      // the mouse release exactly like a left-button drag does.
      window.__selectInMessage = (selector, occurrence) => {
        const body = document.querySelectorAll(selector)[occurrence];
        if (!body) return '';
        const walker = document.createTreeWalker(body, NodeFilter.SHOW_TEXT);
        let node = null;
        while (walker.nextNode()) {
          if (walker.currentNode.nodeValue.trim()) { node = walker.currentNode; break; }
        }
        if (!node) return '';
        const range = document.createRange();
        range.selectNodeContents(node);
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(range);
        document.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, button: 0 }));
        return node.nodeValue;
      };
    }, scenarioMessages());

    // (2) user message text must be selectable without hovering for a button.
    assert.equal(
      await page.evaluate(() => {
        const body = document.querySelector('#messages .msg.user .msg-body');
        return body ? getComputedStyle(body).userSelect : 'missing';
      }),
      'text',
      'user message body must allow text selection'
    );

    // (1) selecting Agent text pops the toolbar with the selected text captured.
    const shown = await page.evaluate(async () => {
      const selected = window.__selectInMessage('#messages .msg.assistant .msg-body', 0);
      // Let the queued selectionchange task run: a selection that is still
      // present must never hide the toolbar it just opened.
      await new Promise(resolve => setTimeout(resolve, 50));
      const bar = document.querySelector('#textSelectionToolbar');
      return {
        selected,
        visible: !!bar && !bar.classList.contains('hidden'),
        label: bar?.textContent || '',
        captured: typeof selectionToolbarText === 'string' ? selectionToolbarText : ''
      };
    });
    assert.match(shown.selected, /FIRST ROUND ANSWER/);
    assert.equal(shown.visible, true, 'selecting Agent text must show the toolbar');
    assert.match(shown.label, /添加到对话/);
    assert.match(shown.label, /复制选中/);
    assert.match(shown.label, /在侧边聊天中提问/);
    assert.match(shown.captured, /FIRST ROUND ANSWER/);

    // Auto-follow scrolling must not dismiss the toolbar; it follows the selection.
    const scrolled = await page.evaluate(async () => {
      const sc = document.querySelector('#chatScroll');
      sc.scrollTop = Math.max(0, sc.scrollTop - 40);
      await new Promise(resolve => setTimeout(resolve, 80));
      const bar = document.querySelector('#textSelectionToolbar');
      return !!bar && !bar.classList.contains('hidden');
    });
    assert.equal(scrolled, true, 'scrolling must keep the toolbar attached to the selection');

    // "复制选中" writes exactly the selected span.
    const copied = await page.evaluate(async () => {
      window.__copied = '';
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: { writeText: async value => { window.__copied = value; } }
      });
      document.querySelector('#textSelectionToolbar [data-selection-action="copy"]').click();
      await new Promise(resolve => setTimeout(resolve, 0));
      return window.__copied;
    });
    assert.match(copied, /FIRST ROUND ANSWER/);

    // "添加到对话" pushes the selection into the composer as a quote.
    const composed = await page.evaluate(() => {
      setComposerText('');
      window.__selectInMessage('#messages .msg.assistant .msg-body', 0);
      const before = !document.querySelector('#textSelectionToolbar').classList.contains('hidden');
      document.querySelector('#textSelectionToolbar [data-selection-action="quote"]').click();
      return {
        before,
        quoted: document.querySelector('#composerInput').textContent,
        hidden: document.querySelector('#textSelectionToolbar').classList.contains('hidden')
      };
    });
    assert.equal(composed.before, true, 'the toolbar must be visible before quoting');
    assert.match(composed.quoted, /> FIRST ROUND ANSWER/);
    assert.equal(composed.hidden, true, 'the toolbar hides after use');

    // "在侧边聊天中提问" opens the side chat panel and quotes the selection.
    const sideChat = await page.evaluate(async () => {
      setComposerText('');
      window.__selectInMessage('#messages .msg.assistant .msg-body', 0);
      document.querySelector('#textSelectionToolbar [data-selection-action="side-chat"]').click();
      await new Promise(resolve => setTimeout(resolve, 50));
      const editor = document.getElementById('sideChatComposerInput');
      return {
        hidden: document.querySelector('#textSelectionToolbar').classList.contains('hidden'),
        editor: editor?.textContent || ''
      };
    });
    assert.equal(sideChat.hidden, true, 'the toolbar hides after asking in side chat');
    assert.match(sideChat.editor, /> FIRST ROUND ANSWER/, 'the selection is quoted into the side chat composer');

    // (3) the withdraw button only appears for the latest user-stopped turn.
    const penVisibility = messages => page.evaluate(list => {
      state.currentSession.messages = list;
      syncUserMessageEditAvailability();
      return [...document.querySelectorAll('#messages .msg.user')]
        .map(el => !el.querySelector('.msg-action-btn[data-act="edit"]').classList.contains('hidden'));
    }, messages);
    const withRun = run => [
      { role: 'user', content: 'ROUND ONE', ts: 1 },
      { role: 'assistant', content: 'ANSWER ONE', ts: 2, agentRun: { status: 'done' } },
      { role: 'user', content: 'ROUND TWO', ts: 3 },
      { role: 'assistant', content: 'ANSWER TWO', ts: 4, agentRun: run }
    ];
    assert.deepEqual(await penVisibility(withRun({ status: 'interrupted' })), [false, true],
      'the latest user-stopped turn keeps the withdraw button');
    assert.deepEqual(await penVisibility(withRun({ status: 'done' })), [false, false],
      'a completed turn must not be resendable');
    assert.deepEqual(await penVisibility(withRun({ status: 'error', error: 'boom' })), [false, false],
      'an errored turn must not be resendable');
    assert.deepEqual(await penVisibility(withRun({ status: 'interrupted', recoveredAfterRestart: true })), [false, false],
      'a restart-recovered interruption must not be resendable');
    assert.deepEqual(await penVisibility([
      { role: 'user', content: 'ROUND ONE', ts: 1 },
      { role: 'assistant', content: 'ANSWER ONE', ts: 2, agentRun: { status: 'done' } },
      { role: 'user', content: 'ROUND TWO', ts: 3 },
      { role: 'assistant', content: '已中止媒体生成', ts: 4 }
    ]), [false, true], 'a user-cancelled media turn stays resendable');

    // An earlier round must refuse even when clicked directly.
    await page.evaluate((messages) => {
      state.currentSession.messages = messages;
      syncUserMessageEditAvailability();
    }, resendScenarioMessages());
    const blocked = await page.evaluate(() => {
      document.querySelectorAll('#messages .msg.user')[0].querySelector('.msg-action-btn[data-act="edit"]').click();
      return { count: state.currentSession.messages.length, toast: document.querySelector('#toast').textContent };
    });
    assert.equal(blocked.count, 4, 'an earlier round must not be withdrawn');
    assert.match(blocked.toast, /用户中止/, 'the blocked round must explain the rule');

    // The latest user-stopped round still withdraws normally.
    await page.evaluate(() => {
      document.querySelectorAll('#messages .msg.user')[1].querySelector('.msg-action-btn[data-act="edit"]').click();
    });
    await page.waitForFunction(() => state.currentSession.messages.length === 2);
    assert.equal(
      await page.evaluate(() => document.querySelector('#composerInput').textContent.includes('SECOND ROUND QUESTION')),
      true,
      'the withdrawn round content returns to the composer'
    );

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, copied, composed, blocked, pen: 'user-stopped-only' }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

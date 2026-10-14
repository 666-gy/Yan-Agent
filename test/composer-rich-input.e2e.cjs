'use strict';

// Composer rich-input acceptance, verified in the real window:
//   1. a URL typed into #composerInput becomes an icon chip that keeps the URL
//      in the outgoing text and opens the right-sidebar browser on click;
//   2. the URL the caret still sits in stays plain text until it is finished;
//   3. selecting composer text pops a pill after ~1s that wraps the selection
//      in Markdown bold/italic markers.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-composer-rich-'));

async function removeDirWithRetry(dir) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    try { fs.rmSync(dir, { recursive: true, force: true }); return; } catch { await new Promise(r => setTimeout(r, 250)); }
  }
}

const typeText = (page, value, { caretAtEnd = true } = {}) => page.evaluate(({ value, caretAtEnd }) => {
  setComposerText(value);
  const selection = window.getSelection();
  const range = document.createRange();
  const node = input.lastChild;
  if (node?.nodeType === Node.TEXT_NODE) range.setStart(node, caretAtEnd ? node.nodeValue.length : 0);
  else range.selectNodeContents(input);
  range.collapse(true);
  selection.removeAllRanges();
  selection.addRange(range);
  input.dispatchEvent(new Event('input', { bubbles: true }));
}, { value, caretAtEnd });

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
      typeof setComposerText === 'function'
      && typeof getComposerText === 'function'
      && typeof openBrowserUrlInNewTab === 'function'
      && !!document.querySelector('#composerInput')
      && quickInputHandlerReady === true
    ));

    // Native deletion must restore both static and suggested placeholders.
    const defaultPlaceholder = await page.locator('#composerInput').getAttribute('data-placeholder');
    for (const bot of [false, true]) {
      if (bot) await page.evaluate(() => showMainPage('bot'));
      for (const placeholder of [defaultPlaceholder, '好，开始做吧']) {
        await page.evaluate(text => { input.dataset.placeholder = text; }, placeholder);
        await page.locator('#composerInput').fill('你好\n再检查一下');
        await page.locator('#composerInput').press('Control+a');
        await page.keyboard.press('Backspace');
        const empty = await page.evaluate(() => ({
          text: getComposerText(),
          content: getComputedStyle(input, '::before').content,
          placeholder: input.dataset.placeholder
        }));
        assert.equal(empty.text, '');
        assert.equal(empty.placeholder, placeholder);
        assert.equal(empty.content, JSON.stringify(placeholder));
        // Also exercise removing the final character one key at a time.
        await page.keyboard.type('x');
        await page.keyboard.press('Backspace');
        assert.equal(await page.evaluate(() => getComputedStyle(input, '::before').content), JSON.stringify(placeholder));
      }
    }
    await page.evaluate(text => { input.dataset.placeholder = text; showMainPage('chat'); }, defaultPlaceholder);

    // The URL the caret is still typing stays plain text.
    await typeText(page, 'https://typing.example');
    assert.equal(await page.evaluate(() => document.querySelectorAll('#composerInput a.composer-link').length), 0,
      'a URL under the caret must stay plain text while typing');

    // A finished URL turns into a chip without losing its text.
    await typeText(page, 'see https://example.com/docs/page?q=1 please');
    const chip = await page.evaluate(() => {
      const link = document.querySelector('#composerInput a.composer-link');
      return {
        count: document.querySelectorAll('#composerInput a.composer-link').length,
        href: link?.dataset.href || '',
        icons: link?.querySelectorAll('.composer-link-icon svg').length || 0,
        label: link?.querySelector('.composer-link-text')?.textContent || '',
        contenteditable: link?.getAttribute('contenteditable') || '',
        text: getComposerText()
      };
    });
    assert.equal(chip.count, 1);
    assert.equal(chip.href, 'https://example.com/docs/page?q=1');
    assert.equal(chip.icons, 1, 'the chip carries an icon');
    assert.equal(chip.label, 'https://example.com/docs/page?q=1');
    assert.equal(chip.contenteditable, 'false');
    assert.match(chip.text, /see https:\/\/example\.com\/docs\/page\?q=1 please/,
      'the URL must stay in the outgoing text');

    // Clicking the chip asks the side panel to open the URL.
    const sent = await page.evaluate(() => {
      const content = '查看 https://example.com/a_b?q=1&x=2。还有 https://example.org/wiki/(test) <script>alert(1)</script> javascript:alert(1)';
      const messages = [{ role: 'user', content, ts: Date.now() }];
      const inspect = () => {
        const body = document.querySelector('#messages .msg.user .msg-body');
        return { links: [...body.querySelectorAll('a.user-message-link')].map(link => link.getAttribute('href')),
          icons: body.querySelectorAll('.composer-link-icon svg').length,
          unsafe: body.querySelectorAll('script').length, text: body.textContent };
      };
      renderMessages(messages);
      const first = inspect();
      renderMessages(JSON.parse(JSON.stringify(messages)));
      return { first, reopened: inspect() };
    });
    assert.deepEqual(sent.first.links, ['https://example.com/a_b?q=1&x=2', 'https://example.org/wiki/(test)']);
    assert.equal(sent.first.icons, 2);
    assert.equal(sent.first.unsafe, 0);
    assert.match(sent.first.text, /<script>alert\(1\)<\/script>/);
    assert.deepEqual(sent.reopened, sent.first, 'reopening history preserves the same link UI');
    if (process.argv.includes('--links-only')) {
      assert.deepEqual(errors, []);
      console.log('PASS: composer URLs, sent user links, history reload, punctuation and HTML escaping.');
      return;
    }

    const opened = await page.evaluate(() => {
      window.__opened = [];
      const original = openBrowserUrlInNewTab;
      openBrowserUrlInNewTab = url => { window.__opened.push(url); return true; };
      document.querySelector('#composerInput a.composer-link').dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      openBrowserUrlInNewTab = original;
      return window.__opened;
    });
    assert.deepEqual(opened, ['https://example.com/docs/page?q=1'], 'clicking the chip opens it in the side panel');

    // Trailing punctuation is not swallowed into the URL.
    await typeText(page, 'read https://example.com/a. thanks');
    assert.equal(await page.evaluate(() => document.querySelector('#composerInput a.composer-link')?.dataset.href), 'https://example.com/a');

    // A trailing slash is part of the URL, not punctuation.
    await typeText(page, 'open https://keylineicons.com/ now');
    assert.equal(await page.evaluate(() => document.querySelector('#composerInput a.composer-link')?.dataset.href), 'https://keylineicons.com/');

    await typeText(page, 'read (https://example.com/a_(b)). thanks');
    assert.equal(await page.locator('#composerInput a.composer-link').getAttribute('data-href'), 'https://example.com/a_(b)');

    // Selecting composer text pops the pill after ~1s and bold wraps the selection.
    const pill = await page.evaluate(async () => {
      setComposerText('hello world');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const textNode = input.firstChild;
      const range = document.createRange();
      range.setStart(textNode, 0);
      range.setEnd(textNode, 5);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise(resolve => setTimeout(resolve, 1300));
      const node = document.querySelector('#composerFormatPill');
      return {
        visible: !!node && !node.classList.contains('hidden'),
        actions: [...(node?.querySelectorAll('[data-format]') || [])].map(button => button.dataset.format)
      };
    });
    assert.equal(pill.visible, true, 'the pill appears after the selection settles');
    assert.deepEqual(pill.actions, ['bold', 'italic']);

    const bold = await page.evaluate(() => {
      document.querySelector('#composerFormatPill [data-format="bold"]').click();
      return {
        text: getComposerText(),
        tag: !!document.querySelector('#composerInput b, #composerInput strong'),
        hidden: document.querySelector('#composerFormatPill').classList.contains('hidden')
      };
    });
    assert.equal(bold.text, '**hello** world');
    assert.equal(bold.tag, true, 'bold must render as real bold in the composer');
    assert.equal(bold.hidden, true, 'the pill hides after applying');

    const italic = await page.evaluate(async () => {
      setComposerText('alpha beta');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      const textNode = input.firstChild;
      const range = document.createRange();
      range.setStart(textNode, 6);
      range.setEnd(textNode, 10);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise(resolve => setTimeout(resolve, 1300));
      document.querySelector('#composerFormatPill [data-format="italic"]').click();
      return { text: getComposerText(), tag: !!document.querySelector('#composerInput i, #composerInput em') };
    });
    assert.equal(italic.text, 'alpha *beta*');
    assert.equal(italic.tag, true, 'italic must render as real italic in the composer');

    await typeText(page, 'https://example.');
    assert.equal(await page.locator('#composerInput a.composer-link').count(), 0, 'typing a dot must not prematurely freeze the URL');
    await page.keyboard.insertText('com/docs');
    assert.equal(await page.locator('#composerInput a.composer-link').count(), 0);
    await page.evaluate(() => input.blur());
    assert.equal(await page.locator('#composerInput a.composer-link').getAttribute('data-href'), 'https://example.com/docs');

    const paste = await page.evaluate(() => {
      setComposerText(''); input.focus(); setComposerCaretByTextOffset(0);
      const data = new DataTransfer(); data.setData('text/plain', 'https://example.com/pasted');
      input.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: data }));
      return { href: input.querySelector('a.composer-link')?.dataset.href, text: getComposerText() };
    });
    assert.deepEqual(paste, { href: 'https://example.com/pasted', text: 'https://example.com/pasted' });

    const formattedDraft = await page.evaluate(() => {
      input.innerHTML = '<b>hello</b> and <i>world</i> https://example.com/draft';
      invalidateComposerTextCache();
      input.focus();
      const range = document.createRange(); range.setStart(input.firstChild.firstChild, 3); range.collapse(true);
      const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range);
      const offset = getComposerCaretTextOffset();
      setComposerCaretByTextOffset(offset);
      const point = { text: getSelection().anchorNode.nodeValue, offset: getSelection().anchorOffset };
      captureComposerDraftForSession(state.currentSession.id);
      setComposerText('');
      restoreComposerDraftForSession(state.currentSession.id);
      return { offset, point, bold: !!input.querySelector('b'), italic: !!input.querySelector('i'), link: input.querySelector('a.composer-link')?.dataset.href, text: getComposerText() };
    });
    assert.equal(formattedDraft.offset, 5, 'caret inside bold counts only the opening marker');
    assert.deepEqual(formattedDraft.point, { text: 'hello', offset: 3 });
    assert.equal(formattedDraft.bold, true);
    assert.equal(formattedDraft.italic, true);
    assert.equal(formattedDraft.link, 'https://example.com/draft');
    assert.equal(formattedDraft.text, '**hello** and *world* https://example.com/draft');

    const pickerFormatting = await page.evaluate(() => {
      input.innerHTML = '<b>bold</b> <i>italic</i> $query'; invalidateComposerTextCache();
      const start = getComposerText().indexOf(' $');
      composerSkillQueryAnchor = start; composerSkillQueryEnd = getComposerText().length;
      toggleComposerSkill({ id: 'test-skill', name: 'Test' });
      const skill = { bold: !!input.querySelector('b'), italic: !!input.querySelector('i'), text: getComposerText() };
      input.append(document.createTextNode(' ￥explorer')); invalidateComposerTextCache();
      composerSubagentQueryAnchor = getComposerText().indexOf(' ￥'); composerSubagentQueryEnd = getComposerText().length;
      toggleComposerSubagent('explorer');
      return { skill, subagent: { bold: !!input.querySelector('b'), italic: !!input.querySelector('i'), text: getComposerText() } };
    });
    assert.deepEqual(pickerFormatting.skill, { bold: true, italic: true, text: '**bold** *italic*' });
    assert.deepEqual(pickerFormatting.subagent, pickerFormatting.skill);

    // Collapsing the selection hides the pill again.
    const cleared = await page.evaluate(async () => {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      document.dispatchEvent(new Event('selectionchange'));
      await new Promise(resolve => setTimeout(resolve, 40));
      return document.querySelector('#composerFormatPill').classList.contains('hidden');
    });
    assert.equal(cleared, true, 'the pill hides once the selection collapses');

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({ ok: true, chip: chip.href, opened, bold: bold.text, italic }));
  } finally {
    await application?.close();
    await removeDirWithRetry(userDataDir);
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

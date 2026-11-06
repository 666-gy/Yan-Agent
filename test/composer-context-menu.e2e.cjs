'use strict';
// 输入框右键菜单：复制 / 粘贴 / 剪切 / 全选，快捷键提示，鼠标定位。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const scratch = path.join(root, '.yanagent');
fs.mkdirSync(scratch, { recursive: true });
const userData = fs.mkdtempSync(path.join(scratch, 'composer-context-'));

(async () => {
  let app;
  const errors = [];
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData }
    });
    const page = await app.firstWindow();
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    // Startup overlay marks the app inert, which also disables hit testing.
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.evaluate(() => document.querySelectorAll('[inert]').forEach(el => { el.inert = false; }));
    await page.waitForTimeout(200);

    const setText = text => page.evaluate(value => {
      const editor = document.querySelector('#composerInput');
      editor.focus();
      editor.replaceChildren(document.createTextNode(value));
      editor.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);

    const selectRange = (start, end) => page.evaluate(([from, to]) => {
      const editor = document.querySelector('#composerInput');
      const range = document.createRange();
      range.setStart(editor.firstChild, from);
      range.setEnd(editor.firstChild, to);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const rect = range.getBoundingClientRect();
      return { x: Math.round(rect.left + Math.min(6, rect.width / 2)), y: Math.round(rect.top + rect.height / 2) };
    }, [start, end]);

    const caretPoint = offset => page.evaluate(value => {
      const editor = document.querySelector('#composerInput');
      const range = document.createRange();
      range.setStart(editor.firstChild, value);
      range.collapse(true);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      const rect = range.getBoundingClientRect();
      return { x: Math.round(rect.left + 2), y: Math.round(rect.top + rect.height / 2) };
    }, offset);

    await setText('hello composer world');
    const point = await selectRange(6, 14);
    await page.mouse.click(point.x, point.y, { button: 'right' });
    await page.waitForTimeout(150);

    const menu = page.locator('.composer-context-menu');
    assert.equal(await menu.isVisible(), true, 'right click opens the composer menu');
    const items = await menu.locator('.sidebar-context-menu-item').allInnerTexts();
    assert.deepEqual(items.map(text => text.replace(/\s+/g, ' ').trim()), ['复制 Ctrl+C', '粘贴 Ctrl+V', '剪切 Ctrl+X', '全选 Ctrl+A']);
    assert.deepEqual(await menu.locator('.sidebar-context-menu-shortcut').allInnerTexts(), ['Ctrl+C', 'Ctrl+V', 'Ctrl+X', 'Ctrl+A']);
    assert.ok((await menu.locator('.sidebar-context-menu-item').last().locator('svg path').getAttribute('d')).startsWith('M12 7L4 7C2.8954'), 'select all uses Keyline input-text-cursor');

    const box = await menu.boundingBox();
    assert.ok(Math.abs(box.x - point.x) <= 2 && Math.abs(box.y - point.y) <= 2, 'menu follows the pointer');
    assert.equal(await menu.evaluate(el => getComputedStyle(el).borderRadius), '12px', 'menu keeps the rounded panel radius');

    await app.evaluate(({ clipboard }) => clipboard.writeText('__cleared__'));
    await menu.getByText('复制', { exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(await menu.count(), 0, 'menu closes after choosing an item');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'composer');

    await app.evaluate(({ clipboard }) => clipboard.writeText('__cleared__'));
    await setText('cut this tail');
    const cutPoint = await selectRange(3, 13);
    await page.mouse.click(cutPoint.x, cutPoint.y, { button: 'right' });
    await page.waitForTimeout(120);
    await page.locator('.composer-context-menu').getByText('剪切', { exact: true }).click();
    await page.waitForTimeout(200);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), ' this tail');
    assert.equal(await page.evaluate(() => document.querySelector('#composerInput').innerText.trim()), 'cut');

    await app.evaluate(({ clipboard }) => clipboard.writeText('PASTED'));
    await setText('ab');
    const pastePoint = await caretPoint(1);
    await page.mouse.click(pastePoint.x, pastePoint.y, { button: 'right' });
    await page.waitForTimeout(120);
    await page.locator('.composer-context-menu').getByText('粘贴', { exact: true }).click();
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => document.querySelector('#composerInput').innerText.replace(/\n/g, '')), 'aPASTEDb');

    await setText('no selection here');
    const emptyPoint = await caretPoint(3);
    await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: 'right' });
    await page.waitForTimeout(120);
    const states = await page.evaluate(() => Array.from(document.querySelectorAll('.composer-context-menu .sidebar-context-menu-item'))
      .map(button => ({ label: button.innerText.replace(/\s+/g, ' ').trim(), disabled: button.disabled })));
    assert.deepEqual(states, [
      { label: '复制 Ctrl+C', disabled: true },
      { label: '粘贴 Ctrl+V', disabled: false },
      { label: '剪切 Ctrl+X', disabled: true },
      { label: '全选 Ctrl+A', disabled: false }
    ]);

    await page.mouse.click(5, 5);
    await page.waitForTimeout(120);
    assert.equal(await page.locator('.composer-context-menu').count(), 0, 'clicking outside closes the menu');

    await page.mouse.click(emptyPoint.x, emptyPoint.y, { button: 'right' });
    await page.locator('.composer-context-menu').getByText('全选', { exact: true }).click();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), 'no selection here', 'select all selects the entire composer');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'composerInput', 'select all returns focus to the composer');
    assert.equal(await page.locator('.composer-context-menu').count(), 0, 'select all closes the menu');
    await page.keyboard.press('Control+c');
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'no selection here', 'selected content can be copied');

    await setText('');
    await page.locator('#composerInput').click({ button: 'right' });
    await page.locator('.composer-context-menu').getByText('全选', { exact: true }).click();
    assert.equal(await page.evaluate(() => window.getSelection().toString()), '', 'select all handles an empty composer');

    // 选中文字后的浮动胶囊同样提供复制/剪切（加粗/斜体保持原样）。
    await setText('pill copy cut');
    await selectRange(5, 9);
    await page.waitForTimeout(1200);
    const pill = page.locator('#composerFormatPill');
    assert.equal(await pill.isVisible(), true, 'selection pill appears');
    assert.deepEqual(
      await pill.locator('.composer-format-action').evaluateAll(nodes => nodes.map(node => node.getAttribute('aria-label'))),
      ['加粗', '斜体', '复制', '剪切']
    );

    await app.evaluate(({ clipboard }) => clipboard.writeText('__cleared__'));
    await pill.locator('[data-edit="copy"]').click();
    await page.waitForTimeout(200);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'copy');
    assert.equal(await pill.isVisible(), false, 'pill hides after copying');

    await setText('pill cut tail');
    await selectRange(5, 13);
    await page.waitForTimeout(1200);
    await page.locator('#composerFormatPill [data-edit="cut"]').click();
    await page.waitForTimeout(250);
    assert.equal(await app.evaluate(({ clipboard }) => clipboard.readText()), 'cut tail');
    assert.equal(await page.evaluate(() => document.querySelector('#composerInput').innerText.trim()), 'pill');

    assert.deepEqual(errors, [], 'no renderer errors');
    console.log('composer context menu: ok');
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exit(1);
});

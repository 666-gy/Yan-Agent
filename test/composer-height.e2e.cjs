'use strict';

// Composer height acceptance: bounded auto-grow, drag handle with persistence,
// keyboard adjustment, and double-click reset — verified in the real window.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-composer-height-'));

function lines(count, prefix = 'composer growth line') {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`).join('\n');
}

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
      typeof autoGrow === 'function'
      && typeof setComposerText === 'function'
      && typeof syncComposerAfterInput === 'function'
      && typeof state !== 'undefined'
      && !!document.querySelector('#composerResizeHandle')
    ));

    const result = await page.evaluate(async () => {
      const composer = document.querySelector('#composer');
      const input = document.querySelector('#composerInput');
      const handle = document.querySelector('#composerResizeHandle');
      const height = () => composer.getBoundingClientRect().height;
      const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
      const settle = async () => { await sleep(220); };
      const lines = (count, prefix = 'composer growth line') => Array.from(
        { length: count },
        (_, index) => `${prefix} ${index + 1}`
      ).join('\n');

      const initial = height();

      // A few lines grow the composer; the growth stays modest.
      setComposerText(lines(4));
      syncComposerAfterInput();
      await settle();
      const fewLines = height();

      // A pasted-sized text grows further but is capped...
      setComposerText(lines(200));
      syncComposerAfterInput();
      await settle();
      const huge = height();
      const hugeScrolls = input.scrollHeight > input.clientHeight + 4;
      const ceiling = composerHeightCeiling();
      const minHeight = composerMinHeight();

      // ...and shrinking the text returns towards the floor (sticky drag off).
      setComposerText('short');
      syncComposerAfterInput();
      await settle();
      const shrunk = height();

      // Drag the grip up by 120px: manual height pins the composer.
      const startHeight = height();
      const dispatch = (type, clientY, pointerId = 77) => handle.dispatchEvent(new PointerEvent(type, {
        bubbles: true, cancelable: true, pointerId, clientY, clientX: 400, button: 0, buttons: type === 'pointerup' ? 0 : 1
      }));
      dispatch('pointerdown', 600);
      dispatch('pointermove', 480);
      dispatch('pointerup', 480);
      await settle();
      const dragged = height();
      const manualAfterDrag = composerManualHeight;
      const storedAfterDrag = window.localStorage.getItem('yan.composer.height');

      // Double-click resets to auto-grow and clears the stored height.
      handle.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
      await settle();
      const afterReset = height();
      const storedAfterReset = window.localStorage.getItem('yan.composer.height');

      // Keyboard: ArrowUp pins 8px above the previous applied height.
      const beforeKey = height();
      handle.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
      await settle();
      const afterKey = height();

      return {
        initial,
        fewLines,
        huge,
        shrunk,
        ceiling,
        minHeight,
        hugeScrolls,
        startHeight,
        dragged,
        manualAfterDrag,
        storedAfterDrag,
        afterReset,
        storedAfterReset,
        beforeKey,
        afterKey
      };
    });

    assert.ok(Math.abs(result.initial - result.minHeight) < 2, `initial height ${result.initial} vs floor ${result.minHeight}`);
    assert.ok(result.fewLines > result.initial + 10, `four lines should grow the composer (${result.initial} -> ${result.fewLines})`);
    assert.ok(result.huge <= result.ceiling, `huge text must respect the ceiling (${result.huge} > ${result.ceiling})`);
    assert.ok(result.huge > result.fewLines, 'huge text should still grow past a few lines');
    assert.equal(result.hugeScrolls, true, 'overflow must scroll inside the input instead of growing forever');
    assert.ok(result.shrunk < result.huge - 40, `shrinking text should collapse the composer (${result.huge} -> ${result.shrunk})`);
    assert.ok(result.dragged > result.shrunk + 80, `drag should add ~120px (${result.shrunk} -> ${result.dragged})`);
    assert.equal(result.storedAfterDrag, String(Math.round(result.dragged)), 'drag height must persist');
    assert.equal(result.storedAfterReset, null, 'double-click must clear the pinned height');
    assert.ok(Math.abs(result.afterReset - result.minHeight) < 3, `reset returns to auto floor (${result.afterReset})`);
    assert.ok(result.afterKey > result.beforeKey + 4, `ArrowUp must raise the composer (${result.beforeKey} -> ${result.afterKey})`);

    // Visual evidence: composer grown by a multi-line draft.
    await page.evaluate(() => {
      setComposerText(['第一行草稿，用来展示输入框自动升高后的多行排版。', '第二行继续输入，高度会随内容受控增长。', '第三行：超过上限后输入框内部滚动，不会吞掉整个对话区。'].join('\n'));
      syncComposerAfterInput();
    });
    await page.waitForTimeout(300);
    const shotDir = path.join(appRoot, 'output', 'composer-height');
    fs.mkdirSync(shotDir, { recursive: true });
    await page.screenshot({ path: path.join(shotDir, 'composer-autogrow.png') });

    assert.equal(errors.length, 0, errors.join('; '));
    console.log(JSON.stringify({
      ok: true,
      initial: Math.round(result.initial),
      fewLines: Math.round(result.fewLines),
      huge: Math.round(result.huge),
      ceiling: Math.round(result.ceiling),
      dragged: Math.round(result.dragged),
      afterReset: Math.round(result.afterReset)
    }));
  } finally {
    await application?.close();
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

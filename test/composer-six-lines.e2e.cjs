'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-six-lines-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && !!state.currentSession);
    const measureInput = () => page.locator('#composerInput').evaluate(el => {
      const s = getComputedStyle(el);
      return { lines: (el.clientHeight - parseFloat(s.paddingTop) - parseFloat(s.paddingBottom)) / parseFloat(s.lineHeight),
        scrolls: el.scrollHeight > el.clientHeight + 2 };
    });
    await page.evaluate(() => {
      setComposerText(Array.from({ length: 30 }, (_, i) => `Line ${i + 1}`).join('\n'));
      syncComposerAfterInput();
    });
    await page.waitForTimeout(300);
    const automatic = await measureInput();
    assert.ok(Math.abs(automatic.lines - 6) < .1, JSON.stringify(automatic));
    assert.equal(automatic.scrolls, true);
    await page.evaluate(() => setComposerManualHeight(1000));
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await measureInput()).lines - 6) < .1);
    await page.locator('#composerResizeHandle').focus();
    await page.keyboard.press('End');
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await measureInput()).lines - 6) < .1);
    await page.evaluate(() => {
      document.querySelector('#composerInput').style.fontSize = '20px';
      autoGrow();
    });
    await page.waitForTimeout(250);
    assert.ok(Math.abs((await measureInput()).lines - 6) < .1, 'six lines must follow the current font');
    await page.evaluate(() => {
      document.querySelector('#composerInput').style.removeProperty('font-size');
      resetComposerManualHeight();
      setComposerText('short'); syncComposerAfterInput();
    });
    await page.waitForTimeout(250);
    assert.ok((await measureInput()).lines < 3, 'short draft must shrink again');

    for (const theme of ['dark', 'light']) {
      await page.evaluate(async theme => {
        state.config = await yan.setConfig({ theme, wallpaper: { id: 'night-sky', path: '', custom: [], removed: [] } });
        applyTheme(theme); applyWallpaperConfig(state.config); await applyWallpaperCompat(state.config);
      }, theme);
      const material = await page.evaluate(() => {
        const style = id => getComputedStyle(document.getElementById(id));
        return { parent: document.querySelector('#newTaskWorkspace').parentElement.id,
          row: style('newTaskWorkspace').backgroundColor, input: style('composer').backgroundColor,
          blur: style('newTaskWorkspace').backdropFilter,
          innerBlur: style('composer').backdropFilter };
      });
      assert.notEqual(material.parent, 'composer');
      assert.equal(material.row, material.input);
      assert.notEqual(material.row, 'rgba(0, 0, 0, 0)');
      assert.ok(material.blur.includes('blur('));
      assert.equal(material.innerBlur, material.blur);
    }
    const original = Array.from({ length: 16 }, (_, i) => `Message line ${i + 1}`).join('\n');
    await page.evaluate(original => {
      state.currentSession.messages = [{ role: 'user', content: original, ts: Date.now() }];
      setEmptyState(false); renderMessages(state.currentSession.messages); updateTaskBar();
    }, original);
    const toggle = page.locator('#messages .user-message-toggle');
    await toggle.waitFor({ state: 'visible' });
    const content = page.locator('#messages .user-message-content');
    const visibleLines = () => content.evaluate(el => el.clientHeight / parseFloat(getComputedStyle(el).lineHeight));
    assert.ok(Math.abs(await visibleLines() - 6) < .1);
    assert.equal(await content.textContent(), original, 'folding must preserve all text');
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.ok(await visibleLines() > 15);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
    assert.ok(Math.abs(await visibleLines() - 6) < .1);
    await page.evaluate(() => handleMessageAction('copy', document.querySelector('#messages .msg.user')));
    assert.equal((await app.evaluate(({ clipboard }) => clipboard.readText())).replace(/\r\n/g, '\n'), original);
    await page.evaluate(() => {
      state.currentSession.messages = [{ role: 'user', content: 'Six lines can be soft wrapped too. '.repeat(150) }];
      renderMessages(state.currentSession.messages);
    });
    await toggle.waitFor({ state: 'visible' });
    assert.ok(Math.abs(await visibleLines() - 6) < .1, 'soft wraps must also be capped');
    await page.evaluate(() => {
      state.currentSession.messages = [{ role: 'user', content: 'Short message' }];
      renderMessages(state.currentSession.messages);
    });
    await page.waitForTimeout(100);
    assert.equal(await toggle.isVisible(), false);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, automatic, manual: true, fontAware: true, fullCopy: true, sharedMaterial: true }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 }); }
    catch (error) { console.warn(`cleanup skipped: ${error.message}`); }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

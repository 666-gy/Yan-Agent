'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');

(async () => {
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-welcome-meadow-'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof newSession === 'function' && typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.evaluate(async () => {
      window.YanStartupHello?.skip();
      await newSession({ forceNew: true });
    });
    const butterfly = page.locator('#welcomeMeadow #butterfly');
    await butterfly.waitFor({ state: 'visible' });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForTimeout(100);
    const position = () => butterfly.getAttribute('transform');
    const frozen = await position();
    await page.waitForTimeout(150);
    assert.equal(await position(), frozen, 'reduced motion stops animation');
    await butterfly.click();
    await page.waitForTimeout(150);
    assert.equal(await position(), frozen, 'click respects reduced motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    // Fresh page puts the butterfly on its first flower, without changing its animation internals.
    await page.reload();
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await butterfly.waitFor({ state: 'visible' });
    const waitForRest = async () => {
      await page.waitForFunction(() => document.getElementById('welcomeMeadow').shadowRoot
        .getElementById('butterfly').getAttribute('aria-disabled') === 'false', null, { timeout: 16000 });
      const resting = await position();
      const mutations = await page.evaluate(() => new Promise(resolve => {
        const svg = document.getElementById('welcomeMeadow').shadowRoot.getElementById('meadow');
        let changes = 0;
        const observer = new MutationObserver(records => { changes += records.length; });
        observer.observe(svg, { attributes: true, subtree: true });
        setTimeout(() => { observer.disconnect(); resolve(changes); }, 1000);
      }));
      assert.equal(mutations, 0, 'resting scene performs no per-frame SVG writes');
      assert.equal(await position(), resting, 'butterfly stays at its destination while idle');
    };
    // The intro includes an initial rest, so wait until it has actually taken off.
    await page.waitForFunction(() => document.getElementById('welcomeMeadow').shadowRoot
      .getElementById('butterfly').getAttribute('aria-disabled') === 'true', null, { timeout: 7000 });
    await waitForRest();
    const layers = await page.locator('#welcomeMeadow').evaluate(el => el.shadowRoot
      .querySelectorAll('#backGrass > g, #frontGrass > g').length);
    assert.equal(layers, 8, 'grass uses eight animated layers');
    await butterfly.click();
    assert.equal(await butterfly.getAttribute('aria-disabled'), 'true', 'mouse click takes off');
    assert.equal(await butterfly.evaluate(el => getComputedStyle(el).outlineStyle), 'none', 'mouse focus has no box');
    const flying = await position();
    await page.waitForTimeout(300);
    assert.notEqual(await position(), flying, 'clicked butterfly flies');
    await page.evaluate(() => setEmptyState(false));
    await page.waitForTimeout(150);
    const hidden = await position();
    await page.waitForTimeout(250);
    assert.equal(await position(), hidden, 'hidden welcome stops rendering');
    await page.evaluate(() => setEmptyState(true));
    await page.waitForTimeout(300);
    assert.notEqual(await position(), hidden, 'returning to welcome resumes');
    await waitForRest();
    await butterfly.focus();
    await page.keyboard.press('Enter');
    assert.equal(await butterfly.getAttribute('aria-disabled'), 'true', 'keyboard starts the next flight');
    await waitForRest();
    fs.mkdirSync(path.join(root, '.yanagent/evidence'), { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(value => document.documentElement.dataset.theme = value, theme);
      await page.screenshot({ path: path.join(root, `.yanagent/evidence/welcome-meadow-${theme}.png`) });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: welcome meadow, idle stops SVG writes, grouped grass, mouse/keyboard flight, reduced motion, hidden pause/resume, both themes');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

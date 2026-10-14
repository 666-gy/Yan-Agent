'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-appearance-'));
const output = path.join(root, 'output/playwright/appearance');
const launch = () => _electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
(async () => {
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-logo').click();
    await page.waitForFunction(() => document.querySelector('#appearanceUiFont').options.length > 10);
    const fontCount = await page.locator('#appearanceUiFont option').count();
    const choose = async (id, value, label, key) => {
      await page.locator(`${id}-trigger`).click();
      if (id.endsWith('Font')) await page.getByRole('combobox', { name: '搜索字体' }).fill(label);
      await page.getByRole('option', { name: label, exact: true }).click();
      await page.waitForFunction(([key, value]) => state.config.appearance[key] === value, [key, value]);
    };
    await choose('#appearanceUiFont', 'local:Arial', 'Arial', 'uiFont');
    await choose('#appearanceContentFont', 'local:Georgia', 'Georgia', 'contentFont');
    await choose('#appearanceCodeFont', 'local:Consolas', 'Consolas', 'codeFont');
    await page.locator('#appearanceCodeScale').fill('17');
    await page.locator('#appearanceCodeScale').dispatchEvent('change');
    await page.waitForFunction(() => state.config.appearance.codeScale === 17);
    await page.locator('#appearanceUiScale').fill('18');
    await page.locator('#appearanceUiScale').dispatchEvent('change');
    await page.waitForFunction(() => state.config.appearance.uiScale === 18);
    const actual = await page.evaluate(() => {
      const style = selector => { const s = getComputedStyle(document.querySelector(selector)); return { family: s.fontFamily, size: s.fontSize, weight: s.fontWeight }; };
      const probe = document.createElement('div');
      probe.className = 'agent-markdown';
      probe.id = 'appearance-content-probe';
      document.body.append(probe);
      return { ui: style('#settings-tab-logo'), content: style('#appearance-content-probe'), code: style('.appearance-type-preview code') };
    });
    assert.match(actual.ui.family, /Arial/);
    assert.match(actual.content.family, /Georgia/);
    assert.match(actual.code.family, /Consolas/);
    assert.equal(actual.code.size, '17px');
    assert.equal(actual.code.weight, '400');
    assert.equal(actual.ui.size, '18px');
    await page.locator('#appearanceAccentPreset-trigger').click();
    await page.getByRole('option', { name: '绿色', exact: true }).click();
    await page.waitForFunction(() => state.config.appearance.accent === '#16865d');
    assert.equal(await page.locator('#appearanceAccentButton').innerText(), 'RGB 22, 134, 93');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#tab-logo')).getPropertyValue('--accent').trim()), '#16865d');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.waitForFunction(() => document.documentElement.dataset.reduceMotion === 'false');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.waitForFunction(() => document.documentElement.dataset.reduceMotion === 'false');
    assert.equal(await page.evaluate(() => document.documentElement.dataset.reduceMotion), 'false');
    await choose('#appearanceContentFont', 'same-ui', '与界面字体相同', 'contentFont');
    assert.match(await page.locator('#appearance-content-probe').evaluate(el => getComputedStyle(el).fontFamily), /Arial/);
    await page.locator('#appearance-content-probe').evaluate(el => el.remove());
    await choose('#appearanceUiFont', 'local:Source Serif 4', 'Source Serif 4', 'uiFont');
    const loaded = await page.evaluate(async () => (await document.fonts.load('600 18px "Source Serif 4"', 'Preview')).length);
    assert.ok(loaded > 0, 'Bundled fonts must actually load offline');
    await choose('#appearanceUiFont', 'system', '系统默认', 'uiFont');
    await choose('#appearanceContentFont', 'system', '系统默认', 'contentFont');
    await page.locator('#appearanceUiScale').fill('14');
    await page.locator('#appearanceUiScale').dispatchEvent('change');
    await page.waitForFunction(() => state.config.appearance.uiScale === 14);
    fs.mkdirSync(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.locator(`[data-theme-choice="${theme}"]`).click();
      await page.waitForFunction(theme => document.documentElement.dataset.theme === theme, theme);
      await page.setViewportSize({ width: 1440, height: 1100 });
      await page.screenshot({ path: path.join(output, `appearance-${theme}.png`) });
    }
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await page.locator('.sheet-content').evaluate(el => ({ ok: el.scrollWidth <= el.clientWidth + 1, width: el.clientWidth, scroll: el.scrollWidth, offenders: [...el.querySelectorAll('*')].filter(x => x.getBoundingClientRect().right > el.getBoundingClientRect().right).slice(0,6).map(x => [x.className, x.tagName, x.getBoundingClientRect().width]) }));
      assert.equal(overflow.ok, true, `no overflow at ${width}: ${JSON.stringify(overflow)}`);
    }
    assert.deepEqual(errors, []);
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    const persisted = await page.evaluate(() => state.config.appearance);
    assert.equal(persisted.codeFont, 'local:Consolas');
    assert.equal(persisted.codeScale, 17);
    assert.equal(persisted.accent, '#16865d');
    assert.equal(persisted.reduceMotion, 'off');
    console.log(JSON.stringify({ ok: true, fontFamilies: fontCount, persisted: true, responsive: true, actual }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true }); } catch {}
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

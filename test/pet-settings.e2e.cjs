'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-domml-'));
const output = path.join(root, 'output/playwright/pet-settings');
const launch = () => _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
  env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
(async () => {
  let app;
  try {
    app = await launch();
    let page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.setViewportSize({ width: 1440, height: 1120 });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-pet').click();
    assert.equal(await page.locator('#tab-general #generalPetToggle').count(), 0);
    assert.equal(await page.locator('#petSettingsGrid button').count(), 3);
    assert.equal(await page.locator('[data-pet-delete]').count(), 0);
    assert.equal(await page.evaluate(async () => (await api.setConfig({ pet: { selected: 'yuexinmiao' } })).pet.selected), 'orb');
    assert.equal(await page.locator('#petVisibilityToggle').innerText(), '显示Domml');
    assert.equal(await page.locator('#petSettingsPreview').getAttribute('data-pet'), 'orb');
    for (const id of ['orb', 'deepseek', 'claude']) {
      await page.locator(`#petSettingsGrid [data-pet-select="${id}"]`).click();
      await page.waitForFunction(id => state.config.pet.selected === id && !petSettingsBusy, id);
      assert.equal(await page.locator(`#petSettingsGrid [data-pet-select="${id}"]`).getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('#petSettingsPreview').getAttribute('data-pet'), id);
    }
    const petWindowReady = app.waitForEvent('window');
    await page.locator('#petVisibilityToggle').click();
    const pet = await petWindowReady;
    pet.on('pageerror', error => errors.push(error.message));
    await pet.waitForLoadState();
    await page.waitForFunction(() => document.querySelector('#petVisibilityToggle').textContent === '隐藏Domml');
    const mainId = await (await app.browserWindow(page)).evaluate(win => win.id);
    const focusResults = [];
    for (const id of ['orb', 'deepseek', 'claude']) {
      await page.locator(`#petSettingsGrid [data-pet-select="${id}"]`).click();
      await pet.waitForFunction(id => document.body.dataset.pet === id, id);
      // Empty task state must not prevent focusing the app.
      await pet.evaluate(() => applyState({ status: 'idle', sessionId: null }));
      for (const mode of ['hidden', 'minimized']) {
        await app.evaluate(({ BrowserWindow }, { mainId, mode }) => {
          const main = BrowserWindow.fromId(mainId);
          mode === 'hidden' ? main.hide() : main.minimize();
        }, { mainId, mode });
        await pet.locator(id === 'orb' ? '#petToggle' : '#entertainmentPet').click();
        await page.waitForFunction(() => document.hasFocus());
        const focused = await app.evaluate(({ BrowserWindow }, mainId) => {
          const main = BrowserWindow.fromId(mainId);
          return main.isVisible() && main.isFocused() && !main.isMinimized();
        }, mainId);
        assert.equal(focused, true, `${id} ${mode}`);
        focusResults.push(`${id}:${mode}`);
      }
    }
    await page.locator('#petVisibilityToggle').click();
    await page.waitForFunction(() => document.querySelector('#petVisibilityToggle').textContent === '显示Domml');
    assert.equal(await page.evaluate(() => api.getPetVisible()), false);
    fs.mkdirSync(output, { recursive: true });
    await page.locator('#petSettingsGrid [data-pet-select="deepseek"]').click();
    await page.waitForFunction(() => state.config.pet.selected === 'deepseek' && !petSettingsBusy);
    await page.locator('.settings-page-layer .sheet-content').evaluate(el => { el.scrollTop = 0; });
    await page.mouse.move(10, 10);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(async theme => { state.config = await api.setConfig({ theme }); applyTheme(theme); }, theme);
      await page.screenshot({ path: path.join(output, `${theme}.png`), animations: 'disabled' });
    }
    for (const width of [880, 768, 414, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      const overflow = await page.locator('#tab-pet').evaluate(el => el.scrollWidth > el.clientWidth + 1);
      assert.equal(overflow, false, `pet content overflow at ${width}`);
    }
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-pet').click();
    assert.equal(await page.locator('#petSettingsPreview').getAttribute('data-pet'), 'deepseek');
    assert.equal(await page.locator('#petVisibilityToggle').innerText(), '显示Domml');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, focusResults, selectionPersistence: true, responsive: true }));
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

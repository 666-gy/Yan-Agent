'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-detail-'));
const dataDir = path.join(userData, 'YanData');
const store = createPluginStore(dataDir); createPluginCatalog(store).install('remotion'); store.update('remotion', { enabled: true });
const evidence = path.join(appRoot, 'output/playwright/plugin-detail'); fs.mkdirSync(evidence, { recursive: true });
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(), errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanPluginsPage);
    await app.evaluate(({ shell }) => { global.__detailOpened = []; shell.openPath = async value => { global.__detailOpened.push({ path: value }); return ''; }; shell.openExternal = async url => { global.__detailOpened.push({ url }); }; });
    await page.setViewportSize({ width: 1920, height: 1250 });
    await page.locator('[data-nav="plugins"]').click(); await page.locator('[data-plugin-open="remotion"]').click();
    const idle = () => page.waitForFunction(() => document.getElementById('pagePluginPackages').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('.plugin-requirements').count(), 0);
    const close = page.locator('#pluginDetailContent [data-plugin-action="back"]');
    assert.equal(await close.getAttribute('aria-label'), '关闭插件详情');
    assert.equal(await close.evaluate(el => el.className === document.getElementById('skillImportCloseBtn').className && el.innerHTML === document.getElementById('skillImportCloseBtn').innerHTML), true);
    assert.equal(await close.evaluate(el => el.getBoundingClientRect().left > document.getElementById('pluginDetailTitle').getBoundingClientRect().right), true);
    await page.evaluate(() => {
      window.__detailSwitches = [...document.querySelectorAll('#pluginDetailContent input[role="switch"]')];
      window.__detailDisabledMutations = [];
      window.__detailSwitchObserver = new MutationObserver(records => window.__detailDisabledMutations.push(...records.filter(record => window.__detailSwitches.includes(record.target))));
      window.__detailSwitchObserver.observe(document.getElementById('pluginDetailContent'), { subtree: true, attributes: true, attributeFilter: ['disabled'] });
    });
    const stableSwitches = async () => {
      await page.evaluate(() => window.YanPluginsPage.show());
      assert.equal(await page.evaluate(() => window.__detailSwitches.every((node, index) => node === document.querySelectorAll('#pluginDetailContent input[role="switch"]')[index])), true, 'switch elements must survive actions and catalog notifications');
      assert.equal(await page.evaluate(() => window.__detailDisabledMutations.length), 0, 'unrelated switches must not be disabled');
    };
    assert.equal(await page.locator('.plugin-skill-row').count(), 5);
    assert.match(await page.locator('#pluginSkillsTitle').textContent(), /12/);
    assert.match(await page.locator('[data-plugin-action="expand"]').textContent(), /7/);
    assert.equal(await page.locator('[data-plugin-action="toggle"]').isChecked(), true);
    assert.equal(await page.locator('.plugin-detail-logo').evaluate(el => el.getBoundingClientRect().bottom < document.getElementById('pluginDetailTitle').getBoundingClientRect().top), true);
    const bounds = await page.locator('#pluginDetailView').boundingBox(), parent = await page.locator('#pagePluginPackages').boundingBox();
    assert.ok(bounds.width <= 880 && bounds.width < parent.width * 0.75);
    assert.ok(Math.abs(bounds.x + bounds.width / 2 - parent.x - parent.width / 2) < 10);
    assert.equal(await page.locator('[data-plugin-action="directory"] img').getAttribute('src'), 'assets/windows-explorer.png');
    await page.locator('[data-plugin-action="directory"]').click(); await idle();
    assert.equal((await app.evaluate(() => global.__detailOpened))[0].path, store.packageRoot(store.get('remotion')));
    for (const kind of ['website', 'privacy', 'terms']) { await page.locator(`[data-link-kind="${kind}"]`).click(); await idle(); assert.equal(await page.locator(`[data-link-kind="${kind}"]`).evaluate(el => document.activeElement === el), true); }
    assert.deepEqual((await app.evaluate(() => global.__detailOpened)).slice(1).map(item => item.url), ['https://remotion.dev/', 'https://www.remotion.dev/privacy', 'https://www.remotion.dev/terms']);
    await stableSwitches();
    const caption = page.locator('[data-skill-id="remotion-captions"]');
    await caption.click(); await idle(); assert.equal(await caption.isChecked(), false);
    assert.deepEqual(store.get('remotion').disabledSkills, ['remotion-captions']);
    assert.equal(await caption.evaluate(el => document.activeElement === el), true);
    await stableSwitches();
    // Hold one saved response while another switch completes; neither should repaint.
    await app.evaluate(({ ipcMain }) => {
      global.__detailOriginalUpdate = ipcMain._invokeHandlers.get('plugins:update');
      ipcMain.removeHandler('plugins:update');
      ipcMain.handle('plugins:update', async (event, payload) => {
        const response = await global.__detailOriginalUpdate(event, payload);
        if (payload.skill?.id === 'remotion-create') await new Promise(resolve => { global.__releaseDetailUpdate = resolve; });
        return response;
      });
    });
    const create = page.locator('[data-skill-id="remotion-create"]');
    await create.click();
    await page.waitForFunction(() => document.querySelector('[data-skill-id="remotion-create"]').getAttribute('aria-busy') === 'true');
    await create.evaluate(node => node.click());
    assert.equal(await create.isChecked(), false, 'repeat click while saving must not flip the pending value');
    await page.locator('[data-plugin-action="toggle"]').click();
    await page.waitForFunction(() => document.querySelector('[data-plugin-action="toggle"]').getAttribute('aria-busy') === 'false');
    assert.equal(await page.locator('[data-plugin-action="toggle"]').isChecked(), false);
    await app.evaluate(() => global.__releaseDetailUpdate()); await idle(); await stableSwitches();
    assert.equal(await create.isChecked(), false); assert.equal(await page.locator('[data-plugin-action="toggle"]').isChecked(), false);
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('plugins:update'); ipcMain.handle('plugins:update', global.__detailOriginalUpdate); });
    await create.click(); await idle();
    await page.locator('[data-plugin-action="toggle"]').click(); await idle(); await stableSwitches();
    await page.evaluate(() => window.__detailSwitchObserver.disconnect());
    await page.locator('[data-plugin-action="expand"]').click();
    assert.equal(await page.locator('.plugin-skill-row').count(), 12);
    assert.equal(await page.locator('[data-plugin-action="expand"]').getAttribute('aria-expanded'), 'true');
    await page.locator('[data-skill-id="remotion-render"]').click(); await idle();
    assert.equal(await page.locator('.plugin-skill-row').count(), 12);
    assert.ok(store.get('remotion').disabledSkills.includes('remotion-render'));
    await page.locator('[data-plugin-action="expand"]').click(); assert.equal(await page.locator('.plugin-skill-row').count(), 5);
    await page.locator('[data-plugin-action="toggle"]').click(); await idle();
    assert.equal(store.get('remotion').enabled, false);
    await page.locator('[data-plugin-action="toggle"]').click(); await idle();
    assert.equal(store.get('remotion').enabled, true); assert.equal(await caption.isChecked(), false);
    await page.reload(); await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanPluginsPage);
    await page.locator('[data-nav="plugins"]').click(); await page.locator('[data-plugin-open="remotion"]').click();
    assert.equal(await caption.isChecked(), false); assert.equal(await page.locator('.plugin-skill-row').count(), 5);
    // A failed update rolls the checkbox back to persisted state.
    await app.evaluate(({ ipcMain }) => { global.__detailOriginalUpdate = ipcMain._invokeHandlers.get('plugins:update'); if (!global.__detailOriginalUpdate) throw new Error('Missing update handler'); ipcMain.removeHandler('plugins:update'); ipcMain.handle('plugins:update', () => ({ ok: false, error: '测试写入失败' })); });
    await caption.click(); await idle(); assert.equal(await caption.isChecked(), false);
    assert.match(await page.locator('#toast').textContent(), /测试写入失败/);
    assert.equal(await page.locator('#toast').evaluate(el => el.matches(':popover-open') && el.classList.contains('toast-error')), true);
    assert.equal(await page.locator('#pluginStatus').count(), 0);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('plugins:update');
      ipcMain.handle('plugins:update', global.__detailOriginalUpdate);
    });
    await caption.click(); await idle(); assert.equal(await caption.isChecked(), true);
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.locator('[data-plugin-action="back"]').click(); await page.locator('[data-plugin-open="remotion"]').click();
      await page.screenshot({ path: path.join(evidence, `remotion-${theme}.png`), animations: 'disabled' });
      await page.locator('#pluginInfoTitle').scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(evidence, `remotion-info-${theme}.png`), animations: 'disabled' });
    }
    // Check the desktop pane at narrow widths with its existing sidebar hidden.
    await page.locator('#sidebarToggle').click();
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      await page.locator('[data-plugin-action="back"]').click(); await page.locator('[data-plugin-open="remotion"]').click();
      assert.equal(await page.locator('#pluginDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false, `detail overflow at ${width}`);
      assert.equal(await page.locator('#pagePluginPackages').evaluate(el => el.scrollWidth > el.clientWidth), false, `page overflow at ${width}`);
      await page.screenshot({ path: path.join(evidence, `remotion-${width}.png`), animations: 'disabled' });
    }
    assert.deepEqual(errors, []);
    console.log('PASS: shared X close button, no preparation section, stable switch DOM, centered detail, Explorer/info actions, skill folding, persisted switches, rollback, focus, themes and narrow widths.');
  } finally {
    const child = app?.process(), stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await app?.close().catch(() => {}); await stopped;
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir())); await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

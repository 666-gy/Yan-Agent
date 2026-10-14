'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-ui-'));
require('./helpers/install-developer-plugins.cjs').seedDeveloperCache(require('../lib/plugins/store').createPluginStore(path.join(userData, 'YanData')));
const evidence = path.join(appRoot, 'output/playwright'); fs.mkdirSync(evidence, { recursive: true });
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanPluginsPage);
    await page.locator('[data-nav="plugins"]').click();
    // Extracting shared templates must preserve the original Skill cards/details.
    await page.locator('#pluginsSkillsTab').click();
    await page.locator('#skillMarketGrid .skill-card').first().waitFor();
    await page.locator('#skillMarketGrid .skill-card').first().click();
    await page.locator('#skillDetailTitle').waitFor();
    await page.locator('#skillDetailContent [data-detail-action="back"]').click();
    await page.locator('#pluginsPackagesTab').click();
    await page.locator('[data-plugin-open="remotion"]').waitFor();
    assert.ok((await page.locator('#pagePluginPackages').textContent()).includes('连接插件，让 Yan Agent 在你的各类工具中协同工作'));
    assert.equal(await page.locator('#pluginMarketGrid .skill-card').count(), 9);
    assert.equal(await page.locator('[data-plugin-open="sentry"], [data-plugin-open="superpowers"], [data-plugin-open="product-design"], [data-plugin-open="higgsfield"]').count(), 0);
    assert.equal(await page.locator('[aria-labelledby="plugin-group-developer-tools"] .skill-card').count(), 5);
    await page.waitForFunction(() => [...document.querySelectorAll('#pluginMarketGrid img')].every(img => img.complete && img.naturalWidth > 0));
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      const icon = page.locator('[data-plugin-open="circleci"] img:visible');
      assert.equal(await icon.count(), 1);
      assert.match(await icon.getAttribute('src'), theme === 'dark' ? /circleci-dark\.png$/ : /circleci\.png$/);
    }
    await page.screenshot({ path: path.join(evidence, 'plugins-developer-tools.png'), animations: 'disabled' });
    for (const [id, count] of [['game-studio', 9], ['circleci', 4], ['build-ios-apps', 9], ['build-macos-apps', 11]]) {
      await page.locator(`[data-plugin-open="${id}"]`).click();
      assert.equal(await page.locator('#pluginDetailContent .plugin-skill-row').count(), Math.min(5, count));
      assert.match(await page.locator('#pluginDetailContent .plugin-info-section').textContent(), /开发者工具/);
      assert.equal(await page.locator('#pluginDetailContent .plugin-requirements').count(), 0);
      await page.locator('#pluginDetailContent [data-plugin-action="back"]').click();
    }
    await page.setViewportSize({ width: 760, height: 760 });
    await page.locator('[data-plugin-open="build-ios-apps"]').click();
    await page.screenshot({ path: path.join(evidence, 'plugins-ios-detail-narrow.png'), animations: 'disabled' });
    assert.equal(await page.locator('#pluginDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.locator('#pluginDetailTitle').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.locator('#pluginDetailContent [data-plugin-action="back"]').click();
    await page.setViewportSize({ width: 1280, height: 900 });
    assert.equal(await page.locator('[aria-labelledby="plugin-group-creativity"] .skill-card').count(), 4);
    assert.equal(await page.locator('#pagePluginPackages dialog').count(), 0);
    assert.equal(await page.locator('#pluginExampleBtn, #pluginInstallBtn, #pluginPreviewDialog').count(), 0);
    assert.equal(await page.evaluate(() => ['pluginsExample','pluginsPreview','pluginsInstall'].some(key => key in window.yan)), false);
    await page.screenshot({ path: path.join(evidence, 'plugins-catalog.png'), animations: 'disabled' });
    await page.locator('#pluginsPackagesTab').focus(); await page.keyboard.press('ArrowUp');
    assert.equal(await page.locator('#pluginsMcpTab').getAttribute('aria-selected'), 'true');
    await page.keyboard.press('ArrowDown'); assert.equal(await page.locator('#pluginsPackagesTab').getAttribute('aria-selected'), 'true');
    assert.equal(await page.locator('#pagePlugins [id$="SearchToggle"], #pagePlugins [id$="FilterToggle"], #pagePlugins input[type="search"], #pluginStatus').count(), 0);
    assert.equal(await page.locator('#pluginMarketGrid .skill-card').count(), 9);
    await page.locator('[data-plugin-open="remotion"]').focus(); await page.keyboard.press('Enter');
    await page.locator('#pluginDetailTitle').waitFor();
    assert.equal(await page.locator('#pluginDetailTitle').textContent(), 'Remotion');
    assert.equal(await page.locator('#pluginDetailContent .plugin-skill-row').count(), 5);
    await page.screenshot({ path: path.join(evidence, 'plugins-catalog-detail.png'), animations: 'disabled' });
    await page.locator('#pluginDetailContent [data-plugin-action="install"]').click();
    await page.locator('#pluginDetailContent [data-plugin-action="toggle"]').waitFor();
    await page.waitForFunction(() => document.getElementById('pagePluginPackages').getAttribute('aria-busy') === 'false');
    assert.equal((await page.evaluate(() => window.yan.pluginsList())).plugins[0].enabled, false);
    assert.match(await page.locator('#toast').textContent(), /安装完成/);
    await page.locator('#pluginDetailContent [data-plugin-action="toggle"]').click();
    await page.waitForFunction(async () => (await window.yan.pluginsList()).plugins[0].enabled === true);
    await page.waitForFunction(() => document.getElementById('pagePluginPackages').getAttribute('aria-busy') === 'false');
    assert.match(await page.locator('#pluginDetailContent .plugin-detail-header').textContent(), /已启用/);
    assert.equal((await page.evaluate(() => window.yan.pluginsPrepare('remotion'))).plugin.ready, true);
    await page.screenshot({ path: path.join(evidence, 'plugins-catalog-installed.png'), animations: 'disabled' });
    await page.locator('#pluginDetailContent [data-plugin-action="back"]').click();
    for (const theme of ['dark', 'light']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.screenshot({ path: path.join(evidence, `plugins-catalog-${theme}.png`), animations: 'disabled' });
    }
    await page.setViewportSize({ width: 760, height: 760 });
    assert.equal(await page.locator('#pagePluginPackages').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.locator('[data-plugin-open="hyperframes"]').click();
    assert.equal(await page.locator('#pluginDetailContent .plugin-skill-row').count(), 5);
    await page.screenshot({ path: path.join(evidence, 'plugins-catalog-narrow.png'), animations: 'disabled' });
    assert.equal(await page.locator('#pluginDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.locator('#pluginDetailContent [data-plugin-action="back"]').click();
    await page.locator('[data-plugin-open="remotion"] [data-plugin-action="open"]').click();
    await page.locator('#pluginDetailContent [data-plugin-action="toggle"]').click();
    await page.waitForFunction(async () => (await window.yan.pluginsList()).plugins[0].enabled === false);
    await page.waitForFunction(() => document.getElementById('pagePluginPackages').getAttribute('aria-busy') === 'false');
    await page.locator('#pluginDetailContent [data-plugin-action="remove"]').click(); await page.locator('#genericConfirmAccept').click();
    await page.waitForFunction(async () => (await window.yan.pluginsList()).plugins.length === 0);
    assert.match(await page.locator('#toast').textContent(), /插件已卸载/);
    await page.locator('#pluginDetailContent [data-plugin-action="install"]').waitFor();
    await page.locator('#pluginDetailContent [data-plugin-action="back"]').click();
    for (const id of ['game-studio', 'circleci', 'build-ios-apps', 'build-macos-apps']) {
      await page.locator(`[data-plugin-open="${id}"] [data-plugin-action="install"]`).click();
      await page.locator('#pluginDetailContent [data-plugin-action="toggle"]').waitFor({ timeout: 180000 });
      await page.waitForFunction(() => document.getElementById('pagePluginPackages').getAttribute('aria-busy') === 'false');
      const installed = (await page.evaluate(() => window.yan.pluginsList())).plugins.find(item => item.id === id);
      assert.equal(installed.enabled, false);
      assert.equal(await page.locator('#pluginDetailContent [data-plugin-action="connect"]').count(), 0);
      if (process.platform !== 'darwin' && id.startsWith('build-')) {
        assert.equal(installed.ready, false);
        assert.match(await page.locator('#pluginDetailContent').textContent(), /运行需要 macOS/);
        assert.match(await page.locator('#pluginDetailContent .plugin-detail-header').textContent(), /需要处理/);
      }
      if (id === 'build-ios-apps') {
        assert.equal(await page.locator('#pluginDetailContent .plugin-requirements').count(), 0);
        await page.screenshot({ path: path.join(evidence, 'plugins-ios-installed.png'), animations: 'disabled' });
      }
      await page.locator('#pluginDetailContent [data-plugin-action="back"]').click();
    }
    assert.equal(await page.locator('[aria-labelledby="plugin-group-developer-tools"] .skill-card').count(), 5);
    assert.equal((await page.evaluate(() => window.yan.pluginsList())).plugins.length, 4);
    assert.deepEqual(errors, []);
    console.log('PASS: shared Skill UI regression, 9 catalog entries, no search/category controls, 4 real developer installs, Apple readiness, theme logos, detail navigation, keyboard tabs, enable, preparation, dark/light/narrow layouts, disable and uninstall. Removed demo/import APIs and dialogs are absent.');
  } finally {
    const child = app?.process();
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    await app?.close().catch(() => {});
    await stopped;
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir())); await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

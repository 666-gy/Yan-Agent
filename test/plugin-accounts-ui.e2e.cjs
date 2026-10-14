'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const { createPluginStore } = require('../lib/plugins/store');
const entries = require('../lib/plugins/remote-catalog.json');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-account-ui-'));
const store = createPluginStore(path.join(userData, 'YanData'));
// Minimal installed test packages exercise real UI/IPC without creating any
// third-party account or sending actual client-registration requests.
for (const id of ['figma', 'canva']) {
  const entry = entries.find(entry => entry.id === id), source = path.join(userData, `fixture-${id}`);
  fs.mkdirSync(source); const manifest = structuredClone(entry.manifest);
  for (const skill of manifest.skills) { const file = path.join(source, skill.path); fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, '# UI fixture\n'); }
  fs.writeFileSync(path.join(source, manifest.instructions), '# UI fixture\n');
  fs.writeFileSync(path.join(source, 'yan-plugin.json'), JSON.stringify(manifest));
  store.install(source, store.preview(source).digest);
}
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(); const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanPluginsPage);
    await app.evaluate(({ safeStorage, shell }) => {
      safeStorage.isEncryptionAvailable = () => false;
      global.__pluginOpenedUrls = [];
      shell.openExternal = async url => { global.__pluginOpenedUrls.push(url); };
    });
    await page.locator('[data-nav="plugins"]').click(); await page.locator('#pluginsPackagesTab').click();
    await page.locator('[data-plugin-open="canva"]').click();
    assert.equal(await page.locator('#pluginDetailTitle').textContent(), 'Canva');
    const assertPill = async action => assert.equal(await page.locator(`[data-plugin-action="${action}"]`).evaluate(node => parseFloat(getComputedStyle(node).borderTopLeftRadius) >= node.getBoundingClientRect().height / 2), true);
    await assertPill('connect');
    await page.locator('[data-plugin-action="connect"]').click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('已打开官方网站'));
    assert.equal(await page.locator('#toast').evaluate(node => node.matches(':popover-open')), true);
    assert.equal(await page.locator('#pluginStatus').count(), 0);
    assert.deepEqual(await app.evaluate(() => global.__pluginOpenedUrls), ['https://www.canva.com/login/']);
    assert.match(await page.locator('#pluginDetailContent').textContent(), /未连接/);
    assert.equal((await page.evaluate(() => window.yan.pluginsList())).plugins.find(item => item.id === 'canva').ready, false);
    const evidence = path.join(appRoot, 'output/playwright'); fs.mkdirSync(evidence, { recursive: true });
    await page.screenshot({ path: path.join(evidence, 'plugins-canva-account.png'), animations: 'disabled' });
    await page.setViewportSize({ width: 760, height: 760 });
    assert.equal(await page.locator('#pluginDetailContent').evaluate(el => el.scrollWidth > el.clientWidth), false);
    assert.equal(await page.locator('#pluginDetailTitle').evaluate(el => el.scrollWidth > el.clientWidth), false);
    await page.screenshot({ path: path.join(evidence, 'plugins-account-narrow.png'), animations: 'disabled' });
    // Fixture only: display an existing connected account, then use the real disconnect action.
    await app.evaluate(({ ipcMain }) => {
      global.__accountCatalog = ipcMain._invokeHandlers.get('plugins:catalog');
      ipcMain.removeHandler('plugins:catalog');
      ipcMain.handle('plugins:catalog', async (event, payload) => {
        const response = await global.__accountCatalog(event, payload);
        const plugin = response.plugins.find(item => item.id === 'canva');
        plugin.installation.accounts.forEach(account => { account.state = 'connected'; account.message = '账号已连接。'; });
        return response;
      });
    });
    await page.evaluate(() => window.YanPluginsPage.show());
    await assertPill('disconnect');
    await page.locator('.plugin-account-section').screenshot({ path: path.join(evidence, 'plugins-account-connected-pill.png'), animations: 'disabled' });
    await app.evaluate(({ ipcMain }) => { ipcMain.removeHandler('plugins:catalog'); ipcMain.handle('plugins:catalog', global.__accountCatalog); });
    await page.locator('[data-plugin-action="disconnect"]').click();
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('账号已断开'));
    await page.waitForFunction(() => document.getElementById('pagePluginPackages').getAttribute('aria-busy') === 'false');
    await assertPill('connect');
    await page.locator('[data-plugin-action="back"]').click();
    await page.locator('[data-plugin-open="game-studio"]').click();
    assert.equal(await page.locator('[data-plugin-action="connect"]').count(), 0);
    assert.equal(await page.locator('#pluginDetailContent .plugin-skill-row').count(), 5);
    await page.locator('[data-plugin-action="back"]').click();
    await page.locator('[data-plugin-open="figma"]').click();
    assert.equal(await page.locator('[data-plugin-action="connect"]').count(), 1);
    assert.equal(await page.locator('#pluginDetailContent .plugin-skills-section .plugin-skill-row').count(), 5);
    await page.locator('[data-plugin-action="expand"]').click();
    assert.equal(await page.locator('#pluginDetailContent .plugin-skills-section .plugin-skill-row').count(), 12);
    assert.deepEqual(errors, []);
    console.log('PASS: real Electron account details, system-browser official login fallback, pending state, narrow layout, and Game Studio without a login requirement.');
  } finally {
    await app?.close().catch(() => {});
    assert.equal(path.dirname(userData), path.resolve(os.tmpdir())); fs.rmSync(userData, { recursive: true, force: true, maxRetries: 8, retryDelay: 150 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

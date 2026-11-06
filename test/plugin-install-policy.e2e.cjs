'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-policy-'));
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: data } });
    await app.evaluate(({ ipcMain }) => {
      global.pluginPolicyInstalls = [];
      const entries = ['third-party', 'official'].map(id => ({ id, name: id, description: id, officialMarket: id === 'official', catalogSource: id === 'official' ? 'official-market' : 'local', installed: id === 'third-party', skills: [], servers: [] }));
      for (const channel of ['plugins:catalog', 'plugins:official-market-refresh', 'plugins:install-catalog']) ipcMain.removeHandler(channel);
      ipcMain.handle('plugins:catalog', () => ({ ok: true, plugins: entries }));
      ipcMain.handle('plugins:official-market-refresh', () => ({ ok: true }));
      ipcMain.handle('plugins:install-catalog', (_, { id }) => { global.pluginPolicyInstalls.push(id); return { ok: true }; });
    });
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof newSession === 'function' && state.config);
    await page.evaluate(() => window.YanStartupHello?.skip());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    await page.evaluate(async () => { switchSidebarNav('plugins'); await window.YanPluginsPage.show(); });
    assert.deepEqual(await page.locator('#pluginMarketGrid .skill-card-name').allTextContents(), ['official']);
    await page.locator('#pluginSourceSwitch [data-plugin-source="installed"]').click();
    assert.deepEqual(await page.locator('#pluginMarketGrid .skill-card-name').allTextContents(), ['third-party']);
    await page.locator('#pluginSourceSwitch [data-plugin-source="market"]').click();
    assert.deepEqual(await page.locator('#pluginMarketGrid .skill-card-name').allTextContents(), ['official']);
    await page.locator('#pluginInstallBtn').click();
    for (const input of ['third-party', 'C:\\external\\plugin']) {
      await page.locator('#pluginInstallInput').fill(input);
      await page.locator('#pluginInstallConfirm').click();
      await page.waitForFunction(() => !document.getElementById('pluginInstallConfirm').disabled);
      assert.match(await page.locator('#pluginInstallError').innerText(), /仅支持官方市场/);
      assert.deepEqual(await app.evaluate(() => global.pluginPolicyInstalls), []);
    }
    await page.locator('#pluginInstallInput').fill('official');
    await page.locator('#pluginInstallConfirm').click();
    await page.locator('#pluginInstallDialog').waitFor({ state: 'hidden' });
    assert.deepEqual(await app.evaluate(() => global.pluginPolicyInstalls), ['official']);
    assert.equal(await page.evaluate(() => typeof window.yan.pluginsInstallLocal), 'undefined');
    console.log('Official-only dialog: third-party and path rejected; official accepted; local IPC bridge absent.');
  } finally {
    await app?.close();
    fs.rmSync(data, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

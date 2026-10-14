'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const http = require('node:http');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-preset-options-'));
const presets = [['mimo', '小米 MiMo'], ['opencode-go', 'OpenCode-Go'], ['opencode-zen', 'OpenCode-Zen']];
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ object: 'list', data: [{ id: 'preset-fixture-model', object: 'model' }] }));
});
let app;
async function launch() {
  app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile, YAN_DISABLE_SINGLE_INSTANCE: '1' } });
  const page = await app.firstWindow();
  await page.waitForFunction(() => window.__YAN_APP_READY__ === true, null, { timeout: 60000 });
  await page.locator('#settingsBtn').click();
  await page.locator('[data-tab="api"]').click();
  await page.locator('#tab-api.active').waitFor();
  return page;
}
(async () => {
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const baseUrl = 'http://127.0.0.1:' + server.address().port + '/v1';
    let page = await launch();
    await page.evaluate(() => openConnectionDialog());
    const saved = [];
    for (const [preset, label] of presets) {
      await page.locator('#connPresetSelect .conn-select-trigger').click();
      const option = page.locator('#connPresetSelect [data-conn-select-value="' + preset + '"]');
      assert.equal((await option.textContent()).trim(), label);
      await option.click();
      assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), label);
      assert.equal(await page.evaluate(() => collectConnectionForm().preset), preset);
      const result = await page.evaluate(({ label, baseUrl }) => api.connectionsSave({
        ...collectConnectionForm(), name: label, baseUrl, apiKey: 'fixture-only', manualModelId: 'preset-fixture-model'
      }), { label, baseUrl });
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.connection.preset, preset);
      saved.push([result.connection.id, preset, label]);
    }
    await app.close(); app = null;
    page = await launch();
    await page.evaluate(() => renderConnectionList());
    for (const [id, preset, label] of saved) {
      await page.evaluate(id => openConnectionDialog(id), id);
      assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), label);
      assert.equal(await page.evaluate(() => collectConnectionForm().preset), preset);
    }
    console.log('PASS: MiMo, OpenCode-Go and OpenCode-Zen dropdown selection, IPC save and actual restart/reopen');
  } finally {
    try { await app?.close(); }
    finally {
      await new Promise(resolve => server.close(resolve));
      fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
    }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

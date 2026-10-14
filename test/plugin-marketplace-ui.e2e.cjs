'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugin-market-ui-'));
const evidence = path.join(appRoot, '.yanagent/evidence'); fs.mkdirSync(evidence, { recursive: true });
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow(); const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ && window.YanPluginsPage);
    await page.locator('[data-nav="plugins"]').click();
    await page.locator('#pluginsPackagesTab').click();
    await page.locator('#pluginMarketGrid .skill-card').first().waitFor();
    assert.equal(await page.locator('#pluginMarketSources').isVisible(), false);

    const source = path.join(userData, 'sample-market');
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'yan-plugin.json'), JSON.stringify({
      schemaVersion: 1, id: 'ui-sample', version: '1.0.0', name: 'UI Sample', description: 'UI sample marketplace plugin.'
    }));
    const added = await page.evaluate(s => window.yan.pluginsAddMarketplace({ source: s }), source);
    assert.equal(added.ok, true);
    assert.equal(added.count, 1);

    await page.waitForFunction(() => !document.querySelector('#pluginMarketSources').classList.contains('hidden'));
    assert.match(await page.locator('#pluginMarketSources').textContent(), /sample-market/);
    assert.match(await page.locator('#pluginMarketSources').textContent(), /1 个插件/);
    assert.equal(await page.locator('#pluginMarketSources [data-plugin-action="remove-market"]').count(), 1);
    assert.equal(await page.locator('[data-plugin-open="ui-sample"]').count(), 1);
    await page.screenshot({ path: path.join(evidence, 'plugin-market-sources.png'), animations: 'disabled' });

    await page.locator('#pluginMarketSources [data-plugin-action="remove-market"]').click();
    await page.locator('#genericConfirmAccept').click();
    await page.waitForFunction(() => document.querySelector('#pluginMarketSources').classList.contains('hidden'));
    assert.equal(await page.locator('[data-plugin-open="ui-sample"]').count(), 0);
    assert.equal((await page.evaluate(() => window.yan.pluginsMarkets())).markets.length, 0);
    assert.deepEqual(errors, []);
    console.log('Plugin marketplace source add/remove UI passed');
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

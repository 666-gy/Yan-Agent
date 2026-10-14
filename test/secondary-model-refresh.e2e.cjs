'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-secondary-refresh-'));
let modelIds = ['fixture-image-a', 'fixture-video-b'];
const server = http.createServer((_req, res) => {
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ object: 'list', data: modelIds.map(id => ({ id, object: 'model' })) }));
});

(async () => {
  let app;
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const env = { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile, YAN_DISABLE_SINGLE_INSTANCE: '1' };
    delete env.ELECTRON_RUN_AS_NODE;
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__ === true, null, { timeout: 60000 });
    const result = await page.evaluate(baseUrl => api.connectionsSave({
      name: 'Secondary refresh fixture', preset: 'openai', apiFormat: 'openai', baseUrl,
      apiKey: 'fixture-only', modelFlags: {
        'fixture-image-a': { image: true, enabled: true },
        'fixture-video-b': { video: true, enabled: true }
      }
    }), `http://127.0.0.1:${server.address().port}/v1`);
    assert.equal(result.ok, true, JSON.stringify(result));
    const id = result.connection.id;
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="model-secondary"]').click();
    const image = page.locator('#secondaryModelList [data-secondary-id="fixture-image-a"]');
    const video = page.locator('#secondaryModelList [data-secondary-id="fixture-video-b"]');
    await image.waitFor();
    await video.waitFor();
    await image.locator('[data-secondary-enable]').check();
    await page.waitForFunction(() => state.config.media.imageModel === 'fixture-image-a');

    // Save through the real provider form after canceling image support.
    await page.locator('[data-tab="api"]').click();
    await page.evaluate(id => openConnectionDialog(id), id);
    const imageFlag = page.locator('#connModels [data-model-id="fixture-image-a"] [data-model-cap="image"]');
    assert.equal(await imageFlag.getAttribute('data-state'), 'yes');
    await imageFlag.click();
    await page.locator('#connNext').click();
    await page.locator('#connectionDialog:not([open])').waitFor({ state: 'attached' });
    // Check the hidden secondary DOM too: saving must update it immediately.
    assert.equal(await image.count(), 0);
    assert.equal(await video.count(), 1);
    assert.equal((await page.evaluate(() => api.getConfig())).media.imageModel, '');
    assert.equal(await page.evaluate(() => state.config.media.imageModel), '');
    await page.locator('[data-tab="model-secondary"]').click();
    await video.waitFor();
    assert.equal(await image.count(), 0);

    // Restore support and select A again, without restarting the renderer.
    await page.locator('[data-tab="api"]').click();
    await page.evaluate(id => openConnectionDialog(id), id);
    await imageFlag.click(); // no -> unknown
    await imageFlag.click(); // unknown -> yes
    await page.locator('#connNext').click();
    await page.locator('#connectionDialog:not([open])').waitFor({ state: 'attached' });
    assert.equal(await image.count(), 1);
    await page.locator('[data-tab="model-secondary"]').click();
    await image.waitFor();
    await image.locator('[data-secondary-enable]').check();
    await page.waitForFunction(() => state.config.media.imageModel === 'fixture-image-a');

    // The API now drops A; saving the provider syncs its new catalog.
    modelIds = ['fixture-video-b'];
    await page.locator('[data-tab="api"]').click();
    await page.evaluate(id => openConnectionDialog(id), id);
    await page.locator('#connNext').click();
    await page.locator('#connectionDialog:not([open])').waitFor({ state: 'attached' });
    assert.equal(await image.count(), 0);
    assert.equal(await video.count(), 1);
    assert.equal((await page.evaluate(() => api.getConfig())).media.imageModel, '');
    await page.locator('[data-tab="model-secondary"]').click();
    await video.waitFor();
    assert.equal(await image.count(), 0);

    // Backend model-change notifications update an already-open page as well.
    assert.equal((await page.evaluate(id => api.connectionsDelete(id), id)).ok, true);
    await page.waitForFunction(() => !document.querySelector('#secondaryModelList [data-secondary-id]'));
    assert.deepEqual(errors, []);
    console.log('PASS: secondary models refresh after support removal, API model removal, restore and delete; invalid selection clears without restart');
  } finally {
    await app?.close();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

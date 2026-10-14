'use strict';

// End-to-end: the vision-relay candidates come from the user's
// "支持多模态" marks, the settings page lists them with a switch, and turning
// one on persists `api.visionRelayModels`. No vendor is hard-coded any more.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-vision-relay-connections-'));

function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_E2E_MODE: '1',
      YAN_E2E_USER_DATA_DIR: userDataDir
    }
  });
}

function connection(id, modelId, name) {
  return {
    id,
    providerId: id,
    supplierId: 'official',
    preset: 'openai',
    manualModelId: '',
    createdAt: 1,
    modelFlags: { [modelId]: { multimodal: true } }
  };
}

function supplier(name, modelId) {
  return [{
    id: 'official',
    name,
    kind: 'official',
    baseUrl: 'https://example.invalid/v1',
    apiKey: 'e2e-key',
    imageGenerationUrl: '',
    imageEditUrl: '',
    videoGenerationUrl: '',
    workspaceId: '',
    models: [{ id: modelId, name: modelId }]
  }];
}

(async () => {
  let application;
  try {
    application = await launch();
    const page = await application.firstWindow();
    await page.waitForFunction(() => typeof yan !== 'undefined');
    await page.evaluate(async () => {
      await yan.setConfig({
        api: {
          connectionsMigrated: true,
          connections: [
            connection('conn-vision-a', 'vision-a', 'Vision A'),
            connection('conn-vision-b', 'vision-b', 'Vision B')
          ],
          providerSuppliers: {
            'conn-vision-a': supplier('Connection A', 'vision-a'),
            'conn-vision-b': supplier('Connection B', 'vision-b')
          },
          providerActiveSupplierIds: {
            'conn-vision-a': 'official',
            'conn-vision-b': 'official'
          }
        }
      });
    });

    const status = await page.evaluate(() => yan.getVisionRelayStatus());
    assert.equal(status.candidateCount, 2, 'both multimodal-marked models are candidates');
    assert.deepEqual(status.candidates.map(candidate => candidate.modelId).sort(), ['vision-a', 'vision-b']);
    assert.equal(status.availableCount, 0, 'nothing is enabled yet');
    assert.equal(status.candidates.every(candidate => candidate.configured === true), true);

    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="vision-relay"]').click();
    assert.equal(await page.locator('#visionRelayEnabledCheck').count(), 0, 'the master switch is gone');
    assert.equal(await page.locator('[data-vision-relay-provider]').count(), 0, 'the vendor list is gone');
    await page.locator('#visionRelayModelList [data-vision-relay-model]').first().waitFor();
    assert.equal(await page.locator('#visionRelayModelList [data-vision-relay-model]').count(), 2);

    const firstKey = await page.locator('#visionRelayModelList [data-vision-relay-model]').first().getAttribute('data-vision-relay-model');
    await page.locator('#visionRelayModelList [data-vision-relay-model]').first().check();
    await page.waitForFunction(() => {
      const cfg = window.state?.config;
      return Array.isArray(cfg?.api?.visionRelayModels) && cfg.api.visionRelayModels.length === 1;
    });
    const saved = await page.evaluate(() => window.state.config.api.visionRelayModels);
    assert.equal(saved.length, 1);
    assert.equal(`${saved[0].providerId}\u0000${saved[0].supplierId}\u0000${saved[0].modelId}`, firstKey);

    const after = await page.evaluate(() => yan.getVisionRelayStatus());
    assert.equal(after.enabledCount, 1);
    assert.equal(after.availableCount, 1);

    console.log(JSON.stringify({ ok: true, candidateCount: status.candidateCount, enabledCount: after.enabledCount }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

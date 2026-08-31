'use strict';

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

(async () => {
  let application;
  try {
    application = await launch();
    let page = await application.firstWindow();
    await page.waitForFunction(() => typeof yan !== 'undefined');
    await page.evaluate(async () => {
      await yan.setConfig({
        api: {
          connectionsMigrated: true,
          connections: [
            {
              id: 'conn-agnes-e2e',
              providerId: 'conn-agnes-e2e',
              supplierId: 'official',
              preset: 'agnes',
              manualModelId: '',
              createdAt: 2
            },
            {
              id: 'conn-glm-e2e',
              providerId: 'conn-glm-e2e',
              supplierId: 'official',
              preset: 'glm',
              manualModelId: '',
              createdAt: 1
            },
            {
              id: 'conn-sensenova-e2e',
              providerId: 'conn-sensenova-e2e',
              supplierId: 'official',
              preset: 'sensenova',
              manualModelId: '',
              createdAt: 3
            },
            {
              id: 'conn-siliconflow-e2e',
              providerId: 'conn-siliconflow-e2e',
              supplierId: 'official',
              preset: 'siliconflow',
              manualModelId: '',
              createdAt: 4
            }
          ],
          providerSuppliers: {
            'conn-agnes-e2e': [{
              id: 'official',
              name: 'Agnes E2E',
              kind: 'official',
              baseUrl: 'https://agnes.invalid/v1',
              apiKey: 'e2e-key',
              imageGenerationUrl: '',
              imageEditUrl: '',
              videoGenerationUrl: '',
              workspaceId: '',
              models: [{ id: 'agnes-2.5-flash', name: 'Agnes 2.5 Flash' }]
            }],
            'conn-glm-e2e': [{
              id: 'official',
              name: 'GLM E2E',
              kind: 'official',
              baseUrl: 'https://glm.invalid/v1',
              apiKey: 'e2e-key',
              imageGenerationUrl: '',
              imageEditUrl: '',
              videoGenerationUrl: '',
              workspaceId: '',
              models: [
                { id: 'glm-5v-turbo', name: 'GLM-5V Turbo' },
                { id: 'glm-4.6v-flash', name: 'GLM-4.6V Flash' }
              ]
            }],
            'conn-sensenova-e2e': [{
              id: 'official',
              name: 'SenseNova E2E',
              kind: 'official',
              baseUrl: 'https://sensenova.invalid/v1',
              apiKey: 'e2e-key',
              imageGenerationUrl: '',
              imageEditUrl: '',
              videoGenerationUrl: '',
              workspaceId: '',
              models: [
                { id: 'sensenova-6.8-flash-lite', name: 'SenseNova 6.8 Flash Lite' },
                { id: 'sensenova-u1-fast', name: 'SenseNova U1 Fast' }
              ]
            }],
            'conn-siliconflow-e2e': [{
              id: 'official',
              name: 'SiliconFlow E2E',
              kind: 'official',
              baseUrl: 'https://siliconflow.invalid/v1',
              apiKey: 'e2e-key',
              imageGenerationUrl: '',
              imageEditUrl: '',
              videoGenerationUrl: '',
              workspaceId: '',
              models: []
            }]
          },
          providerActiveSupplierIds: {
            'conn-agnes-e2e': 'official',
            'conn-glm-e2e': 'official',
            'conn-sensenova-e2e': 'official',
            'conn-siliconflow-e2e': 'official'
          }
        }
      });
    });
    const status = await page.evaluate(() => yan.getVisionRelayStatus());
    assert.equal(status.agnes.configured, true);
    assert.equal(status.agnes.available, true);
    assert.ok(status.agnes.models.some(model => model.providerId === 'conn-agnes-e2e'));
    assert.equal(status.glm.configured, true);
    assert.equal(status.glm.available, true);
    assert.ok(status.glm.models.some(model => model.providerId === 'conn-glm-e2e'));
    assert.equal(status.glm.models.some(model => model.modelId === 'glm-5v-turbo'), false);
    assert.equal(status.sensenova.configured, true);
    assert.equal(status.sensenova.available, true);
    assert.ok(status.sensenova.models.some(model => model.modelId === 'sensenova-6.8-flash-lite'));
    assert.equal(status.sensenova.models.some(model => model.modelId === 'sensenova-u1-fast'), false);
    assert.equal(status.siliconflow.configured, true);
    assert.equal(status.siliconflow.available, true);
    assert.deepEqual(status.siliconflow.models.map(model => model.modelId), [
      'Qwen/Qwen3.5-4B',
      'deepseek-ai/DeepSeek-OCR',
      'PaddlePaddle/PaddleOCR-VL-1.5'
    ]);
    const providers = await page.evaluate(() => yan.listProviders());
    const senseNovaProvider = providers.find(provider => provider.id === 'conn-sensenova-e2e');
    assert.ok(senseNovaProvider);
    assert.equal(senseNovaProvider.mediaAdapterReady, true);
    assert.equal(senseNovaProvider.mediaCapabilities.imageGeneration, true);
    assert.ok(senseNovaProvider.suppliers[0].models.some(model => (
      model.id === 'sensenova-u1-fast' && model.modelType === 'image'
    )));

    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="vision-relay"]').click();
    assert.equal(await page.locator('.vision-relay-list.general-settings-group').count(), 2);
    await page.locator('#visionRelayAgnesStatus[data-status="success"]').waitFor();
    await page.locator('#visionRelayGlmStatus[data-status="success"]').waitFor();
    await page.locator('#visionRelaySenseNovaStatus[data-status="success"]').waitFor();
    await page.locator('#visionRelaySiliconFlowStatus[data-status="success"]').waitFor();
    assert.equal(await page.locator('#visionRelayAgnesStatus').textContent(), '检查配置状态');
    assert.equal(await page.locator('#visionRelayGlmStatus').textContent(), '检查配置状态');
    assert.equal(await page.locator('#visionRelaySenseNovaStatus').textContent(), '检查配置状态');
    assert.match(await page.locator('#visionRelayAgnesStatus').getAttribute('aria-label'), /已配置/);
    assert.match(await page.locator('#visionRelayGlmStatus').getAttribute('aria-label'), /已配置/);
    assert.match(await page.locator('#visionRelaySenseNovaStatus').getAttribute('aria-label'), /已配置/);

    await page.locator('#visionRelayOverviewBtn').click();
    await page.locator('#visionRelayGuideDialog[open]').waitFor();
    assert.equal(await page.locator('#visionRelayGuideDialog').getAttribute('data-guide'), 'overview');
    assert.equal(await page.locator('#visionRelayGuidePageCopy').evaluate(element => getComputedStyle(element).fontSize), '16px');
    assert.equal(await page.locator('#visionRelayGuideStepLabel').textContent(), '1 / 5');
    assert.equal(await page.locator('#visionRelayGuidePageTitle').textContent(), '什么是“视觉中继”？');
    await page.locator('#visionRelayGuideNext').click();
    assert.equal(await page.locator('#visionRelayGuideStepLabel').textContent(), '2 / 5');
    assert.equal(await page.locator('#visionRelayGuideDialog .provider-dialog-shell').evaluate(element => getComputedStyle(element).height), '300px');
    await page.locator('#visionRelayGuideClose').click();

    await page.locator('[data-vision-relay-guide="glm"]').click();
    assert.equal(await page.locator('#visionRelayGuideDialog').getAttribute('data-guide'), 'glm');
    assert.equal(await page.locator('#visionRelayGuidePageCopy').evaluate(element => getComputedStyle(element).fontSize), '16px');
    await page.locator('#visionRelayGuideClose').click();

    await page.locator('[data-vision-relay-guide="sensenova"]').click();
    assert.equal(await page.locator('#visionRelayGuideDialog').getAttribute('data-guide'), 'sensenova');
    assert.equal(await page.locator('#visionRelayGuideStepLabel').textContent(), '1 / 7');
    await page.locator('#visionRelayGuideClose').click();

    await page.locator('[data-vision-relay-guide="siliconflow"]').click();
    assert.equal(await page.locator('#visionRelayGuideDialog').getAttribute('data-guide'), 'siliconflow');
    assert.equal(await page.locator('#visionRelayGuideStepLabel').textContent(), '1 / 7');
    await page.locator('#visionRelayGuideClose').click();

    const openedGuideUrl = await page.evaluate(() => yan.openVisionRelayGuideUrl('https://bigmodel.cn/glm-coding'));
    assert.equal(openedGuideUrl.url, 'https://bigmodel.cn/glm-coding');
    const openedSenseNovaUrl = await page.evaluate(() => yan.openVisionRelayGuideUrl('https://www.sensenova.cn/'));
    assert.equal(openedSenseNovaUrl.url, 'https://www.sensenova.cn/');
    const openedSiliconFlowUrl = await page.evaluate(() => yan.openVisionRelayGuideUrl('https://www.siliconflow.cn/'));
    assert.equal(openedSiliconFlowUrl.url, 'https://www.siliconflow.cn/');

    console.log(JSON.stringify({
      ok: true,
      agnesModels: status.agnes.modelCount,
      glmModels: status.glm.modelCount,
      senseNovaModels: status.sensenova.modelCount
    }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-connections-ui-e2e-'));

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error?.stack || error?.message || String(error)));
    await page.waitForFunction(() => typeof openSettings === 'function');
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="api"]').click();
    await page.locator('#tab-api.active').waitFor();

    assert.equal(await page.locator('#tab-api.active').evaluate(el => getComputedStyle(el).display), 'block');
    assert.equal(await page.locator('#mediaModelPickerWrap').count(), 0);
    assert.equal(await page.locator('.media-model-settings-field > label').textContent(), '图像/视频模型选择');
    assert.equal(await page.locator('#mediaImageSettingsRow .media-model-settings-label').textContent(), '生成图像模型选择');
    assert.equal(await page.locator('#mediaVideoSettingsRow .media-model-settings-label').textContent(), '生成视频模型选择');
    assert.equal(await page.locator('#mediaImageSettingsSelect').textContent(), '选择');
    assert.equal(await page.locator('#mediaImageSettingsSelect').evaluate(button => getComputedStyle(button).borderRadius), '999px');

    await page.locator('#mediaImageSettingsSelect').click();
    await page.locator('#mediaModelSettingsDialog[open]').waitFor();
    assert.equal(await page.locator('#mediaModelSettingsTitle').textContent(), '生成图像模型选择');
    assert.equal(await page.locator('#mediaModelSettingsStepLabel').textContent(), '1 / 2');
    await page.locator('#mediaModelSettingsClose').click();

    await page.evaluate(() => {
      mediaModelCatalogStatus = 'ready';
      connectionCache = [
        { providerId: 'conn-glm', supplierId: 'glm-prod', name: '智谱生产连接', preset: 'glm' },
        { providerId: 'conn-agnes', supplierId: 'agnes-main', name: 'Agnes 主连接', preset: 'agnes' },
        { providerId: 'conn-video', supplierId: 'video-main', name: '视频连接', preset: 'sensenova' }
      ];
      mediaModelCatalog = [
        { providerId: 'conn-glm', providerName: 'GLM', supplierId: 'glm-prod', supplierName: '智谱生产连接', id: 'cogview-4', name: 'GLM Image Pro', modelType: 'image' },
        { providerId: 'conn-glm', providerName: 'GLM', supplierId: 'glm-prod', supplierName: '智谱生产连接', id: 'cogview-3-flash', name: 'CogView Flash', modelType: 'image' },
        { providerId: 'conn-agnes', providerName: 'Agnes', supplierId: 'agnes-main', supplierName: 'Agnes 主连接', id: 'agnes-image', name: 'Agnes Image', modelType: 'image' },
        { providerId: 'conn-video', providerName: '日日新', supplierId: 'video-main', supplierName: '视频连接', id: 'nova-video', name: 'Nova Video', modelType: 'video' }
      ];
      Object.assign(mediaModelSettingsDraft, {
        role: 'image', page: 0, providerId: '', supplierId: '', modelId: ''
      });
      const dialog = document.querySelector('#mediaModelSettingsDialog');
      dialog.showModal();
      renderMediaModelSettingsWizard();
    });
    assert.equal(await page.locator('#mediaModelSettingsProviders [data-media-provider]').count(), 2);
    assert.match(await page.locator('#mediaModelSettingsProviders').textContent(), /GLM · 智谱/);
    assert.match(await page.locator('#mediaModelSettingsProviders').textContent(), /智谱生产连接/);
    assert.doesNotMatch(await page.locator('#mediaModelSettingsProviders').textContent(), /日日新/);
    const firstStageHeight = await page.locator('.media-model-settings-stage').evaluate(stage => getComputedStyle(stage).height);
    await page.locator('#mediaModelSettingsProviders [data-media-provider="conn-glm"]').click();
    await page.locator('#mediaModelSettingsNext').click();
    assert.equal(await page.locator('#mediaModelSettingsStepLabel').textContent(), '2 / 2');
    assert.equal(await page.locator('#mediaModelSettingsNext').textContent(), '确定');
    assert.match(await page.locator('#mediaModelSettingsModels').textContent(), /不选择/);
    assert.match(await page.locator('#mediaModelSettingsModels').textContent(), /GLM Image Pro/);
    assert.doesNotMatch(await page.locator('#mediaModelSettingsModels').textContent(), /Nova Video/);
    assert.equal(await page.locator('.media-model-settings-stage').evaluate(stage => getComputedStyle(stage).height), firstStageHeight);
    await page.locator('#mediaModelSettingsClose').click();

    await page.evaluate(() => {
      Object.assign(mediaModelSettingsDraft, {
        role: 'video', page: 0, providerId: '', supplierId: '', modelId: ''
      });
      const dialog = document.querySelector('#mediaModelSettingsDialog');
      dialog.showModal();
      renderMediaModelSettingsWizard();
    });
    assert.equal(await page.locator('#mediaModelSettingsTitle').textContent(), '生成视频模型选择');
    assert.equal(await page.locator('#mediaModelSettingsProviders [data-media-provider]').count(), 1);
    assert.match(await page.locator('#mediaModelSettingsProviders').textContent(), /日日新/);
    assert.doesNotMatch(await page.locator('#mediaModelSettingsProviders').textContent(), /GLM/);
    await page.locator('#mediaModelSettingsClose').click();

    await page.evaluate(() => {
      state.config.media = {
        ...(state.config.media || {}),
        imageProvider: 'conn-glm',
        imageSupplierId: 'glm-prod',
        imageModel: 'cogview-4',
        imageName: 'GLM Image Pro'
      };
      renderMediaModelBadge();
    });
    assert.equal(await page.locator('#mediaImageSettingsModel').textContent(), 'GLM Image Pro');
    assert.equal(await page.locator('#mediaImageSettingsProvider').textContent(), '智谱生产连接');

    await page.evaluate(() => {
      Object.assign(mediaModelSettingsDraft, {
        role: 'image', page: 0, providerId: 'conn-glm', supplierId: 'glm-prod', modelId: 'cogview-4'
      });
      const dialog = document.querySelector('#mediaModelSettingsDialog');
      dialog.showModal();
      renderMediaModelSettingsWizard();
    });
    await page.locator('#mediaModelSettingsNext').click();
    await page.locator('#mediaModelSettingsModels [data-media-model=""]').click();
    await page.locator('#mediaModelSettingsNext').click();
    await page.locator('#mediaModelSettingsDialog:not([open])').waitFor({ state: 'attached' });
    assert.equal(await page.locator('#mediaImageSettingsModel').textContent(), '未选择');
    assert.equal(await page.locator('#mediaImageSettingsProvider').isHidden(), true);

    await page.locator('#connectionList .provider-add').click();
    await page.locator('#connectionDialog[open]').waitFor();
    assert.equal(await page.locator('#connectionList .provider-add .provider-name').textContent(), '新建连接');
    assert.equal(await page.locator('#connectionList .provider-add .provider-status').count(), 0);
    assert.equal(await page.locator('#connectionList .provider-add .provider-open svg path').count(), 3);
    assert.equal(await page.locator('#connectionList .provider-add .provider-open').getAttribute('title'), '新建连接');

    const pages = await page.locator('#connectionDialog .conn-page').evaluateAll(nodes => nodes.map(node => node.querySelector('.conn-page-title')?.textContent?.trim()));
    assert.deepEqual(pages, [
      '配置名称', '兼容预设', 'Base URL', 'API Key', '生成图像 POST 可选',
      '编辑图片 POST 可选', '生成视频 POST 可选', '自定义模型 ID 可选', '返回模型', '完成'
    ]);
    assert.equal(await page.locator('#connPresetGrid [data-preset="stepfun"]').textContent(), '阶跃 · StepFun');
    assert.equal(await page.locator('#connPresetGrid [data-preset="hunyuan"]').textContent(), '混元 · Hunyuan');
    assert.equal(await page.locator('#connPresetGrid [data-preset="gemini"]').textContent(), 'Gemini');
    assert.equal(await page.locator('#connPresetGrid [data-preset="kimi"]').textContent(), 'Kimi');
    assert.equal(await page.locator('#connPresetGrid [data-preset="opencode"]').textContent(), 'OpenCode');
    assert.equal(await page.locator('#connPresetGrid [data-preset="sensenova"]').textContent(), '日日新');
    assert.equal(await page.locator('#connPresetGrid [data-preset="jiyuan"]').textContent(), '基元律动');
    assert.equal(await page.locator('#connectionDialog .conn-wizard-foot > .conn-pill').count(), 2);
    assert.equal(await page.locator('.conn-action-pill').count(), 0);
    assert.equal(await page.locator('#connDelete').count(), 0);
    assert.equal(await page.locator('#connApiKey').evaluate(input => getComputedStyle(input).borderRadius), '999px');
    assert.equal(await page.locator('#connToggleKey').evaluate(button => getComputedStyle(button).position), 'absolute');
    assert.equal(await page.locator('#connApiKey').evaluate(input => {
      input.dataset.masked = 'true';
      input.value = '••••••';
      return collectConnectionForm().apiKey;
    }), '');
    assert.equal(await page.locator('#connectionDialog .conn-wizard-stage').evaluate(stage => getComputedStyle(stage).height), '236px');
    assert.equal(await page.locator('.conn-page[data-conn-page="8"] .provider-models-heading').count(), 0);
    assert.equal(await page.locator('.conn-page[data-conn-page="8"] .conn-page-sub').textContent(), '以下为API返回的全部模型');
    await page.evaluate(() => showConnectionNotice('连接失败：测试', 'error'));
    assert.equal(await page.locator('#connNotice').isVisible(), true);
    assert.equal(await page.locator('#connNotice').getAttribute('data-state'), 'error');
    await page.evaluate(() => showConnectionNotice(''));
    assert.equal(await page.evaluate(() => formatConnectionCatalogStatus({
      apiKeyConfigured: true,
      modelCount: 2,
      supplementalModelCount: 13,
      supplementalModelLabel: 'GLM 官方补充'
    })), '2 个 API 模型 · 13 个 GLM 官方补充');

    await page.evaluate(() => { void deleteConnection({ id: 'conn-test', name: '测试连接' }); });
    await page.locator('#providerConfirmModal:not(.hidden)').waitFor();
    assert.equal(await page.locator('#connectionDialog[open]').count(), 0);
    assert.equal(await page.locator('#providerConfirmModal').getAttribute('aria-hidden'), 'false');
    await page.locator('#providerConfirmCancel').click({ force: true });
    await page.locator('#connectionList .provider-add').click();
    await page.locator('#connectionDialog[open]').waitFor();

    await page.locator('#connNext').click();
    assert.match(await page.locator('#connNotice').textContent(), /配置名称/);
    assert.equal(await page.locator('#connStepLabel').textContent(), '1 / 10');

    await page.locator('#connName').fill('测试连接');
    await page.locator('#connNext').click();
    assert.equal(await page.locator('#connStepLabel').textContent(), '2 / 10');
    await page.locator('[data-preset="hunyuan"]').click();
    await page.locator('#connNext').click();
    assert.equal(await page.locator('#connStepLabel').textContent(), '3 / 10');
    await page.locator('#connBaseUrl').fill('https://example.com/v1');
    await page.locator('#connNext').click();
    assert.equal(await page.locator('#connStepLabel').textContent(), '4 / 10');
    await page.locator('#connApiKey').fill('test-key');
    await page.locator('#connToggleKey').click();
    assert.equal(await page.locator('#connApiKey').inputValue(), '••••••');
    assert.equal(await page.evaluate(() => collectConnectionForm().apiKey), 'test-key');
    await page.locator('#connNext').click();
    assert.equal(await page.locator('#connStepLabel').textContent(), '5 / 10');
    assert.equal(await page.locator('#connNext').textContent(), '下一页 →');

    await page.locator('#connectionDialogClose').click();
    await page.locator('#closeSettings').click();
    await page.locator('#settingsOverlay').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      state.config = {
        ...(state.config || {}),
        api: {
          ...(state.config?.api || {}),
          provider: 'conn-glm',
          model: 'glm-5.3',
          reasoningSpeed: 'medium',
          thinking: false
        },
        agentModel: {
          providerId: 'conn-glm',
          supplierId: 'official',
          modelId: 'glm-5.3',
          modelType: 'text',
          name: 'GLM-5.3'
        }
      };
      quickModelsCache = {
        models: [
          { providerId: 'conn-glm', providerName: 'GLM', supplierId: 'official', supplierName: '智谱', id: 'glm-5.3', name: 'GLM-5.3', modelType: 'text', source: 'api' },
          { providerId: 'conn-glm', providerName: 'GLM', supplierId: 'official', supplierName: '智谱', id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', modelType: 'text', source: 'glm-official-supplement' },
          { providerId: 'conn-glm', providerName: 'GLM', supplierId: 'official', supplierName: '智谱', id: 'glm-4.6v-flash', name: 'GLM-4.6V Flash', modelType: 'text', source: 'api' }
        ]
      };
      renderModelBadge();
      resetModelPickerDraft();
      renderModelPickerWizard();
      document.querySelector('#modelPill').setAttribute('aria-expanded', 'true');
      document.querySelector('#modelPickerDialog').showModal();
    });

    const modelPill = page.locator('#modelPill');
    const modelDialog = page.locator('#modelPickerDialog[open]');
    await modelDialog.waitFor();
    assert.equal(await modelPill.evaluate(button => getComputedStyle(button).borderRadius), '999px');
    assert.equal(await page.locator('#modelPickerStepLabel').textContent(), '1 / 2');
    assert.equal(await page.locator('#modelPickerChoices .conn-preset-pill').count(), 3);
    assert.equal(await modelDialog.evaluate(dialog => dialog.classList.contains('conn-wizard-dialog')), true);
    const modelChoiceBoxes = await page.locator('#modelPickerChoices .conn-preset-pill').evaluateAll(buttons => (
      buttons.slice(0, 3).map(button => {
        const box = button.getBoundingClientRect();
        return { x: box.x, y: box.y, right: box.right };
      })
    ));
    assert.ok(Math.abs(modelChoiceBoxes[0].y - modelChoiceBoxes[1].y) < 1);
    assert.ok(modelChoiceBoxes[1].x > modelChoiceBoxes[0].right);
    const modelPickerStageHeight = await page.locator('#modelPickerStage').evaluate(stage => getComputedStyle(stage).height);
    fs.mkdirSync(path.join(appRoot, 'output', 'playwright'), { recursive: true });
    await modelDialog.screenshot({ path: path.join(appRoot, 'output', 'playwright', 'model-picker-models.png') });
    await page.locator('#modelPickerNext').click();
    assert.equal(await page.locator('#modelPickerStepLabel').textContent(), '2 / 2');
    assert.deepEqual(
      await page.locator('#modelReasoningChoices [data-reasoning-mode]').allTextContents(),
      ['轻度', '中', '高', '极高', '最高']
    );
    assert.equal(await page.locator('#modelPickerStage').evaluate(stage => getComputedStyle(stage).height), modelPickerStageHeight);
    const maximumReasoning = page.locator('#modelReasoningChoices [data-reasoning-mode="max"]');
    await maximumReasoning.focus();
    assert.equal(await maximumReasoning.evaluate(button => getComputedStyle(button).outlineWidth), '2px');
    assert.equal(await maximumReasoning.evaluate(button => getComputedStyle(button).outlineStyle), 'solid');
    await maximumReasoning.click();
    assert.equal(await page.locator('#modelPillSpeed').textContent(), '中');
    assert.match(await modelPill.getAttribute('aria-label'), /推理强度 中/);

    await modelDialog.screenshot({ path: path.join(appRoot, 'output', 'playwright', 'model-picker-effort.png') });
    await page.locator('#modelPickerClose').click();
    await page.locator('#modelPickerDialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#modelPill')?.getAttribute('aria-expanded') === 'false');
    assert.equal(await page.locator('#modelPillSpeed').textContent(), '中');
    assert.equal(await modelPill.getAttribute('aria-expanded'), 'false');
    assert.match(
      await modelPill.evaluate(button => getComputedStyle(button).borderTopColor),
      /^(?:transparent|rgba\(0, 0, 0, 0\))$/
    );
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      ok: true,
      pages: pages.length,
      modelChoices: modelChoiceBoxes.length,
      reasoningChoices: await page.locator('#modelReasoningChoices [data-reasoning-mode]').count()
    }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

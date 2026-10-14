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
    await page.waitForFunction(() => window.__YAN_APP_READY__ === true, { timeout: 60000 });
    await page.locator('#settingsBtn').click();
    await page.locator('[data-tab="api"]').click();
    await page.locator('#tab-api.active').waitFor();

    // Closing a <dialog> queues a task that fires its `close` event, and the app
    // clears the media wizard draft there. Wait for that event before reopening,
    // otherwise the draft set below is wiped asynchronously and Next stays disabled.
    const closeMediaDialog = async () => {
      await page.evaluate(() => {
        window.__mediaDialogClosed = false;
        document.querySelector('#mediaModelSettingsDialog')
          .addEventListener('close', () => { window.__mediaDialogClosed = true; }, { once: true });
      });
      await page.locator('#mediaModelSettingsClose').click();
      await page.waitForFunction(() => window.__mediaDialogClosed === true);
    };

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
    await closeMediaDialog();

    await page.evaluate(() => {
      // Publish the fixtures once; bumping the refresh sequence cancels any
      // background catalog refresh that would otherwise overwrite them.
      window.__yanE2EMediaFixtures = () => {
        mediaModelRefreshSequence += 1;
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
      };
      window.__yanE2EMediaFixtures();
      Object.assign(mediaModelSettingsDraft, {
        role: 'image', page: 0, providerId: '', supplierId: '', modelId: ''
      });
      const dialog = document.querySelector('#mediaModelSettingsDialog');
      dialog.showModal();
      renderMediaModelSettingsWizard();
    });
    assert.equal(await page.locator('#mediaModelSettingsProviders [data-media-provider]').count(), 2);
    assert.match(await page.locator('#mediaModelSettingsProviders').textContent(), /glm·GLMM/);
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
    await closeMediaDialog();

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
    await closeMediaDialog();

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

    // Sidebar: 9 official presets + a custom entry, in the requested order.
    const presetTabCount = await page.locator('#connPresetSidebar .connection-preset-item').count();
    assert.equal(presetTabCount, 10);
    assert.deepEqual(
      await page.locator('#connPresetSidebar .connection-preset-name').allTextContents(),
      ['DeepSeek', 'GLM', 'GPT', 'Grok', 'Kimi', 'Qwen', 'Gemini', 'Anthropic', 'Agnes', '自定义配置']
    );
    // Custom entry uses the lucide circle-plus glyph, not a text "+".
    assert.equal(await page.locator('#connPresetSidebar [data-conn-preset-item="custom"] .is-plus svg').count(), 1);
    assert.equal(await page.locator('#connPresetSidebar [data-conn-preset-item="custom"] .is-plus svg circle').count(), 1);
    // Fresh logos for the vendors that had none.
    assert.match(await page.locator('#connPresetSidebar [data-conn-preset-item="gemini"] .connection-preset-logo').getAttribute('style'), /gemini\.svg/);
    assert.match(await page.locator('#connPresetSidebar [data-conn-preset-item="anthropic"] .connection-preset-logo').getAttribute('style'), /claude\.svg/);
    assert.match(await page.locator('#connPresetSidebar [data-conn-preset-item="agnes"] .connection-preset-logo').getAttribute('style'), /agnes\.png/);

    // One unified panel; the paged wizard, its dots and native selects are gone.
    assert.equal(await page.locator('#connectionDialog .conn-page').count(), 0);
    assert.equal(await page.locator('#connectionDialog .conn-step-dots').count(), 0);
    assert.equal(await page.locator('#connectionDialog .conn-wizard-foot > .conn-pill').count(), 1);
    assert.equal(await page.locator('#connDelete').count(), 0);
    assert.equal(await page.locator('#connectionDialog select').count(), 0);

    // Format is our own dropdown, closed until clicked.
    assert.equal(await page.locator('#connFormatSelect .conn-select-value').textContent(), '自动识别');
    assert.equal(await page.locator('#connFormatSelect .conn-select-menu').isVisible(), false);
    await page.locator('#connFormatSelect .conn-select-trigger').click();
    assert.equal(await page.locator('#connFormatSelect .conn-select-menu').isVisible(), true);
    const formatOptions = (await page.locator('#connFormatSelect .conn-select-option').allTextContents()).map(text => text.trim());
    assert.deepEqual(formatOptions, ['自动识别', 'Chat Completions', 'Anthropic Messages', 'Responses']);
    await page.locator('#connFormatSelect [data-conn-select-value="responses"]').click();
    assert.equal(await page.locator('#connFormatSelect .conn-select-value').textContent(), 'Responses');
    assert.equal(await page.evaluate(() => collectConnectionForm().apiFormat), 'responses');
    await page.locator('#connFormatSelect .conn-select-trigger').click();
    await page.locator('#connFormatSelect [data-conn-select-value="auto"]').click();

    // Custom defaults to the generic OpenAI preset and stays unlocked: every
    // preset lives inside our own menu, so the panel never grows a wrapping
    // pill grid that would overflow.
    assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), 'OpenAI 通用');
    assert.equal(await page.evaluate(() => collectConnectionForm().preset), 'openai');
    assert.equal(await page.locator('#connPresetSelect .conn-select-trigger').isDisabled(), false);
    await page.locator('#connPresetSelect .conn-select-trigger').click();
    assert.equal(await page.locator('#connPresetSelect .conn-select-option').count(), 22);
    fs.mkdirSync(path.join(appRoot, 'output', 'playwright'), { recursive: true });
    await page.locator('#connectionDialog').screenshot({
      path: path.join(appRoot, 'output', 'playwright', 'connection-preset-menu.png'),
      animations: 'disabled'
    });
    await page.locator('#connPresetSelect [data-conn-select-value="opencode"]').click();
    assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), 'OpenCode');
    assert.equal(await page.evaluate(() => collectConnectionForm().preset), 'opencode');
    for (const [preset, label] of [['mimo', '小米 MiMo'], ['opencode-go', 'OpenCode-Go'], ['opencode-zen', 'OpenCode-Zen']]) {
      await page.locator('#connPresetSelect .conn-select-trigger').click();
      await page.locator('#connPresetSelect [data-conn-select-value="' + preset + '"]').click();
      assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), label);
      assert.equal(await page.evaluate(() => collectConnectionForm().preset), preset);
    }
    await page.locator('#connPresetSelect .conn-select-trigger').click();
    await page.locator('#connPresetSelect [data-conn-select-value="openai"]').click();

    // Official tabs prefill Base URL + name and default to our adapter, but the
    // compatibility preset stays editable instead of being locked.
    await page.locator('#connPresetSidebar [data-conn-preset-item="deepseek"]').click();
    assert.equal(await page.locator('#connEndpointInput').inputValue(), 'https://api.deepseek.com');
    assert.equal(await page.locator('#connName').inputValue(), 'DeepSeek');
    assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), 'DeepSeek · DSML');
    assert.equal(await page.locator('#connPresetSelect .conn-select-trigger').isDisabled(), false);
    fs.mkdirSync(path.join(appRoot, 'output', 'playwright'), { recursive: true });
    await page.locator('#connectionDialog').screenshot({
      path: path.join(appRoot, 'output', 'playwright', 'connection-preset.png'),
      animations: 'disabled'
    });
    // The user can still re-point an official tab at another request shape.
    await page.locator('#connPresetSelect .conn-select-trigger').click();
    await page.locator('#connPresetSelect [data-conn-select-value="gptl"]').click();
    assert.equal(await page.evaluate(() => collectConnectionForm().preset), 'gptl');
    await page.locator('#connPresetSidebar [data-conn-preset-item="anthropic"]').click();
    assert.equal(await page.locator('#connEndpointInput').inputValue(), 'https://api.anthropic.com');
    assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), 'Anthropic · ANTL');
    fs.mkdirSync(path.join(appRoot, 'output', 'playwright'), { recursive: true });
    await page.locator('#connectionDialog').screenshot({
      path: path.join(appRoot, 'output', 'playwright', 'connection-antl.png'),
      animations: 'disabled'
    });
    // Custom clears the Base URL and falls back to the OpenAI preset.
    await page.locator('#connPresetSidebar [data-conn-preset-item="custom"]').click();
    assert.equal(await page.locator('#connEndpointInput').inputValue(), '');
    assert.equal(await page.locator('#connPresetSelect .conn-select-trigger').isDisabled(), false);
    assert.equal(await page.locator('#connPresetSelect .conn-select-value').textContent(), 'OpenAI 通用');
    assert.equal(await page.evaluate(() => collectConnectionForm().preset), 'openai');

    // A masked key hides the value from the form reader.
    await page.evaluate(() => {
      const input = document.querySelector('#connApiKey');
      input.dataset.masked = 'true';
      input.value = '••••••';
    });
    assert.equal(await page.evaluate(() => collectConnectionForm().apiKey), '');

    // One joined input is reused for base / image / video via the endpoint dropdown.
    const selectEndpoint = async value => {
      await page.locator('#connEndpointSelect .conn-select-trigger').click();
      await page.locator(`#connEndpointSelect [data-conn-select-value="${value}"]`).click();
    };
    assert.equal(await page.locator('#connEndpointSelect .conn-select-value').textContent(), 'Base URL');
    await selectEndpoint('base');
    await page.locator('#connEndpointInput').fill('https://example.com/v1');
    await selectEndpoint('image');
    assert.equal(await page.locator('#connEndpointInput').inputValue(), '');
    await page.locator('#connEndpointInput').fill('https://example.com/v1/images');
    await selectEndpoint('video');
    await page.locator('#connEndpointInput').fill('https://example.com/v1/videos');
    await selectEndpoint('base');
    assert.equal(await page.locator('#connEndpointInput').inputValue(), 'https://example.com/v1');
    await page.locator('#connName').fill('测试连接');
    await page.evaluate(() => {
      const input = document.querySelector('#connApiKey');
      input.dataset.masked = 'false';
      input.value = '';
    });
    await page.locator('#connApiKey').fill('test-key');
    assert.deepEqual(await page.evaluate(() => {
      const form = collectConnectionForm();
      return [form.name, form.baseUrl, form.imageGenerationUrl, form.imageEditUrl, form.videoGenerationUrl, form.apiKey];
    }), [
      '测试连接', 'https://example.com/v1', 'https://example.com/v1/images',
      'https://example.com/v1/images', 'https://example.com/v1/videos', 'test-key'
    ]);
    assert.equal(await page.locator('#connToggleKey').evaluate(button => getComputedStyle(button).position), 'absolute');

    await page.evaluate(() => toast('连接失败：测试', { error: true }));
    assert.equal(await page.locator('#toast').evaluate(el => el.getAttribute('popover')), 'manual');
    assert.equal(await page.locator('#toast').isVisible(), true);
    assert.equal(await page.locator('#toast').evaluate(el => el.classList.contains('toast-error')), true);
    fs.mkdirSync(path.join(appRoot, 'output', 'playwright'), { recursive: true });
    await page.screenshot({
      path: path.join(appRoot, 'output', 'playwright', 'connection-toast.png'),
      animations: 'disabled'
    });
    await page.evaluate(() => {
      const toastEl = document.querySelector('#toast');
      if (toastEl.matches(':popover-open')) toastEl.hidePopover();
    });
    assert.equal(await page.evaluate(() => formatConnectionCatalogStatus({
      apiKeyConfigured: true,
      modelCount: 2,
      supplementalModelCount: 13,
      supplementalModelLabel: 'GLM 官方补充'
    })), '2 个 API 模型 · 13 个 GLM 官方补充');

    fs.mkdirSync(path.join(appRoot, 'output', 'playwright'), { recursive: true });
    await page.locator('#connectionDialog').screenshot({
      path: path.join(appRoot, 'output', 'playwright', 'connection-form.png'),
      animations: 'disabled'
    });

    await page.evaluate(() => { void deleteConnection({ id: 'conn-test', name: '测试连接' }); });
    await page.locator('#providerConfirmModal:not(.hidden)').waitFor();
    assert.equal(await page.locator('#connectionDialog[open]').count(), 0);
    assert.equal(await page.locator('#providerConfirmModal').getAttribute('aria-hidden'), 'false');
    await page.locator('#providerConfirmCancel').click({ force: true });

    await page.locator('#connectionList .provider-add').click();
    await page.locator('#connectionDialog[open]').waitFor();
    await page.locator('#connectionDialogClose').click();

    // Editing an existing connection hides the sidebar (no cross-talk).
    await page.evaluate(() => {
      connectionCache = [{
        id: 'conn-edit', providerId: 'conn-edit', supplierId: 'official', name: '待编辑连接',
        baseUrl: 'https://api.example.com/v1', preset: 'deepseek', presetManual: true,
        apiFormat: 'auto', apiKeyConfigured: true,
        models: [{ id: 'saved-model', name: 'Saved Model' }], modelCount: 1
      }];
      void openConnectionDialog('conn-edit');
    });
    await page.locator('#connectionDialog[open]').waitFor();
    assert.equal(await page.locator('#connectionDialog').evaluate(el => el.classList.contains('is-editing')), true);
    assert.equal(await page.locator('#connectionDialog .connection-form-side').isVisible(), false);
    assert.equal(await page.locator('#connPresetSelect .conn-select-trigger').isDisabled(), true);
    assert.equal(await page.locator('#connEndpointInput').inputValue(), 'https://api.example.com/v1');
    // Model list header exposes a three-icon enable-all/refresh/custom pill.
    assert.equal(await page.locator('#connectionDialog .conn-models-head .conn-field-label').textContent(), '模型列表');
    assert.equal(await page.locator('#connectionDialog .conn-models-pill .conn-models-icon-btn').count(), 3);
    assert.equal(await page.locator('#connEndpointSelect .conn-select-trigger').count(), 1);
    // Custom icon reveals the manual model id input.
    assert.equal(await page.locator('#connManualModelRow').isHidden(), true);
    await page.locator('#connModelsCustom').click();
    assert.equal(await page.locator('#connManualModelRow').isVisible(), true);
    await page.locator('#connManualModelRow input').fill('custom-model-id');
    assert.equal(await page.evaluate(() => collectConnectionForm().manualModelId), 'custom-model-id');
    await page.locator('#connModelsCustom').click();
    assert.equal(await page.locator('#connManualModelRow').isHidden(), true);
    // The saved catalog is NOT persisted into the form; only a test result shows.
    assert.equal(await page.locator('#connModels .conn-model-row').count(), 0);
    assert.match(await page.locator('#connModels').textContent(), /点击刷新获取/);
    await page.evaluate(() => renderConnectionModels([{ id: 'live-model', name: 'Live Model', modelType: 'text' }, { id: 'live-model-2', name: 'Live Model Two', modelType: 'text' }], 2));
    assert.equal(await page.locator('#connModels .conn-model-row').count(), 2);
    const modelRows = await page.locator('#connModels .conn-model-row').evaluateAll(rows => rows.map(row => {
      const box = row.getBoundingClientRect();
      return { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
    }));
    assert.equal(modelRows[0].x, modelRows[1].x);
    assert.ok(modelRows[1].y > modelRows[0].y, 'models stack one per row');
    assert.ok(modelRows[0].height >= 56, 'model row is tall enough for the controls');
    // Each row carries a three-way capability pill and an enable switch.
    const firstModelRow = page.locator('#connModels .conn-model-row').first();
    assert.equal(await firstModelRow.locator('.conn-model-cap').count(), 3);
    assert.equal(await firstModelRow.locator('[data-model-enable]').count(), 1);
    const imageCap = firstModelRow.locator('[data-model-cap="image"]');
    assert.equal(await imageCap.getAttribute('data-state'), 'unknown');
    await imageCap.click();
    assert.equal(await imageCap.getAttribute('data-state'), 'yes');
    await imageCap.click();
    assert.equal(await imageCap.getAttribute('data-state'), 'no');
    await imageCap.click();
    assert.equal(await imageCap.getAttribute('data-state'), 'unknown');
    await firstModelRow.locator('[data-model-enable]').uncheck();
    assert.deepEqual(await page.evaluate(() => collectConnectionForm().modelFlags), { 'live-model': { enabled: false } });
    // One-click switch enables then disables every listed model.
    const toggleAll = page.locator('#connModelsToggleAll');
    assert.equal(await toggleAll.getAttribute('aria-pressed'), 'false');
    await toggleAll.click();
    assert.equal(await toggleAll.getAttribute('aria-pressed'), 'true');
    assert.deepEqual(
      await page.locator('#connModels [data-model-enable]').evaluateAll(nodes => nodes.map(node => node.checked)),
      [true, true]
    );
    await toggleAll.click();
    assert.equal(await toggleAll.getAttribute('aria-pressed'), 'false');
    assert.deepEqual(
      await page.locator('#connModels [data-model-enable]').evaluateAll(nodes => nodes.map(node => node.checked)),
      [false, false]
    );
    assert.deepEqual(await page.evaluate(() => collectConnectionForm().modelFlags), { 'live-model': { enabled: false }, 'live-model-2': { enabled: false } });
    await page.locator('#connectionDialog').screenshot({
      path: path.join(appRoot, 'output', 'playwright', 'connection-edit.png'),
      animations: 'disabled'
    });
    await page.locator('#connectionDialogClose').click();
    // Closing the form drops the transient list immediately.
    await page.locator('#connectionList .provider-add').click();
    await page.locator('#connectionDialog[open]').waitFor();
    assert.equal(await page.locator('#connModels .conn-preset-pill').count(), 0);
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
      presetTabs: presetTabCount,
      modelChoices: modelChoiceBoxes.length,
      reasoningChoices: await page.locator('#modelReasoningChoices [data-reasoning-mode]').count()
    }));
  } finally {
    await application?.close().catch(() => {});
    // Windows may still hold the Electron userData dir for a moment after close;
    // a cleanup failure must never mask the real test result.
    try {
      fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 8, retryDelay: 250 });
    } catch (cleanupError) {
      console.warn(`cleanup skipped: ${cleanupError?.message || cleanupError}`);
    }
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

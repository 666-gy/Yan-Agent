'use strict';

// Provider / connections / models IPC (plan T4.4). Moved verbatim from
// main.js; the provider, config and model-state stores arrive as deps.

const { fetchRemoteModelCatalog, normalizeRemoteModels } = require('../model-catalog');
const { getModelType, isAgentTextModel, buildMediaModelList, configuredSupplierModels, filterDesignatedMediaModels } = require('../model-roles');
const { summarizeModelCatalog } = require('../provider-model-catalog');
const {
  CONNECTION_PRESETS,
  inferConnectionPreset,
  normalizeApiFormat,
  normalizeCustomModelIds,
  normalizeModelFlags,
  connectionModelFlagsFor,
  applyConnectionModelFlags,
  resolveConnectionApiFormat,
  resolveConnectionPreset
} = require('../connection-presets');

function registerProviderIpc(ctx, deps) {
  const { ipcMain } = ctx;
  const {
    MODEL_PROVIDERS,
    providerConfig,
    configStore,
    modelState,
    EMPTY_MEDIA_CAPABILITIES,
    PROVIDER_MEDIA_CAPABILITIES,
    PROVIDER_MEDIA_ADAPTERS,
    STATIC_PROVIDER_SUPPLEMENTAL_MODELS
  } = deps;

  ipcMain.handle('providers:list', () => {
    const cfg = configStore.loadConfig();
    const list = [];
    for (const id of Object.keys(MODEL_PROVIDERS)) {
      const p = MODEL_PROVIDERS[id];
      const configuredSuppliers = providerConfig.getProviderSuppliers(cfg, p.id)
        .filter(supplier => providerConfig.isConfiguredSupplier(cfg, p.id, supplier));
      const models = providerConfig.mergeProviderModelCatalog(
        ...configuredSuppliers.map(supplier => providerConfig.getProviderSupplierCatalog(p.id, supplier))
      );
      const officialMediaCapabilities = PROVIDER_MEDIA_CAPABILITIES[providerConfig.providerMediaPresetId(p)] || EMPTY_MEDIA_CAPABILITIES;
      const mediaAdapter = PROVIDER_MEDIA_ADAPTERS[providerConfig.providerMediaPresetId(p)] || EMPTY_MEDIA_CAPABILITIES;
      const hasImageModel = models.some(model => getModelType(p.id, model) === 'image');
      const hasVideoModel = models.some(model => getModelType(p.id, model) === 'video');
      const mediaCapabilities = {
        imageGeneration: mediaAdapter.imageGeneration && hasImageModel,
        imageEditing: mediaAdapter.imageEditing && hasImageModel,
        videoGeneration: mediaAdapter.videoGeneration && hasVideoModel
      };
      const connection = providerConfig.getProviderConnection(cfg, id);
      const activeSupplierId = String(cfg.api.providerActiveSupplierIds?.[id] || 'official');
      const suppliers = providerConfig.getProviderSuppliers(cfg, id).map(supplier => {
        const catalogModels = providerConfig.getProviderSupplierCatalog(id, supplier);
        // A bundled catalog describes what the provider supports, not what the
        // current supplier can use. Expose it as available only after the
        // supplier has credentials; dynamic providers still use their fetched
        // catalog after configuration.
        const supplierConfigured = providerConfig.isConfiguredSupplier(cfg, id, supplier);
        const supplierModels = configuredSupplierModels(catalogModels, supplierConfigured);
        const supplierHasImage = supplierModels.some(model => getModelType(id, model) === 'image');
        const supplierHasVideo = supplierModels.some(model => getModelType(id, model) === 'video');
        return {
          id: supplier.id,
          name: supplier.name,
          kind: supplier.kind,
          baseUrl: supplier.baseUrl,
          imageGenerationUrl: supplier.imageGenerationUrl,
          imageEditUrl: supplier.imageEditUrl,
          videoGenerationUrl: supplier.videoGenerationUrl,
          workspaceId: supplier.workspaceId,
          apiKeyPlaceholder: p.apiKeyPlaceholder,
          apiKeyConfigured: supplierConfigured,
          modelCount: supplierModels.length,
          models: supplierModels.map(model => ({
            id: model.id,
            name: model.name || model.id,
            modelType: getModelType(id, model),
            capabilities: model.capabilities || {}
          })),
          mediaCapabilities: {
            imageGeneration: mediaAdapter.imageGeneration && supplierHasImage,
            imageEditing: mediaAdapter.imageEditing && supplierHasImage,
            videoGeneration: mediaAdapter.videoGeneration && supplierHasVideo
          }
        };
      });
      list.push({
        id: p.id,
        name: p.name,
        baseUrl: connection.baseUrl,
        defaultBaseUrl: p.baseUrl,
        imageGenerationUrl: connection.imageGenerationUrl,
        imageEditUrl: connection.imageEditUrl,
        videoGenerationUrl: connection.videoGenerationUrl,
        workspaceId: connection.workspaceId,
        apiKeyPlaceholder: p.apiKeyPlaceholder,
        modelCount: models.length,
        dynamicModels: !!p.dynamicModels,
        custom: !!p.custom,
        apiFormat: p.apiFormat || '',
        ...(p.custom ? {
          modelId: String(cfg.customModel?.modelId || '').trim(),
          modelName: String(cfg.customModel?.modelName || '').trim()
        } : {}),
        configured: suppliers.some(supplier => supplier.apiKeyConfigured),
        activeSupplierId,
        suppliers,
        officialMediaCapabilities: { ...officialMediaCapabilities },
        mediaCapabilities: { ...mediaCapabilities },
        mediaAdapterReady: Object.values(mediaAdapter).some(Boolean)
      });
    }
    return list;
  });

  async function refreshConfiguredProviderModelCache(providerId) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider?.dynamicModels) return { ok: false, skipped: true };
    const before = configStore.loadConfig();
    const connection = providerConfig.getProviderConnection(before, providerId);
    if (!connection.apiKey || !connection.baseUrl) return { ok: false, skipped: true };
    const models = await fetchRemoteModelCatalog({
      baseUrl: connection.baseUrl,
      apiKey: connection.apiKey,
      apiFormat: provider.apiFormat === 'anthropic' ? 'anthropic' : 'openai'
    });
    const cfg = configStore.loadConfig();
    const current = providerConfig.getProviderConnection(cfg, providerId);
    if (current.apiKey !== connection.apiKey || current.baseUrl !== connection.baseUrl) {
      return { ok: false, skipped: true };
    }
    if (!cfg.providerModels) cfg.providerModels = {};
    const activeSupplier = providerConfig.getActiveProviderSupplier(cfg, providerId);
    if (activeSupplier) {
      activeSupplier.models = models;
      providerConfig.syncActiveProviderSupplier(cfg, providerId, activeSupplier);
    }
    cfg.providerModels[providerId] = models;
    if (cfg.api.provider === providerId) {
      cfg.models = providerConfig.getProviderModels(cfg, providerId);
      if (!cfg.models.some(model => model.id === cfg.api.model && getModelType(providerId, model) === 'text')) {
        cfg.api.model = modelState.getFirstTextModel(providerId, cfg.models)?.id || '';
      }
    }
    modelState.normalizeAgentModelSelection(cfg);
    modelState.updateImageGenerationConfig(cfg);
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return { ok: true, modelCount: models.length };
  }
  ipcMain.handle('provider:get-secret', (_e, { providerId, supplierId } = {}) => {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return { error: '未知厂商: ' + providerId };
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const id = String(supplierId || cfg.api.providerActiveSupplierIds?.[providerId] || 'official');
    const supplier = providerConfig.getProviderSuppliers(cfg, providerId).find(item => item.id === id);
    if (!supplier) return { error: '供应商不存在' };
    return { ok: true, apiKey: String(supplier.apiKey || '') };
  });

  ipcMain.handle('provider:add-supplier', (_e, { providerId, name } = {}) => {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider || provider.custom) return { error: '未知厂商或暂不支持自定义厂商多供应商' };
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const suppliers = cfg.api.providerSuppliers[providerId] || [];
    const baseName = String(name || '新供应商').trim() || '新供应商';
    let id = `supplier-${Date.now().toString(36)}`;
    let seq = 2;
    while (suppliers.some(item => item.id === id)) id = `supplier-${Date.now().toString(36)}-${seq++}`;
    const supplier = providerConfig.normalizeProviderSupplier({
      id,
      name: baseName,
      kind: 'custom',
      baseUrl: provider.baseUrl,
      models: provider.dynamicModels ? [] : provider.models
    }, provider);
    suppliers.push(supplier);
    cfg.api.providerSuppliers[providerId] = suppliers;
    configStore.saveConfig(cfg);
    return { ok: true, providerId, supplierId: id, config: configStore.publicConfig(cfg) };
  });

  ipcMain.handle('provider:set-supplier', (_e, { providerId, supplierId } = {}) => {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return { error: '未知厂商: ' + providerId };
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const supplier = providerConfig.getProviderSuppliers(cfg, providerId).find(item => item.id === String(supplierId || ''));
    if (!supplier) return { error: '供应商不存在' };
    if (!String(supplier.apiKey || '').trim()) return { error: '请先配置 API Key，再启用此连接' };
    providerConfig.syncActiveProviderSupplier(cfg, providerId, supplier);
    cfg.api.provider = providerId;
    cfg.api.baseUrl = supplier.baseUrl;
    cfg.api.apiKey = supplier.apiKey;
    cfg.models = providerConfig.getProviderModels(cfg, providerId, supplier.id);
    const selectedModel = modelState.getFirstTextModel(providerId, cfg.models);
    cfg.api.model = selectedModel?.id || '';
    cfg.agentModel = selectedModel
      ? {
          providerId,
          supplierId: supplier.id,
          modelId: selectedModel.id,
          modelType: 'text',
          name: selectedModel.name || selectedModel.id,
          capabilities: selectedModel.capabilities || {}
        }
      : {
          providerId,
          supplierId: supplier.id,
          modelId: '',
          modelType: 'text',
          name: '',
          capabilities: {}
        };
    modelState.updateImageGenerationConfig(cfg);
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return { ok: true, config: configStore.publicConfig(cfg) };
  });

  ipcMain.handle('provider:delete-supplier', (_e, { providerId, supplierId } = {}) => {
    const provider = MODEL_PROVIDERS[providerId];
    const id = String(supplierId || '').trim();
    if (!provider) return { error: '未知厂商: ' + providerId };
    if (!id || id === 'official') return { error: '官方供应商不可删除' };
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const suppliers = cfg.api.providerSuppliers[providerId] || [];
    if (!suppliers.some(item => item.id === id)) return { error: '供应商不存在' };
    cfg.api.providerSuppliers[providerId] = suppliers.filter(item => item.id !== id);
    providerConfig.rebindRolesAfterSupplierRemoval(cfg, providerId, id);
    if (cfg.api.providerActiveSupplierIds[providerId] === id) {
      const fallback = cfg.api.providerSuppliers[providerId].find(item => item.id === 'official')
        || cfg.api.providerSuppliers[providerId][0];
      providerConfig.syncActiveProviderSupplier(cfg, providerId, fallback);
      if (cfg.agentModel?.providerId === providerId) {
        cfg.api.provider = providerId;
        cfg.api.baseUrl = fallback.baseUrl;
        cfg.api.apiKey = fallback.apiKey;
        cfg.models = providerConfig.getProviderModels(cfg, providerId, fallback.id);
        cfg.api.model = modelState.getFirstTextModel(providerId, cfg.models)?.id || '';
      }
    }
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return { ok: true, config: configStore.publicConfig(cfg) };
  });

  async function applyProviderConfiguration({
    providerId,
    supplierId,
    supplierName,
    apiKey,
    baseUrl,
    imageGenerationUrl,
    imageEditUrl,
    videoGenerationUrl,
    workspaceId,
    providerName,
    modelId,
    modelName,
    apiFormat
  } = {}) {
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return { error: '未知厂商: ' + providerId };
    let key = String(apiKey || '').trim();
    const nextBaseUrl = String(baseUrl || provider.baseUrl).trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(nextBaseUrl)) return { error: 'Base URL 必须以 http:// 或 https:// 开头' };
    const nextImageGenerationUrl = String(imageGenerationUrl || '').trim();
    const nextImageEditUrl = String(imageEditUrl || '').trim();
    const nextVideoGenerationUrl = String(videoGenerationUrl || '').trim();
    if ((nextImageGenerationUrl && !/^https?:\/\//i.test(nextImageGenerationUrl))
      || (nextImageEditUrl && !/^https?:\/\//i.test(nextImageEditUrl))
      || (nextVideoGenerationUrl && !/^https?:\/\//i.test(nextVideoGenerationUrl))) {
      return { error: '图片/视频 POST URL 必须以 http:// 或 https:// 开头' };
    }
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const previousAgent = modelState.normalizeAgentModelSelection(cfg);
    const previousAgentConnection = providerConfig.getProviderConnectionForSupplier(
      cfg,
      previousAgent.providerId,
      previousAgent.supplierId
    );
    const selectedSupplierId = String(supplierId || cfg.api.providerActiveSupplierIds?.[providerId] || 'official').trim();
    const suppliers = cfg.api.providerSuppliers[providerId] || [];
    let supplier = suppliers.find(item => item.id === selectedSupplierId);
    if (!supplier) return { error: '供应商不存在' };
    // The UI intentionally does not echo stored secrets back into the form.
    // An empty key therefore means "keep the existing key" while the explicit
    // clear action remains available through provider:remove-config.
    if (!key && supplier.apiKey) key = supplier.apiKey;
    const effectiveApiFormat = normalizeApiFormat(apiFormat || provider.apiFormat || 'openai');
    const catalogApiFormat = effectiveApiFormat === 'anthropic' ? 'anthropic' : 'openai';
    let models = provider.models;
    const previousSupplierModels = Array.isArray(supplier.models) ? supplier.models : [];
    if (provider.dynamicModels) {
      if (!key) {
        models = Array.isArray(supplier.models) ? supplier.models : [];
      } else {
        try {
          models = await fetchRemoteModelCatalog({ baseUrl: nextBaseUrl, apiKey: key, apiFormat: catalogApiFormat });
        } catch (error) {
          // A connection can legitimately fail to list models (relay without a
          // catalog endpoint) while still having custom models or a previous
          // catalog. Keep those instead of blocking the save.
          const hasStored = Array.isArray(supplier.models) && supplier.models.length > 0;
          const hasCustom = Array.isArray(provider.models) && provider.models.length > 0;
          if (!hasStored && !hasCustom) return { error: `模型列表同步失败：${error.message}` };
          models = hasStored ? supplier.models : [];
        }
      }
    }
    supplier = providerConfig.normalizeProviderSupplier({
      ...supplier,
      id: selectedSupplierId,
      name: String(supplierName || supplier.name || (selectedSupplierId === 'official' ? '官方' : '新供应商')).trim(),
      baseUrl: nextBaseUrl,
      apiKey: key,
      imageGenerationUrl: nextImageGenerationUrl,
      imageEditUrl: nextImageEditUrl,
      videoGenerationUrl: nextVideoGenerationUrl,
      workspaceId: providerId === 'qwen' ? String(workspaceId || '').trim() : ''
    }, provider, selectedSupplierId);
    supplier.models = normalizeRemoteModels(models);
    // A refreshed connection catalog starts with every newly discovered model
    // disabled: the user opts models in instead of the refresh enabling them all.
    if (provider.dynamicModels && providerId.startsWith('conn-')) {
      const connection = (cfg.api.connections || []).find(item => item.providerId === providerId);
      if (connection) {
        const knownIds = new Set(previousSupplierModels.map(model => String(model?.id || '')).filter(Boolean));
        if (!connection.modelFlags || typeof connection.modelFlags !== 'object') connection.modelFlags = {};
        for (const model of supplier.models) {
          const id = String(model?.id || '');
          if (!id || knownIds.has(id)) continue;
          const entry = connection.modelFlags[id];
          if (entry && Object.prototype.hasOwnProperty.call(entry, 'enabled')) continue;
          connection.modelFlags[id] = { ...(entry || {}), enabled: false };
        }
      }
    }
    cfg.api.providerSuppliers[providerId] = suppliers.map(item => item.id === selectedSupplierId ? supplier : item);
    cfg.api.providerActiveSupplierIds[providerId] = selectedSupplierId;
    providerConfig.syncActiveProviderSupplier(cfg, providerId, supplier);
    if (providerId.startsWith('conn-')) {
      // Keep the dynamic registry entry (name/preset/manual model) in sync with
      // the supplier the connection just wrote.
      const connection = (cfg.api.connections || []).find(item => item.providerId === providerId);
      if (connection) {
        // customModels are authored in connections:save; keep the enabled set
        // additive so a saved connection is usable immediately.
        if (!Array.isArray(cfg.api.enabledConnections)) cfg.api.enabledConnections = [];
        if (!cfg.api.enabledConnections.includes(connection.id)) cfg.api.enabledConnections.push(connection.id);
      }
      providerConfig.syncConnectionProviders(cfg);
    }
    if (!cfg.providerModels) cfg.providerModels = {};
    if (provider.dynamicModels) cfg.providerModels[providerId] = models;
    const keepExistingAgent = !!(
      previousAgent.providerId
      && previousAgent.modelId
      && previousAgentConnection.apiKey
    );
    if (keepExistingAgent) {
      const previousModels = providerConfig.getProviderModels(cfg, previousAgent.providerId, previousAgent.supplierId);
      const previousModel = previousModels.find(model => model.id === previousAgent.modelId && getModelType(previousAgent.providerId, model) === 'text');
      if (previousModel) {
        const connection = providerConfig.getProviderConnectionForSupplier(cfg, previousAgent.providerId, previousAgent.supplierId);
        if (previousAgent.providerId === providerId && previousAgent.supplierId) {
          cfg.api.providerActiveSupplierIds[providerId] = previousAgent.supplierId;
        }
        cfg.api.provider = previousAgent.providerId;
        cfg.api.baseUrl = connection.baseUrl;
        cfg.api.apiKey = connection.apiKey;
        cfg.api.model = previousModel.id;
        cfg.models = previousModels;
      } else {
        modelState.applyProviderSelection(cfg, providerId, key, selectedSupplierId);
      }
    } else {
      modelState.applyProviderSelection(cfg, providerId, key, selectedSupplierId);
    }
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return {
      ok: true,
      config: configStore.publicConfig(cfg),
      providerId,
      supplierId: selectedSupplierId,
      modelCount: providerConfig.getProviderModels(cfg, providerId, selectedSupplierId).length
    };
  }

  ipcMain.handle('provider:configure', (_e, payload = {}) => applyProviderConfiguration(payload));

  ipcMain.handle('provider:remove-config', (_e, payload) => {
    const providerId = typeof payload === 'string' ? payload : String(payload?.providerId || '');
    const requestedSupplierId = typeof payload === 'object' ? String(payload?.supplierId || '').trim() : '';
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return { error: '未知厂商: ' + providerId };

    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const activeSupplier = requestedSupplierId
      ? providerConfig.getProviderSuppliers(cfg, providerId).find(item => item.id === requestedSupplierId)
      : providerConfig.getActiveProviderSupplier(cfg, providerId);
    if (requestedSupplierId && !activeSupplier) return { error: '供应商不存在' };
    if (activeSupplier) {
      const clearedSupplierId = activeSupplier.id;
      activeSupplier.apiKey = '';
      activeSupplier.models = [];
      activeSupplier.imageGenerationUrl = '';
      activeSupplier.imageEditUrl = '';
      activeSupplier.videoGenerationUrl = '';
      providerConfig.syncActiveProviderSupplier(cfg, providerId, activeSupplier);
      providerConfig.rebindRolesAfterSupplierRemoval(cfg, providerId, clearedSupplierId);
      if (provider.custom && cfg.customModel) {
        cfg.customModel.apiKey = '';
        cfg.customModel.baseUrl = '';
        cfg.customModel.modelId = '';
        cfg.customModel.modelName = '';
        cfg.customModel.models = [];
        cfg.customProviders = [cfg.customModel];
      }
    } else {
      cfg.api.providerConfigs[providerId] = providerConfig.normalizeProviderConfig({}, provider);
      cfg.api.apiKeys[providerId] = '';
    }
    if (!cfg.providerModels) cfg.providerModels = {};
    if (provider.dynamicModels) cfg.providerModels[providerId] = [];
    if (cfg.agentModel?.providerId && cfg.agentModel?.modelId) {
      const agentConnection = providerConfig.getProviderConnectionForSupplier(
        cfg,
        cfg.agentModel.providerId,
        cfg.agentModel.supplierId
      );
      cfg.api.provider = cfg.agentModel.providerId;
      cfg.api.baseUrl = agentConnection.baseUrl;
      cfg.api.apiKey = agentConnection.apiKey;
      cfg.api.model = cfg.agentModel.modelId;
      cfg.models = providerConfig.getProviderModels(cfg, cfg.agentModel.providerId, cfg.agentModel.supplierId);
    } else {
      cfg.api.model = '';
      cfg.models = [];
    }

    modelState.updateImageGenerationConfig(cfg);
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return { ok: true, config: configStore.publicConfig(cfg) };
  });

  // ---------------------------------------------------------------------------
  // IPC: user-defined connections (the flat API configuration surface)
  // ---------------------------------------------------------------------------
  function connectionSummary(cfg, connection) {    const supplier = providerConfig.getProviderSupplier(cfg, connection.providerId, connection.supplierId);
    if (!supplier) return null;
    const name = String(supplier.name || '连接').trim() || '连接';
    const preset = connection.providerId.startsWith('conn-')
      ? resolveConnectionPreset(connection, name, supplier.baseUrl)
      : connection.providerId;
    const provider = MODEL_PROVIDERS[connection.providerId];
    const catalog = summarizeModelCatalog(
      providerConfig.getProviderSupplierApiCatalog(connection.providerId, supplier),
      STATIC_PROVIDER_SUPPLEMENTAL_MODELS[providerConfig.providerMediaPresetId(provider)] || []
    );
    return {
      id: connection.id,
      providerId: connection.providerId,
      supplierId: supplier.id,
      name,
      baseUrl: supplier.baseUrl || '',
      apiKeyConfigured: !!String(supplier.apiKey || '').trim(),
      imageGenerationUrl: supplier.imageGenerationUrl || '',
      imageEditUrl: supplier.imageEditUrl || '',
      videoGenerationUrl: supplier.videoGenerationUrl || '',
      preset,
      presetManual: connection.preset && connection.preset !== 'auto',
      apiFormat: resolveConnectionApiFormat(connection, name, supplier.baseUrl),
      manualModelId: String(connection.manualModelId || '').trim(),
      customModels: normalizeCustomModelIds(connection.customModels),
      modelCount: catalog.modelCount,
      supplementalModelCount: catalog.supplementalModelCount,
      supplementalModelLabel: preset === 'glm' ? 'GLM 官方补充' : '官方补充',
      totalModelCount: catalog.totalModelCount,
      models: applyConnectionModelFlags(
        connection.modelFlags,
        catalog.apiModels,
        providerConfig.providerCapabilityPresetId(provider)
      ).map(model => ({
        id: model.id,
        name: model.name || model.id,
        modelType: getModelType(connection.providerId, model),
        source: model.source === 'custom' ? 'custom' : ''
      })),
      modelFlags: connection.modelFlags && typeof connection.modelFlags === 'object' ? connection.modelFlags : {},
      isCurrentText: cfg.agentModel?.providerId === connection.providerId
        && cfg.agentModel?.supplierId === supplier.id,
      isEnabled: providerConfig.isConnectionEnabled(cfg, connection),
      logoProviderId: connection.providerId.startsWith('conn-') ? '' : connection.providerId,
      createdAt: Number(connection.createdAt) || 0
    };
  }

  ipcMain.handle('connections:list', () => {
    const cfg = configStore.loadConfig();
    return (cfg.api.connections || [])
      .map(connection => connectionSummary(cfg, connection))
      .filter(Boolean)
      .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0));
  });

  ipcMain.handle('connections:test', async (_e, { baseUrl, apiKey, preset, apiFormat: requestedFormat } = {}) => {
    const url = String(baseUrl || '').trim().replace(/\/$/, '');
    if (!/^https?:\/\//i.test(url)) return { ok: false, error: 'Base URL 必须以 http:// 或 https:// 开头' };
    const key = String(apiKey || '').trim();
    if (!key) return { ok: false, error: '请填写 API Key 后再测试' };
    const requestedPreset = String(preset || 'auto').trim().toLowerCase();
    const capabilityPreset = requestedPreset === 'auto'
      ? inferConnectionPreset('', url)
      : (CONNECTION_PRESETS.includes(requestedPreset) ? requestedPreset : 'openai');
    const explicitFormat = normalizeApiFormat(requestedFormat);
    const apiFormat = resolveConnectionApiFormat({ preset: capabilityPreset, apiFormat: explicitFormat }, '', url);
    const catalogApiFormat = apiFormat === 'anthropic' ? 'anthropic' : 'openai';
    try {
      const catalog = await fetchRemoteModelCatalog({ baseUrl: url, apiKey: key, apiFormat: catalogApiFormat });
      const models = normalizeRemoteModels(catalog);
      return {
        ok: true,
        modelCount: models.length,
        models: models.map(model => ({
          id: model.id,
          name: model.name || model.id,
          modelType: getModelType(capabilityPreset, model)
        }))
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('connections:set-enabled', (_e, { id, enabled } = {}) => {
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const result = providerConfig.setConnectionEnabled(cfg, id, enabled === true);
    if (result?.error) return { error: result.error };
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return { ok: true, config: configStore.publicConfig(cfg) };
  });

  ipcMain.handle('connections:save', async (_e, payload = {}) => {
    const name = String(payload.name || '').trim() || '新连接';
    const preset = CONNECTION_PRESETS.includes(String(payload.preset || 'auto'))
      ? String(payload.preset)
      : 'auto';
    const manualModelId = String(payload.manualModelId || '').trim();
    const customModels = normalizeCustomModelIds([
      ...(Array.isArray(payload.customModels) ? payload.customModels : []),
      ...(manualModelId ? [manualModelId] : [])
    ]);
    const modelFlags = normalizeModelFlags(payload.modelFlags);
    const apiFormat = normalizeApiFormat(payload.apiFormat);
    const existingId = String(payload.id || '').trim();
    let cfg = configStore.loadConfig();
    if (!Array.isArray(cfg.api.connections)) cfg.api.connections = [];
    let connection = providerConfig.findConnection(cfg, existingId);
    let created = false;
    if (!connection) {
      const providerId = providerConfig.newConnectionId();
      connection = {
        id: providerId,
        providerId,
        supplierId: 'official',
        preset,
        apiFormat,
        manualModelId,
        customModels,
        modelFlags,
        createdAt: Date.now()
      };
      cfg.api.connections.push(connection);
      cfg.api.providerSuppliers[providerId] = [{
        id: 'official',
        name,
        kind: 'official',
        baseUrl: '',
        apiKey: '',
        imageGenerationUrl: '',
        imageEditUrl: '',
        videoGenerationUrl: '',
        workspaceId: '',
        models: []
      }];
      cfg.api.providerActiveSupplierIds[providerId] = 'official';
      created = true;
    }
    connection.preset = preset;
    connection.apiFormat = apiFormat;
    connection.manualModelId = customModels[0] || '';
    connection.customModels = customModels;
    connection.modelFlags = modelFlags;
    const supplier = cfg.api.providerSuppliers[connection.providerId]?.find(item => item.id === connection.supplierId);
    if (supplier) supplier.name = name;
    providerConfig.syncConnectionProviders(cfg);
    configStore.saveConfig(cfg);

    const result = await applyProviderConfiguration({
      providerId: connection.providerId,
      supplierId: connection.supplierId,
      supplierName: name,
      apiKey: payload.apiKey,
      baseUrl: payload.baseUrl,
      imageGenerationUrl: payload.imageGenerationUrl,
      imageEditUrl: payload.imageEditUrl,
      videoGenerationUrl: payload.videoGenerationUrl,
      providerName: name,
      modelId: manualModelId || undefined,
      modelName: manualModelId || undefined,
      apiFormat: resolveConnectionApiFormat(connection, name, String(payload.baseUrl || ''))
    });
    if (!result?.ok && created) {
      // A brand-new connection that cannot be validated is rolled back so the
      // list never shows a half-configured ghost entry.
      const rollback = configStore.loadConfig();
      rollback.api.connections = (rollback.api.connections || []).filter(item => item.id !== connection.id);
      delete rollback.api.providerSuppliers[connection.providerId];
      delete rollback.api.providerActiveSupplierIds?.[connection.providerId];
      delete rollback.api.providerConfigs?.[connection.providerId];
      delete rollback.api.apiKeys?.[connection.providerId];
      delete rollback.providerModels?.[connection.providerId];
      delete MODEL_PROVIDERS[connection.providerId];
      configStore.saveConfig(rollback);
      return result;
    }
    if (!result?.ok) return result;
    const finalConfig = result.config;
    const summary = connectionSummary(finalConfig, connection);
    return {
      ok: true,
      modelCount: summary?.modelCount || 0,
      supplementalModelCount: summary?.supplementalModelCount || 0,
      totalModelCount: summary?.totalModelCount || 0,
      connection: summary
    };
  });

  ipcMain.handle('connections:delete', (_e, { id } = {}) => {
    const cfg = configStore.loadConfig();
    const connection = providerConfig.findConnection(cfg, id);
    if (!connection) return { error: '连接不存在' };
    const { providerId, supplierId } = connection;
    cfg.api.connections = cfg.api.connections.filter(item => item.id !== connection.id);
    if (providerId.startsWith('conn-')) {
      delete cfg.api.providerSuppliers[providerId];
      delete cfg.api.providerActiveSupplierIds?.[providerId];
      delete cfg.api.providerConfigs?.[providerId];
      delete cfg.api.apiKeys?.[providerId];
      delete cfg.providerModels?.[providerId];
      delete MODEL_PROVIDERS[providerId];
      if (cfg.agentModel?.providerId === providerId) {
        cfg.agentModel = { ...cfg.agentModel, providerId: '', supplierId: '', modelId: '', name: '' };
      }
      for (const role of ['image', 'video']) {
        if (cfg.media?.[`${role}Provider`] === providerId) {
          cfg.media[`${role}Provider`] = '';
          cfg.media[`${role}SupplierId`] = '';
          cfg.media[`${role}Model`] = '';
          cfg.media[`${role}Name`] = '';
        }
      }
    } else if (supplierId === 'official') {
      const supplier = providerConfig.getProviderSupplier(cfg, providerId, supplierId);
      if (supplier) {
        supplier.apiKey = '';
        supplier.models = [];
        supplier.imageGenerationUrl = '';
        supplier.imageEditUrl = '';
        supplier.videoGenerationUrl = '';
        providerConfig.syncActiveProviderSupplier(cfg, providerId, supplier);
        providerConfig.rebindRolesAfterSupplierRemoval(cfg, providerId, supplierId);
      }
    } else {
      cfg.api.providerSuppliers[providerId] = (cfg.api.providerSuppliers[providerId] || [])
        .filter(item => item.id !== supplierId);
      if (cfg.api.providerActiveSupplierIds?.[providerId] === supplierId) {
        cfg.api.providerActiveSupplierIds[providerId] = 'official';
      }
      providerConfig.rebindRolesAfterSupplierRemoval(cfg, providerId, supplierId);
    }
    if (cfg.agentModel?.providerId && cfg.agentModel?.modelId) {
      const agentConnection = providerConfig.getProviderConnectionForSupplier(cfg, cfg.agentModel.providerId, cfg.agentModel.supplierId);
      cfg.api.provider = cfg.agentModel.providerId;
      cfg.api.baseUrl = agentConnection.baseUrl;
      cfg.api.apiKey = agentConnection.apiKey;
      cfg.api.model = cfg.agentModel.modelId;
      cfg.models = providerConfig.getProviderModels(cfg, cfg.agentModel.providerId, cfg.agentModel.supplierId);
    }
    modelState.normalizeAgentModelSelection(cfg);
    modelState.updateImageGenerationConfig(cfg);
    configStore.saveConfig(cfg);
    modelState.publishModelState(cfg);
    return { ok: true };
  });

  ipcMain.handle('models:main-list', () => {
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const enabledConnections = providerConfig.getEnabledConnections(cfg);
    const models = [];
    // The user's explicit per-model marks win over the catalog classification,
    // exactly like the connection editor: a model marked 支持生图/支持生视频 is
    // never a primary text model.
    const effectiveModelType = (connection, model) => {
      const entry = connection.modelFlags?.[model.id];
      if (entry?.video === true) return 'video';
      if (entry?.image === true) return 'image';
      if (entry?.video === false || entry?.image === false) return 'text';
      return getModelType(connection.providerId, model);
    };
    for (const connection of enabledConnections) {
      const supplier = providerConfig.getProviderSupplier(cfg, connection.providerId, connection.supplierId);
      if (!supplier) continue;
      const provider = MODEL_PROVIDERS[connection.providerId];
      const catalog = providerConfig.getProviderSupplierCatalog(connection.providerId, supplier);
      for (const model of catalog) {
        if (connection.modelFlags?.[model.id]?.enabled === false) continue;
        // Main models are text models only: a model the user marked as image or
        // video generation can never be a primary text model.
        if (effectiveModelType(connection, model) !== 'text') continue;
        if (!isAgentTextModel(connection.providerId, model)) continue;
        models.push({
          providerId: connection.providerId,
          providerName: provider?.name || connection.providerId,
          supplierId: supplier.id,
          supplierName: supplier.name || supplier.id,
          id: model.id,
          name: model.name || model.id,
          modelType: 'text',
          source: model.source || 'api',
          capabilities: model.capabilities || {}
        });
      }
    }
    const current = modelState.normalizeAgentModelSelection(cfg);
    return {
      models,
      current: {
        providerId: current.providerId,
        supplierId: current.supplierId,
        modelId: current.modelId
      },
      enabledCount: enabledConnections.length,
      notice: models.length ? '' : '请先在设置 → 服务商配置中启用一个包含文本模型的连接。'
    };
  });

  ipcMain.handle('models:quick-list', () => {
    const cfg = configStore.loadConfig();
    providerConfig.ensureProviderConfigs(cfg);
    const activeSelection = modelState.normalizeAgentModelSelection(cfg);
    const activeProviderId = String(cfg.api.provider || activeSelection.providerId || '');
    const activeSupplierId = String(cfg.api.providerActiveSupplierIds?.[activeProviderId] || activeSelection.supplierId || '');

    const buildEntry = connection => {
      const supplier = providerConfig.getProviderSupplier(cfg, connection.providerId, connection.supplierId);
      if (!supplier) return null;
      const models = applyConnectionModelFlags(
        connection.modelFlags,
        configuredSupplierModels(providerConfig.getProviderSupplierCatalog(connection.providerId, supplier), true),
        providerConfig.providerCapabilityPresetId(MODEL_PROVIDERS[connection.providerId])
      )
        .filter(model => model.enabled !== false)
        .map(model => ({
          ...model,
          providerId: connection.providerId,
          providerName: MODEL_PROVIDERS[connection.providerId]?.name || connection.providerId,
          supplierId: supplier.id,
          supplierName: supplier.name || supplier.id,
          // The renderer groups quick-picker entries by the public top-level
          // modelType. Dynamic connection catalogs also keep the richer
          // capability object, but must expose this field explicitly.
          modelType: getModelType(connection.providerId, model)
        }));
      return { connection, supplier, models };
    };

    // Several providers can be enabled at once, so the composer picker offers
    // the text models of every enabled connection, not just the active one.
    const entries = [];
    for (const connection of providerConfig.getEnabledConnections(cfg)) {
      const entry = buildEntry(connection);
      if (entry) entries.push(entry);
    }
    if (!entries.length) {
      // Legacy fallback: before any explicit enable, keep the active supplier
      // visible so the picker is never empty for existing installs.
      const connections = Array.isArray(cfg.api.connections) ? cfg.api.connections : [];
      const activeConnection = connections.find(connection => connection.providerId === activeProviderId
        && String(connection.supplierId || 'official') === (activeSupplierId || 'official'))
        || connections.find(connection => connection.providerId === activeProviderId);
      if (activeConnection) {
        const entry = buildEntry(activeConnection);
        if (entry) entries.push(entry);
      }
    }

    const providers = [];
    const models = [];
    for (const entry of entries) {
      const providerId = entry.connection.providerId;
      let provider = providers.find(item => item.providerId === providerId);
      if (!provider) {
        provider = {
          providerId,
          providerName: MODEL_PROVIDERS[providerId]?.name || providerId,
          suppliers: []
        };
        providers.push(provider);
      }
      const isActive = providerId === activeSelection.providerId
        && entry.supplier.id === activeSelection.supplierId;
      provider.suppliers.push({
        supplierId: entry.supplier.id,
        supplierName: entry.supplier.name || entry.supplier.id,
        configured: true,
        active: isActive,
        selected: isActive,
        models: entry.models
      });
      models.push(...entry.models);
    }

    // Keep role-specific media selections visible even when their supplier is
    // different from the text-model browsing cursor. This prevents the image
    // and video sections in settings from appearing to lose a configured model.
    for (const role of ['image', 'video']) {
      const roleProviderId = String(cfg.media?.[`${role}Provider`] || '');
      const roleSupplierId = String(cfg.media?.[`${role}SupplierId`] || '');
      if (!roleProviderId || !roleSupplierId) continue;
      const provider = providers.find(item => item.providerId === roleProviderId);
      const supplier = provider?.suppliers?.find(item => item.supplierId === roleSupplierId);
      for (const model of supplier?.models || []) {
        if (model.modelType !== role) continue;
        if (!models.some(item => item.providerId === model.providerId && item.supplierId === model.supplierId && item.id === model.id)) {
          models.push(model);
        }
      }
    }

    const providerCount = providers.length;
    const hasTextModel = models.some(model => model.modelType === 'text');
    return {
      models,
      providers,
      activeProviderId,
      activeSupplierId,
      providerCount,
      providerName: hasTextModel ? `已启用 ${providerCount} 家厂商` : '尚未启用文本模型',
      notice: hasTextModel ? '' : '请先在设置 → 服务商配置中启用一个包含文本模型的连接。'
    };
  });
  ipcMain.handle('models:media-list', () => {
    const cfg = configStore.loadConfig();
    const providers = Object.values(MODEL_PROVIDERS).flatMap(provider => {
      const adapter = PROVIDER_MEDIA_ADAPTERS[providerConfig.providerMediaPresetId(provider)] || EMPTY_MEDIA_CAPABILITIES;
      const flags = connectionModelFlagsFor(cfg, provider.id);
      // A connection can resolve to a preset whose media adapter table has no
      // entry (for example a relay saved under a text-only vendor preset). The
      // user's explicit 支持生图/支持生视频 marks must still surface, so the
      // preset adapter gate only skips providers the user never designated.
      const userDesignated = !!flags && Object.values(flags)
        .some(entry => entry?.image === true || entry?.video === true);
      if (!Object.values(adapter).some(Boolean) && !userDesignated) return [];
      return providerConfig.getProviderSuppliers(cfg, provider.id).flatMap(supplier => {
        if (!providerConfig.isConfiguredSupplier(cfg, provider.id, supplier)) return [];
          let catalog = applyConnectionModelFlags(
            flags,
            providerConfig.getProviderSupplierCatalog(provider.id, supplier),
            providerConfig.providerCapabilityPresetId(provider)
          );
          // Dynamic connections must not surface auto-classified media models
          // the user never designated; built-in providers keep their declared
          // catalogs.
          if (provider.connection) {
            catalog = filterDesignatedMediaModels(flags, cfg.media, provider.id, supplier.id, catalog);
          }
          return [{
            providerId: provider.id,
            providerName: provider.name,
            supplierId: supplier.id,
            supplierName: supplier.name,
            models: catalog,
            configured: true
          }];
      });
    });
    const models = buildMediaModelList({
        providers,
        media: cfg.media
      });
    // Clear media selections that no longer belong to any configured supplier.
    // This prevents a deleted connection from remaining active in yan-media or
    // being shown by a renderer that was already open when the deletion happened.
    let mediaChanged = false;
    for (const role of ['image', 'video']) {
      const providerId = String(cfg.media?.[`${role}Provider`] || '');
      const supplierId = String(cfg.media?.[`${role}SupplierId`] || '');
      const modelId = String(cfg.media?.[`${role}Model`] || '');
      if (!providerId || !modelId) continue;
      const stillAvailable = models.some(model => model.modelType === role
        && model.providerId === providerId
        && model.id === modelId
        && (!supplierId || String(model.supplierId || '') === supplierId));
      if (stillAvailable) continue;
      cfg.media[`${role}Provider`] = '';
      cfg.media[`${role}SupplierId`] = '';
      cfg.media[`${role}Model`] = '';
      cfg.media[`${role}Name`] = '';
      mediaChanged = true;
    }
    if (mediaChanged) {
      modelState.updateImageGenerationConfig(cfg);
      configStore.saveConfig(cfg);
    }
    return {
      models,
      notice: providers.length ? '' : '请先配置至少一家已适配媒体能力的厂商 API。'
    };
  });
  ipcMain.handle('model:role-set', (_e, payload = {}) => (
    modelState.setActiveModelRole(payload.providerId, payload.modelId, payload.modelType, payload.supplierId)
  ));

  return {
    refreshConfiguredProviderModelCache,
    applyProviderConfiguration,
    connectionSummary,
  };
}

module.exports = { registerProviderIpc };

'use strict';

// Model state (plan T4.2): media config, agent model selection, role binding
// and the public model state published to the renderer. Moved verbatim from
// main.js; the config/provider stores and the main window arrive as deps.

const { getModelType, isAgentTextModel } = require('../model-roles');
const { resolveImageGenerationConfig, resolveVideoGenerationConfig } = require('../model-capabilities');

function createModelState(deps) {
  const { MODEL_PROVIDERS, providerConfig, configStore, getMainWindow } = deps;

  function getFirstTextModel(providerId, models) {
    return (models || []).find(model => getModelType(providerId, model) === 'text') || null;
  }

  function normalizeMediaConfig(cfg) {
    const current = cfg.media && typeof cfg.media === 'object' ? cfg.media : {};
    const next = { ...current };
    for (const role of ['image', 'video']) {
      const providerKey = `${role}Provider`;
      const modelKey = `${role}Model`;
      const supplierKey = `${role}SupplierId`;
      const nameKey = `${role}Name`;
      const providerId = MODEL_PROVIDERS[next[providerKey]] ? String(next[providerKey]) : '';
      const modelId = String(next[modelKey] || '').trim();
      const requestedSupplierId = providerId
        ? String(next[supplierKey] || cfg.api?.providerActiveSupplierIds?.[providerId] || '').trim()
        : '';
      const supplierId = providerId
        ? String(providerConfig.getProviderSupplier(cfg, providerId, requestedSupplierId)?.id || '')
        : '';
      const model = providerId && modelId
        ? providerConfig.getProviderModels(cfg, providerId, supplierId).find(item => item.id === modelId && getModelType(providerId, item) === role)
        : null;
      const supplier = providerId ? providerConfig.getProviderSupplier(cfg, providerId, supplierId) : null;
      const configured = providerId && providerConfig.isConfiguredSupplier(cfg, providerId, supplier);
      next[providerKey] = model && configured ? providerId : '';
      next[modelKey] = model && configured ? model.id : '';
      next[supplierKey] = model && configured ? supplierId : '';
      next[nameKey] = model && configured ? String(model.name || model.id) : '';
    }
    cfg.media = next;
    return next;
  }

  function updateImageGenerationConfig(cfg) {
    const media = normalizeMediaConfig(cfg);
    const imageProvider = media.imageProvider;
    cfg.imageGeneration = imageProvider && media.imageModel
      ? resolveImageGenerationConfig(imageProvider, media.imageModel, providerConfig.getProviderModels(cfg, imageProvider, media.imageSupplierId))
      : { available: false, strategy: '', providerId: '', model: '' };
    cfg.videoGeneration = media.videoProvider && media.videoModel
      ? resolveVideoGenerationConfig(media.videoProvider, media.videoModel, providerConfig.getProviderModels(cfg, media.videoProvider, media.videoSupplierId))
      : { available: false, providerId: '', model: '' };
    if (cfg.imageGeneration?.available) cfg.imageGeneration.supplierId = media.imageSupplierId || '';
    if (cfg.videoGeneration?.available) cfg.videoGeneration.supplierId = media.videoSupplierId || '';
    return cfg.imageGeneration;
  }

  function resolveRequestedGenerationConfig(cfg, type, providerId = '', modelId = '') {
    const role = type === 'video' ? 'video' : 'image';
    const media = normalizeMediaConfig(cfg);
    const fallbackProviderId = media[`${role}Provider`];
    const fallbackModelId = media[`${role}Model`];
    const selectedProviderId = MODEL_PROVIDERS[providerId] ? providerId : fallbackProviderId;
    const selectedModelId = String(modelId || '').trim() || fallbackModelId;
    const selectedSupplierId = selectedProviderId === fallbackProviderId
      ? String(media[`${role}SupplierId`] || providerConfig.getRoleSupplierId(cfg, role, selectedProviderId) || '')
      : providerConfig.getRoleSupplierId(cfg, role, selectedProviderId);
    if (!selectedProviderId || !selectedModelId) {
      return { error: `尚未选择${role === 'image' ? '生图' : '生视频'}模型` };
    }
    const models = providerConfig.getProviderModels(cfg, selectedProviderId, selectedSupplierId);
    const selected = models.find(item => item.id === selectedModelId);
    if (!selected || getModelType(selectedProviderId, selected) !== role) {
      return { error: `所选${role === 'image' ? '图像' : '视频'}模型不可用，请重新选择模型` };
    }
    const config = role === 'image'
      ? resolveImageGenerationConfig(selectedProviderId, selectedModelId, models)
      : resolveVideoGenerationConfig(selectedProviderId, selectedModelId, models);
    if (!config.available || config.model !== selectedModelId) {
      return { error: `所选${role === 'image' ? '图像' : '视频'}模型没有可用的生成能力` };
    }
    return { ...config, supplierId: selectedSupplierId };
  }

  function normalizeAgentModelSelection(cfg) {
    providerConfig.ensureProviderConfigs(cfg);
    const empty = {
      providerId: '',
      supplierId: '',
      modelId: '',
      modelType: 'text',
      name: '',
      capabilities: {}
    };
    // Use connection order and the same enabled text-model eligibility as the
    // main-model picker. A configured endpoint alone is not an enabled model.
    const candidates = providerConfig.getEnabledConnections(cfg).flatMap(connection => {
      const { providerId, supplierId } = connection;
      const supplier = providerConfig.getProviderSupplier(cfg, providerId, supplierId);
      if (!supplier) return [];
      const models = providerConfig.getProviderModels(cfg, providerId, supplierId);
      return models.filter(model => model.enabled !== false
        && connection.modelFlags?.[model.id]?.enabled !== false
        && getModelType(providerId, model) === 'text'
        && isAgentTextModel(providerId, model))
        .map(model => ({ providerId, supplierId, supplier, models, model }));
    });
    const stored = cfg.agentModel && typeof cfg.agentModel === 'object' ? cfg.agentModel : {};
    const storedModelId = String(stored.modelId || stored.model || '').trim();
    const preferred = candidates.find(entry => entry.providerId === stored.providerId
      && entry.supplierId === stored.supplierId && entry.model.id === storedModelId)
      || (!storedModelId && candidates.find(entry => entry.providerId === cfg.api.provider
        && entry.supplierId === cfg.api.providerActiveSupplierIds?.[entry.providerId]
        && entry.model.id === cfg.api.model))
      || candidates[0];
    if (!preferred) {
      cfg.api.provider = '';
      cfg.api.baseUrl = '';
      cfg.api.apiKey = '';
      cfg.api.model = '';
      cfg.models = [];
      cfg.agentModel = empty;
      return empty;
    }
    const { providerId, supplierId, models, model: currentModel } = preferred;
    const selected = {
      providerId,
      supplierId,
      modelId: currentModel.id,
      modelType: 'text',
      name: currentModel.name || currentModel.id,
      capabilities: currentModel.capabilities || {}
    };
    cfg.api.provider = providerId;
    cfg.api.providerActiveSupplierIds[providerId] = supplierId;
    cfg.api.baseUrl = preferred.supplier.baseUrl || '';
    cfg.api.apiKey = preferred.supplier.apiKey || '';
    cfg.api.model = selected.modelId;
    cfg.models = models;
    cfg.agentModel = selected;
    return selected;
  }

  function buildPublicModelState(cfg = configStore.loadConfig()) {
    const agentModel = cfg.agentModel || normalizeAgentModelSelection(cfg);
    const provider = agentModel.providerId || cfg.api?.provider || '';
    const models = providerConfig.getProviderModels(cfg, provider, agentModel.supplierId).map(model => ({
      id: model.id,
      name: model.name || model.id,
      capabilities: model.capabilities || {}
    }));
    const current = models.find(model => model.id === agentModel.modelId) || null;
    return {
      provider,
      providerName: MODEL_PROVIDERS[provider]?.name || provider,
      model: current?.id || '',
      capabilities: current?.capabilities || {},
      models,
      agentModel,
      media: normalizeMediaConfig(cfg)
    };
  }

  function publishModelState(cfg) {
    const detail = buildPublicModelState(cfg);
    const win = getMainWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) {
      win.webContents.send('model:changed', detail);
    }
    return detail;
  }

  function setActiveModel(modelId) {
    const cfg = configStore.loadConfig();
    const selection = normalizeAgentModelSelection(cfg);
    return setActiveModelRole(selection.providerId, modelId, 'text', selection.supplierId);
  }

  function setActiveModelRole(providerId, modelId, expectedType = '', supplierId = '') {
    const cfg = configStore.loadConfig();
    const id = String(modelId || '').trim();
    if (!id && ['image', 'video'].includes(expectedType)) {
      normalizeMediaConfig(cfg);
      cfg.media[`${expectedType}Provider`] = '';
      cfg.media[`${expectedType}Model`] = '';
      cfg.media[`${expectedType}SupplierId`] = '';
      normalizeAgentModelSelection(cfg);
      updateImageGenerationConfig(cfg);
      configStore.saveConfig(cfg);
      publishModelState(cfg);
      return cfg;
    }
    const provider = MODEL_PROVIDERS[providerId];
    if (!provider) return { error: '未知模型厂商' };
    const requestedSupplierId = String(supplierId || '').trim();
    const role = expectedType === 'image' || expectedType === 'video' ? expectedType : 'text';
    const selectedSupplier = providerConfig.getProviderSupplier(cfg, providerId, requestedSupplierId || providerConfig.getRoleSupplierId(cfg, role, providerId));
    if (!selectedSupplier) return { error: '供应商不存在' };
    if (!providerConfig.isConfiguredSupplier(cfg, providerId, selectedSupplier)) {
      return { error: '供应商尚未配置或未启用' };
    }
    const selectedSupplierId = selectedSupplier.id;
    // Keep the text picker cursor aligned with the text role. Media choices must
    // not move that cursor: image/video suppliers are independent roles.
    if (role === 'text') cfg.api.providerActiveSupplierIds[providerId] = selectedSupplierId;
    const models = providerConfig.getProviderModels(cfg, providerId, selectedSupplierId);
    const model = models.find(item => item.id === id);
    if (!model) return { error: '模型不属于指定厂商' };
    const modelType = getModelType(providerId, model);
    if (expectedType && expectedType !== modelType) return { error: '模型类型与目标角色不匹配' };

    if (modelType === 'text') {
      const connection = providerConfig.getProviderConnectionForSupplier(cfg, providerId, selectedSupplierId);
      cfg.api.provider = providerId;
      cfg.api.baseUrl = connection.baseUrl;
      cfg.api.apiKey = connection.apiKey;
      cfg.api.model = id;
      cfg.models = models;
      cfg.agentModel = {
        providerId,
        supplierId: selectedSupplierId,
        modelId: id,
        modelType: 'text',
        name: model.name || id,
        capabilities: model.capabilities || {}
      };
    } else {
      normalizeMediaConfig(cfg);
      cfg.media[`${modelType}Provider`] = providerId;
      cfg.media[`${modelType}Model`] = id;
      cfg.media[`${modelType}SupplierId`] = selectedSupplierId;
      normalizeAgentModelSelection(cfg);
    }
    updateImageGenerationConfig(cfg);
    configStore.saveConfig(cfg);
    publishModelState(cfg);
    return cfg;
  }

  function applyProviderSelection(cfg, providerId, apiKey, supplierId = '') {
    providerConfig.ensureProviderConfigs(cfg);
    const supplier = providerConfig.getProviderSupplier(cfg, providerId, supplierId);
    const selectedSupplierId = supplier?.id || String(supplierId || '').trim();
    const connection = providerConfig.getProviderConnectionForSupplier(cfg, providerId, selectedSupplierId);
    connection.apiKey = String(apiKey || '').trim();
    cfg.api.providerConfigs[providerId] = connection;
    cfg.api.apiKeys[providerId] = connection.apiKey;
    cfg.api.provider = providerId;
    cfg.api.baseUrl = connection.baseUrl;
    cfg.api.apiKey = connection.apiKey;
    cfg.models = providerConfig.getProviderModels(cfg, providerId, selectedSupplierId);
    if (!cfg.models.some(model => model.id === cfg.api.model && getModelType(providerId, model) === 'text')) {
      cfg.api.model = getFirstTextModel(providerId, cfg.models)?.id || '';
    }
    const selectedModel = cfg.models.find(model => model.id === cfg.api.model && getModelType(providerId, model) === 'text');
    cfg.agentModel = {
      providerId,
      supplierId: selectedSupplierId,
      modelId: selectedModel?.id || '',
      modelType: 'text',
      name: selectedModel?.name || selectedModel?.id || '',
      capabilities: selectedModel?.capabilities || {}
    };
    updateImageGenerationConfig(cfg);
    return cfg;
  }

  return {
    getFirstTextModel,
    normalizeMediaConfig,
    updateImageGenerationConfig,
    resolveRequestedGenerationConfig,
    normalizeAgentModelSelection,
    buildPublicModelState,
    publishModelState,
    setActiveModel,
    setActiveModelRole,
    applyProviderSelection,
  };
}

module.exports = { createModelState };

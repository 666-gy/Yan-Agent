'use strict';

const { decorateModels, resolveModelCapabilities } = require('./model-capabilities');

const AGNES_FALLBACK_MODELS = Object.freeze([
  { id: 'agnes-2.0-flash', name: 'Agnes 2.0 Flash' },
  { id: 'agnes-2.5-flash', name: 'Agnes 2.5 Flash' },
  { id: 'agnes-2.5-pro', name: 'Agnes 2.5 Pro' },
  { id: 'agnes-2.5-pro-alpha', name: 'Agnes 2.5 Pro Alpha' },
  { id: 'agnes-image-2.0-flash', name: 'Agnes Image 2.0 Flash' },
  { id: 'agnes-image-2.1-flash', name: 'Agnes Image 2.1 Flash' },
  { id: 'agnes-video-v2.0', name: 'Agnes Video V2.0' }
]);

const GLM_VISION_RELAY_MODELS = Object.freeze([
  { id: 'glm-5v-turbo', name: 'GLM-5V Turbo' },
  { id: 'glm-4.6v-flash', name: 'GLM-4.6V Flash' },
  { id: 'glm-4.1v-thinking-flash', name: 'GLM-4.1V Thinking Flash' },
  { id: 'glm-4v-flash', name: 'GLM-4V Flash' }
]);

const DEFAULT_MODEL_ROLES = Object.freeze({
  text: { providerId: 'agnes', model: 'agnes-2.0-flash' },
  image: { providerId: 'agnes', model: 'agnes-image-2.1-flash' },
  video: { providerId: 'agnes', model: 'agnes-video-v2.0' }
});

const AGNES_RECOMMENDED_MODEL_IDS = Object.freeze([
  DEFAULT_MODEL_ROLES.text.model,
  DEFAULT_MODEL_ROLES.image.model,
  DEFAULT_MODEL_ROLES.video.model
]);

function getModelType(providerId, model = {}) {
  const explicit = String(model?.capabilities?.modelType || model?.modelType || '').toLowerCase();
  if (['text', 'image', 'video'].includes(explicit)) return explicit;
  return resolveModelCapabilities(providerId, model).modelType;
}

function isAgentTextModel(providerId, model = {}) {
  if (getModelType(providerId, model) !== 'text') return false;
  const outputs = model.outputModalities || model.output_modalities || model.capabilities?.output_modalities || model.capabilities?.output;
  if (Array.isArray(outputs) && outputs.length && !outputs.some(value => String(value).toLowerCase() === 'text')) return false;
  const id = String(model.id || '').toLowerCase();
  return !/(?:embedding|rerank|moderation|transcri|whisper|speech|tts|realtime|dall-e|image-generation|video-generation|stable-diffusion|sdxl|kolors|flux|cogvideo|hunyuanvideo|(?:^|[\/_-])sora(?:[\/_-]|$)|(?:^|[\/_-])wan\d)/i.test(id);
}

function buildQuickModelList({ providers, activeSelection, activeProviderId, activeTextModel } = {}) {
  const selected = activeSelection && typeof activeSelection === 'object'
    ? activeSelection
    : {
        providerId: activeProviderId,
        modelId: activeTextModel,
        modelType: 'text'
      };
  return (Array.isArray(providers) ? providers : []).flatMap(provider => {
    const providerId = String(provider?.providerId || '').trim();
    if (!providerId || !provider?.configured) return [];
    const catalog = decorateModels(providerId, provider.models || []);
    return catalog.filter(model => {
      const modelType = getModelType(providerId, model);
      return modelType === 'text' ? isAgentTextModel(providerId, model) : ['image', 'video'].includes(modelType);
    }).map(model => ({
      providerId,
      providerName: provider.providerName || providerId,
      id: model.id,
      name: model.name || model.id,
      modelType: getModelType(providerId, model),
      source: model.source || 'api',
      selected: selected.providerId === providerId
        && String(selected.modelId || selected.model || '') === model.id
        && (selected.modelType || 'text') === getModelType(providerId, model),
      requiresApiKey: true,
      capabilities: model.capabilities || {},
      configured: !!provider.configured
    }));
  });
}

function buildMediaModelList({
  providers,
  currentProviderId,
  currentProviderName,
  currentProviderModels,
  currentProviderApiKey,
  agnesModels,
  agnesApiKey,
  media
} = {}) {
  const candidates = Array.isArray(providers)
    ? providers.flatMap(provider => decorateModels(provider.providerId, provider.models || []).map(model => ({
        providerId: provider.providerId,
        providerName: provider.providerName || provider.providerId,
        model,
        configured: !!provider.configured
      })))
    : decorateModels('agnes', agnesModels?.length ? agnesModels : AGNES_FALLBACK_MODELS)
        .map(model => ({ providerId: 'agnes', providerName: 'Agnes', model, configured: !!String(agnesApiKey || '').trim() }));
  if (!Array.isArray(providers) && currentProviderId !== 'agnes' && String(currentProviderApiKey || '').trim()) {
    candidates.push(...decorateModels(currentProviderId, currentProviderModels || []).map(model => ({
      providerId: currentProviderId,
      providerName: currentProviderName || currentProviderId,
      model,
      configured: true
    })));
  }
  const seen = new Set();
  return candidates.flatMap(entry => {
    const modelType = getModelType(entry.providerId, entry.model);
    const key = `${entry.providerId}:${entry.model.id}`;
    if (!['image', 'video'].includes(modelType) || seen.has(key)) return [];
    seen.add(key);
    return [{
      providerId: entry.providerId,
      providerName: entry.providerName,
      id: entry.model.id,
      name: entry.model.name || entry.model.id,
      modelType,
      selected: media?.[`${modelType}Provider`] === entry.providerId && media?.[`${modelType}Model`] === entry.model.id,
      configured: entry.configured,
      source: entry.model.source || 'api',
      capabilities: entry.model.capabilities || {}
    }];
  });
}

module.exports = {
  AGNES_FALLBACK_MODELS,
  AGNES_RECOMMENDED_MODEL_IDS,
  DEFAULT_MODEL_ROLES,
  GLM_VISION_RELAY_MODELS,
  buildMediaModelList,
  buildQuickModelList,
  getModelType,
  isAgentTextModel
};

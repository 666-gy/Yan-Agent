'use strict';

const MODEL_SOURCE_API = 'api';
const MODEL_SOURCE_GLM_OFFICIAL = 'glm-official-supplement';
const MODEL_SOURCE_SENSENOVA_OFFICIAL = 'sensenova-official-supplement';

const GLM_VISION_MODELS = Object.freeze([
  { id: 'glm-5v-turbo', name: 'GLM-5V Turbo' },
  { id: 'glm-4.6v-flash', name: 'GLM-4.6V Flash' },
  { id: 'glm-4.1v-thinking-flash', name: 'GLM-4.1V Thinking Flash' },
  { id: 'glm-4v-flash', name: 'GLM-4V Flash' }
]);
const GLM_VISION_RELAY_MODELS = Object.freeze(GLM_VISION_MODELS
  .filter(model => !['glm-5-turbo', 'glm-5v-turbo'].includes(model.id)));

const GLM_OFFICIAL_SUPPLEMENTAL_MODELS = Object.freeze([
  { id: 'glm-4.7-flash', name: 'GLM-4.7 Flash', modelType: 'text' },
  { id: 'glm-4.5-flash', name: 'GLM-4.5 Flash (即将下线)', modelType: 'text' },
  { id: 'glm-4-flash-250414', name: 'GLM-4 Flash 250414', modelType: 'text' },
  ...GLM_VISION_MODELS.map(model => ({
    ...model,
    modelType: 'text',
    capabilities: { vision: true }
  })),
  { id: 'glm-image', name: 'GLM-Image', modelType: 'image' },
  { id: 'cogview-4', name: 'CogView-4 (Latest)', modelType: 'image' },
  { id: 'cogview-4-250304', name: 'CogView-4 250304', modelType: 'image' },
  { id: 'cogview-3-flash', name: 'CogView-3-Flash', modelType: 'image' },
  { id: 'cogvideox-3', name: 'CogVideoX-3', modelType: 'video' },
  { id: 'cogvideox-flash', name: 'CogVideoX-Flash', modelType: 'video' }
].map(model => Object.freeze({ ...model, source: MODEL_SOURCE_GLM_OFFICIAL })));

const SENSENOVA_OFFICIAL_SUPPLEMENTAL_MODELS = Object.freeze([
  {
    id: 'sensenova-6.8-flash-lite',
    name: 'SenseNova 6.8 Flash Lite',
    modelType: 'text',
    capabilities: { vision: true }
  },
  {
    id: 'sensenova-u1-fast',
    name: 'SenseNova U1 Fast',
    modelType: 'image',
    capabilities: { imageGeneration: true }
  }
].map(model => Object.freeze({ ...model, source: MODEL_SOURCE_SENSENOVA_OFFICIAL })));

function cleanCatalog(models, defaultSource = '') {
  const seen = new Set();
  const result = [];
  for (const model of Array.isArray(models) ? models : []) {
    const id = String(model?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    result.push({
      ...model,
      id,
      ...(model.source || !defaultSource ? {} : { source: defaultSource })
    });
  }
  return result;
}

function getOfficialSupplementalModels(presetId) {
  const preset = String(presetId || '').trim().toLowerCase();
  if (preset === 'glm') return GLM_OFFICIAL_SUPPLEMENTAL_MODELS;
  if (preset === 'sensenova') return SENSENOVA_OFFICIAL_SUPPLEMENTAL_MODELS;
  return [];
}

function buildSelectableModelCatalog(apiModels, supplementalModels) {
  const api = cleanCatalog(apiModels, MODEL_SOURCE_API);
  const apiIds = new Set(api.map(model => model.id));
  // Keep the provider's ordering first so initial model selection remains
  // anchored to the live catalog. A matching supplement is omitted because
  // the API copy is authoritative for both metadata and source labeling.
  return [
    ...api,
    ...cleanCatalog(supplementalModels).filter(model => !apiIds.has(model.id))
  ];
}

function summarizeModelCatalog(apiModels, supplementalModels) {
  const api = cleanCatalog(apiModels, MODEL_SOURCE_API);
  const apiIds = new Set(api.map(model => model.id));
  const supplemental = cleanCatalog(supplementalModels)
    .filter(model => !apiIds.has(model.id));
  return {
    apiModels: api,
    supplementalModels: supplemental,
    selectableModels: buildSelectableModelCatalog(api, supplemental),
    modelCount: api.length,
    supplementalModelCount: supplemental.length,
    totalModelCount: api.length + supplemental.length
  };
}

module.exports = {
  GLM_OFFICIAL_SUPPLEMENTAL_MODELS,
  GLM_VISION_MODELS,
  GLM_VISION_RELAY_MODELS,
  SENSENOVA_OFFICIAL_SUPPLEMENTAL_MODELS,
  MODEL_SOURCE_API,
  MODEL_SOURCE_GLM_OFFICIAL,
  MODEL_SOURCE_SENSENOVA_OFFICIAL,
  buildSelectableModelCatalog,
  getOfficialSupplementalModels,
  summarizeModelCatalog
};

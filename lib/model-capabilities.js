'use strict';

const STATIC_VISION_MODEL_IDS = new Set([
  'doubao-seed-2-1-pro-260628',
  'doubao-seed-2-1-turbo-260628',
  'doubao-seed-2-0-lite-260428',
  'doubao-seed-2-0-mini-260428',
  'doubao-seed-2-0-pro-260215',
  'kimi-k3',
  'kimi-k2.7-code-highspeed',
  'kimi-k2.7-code',
  'kimi-k2.6',
  'kimi-k2.5',
  'step-3.7-flash',
  'MiniMax-M3'
]);

const STATIC_TEXT_ONLY_MODEL_IDS = new Set([
  'agnes-2.0-flash',
  'agnes-2.0-pro',
  'Baichuan4',
  'Baichuan3-Turbo',
  'yi-large',
  'yi-lightning',
  'hunyuan-turbos',
  'hunyuan-pro',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'qwen3.7-max',
  'qwen3.7-plus',
  'qwen3.6-flash',
  'qwen3.6-max-preview',
  'qwen3.6-plus',
  'qwen3-max',
  'qwen-plus',
  'qwen-turbo',
  'qwen-long',
  'glm-5.2',
  'glm-5.1',
  'glm-5-turbo',
  'glm-5',
  'glm-4.7',
  'glm-4.7-flashx',
  'glm-4.7-flash',
  'glm-4.6',
  'glm-4.5-air',
  'glm-4.5-airx',
  'glm-4-flashx-250414',
  'glm-4-flash-250414',
  'step-3.5-flash',
  'MiniMax-M2.7-highspeed',
  'MiniMax-M2.7'
]);

const PROVIDER_IMAGE_MIME_TYPES = {
  openai: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  grok: ['image/png', 'image/jpeg'],
  moonshot: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  doubao: ['image/png', 'image/jpeg', 'image/webp'],
  stepfun: ['image/png', 'image/jpeg', 'image/webp'],
  minimax: ['image/png', 'image/jpeg', 'image/webp']
};

const GROK_IMAGE_MODEL_IDS = new Set([
  'grok-imagine-image',
  'grok-imagine-image-quality'
]);

function normalizeModelId(modelId) {
  return String(modelId || '').trim();
}

function readExplicitVision(model = {}) {
  if (typeof model.capabilities?.vision === 'boolean') return model.capabilities.vision;
  if (typeof model.vision === 'boolean') return model.vision;
  const modalities = model.inputModalities
    || model.input_modalities
    || model.capabilities?.input_modalities
    || model.capabilities?.input;
  if (Array.isArray(modalities)) {
    return modalities.some(item => /^(?:image|vision)$/i.test(String(item)));
  }
  return null;
}

function isOpenAiVisionModel(modelId) {
  const id = normalizeModelId(modelId).toLowerCase();
  if (!id || /(?:audio|transcrib|tts|embedding|moderation|realtime|gpt-image|dall-e)/.test(id)) return false;
  if (/^gpt-(?:4o|4\.1|4\.5|5(?:[.\-]|$))/.test(id)) return true;
  if (/^chatgpt-4o(?:[.\-]|$)/.test(id)) return true;
  if (/^(?:o1|o3)(?:-pro)?(?:[.\-]|$)/.test(id)) return true;
  if (/^o4-mini(?:[.\-]|$)/.test(id)) return true;
  if (/^(?:computer-use-preview|codex-mini-latest)(?:[.\-]|$)/.test(id)) return true;
  return /^5\.6(?:[.\-_]?(?:sol|terra|luna))?$/.test(id);
}

function isOpenAiResponsesImageModel(modelId) {
  const id = normalizeModelId(modelId).toLowerCase();
  return /^gpt-5(?:[.\-]|$)/.test(id)
    || /^5\.6(?:[.\-_]?(?:sol|terra|luna))?$/.test(id);
}

function isGrokVisionModel(modelId) {
  const id = normalizeModelId(modelId).toLowerCase();
  return /vision/.test(id) || /^grok-4(?:[.\-]|$)/.test(id);
}

function isGrokImageGenerationModel(modelId) {
  return GROK_IMAGE_MODEL_IDS.has(normalizeModelId(modelId).toLowerCase());
}

function isGptImageGenerationModel(modelId) {
  return /^gpt-image-/i.test(normalizeModelId(modelId));
}

function isImageGenerationModel(providerId, modelId) {
  const id = normalizeModelId(modelId).toLowerCase();
  if (providerId === 'openai') return isGptImageGenerationModel(id) || /^dall-e-/.test(id);
  if (providerId === 'grok') return isGrokImageGenerationModel(id);
  return false;
}

function inferVision(providerId, model) {
  const explicit = readExplicitVision(model);
  if (explicit !== null) return explicit;
  const id = normalizeModelId(model?.id);
  if (STATIC_VISION_MODEL_IDS.has(id)) return true;
  if (STATIC_TEXT_ONLY_MODEL_IDS.has(id)) return false;
  if (providerId === 'openai') return isOpenAiVisionModel(id);
  if (providerId === 'grok') return isGrokVisionModel(id);
  return false;
}

function resolveModelCapabilities(providerId, model = {}) {
  const id = normalizeModelId(model.id);
  const vision = inferVision(providerId, model);
  const imageModel = isImageGenerationModel(providerId, id);
  const imageInput = vision || imageModel;
  const responsesImageGeneration = providerId === 'openai' && isOpenAiResponsesImageModel(id);
  return {
    vision,
    imageInput,
    imageGeneration: imageModel || responsesImageGeneration,
    imageGenerationModel: imageModel,
    responsesImageGeneration,
    imageMimeTypes: imageInput ? [...(PROVIDER_IMAGE_MIME_TYPES[providerId] || ['image/png', 'image/jpeg'])] : [],
    maxImageBytes: imageInput ? 20 * 1024 * 1024 : 0
  };
}

function decorateModel(providerId, model = {}) {
  return {
    ...model,
    capabilities: resolveModelCapabilities(providerId, model)
  };
}

function decorateModels(providerId, models) {
  return (Array.isArray(models) ? models : []).map(model => decorateModel(providerId, model));
}

function resolveImageGenerationConfig(providerId, currentModelId, models) {
  const decorated = decorateModels(providerId, models);
  const current = decorated.find(model => model.id === currentModelId);
  if (current?.capabilities?.responsesImageGeneration) {
    return {
      available: true,
      strategy: 'responses',
      providerId,
      model: current.id
    };
  }

  if (current?.capabilities?.imageGenerationModel) {
    return {
      available: true,
      strategy: 'images',
      providerId,
      model: current.id
    };
  }

  const imageModel = decorated.find(model => model.capabilities?.imageGenerationModel);
  if (imageModel) {
    return {
      available: true,
      strategy: 'images',
      providerId,
      model: imageModel.id
    };
  }

  return { available: false, strategy: '', providerId, model: '' };
}

module.exports = {
  GROK_IMAGE_MODEL_IDS,
  PROVIDER_IMAGE_MIME_TYPES,
  STATIC_TEXT_ONLY_MODEL_IDS,
  STATIC_VISION_MODEL_IDS,
  decorateModel,
  decorateModels,
  isGrokVisionModel,
  isGrokImageGenerationModel,
  isGptImageGenerationModel,
  isImageGenerationModel,
  isOpenAiResponsesImageModel,
  isOpenAiVisionModel,
  resolveImageGenerationConfig,
  resolveModelCapabilities
};

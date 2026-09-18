'use strict';

const gptProfile = require('./gpt-model-profile');

const STATIC_VISION_MODEL_IDS = new Set([
  'agnes-2.0-flash',
  'agnes-2.5-flash',
  'agnes-2.5-pro-alpha',
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
  'MiniMax-M3',
  'glm-5.3-flash',
  'glm-5v-turbo',
  'glm-4.6v-flash',
  'glm-4.1v-thinking-flash',
  'glm-4v-flash',
  'sensenova-6.8-flash-lite',
  'Qwen/Qwen3.5-4B',
  'deepseek-ai/DeepSeek-OCR',
  'PaddlePaddle/PaddleOCR-VL-1.5',
  'hunyuan-vision',
  'hunyuan-vision-1.5-instruct',
  'hunyuan-t1-vision-20250916',
  'deepseek-flash',
  'deepseek-v4-flash-vision-exp',
  'qwen3.8-max-preview',
  'qwen3.7-plus',
  'qwen3.7-flash',
  'qwen3.7-flash-2026-07-15',
  'qwen3.6-plus',
  'qwen3.6-plus-2026-04-02',
  'qwen3.6-flash',
  'qwen3.6-flash-2026-04-16'
]);

const STATIC_TEXT_ONLY_MODEL_IDS = new Set([
  'Baichuan4',
  'Baichuan3-Turbo',
  'yi-large',
  'yi-lightning',
  'hunyuan-turbos',
  'hunyuan-pro',
  'deepseek-v4-flash',
  'deepseek-v4-pro',
  'qwen3.7-max',
  'qwen3.6-max-preview',
  'qwen3-max',
  'qwen-plus',
  'qwen-turbo',
  'qwen-long',
  'glm-5.3',
  'glm-5.2',
  'glm-5.2-fast-preview',
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
  agnes: ['image/png', 'image/jpeg', 'image/webp'],
  sensenova: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  moonshot: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
  doubao: ['image/png', 'image/jpeg', 'image/webp'],
  stepfun: ['image/png', 'image/jpeg', 'image/webp'],
  minimax: ['image/png', 'image/jpeg', 'image/webp']
};

const GROK_IMAGE_MODEL_IDS = new Set([
  'grok-imagine-image',
  'grok-imagine-image-quality'
]);

const PROVIDER_MEDIA_MODEL_HINTS = Object.freeze({
  openai: Object.freeze({ image: ['gpt-image-', 'dall-e-'], video: ['sora-'] }),
  grok: Object.freeze({ image: ['grok-imagine-image'], video: ['grok-imagine-video'] }),
  agnes: Object.freeze({ image: ['agnes-image-'], video: ['agnes-video-'] }),
  qwen: Object.freeze({
    image: ['qwen-image', 'wan2.7-image', 'wan2.6-image', 'wanx', 't2i', 'image-edit', 'z-image-'],
    video: ['t2v', 'wan-video']
  }),
  glm: Object.freeze({ image: ['cogview'], video: ['cogvideo'] }),
  doubao: Object.freeze({ image: ['seedream'], video: ['seedance'] }),
  stepfun: Object.freeze({ image: ['step-image', 'step-2x'], video: [] }),
  minimax: Object.freeze({ image: ['image-'], video: ['video-', 't2v-'] }),
  sensenova: Object.freeze({ image: ['sensenova-u1'], video: [] }),
  siliconflow: Object.freeze({
    image: ['flux', 'kolors', 'stable-diffusion', 'sdxl', 't2i', 'qwen-image'],
    video: ['t2v', 'cogvideo', 'hunyuanvideo', 'wan-video']
  })
});

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

// GPT family facts come from the shared profile (lib/gpt-model-profile.js) so
// a newly released model id is classified without touching this table.
function isOpenAiVisionModel(modelId) {
  const id = normalizeModelId(modelId).toLowerCase();
  if (!id || /(?:audio|transcrib|tts|embedding|moderation|realtime|gpt-image|dall-e)/.test(id)) return false;
  const profile = gptProfile.profileFor(id);
  if (profile.kind === 'media' || profile.kind === 'unknown') return false;
  return profile.vision === true;
}

// Responses-side image generation is available to every GPT reasoning family
// that serves /responses (gpt-5.x, gpt-5.6, gpt-6 and later).
function isOpenAiResponsesImageModel(modelId) {
  const profile = gptProfile.profileFor(modelId);
  return profile.kind === 'gpt' && profile.responsesEndpoint === true;
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

function isAgnesImageGenerationModel(modelId) {
  return normalizeModelId(modelId).toLowerCase().startsWith('agnes-image-');
}

function isAgnesVideoGenerationModel(modelId) {
  return normalizeModelId(modelId).toLowerCase().startsWith('agnes-video-');
}

function isAgnesTextModel(modelId) {
  const id = normalizeModelId(modelId).toLowerCase();
  return id.startsWith('agnes-')
    && !isAgnesImageGenerationModel(id)
    && !isAgnesVideoGenerationModel(id);
}

function isImageGenerationModel(providerId, modelId) {
  const provider = String(providerId || '').toLowerCase();
  const id = normalizeModelId(modelId).toLowerCase();
  return mediaModelTypeFromId(provider, id) === 'image';
}

function mediaModelTypeFromId(providerId, modelId) {
  const provider = String(providerId || '').toLowerCase();
  const id = normalizeModelId(modelId).toLowerCase();
  const hints = PROVIDER_MEDIA_MODEL_HINTS[provider];
  if (!id || !hints) return '';
  if (hints.video.some(hint => id.includes(hint))) return 'video';
  if (hints.image.some(hint => id.includes(hint))) return 'image';
  return '';
}

function inferVision(providerId, model) {
  const explicit = readExplicitVision(model);
  if (explicit !== null) return explicit;
  const id = normalizeModelId(model?.id);
  if (STATIC_VISION_MODEL_IDS.has(id)) return true;
  if (STATIC_TEXT_ONLY_MODEL_IDS.has(id)) return false;
  if (/(?:vision|(?:^|[-_/.])vl(?:[-_/.]|$)|qwen\d*(?:\.\d+)?[-_]?vl)/i.test(id)) return true;
  if (providerId === 'qwen' && /^qwen3\.(?:5|6|7|8)-(?:plus|flash)(?:-|$)/i.test(id)) return true;
  if (providerId === 'openai') return isOpenAiVisionModel(id);
  if (providerId === 'grok') return isGrokVisionModel(id);
  if (providerId === 'agnes') return isAgnesTextModel(id);
  return false;
}

// Output caps protect provider request parameters. Context length is configured
// by the user and must never be inferred from a model name here. Custom
// connections carry conn-* provider ids whose presets are guessed from names,
// so family detection relies on the model id alone.
function inferOpenAiFamilyOutputLimit(modelId) {
  const profile = gptProfile.profileFor(modelId);
  return profile.maxOutputTokens ? { maxOutputTokens: profile.maxOutputTokens } : null;
}

function resolveModelCapabilities(providerId, model = {}) {
  const id = normalizeModelId(model.id);
  const vision = inferVision(providerId, model);
  const explicitModelType = String(model?.capabilities?.modelType || model?.modelType || '').toLowerCase();
  const inferredMediaType = mediaModelTypeFromId(providerId, id);
  const imageModel = explicitModelType === 'image' || inferredMediaType === 'image';
  const videoModel = explicitModelType === 'video' || inferredMediaType === 'video';
  const imageInput = vision || imageModel;
  const responsesImageGeneration = providerId === 'openai' && isOpenAiResponsesImageModel(id);
  const gptTextProfile = ['gpt', 'o-series', 'codex'].includes(gptProfile.profileFor(id).kind)
    ? gptProfile.profileFor(id)
    : null;
  return {
    ...inferOpenAiFamilyOutputLimit(id),
    modelType: imageModel ? 'image' : (videoModel ? 'video' : 'text'),
    vision,
    imageInput,
    imageGeneration: imageModel || responsesImageGeneration,
    imageGenerationModel: imageModel,
    videoGeneration: videoModel,
    videoGenerationModel: videoModel,
    responsesImageGeneration,
    imageMimeTypes: imageInput ? [...(PROVIDER_IMAGE_MIME_TYPES[providerId] || ['image/png', 'image/jpeg'])] : [],
    maxImageBytes: imageInput ? 20 * 1024 * 1024 : 0,
    // Explicit per-model reasoning ladder: the kernel maps the user's tier to
    // the nearest value the model actually accepts instead of guessing.
    ...(gptTextProfile && gptTextProfile.efforts.length
      ? { reasoningEffortLevels: [...gptTextProfile.efforts] }
      : {})
  };
}

function decorateModel(providerId, model = {}) {
  return {
    ...model,
    capabilities: {
      ...(model.capabilities || {}),
      ...resolveModelCapabilities(providerId, model)
    }
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

function resolveVideoGenerationConfig(providerId, currentModelId, models) {
  const decorated = decorateModels(providerId, models);
  const current = decorated.find(model => model.id === currentModelId);
  if (current?.capabilities?.videoGenerationModel) {
    return { available: true, providerId, model: current.id };
  }
  const videoModel = decorated.find(model => model.capabilities?.videoGenerationModel);
  if (videoModel) return { available: true, providerId, model: videoModel.id };
  return { available: false, providerId, model: '' };
}

module.exports = {
  GROK_IMAGE_MODEL_IDS,
  PROVIDER_IMAGE_MIME_TYPES,
  STATIC_TEXT_ONLY_MODEL_IDS,
  STATIC_VISION_MODEL_IDS,
  decorateModel,
  decorateModels,
  isAgnesImageGenerationModel,
  isAgnesTextModel,
  isAgnesVideoGenerationModel,
  isGrokVisionModel,
  isGrokImageGenerationModel,
  isGptImageGenerationModel,
  isImageGenerationModel,
  mediaModelTypeFromId,
  PROVIDER_MEDIA_MODEL_HINTS,
  isOpenAiResponsesImageModel,
  isOpenAiVisionModel,
  resolveImageGenerationConfig,
  resolveModelCapabilities,
  resolveVideoGenerationConfig
};

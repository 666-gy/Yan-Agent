'use strict';

// Natural-language provider setup helpers.
//
// The conversation owner receives a base URL, an API key and a loose list of
// model names ("里面有几个生图模式"). Nothing here talks to the network or the
// config file: these are the pure decisions — which model is a text/image/video
// role, which per-model flags to write, and how to report a key without echoing
// it back into the transcript.

const NON_GENERATION_MODEL = /(?:embedding|embed-|rerank|moderation|transcri|whisper|tts|speech|realtime|audio)/i;

const VIDEO_MARKERS = [
  'sora', 'veo', 'kling', 'hailuo', 'runway', 'pika', 'luma', 'seedance',
  'jimeng', 'vidu', 'cogvideo', 'hunyuanvideo', 'hunyuan-video', 'wan-video',
  'wanx-video', 'agnes-video', 'grok-imagine-video', 'doubao-video',
  'minimax-video', 't2v', 'i2v', 'text-to-video', 'image-to-video',
  'video-generation', 'video-gen'
];

const IMAGE_MARKERS = [
  'gpt-image', 'dall-e', 'dalle', 'imagen', 'flux', 'sdxl', 'stable-diffusion',
  'midjourney', 'ideogram', 'recraft', 'seedream', 'kolors', 'wanx',
  'qwen-image', 'cogview', 'nano-banana', 'imagine-image', 'agnes-image',
  'z-image', 't2i', 'image-edit', 'image-generation', 'image-gen',
  'grok-imagine-image', 'doubao-image', 'hunyuan-image', 'minimax-image'
];

const ROLE_ALIASES = Object.freeze({
  image: 'image', img: 'image', '生图': 'image', '图像': 'image', '图片': 'image', picture: 'image',
  video: 'video', '生视频': 'video', '视频': 'video', movie: 'video',
  text: 'text', chat: 'text', '文本': 'text', '对话': 'text', llm: 'text'
});

function normalizeRole(value) {
  const key = String(value || '').trim().toLowerCase();
  return ROLE_ALIASES[key] || '';
}

function modelTokens(id, name = '') {
  return `${String(id || '').toLowerCase()} ${String(name || '').toLowerCase()}`;
}

function hasMarker(text, markers) {
  return markers.some(marker => text.includes(marker));
}

// Decide what a model produces. Explicit user hints always win; otherwise the
// id/name is matched against vendor media families. Text is the fallback so an
// unknown model still lands in the normal chat picker.
function classifyModelRole(id, name = '', hint = '') {
  const explicit = normalizeRole(hint);
  if (explicit) return { role: explicit, reason: 'explicit' };
  const text = modelTokens(id, name);
  if (!text.trim()) return { role: 'text', reason: 'empty' };
  if (NON_GENERATION_MODEL.test(text)) return { role: 'text', reason: 'non-generation' };
  if (hasMarker(text, VIDEO_MARKERS)) return { role: 'video', reason: 'video-family' };
  if (hasMarker(text, IMAGE_MARKERS)) return { role: 'image', reason: 'image-family' };
  // Generic markers last: they are common words, so they only decide after the
  // vendor families above had their chance.
  if (/(?:^|[/_.\s-])video(?:$|[/_.\s-])/.test(text) && !/video[-\s]?(?:understanding|analysis|input)/.test(text)) {
    return { role: 'video', reason: 'video-word' };
  }
  if (/(?:^|[/_.\s-])image(?:$|[/_.\s-])/.test(text) && !/image[-\s]?(?:understanding|analysis|caption)/.test(text)) {
    return { role: 'image', reason: 'image-word' };
  }
  return { role: 'text', reason: 'default' };
}

function asList(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    return value.split(/[,，\n]/).map(item => item.trim()).filter(Boolean);
  }
  return [];
}

function modelIdOf(value) {
  if (value && typeof value === 'object') {
    return String(value.id || value.model || value.modelId || value.model_id || '').trim();
  }
  return String(value || '').trim();
}

// `models` accepts plain ids ("gpt-image-1") or objects ({ id, role }); the
// role-specific lists are the unambiguous form and are what the tool schema
// advertises.
function normalizeModelSpecs(payload = {}) {
  const specs = [];
  const seen = new Set();
  const push = (value, roleHint = '') => {
    const id = modelIdOf(value);
    if (!id || seen.has(id)) return;
    seen.add(id);
    const objectHint = value && typeof value === 'object'
      ? (value.role || value.type || value.modelType || '')
      : '';
    const role = normalizeRole(objectHint || roleHint);
    specs.push({ id, role });
  };
  for (const item of asList(payload.models)) push(item);
  for (const item of asList(payload.image_models ?? payload.imageModels)) push(item, 'image');
  for (const item of asList(payload.video_models ?? payload.videoModels)) push(item, 'video');
  for (const item of asList(payload.text_models ?? payload.textModels)) push(item, 'text');
  return specs;
}

// Per-model flags are what the settings UI itself writes: image/video marks
// override the catalog classification, `enabled` opts a model in. Newly
// discovered models are disabled by the provider save path unless a flag says
// otherwise, so every media model we recognise is enabled here explicitly.
function buildConnectionModelFlags({ models = [], specs = [], enableAll = false } = {}) {
  const flags = {};
  const specById = new Map((Array.isArray(specs) ? specs : []).map(spec => [spec.id, spec]));
  const roleOf = model => {
    const spec = specById.get(model.id);
    if (spec?.role) return spec.role;
    return classifyModelRole(model.id, model.name).role;
  };
  for (const model of Array.isArray(models) ? models : []) {
    const id = modelIdOf(model);
    if (!id) continue;
    const role = roleOf({ ...model, id });
    if (role === 'image') flags[id] = { enabled: true, image: true };
    else if (role === 'video') flags[id] = { enabled: true, video: true };
  }
  for (const spec of Array.isArray(specs) ? specs : []) {
    if (!spec.id) continue;
    flags[spec.id] = { enabled: true, ...(flags[spec.id] || {}) };
  }
  if (enableAll) {
    for (const model of Array.isArray(models) ? models : []) {
      const id = modelIdOf(model);
      if (id) flags[id] = { ...(flags[id] || {}), enabled: true };
    }
  }
  return flags;
}

// Force one model into a role regardless of name-based classification.
function pinModelRole(flags, modelId, role) {
  const id = String(modelId || '').trim();
  if (!id) return flags;
  const next = { ...(flags[id] || {}), enabled: true };
  if (role === 'image') {
    next.image = true;
    delete next.video;
  } else if (role === 'video') {
    next.video = true;
    delete next.image;
  } else if (role === 'text') {
    next.image = false;
    next.video = false;
  }
  flags[id] = next;
  return flags;
}

// Never echo a credential back into the transcript or a tool result.
function maskSecret(secret) {
  const value = String(secret || '');
  if (!value) return '';
  if (value.length <= 8) return `${value.slice(0, 2)}…`;
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}

module.exports = {
  classifyModelRole,
  normalizeModelSpecs,
  buildConnectionModelFlags,
  pinModelRole,
  maskSecret,
  normalizeRole
};

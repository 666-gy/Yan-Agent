'use strict';
const { endpointInfo, isOfficialOpenAI } = require('./api-endpoint');
const { resolveModelCapabilities } = require('./model-capabilities');

// Compatibility presets for user-defined API connections. The UI form is
// vendor-free; these helpers infer the request shape (DSML, anthropic format,
// media body shapes) from the connection name/URL unless the user picks one
// explicitly. No model or vendor list is required to stay in sync — inference
// is string based and falls back to the generic OpenAI shape.

const CONNECTION_PRESETS = Object.freeze([
  'auto', 'openai', 'gptl', 'anthropic', 'deepseek', 'glm', 'qwen', 'doubao',
  'gemini', 'kimi', 'minimax', 'siliconflow', 'grok', 'agnes', 'stepfun',
  'hunyuan', 'mimo', 'opencode', 'opencode-go', 'opencode-zen', 'sensenova', 'jiyuan'
]);

const API_FORMATS = Object.freeze(['auto', 'openai', 'anthropic', 'chat', 'responses']);

function inferConnectionPreset(name, baseUrl) {
  const text = `${name || ''} ${baseUrl || ''}`.toLowerCase();
  if (text.includes('deepseek')) return 'deepseek';
  if (text.includes('bigmodel') || text.includes('zhipu') || text.includes('智谱')
    || /\bz\.ai\b|\bglm(?:\b|[-_])/i.test(text)) return 'glm';
  if (text.includes('anthropic') || text.includes('claude')) return 'anthropic';
  if (text.includes('gemini') || text.includes('generativelanguage.googleapis.com') || text.includes('google ai')) return 'gemini';
  if (text.includes('kimi') || text.includes('moonshot')) return 'kimi';
  if (text.includes('dashscope') || text.includes('qwen') || text.includes('aliyun')) return 'qwen';
  if (text.includes('doubao') || text.includes('volces') || text.includes('ark.cn')) return 'doubao';
  if (text.includes('minimax')) return 'minimax';
  if (text.includes('siliconflow')) return 'siliconflow';
  if (text.includes('grok') || text.includes('x.ai')) return 'grok';
  if (text.includes('agnes') || text.includes('agnes-ai')) return 'agnes';
  if (text.includes('stepfun') || text.includes('阶跃')) return 'stepfun';
  if (text.includes('hunyuan') || text.includes('混元')) return 'hunyuan';
  if (text.includes('opencode') || text.includes('open code')) return 'opencode';
  if (text.includes('sensenova') || text.includes('sensecore') || text.includes('sensetime') || text.includes('日日新')) return 'sensenova';
  if (text.includes('jiyuan') || text.includes('基元律动') || text.includes('基元')) return 'jiyuan';
  return 'openai';
}

// Model families whose request shape differs from the generic OpenAI one. A
// relay (中转站) can front several vendors behind one base URL, so the model the
// user actually selected identifies the wire shape far more reliably than the
// connection name the user typed. Kept deliberately conservative: a family is
// only matched on the model id itself, and families without a dedicated adapter
// (anthropic, doubao, minimax, ...) are reported for display but never switch a
// module, because their vendors speak the compatible shape.
const MODEL_PRESET_RULES = Object.freeze([
  ['deepseek', /(?:^|[/_.-])deepseek(?:$|[/\d_.-])/i],
  ['glm', /(?:^|[/_.-])(?:glm|chatglm)\d?(?:$|[/_.-])/i],
  ['qwen', /(?:^|[/_.-])(?:qwen|qwq|qvq)\d?(?:$|[/_.-])/i],
  ['kimi', /(?:^|[/_.-])(?:kimi|moonshot)(?:$|[/\d_.-])/i],
  ['gemini', /(?:^|[/_.-])gemini(?:$|[/\d_.-])/i],
  ['grok', /(?:^|[/_.-])grok(?:$|[/\d_.-])/i],
  ['agnes', /(?:^|[/_.-])agnes(?:$|[/\d_.-])/i],
  ['anthropic', /(?:^|[/_.-])(?:claude|anthropic)(?:$|[/\d_.-])/i],
  ['doubao', /(?:^|[/_.-])(?:doubao|seed[-_]?\d)(?:$|[/_.-])/i],
  ['minimax', /(?:^|[/_.-])(?:minimax|abab)\d?(?:$|[/_.-])/i],
  ['stepfun', /(?:^|[/_.-])step[-_.]?\d(?:$|[/_.-])/i],
  ['hunyuan', /(?:^|[/_.-])hunyuan(?:$|[/\d_.-])/i],
  ['sensenova', /(?:^|[/_.-])(?:sensenova|sensechat)(?:$|[/\d_.-])/i],
  ['jiyuan', /(?:^|[/_.-])jiyuan(?:$|[/\d_.-])/i],
  // The family that needs no adapter is still worth naming: once the model has
  // been identified as a generic OpenAI-shaped one, a vendor-flavoured
  // connection name must not talk the resolver out of it.
  ['openai', /(?:^|[/_.-])(?:gpt|chatgpt|davinci|o[1-9])(?:$|[/\d_.-])/i]
]);

/**
 * Identify the vendor family from a model id alone.
 * @returns {string|undefined} a CONNECTION_PRESETS member, or undefined when
 *   the model says nothing about its vendor.
 */
function inferPresetFromModel(modelId) {
  const model = String(modelId || '').trim();
  if (!model) return undefined;
  // Aliased ids arrive as "vendor/model"; the tail carries the family.
  const tail = model.split('/').at(-1);
  for (const [preset, pattern] of MODEL_PRESET_RULES) {
    if (pattern.test(tail)) return preset;
  }
  return undefined;
}

/**
 * Resolve the preset a connection actually speaks.
 *
 * Priority: the API format the user forced > the preset the user picked by hand
 * > the vendor family of the selected model > the connection name/URL. The
 * model deliberately outranks the name: on a multi-vendor relay the name is
 * arbitrary ("我的中转"), and even a vendor-flavoured name such as
 * "DeepSeek 中转" must not turn a GLM model into a DSML request.
 */
function resolveConnectionPreset(connection, name, baseUrl, modelId) {
  if (String(connection?.apiFormat || '').toLowerCase() === 'gptl') return 'gptl';
  const stored = String(connection?.preset || 'auto').trim();
  if (stored && stored !== 'auto' && CONNECTION_PRESETS.includes(stored)) return stored;
  const fromModel = inferPresetFromModel(modelId);
  if (fromModel) return fromModel;
  return inferConnectionPreset(name, baseUrl);
}

function apiFormatForPreset(preset) {
  return String(preset || '').trim().toLowerCase() === 'anthropic' ? 'anthropic' : 'openai';
}

function normalizeApiFormat(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return API_FORMATS.includes(normalized) ? normalized : 'auto';
}

// An explicit user choice wins; otherwise the anthropic preset switches the
// wire protocol and every other preset stays on the OpenAI-compatible shape.
function resolveConnectionApiFormat(connection, name, baseUrl) {
  const explicit = normalizeApiFormat(connection?.apiFormat);
  if (explicit !== 'auto') return explicit;
  const endpointFormat = endpointInfo(baseUrl).format;
  if (endpointFormat) return endpointFormat;
  if (resolveConnectionPreset(connection, name, baseUrl) === 'gptl' && isOfficialOpenAI(baseUrl)) return 'auto';
  // A vendor may offer multiple wire protocols; its name is not the protocol.
  if (/\/api\/anthropic(?:\/|$)/i.test(String(baseUrl || ''))) return 'anthropic';
  return apiFormatForPreset(resolveConnectionPreset(connection, name, baseUrl));
}

function normalizeCustomModelIds(raw) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const id = String(typeof entry === 'string' ? entry : entry?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
    if (out.length >= 50) break;
  }
  return out;
}

function normalizeConnectionStore(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const cleaned = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const id = String(item.id || '').trim();
    const providerId = String(item.providerId || '').trim();
    const supplierId = String(item.supplierId || 'official').trim() || 'official';
    if (!id || !providerId || seen.has(id)) continue;
    seen.add(id);
    const preset = String(item.apiFormat || '').toLowerCase() === 'gptl' ? 'gptl'
      : CONNECTION_PRESETS.includes(String(item.preset || '')) ? String(item.preset) : 'auto';
    let customModels = normalizeCustomModelIds(item.customModels);
    const manualModelId = String(item.manualModelId || '').trim();
    // Older builds kept a single custom model id; seed the list from it so the
    // upgrade is lossless.
    if (!customModels.length && manualModelId) customModels = [manualModelId];
    cleaned.push({
      id,
      providerId,
      supplierId,
      preset,
      apiFormat: normalizeApiFormat(item.apiFormat),
      manualModelId: customModels[0] || manualModelId,
      customModels,
      modelFlags: normalizeModelFlags(item.modelFlags),
      createdAt: Math.max(0, Number(item.createdAt) || 0)
    });
  }
  return cleaned;
}

const CONNECTION_MODEL_CAP_KEYS = Object.freeze(['multimodal', 'image', 'video']);
const CONNECTION_MODEL_NUMERIC_KEYS = Object.freeze(['contextWindow', 'compactionThreshold', 'maxOutputTokens']);

function connectionModelFlagsFor(cfg, providerId) {
  if (!String(providerId || '').startsWith('conn-')) return null;
  const connection = (cfg?.api?.connections || []).find(item => item.providerId === providerId);
  const flags = connection?.modelFlags;
  return flags && typeof flags === 'object' && Object.keys(flags).length ? flags : null;
}

function flaggedModelType(flags, model) {
  const entry = flags?.[model?.id];
  if (!entry) return null;
  if (entry.video === true) return 'video';
  if (entry.image === true) return 'image';
  if (entry.video === false || entry.image === false) return 'text';
  return null;
}

// Applies the user's per-model marks (type override, vision, per-model context
// window, enable flag) onto a model catalog for one connection.
//
// `capabilityProviderId` is the id whose capability preset the caller decorated
// with (for a custom connection that is the preset guessed from the model
// family, not the dynamic `conn-*` id). It only matters for models the user
// marked multimodal: that mark changes whether the model accepts images, so
// every field derived from that answer has to be recomputed. Patching only
// `vision` left `imageInput` (plus `imageMimeTypes` / `maxImageBytes`) stale,
// and the relay gate reads `imageInput` alone - so a model the kernel already
// declared image-capable was still refused before the request was built.
function applyConnectionModelFlags(flags, models, capabilityProviderId = '') {
  if (!flags) return models;
  return (Array.isArray(models) ? models : []).map(model => {
    const entry = flags[model.id];
    if (!entry) return model;
    const type = flaggedModelType(flags, model);
    const next = { ...model };
    if (type) {
      next.modelType = type;
      // Keep the derived capability in sync: getModelType() reads
      // capabilities.modelType first, so a stale 'text' there would make an
      // image/video-marked model look like a text model to the pickers.
      next.capabilities = { ...(next.capabilities || model.capabilities || {}), modelType: type };
    }
    if (entry.multimodal === true) {
      next.capabilities = { ...(next.capabilities || model.capabilities || {}), vision: true };
      // Recompute before the numeric overrides below: the derived set can carry
      // a family output cap that must not overwrite the user's own budget.
      next.capabilities = {
        ...next.capabilities,
        ...resolveModelCapabilities(capabilityProviderId, next)
      };
    }
    const contextWindow = Math.round(Number(entry.contextWindow));
    if (Number.isFinite(contextWindow) && contextWindow > 0) {
      // A per-model context override wins over the catalog's declared window.
      next.capabilities = { ...(next.capabilities || model.capabilities || {}), contextWindow };
      next.contextWindow = contextWindow;
      if (!(Number(entry.compactionThreshold) > 0)) {
        next.capabilities.compactionThreshold = Math.floor(contextWindow * 0.8);
        next.compactionThreshold = next.capabilities.compactionThreshold;
      }
    }
    const compactionThreshold = Math.round(Number(entry.compactionThreshold));
    if (Number.isFinite(compactionThreshold) && compactionThreshold > 0) {
      next.capabilities = { ...(next.capabilities || model.capabilities || {}), compactionThreshold };
      next.compactionThreshold = compactionThreshold;
    }
    const maxOutputTokens = Math.round(Number(entry.maxOutputTokens));
    if (Number.isFinite(maxOutputTokens) && maxOutputTokens > 0) {
      // The user's output budget wins over the family default: relays often
      // cap output below (or above) what the model family officially allows.
      // userMaxOutputTokens marks the budget as user-set: only that one may
      // exceed the sidecar's default ceiling.
      next.capabilities = {
        ...(next.capabilities || model.capabilities || {}),
        maxOutputTokens,
        userMaxOutputTokens: maxOutputTokens
      };
      next.maxOutputTokens = maxOutputTokens;
    }
    if (typeof entry.enabled === 'boolean') next.enabled = entry.enabled;
    return next;
  });
}

function normalizeModelFlags(raw) {
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [rawId, value] of Object.entries(raw)) {
    const id = String(rawId || '').trim();
    if (!id || !value || typeof value !== 'object') continue;
    const entry = {};
    for (const cap of CONNECTION_MODEL_CAP_KEYS) {
      if (typeof value[cap] === 'boolean') entry[cap] = value[cap];
    }
    for (const key of CONNECTION_MODEL_NUMERIC_KEYS) {
      const number = Math.round(Number(value[key]));
      if (Number.isFinite(number) && number > 0) entry[key] = number;
    }
    if (typeof value.enabled === 'boolean') entry.enabled = value.enabled;
    if (Object.keys(entry).length) out[id] = entry;
  }
  return out;
}

module.exports = {
  API_FORMATS,
  CONNECTION_PRESETS,
  apiFormatForPreset,
  inferConnectionPreset,
  inferPresetFromModel,
  normalizeApiFormat,
  normalizeConnectionStore,
  normalizeCustomModelIds,
  normalizeModelFlags,
  connectionModelFlagsFor,
  applyConnectionModelFlags,
  resolveConnectionApiFormat,
  resolveConnectionPreset
};

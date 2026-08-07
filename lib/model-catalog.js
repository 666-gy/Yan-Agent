'use strict';

const CATALOG_WRAPPER_KEYS = Object.freeze([
  'data',
  'models',
  'items',
  'list',
  'result',
  'response',
  'body',
  'payload'
]);
const MODEL_ID_KEYS = Object.freeze(['id', 'model', 'model_id', 'modelId', 'slug', 'name']);
const MODEL_NAME_KEYS = Object.freeze(['display_name', 'displayName', 'title', 'label', 'name']);
const CATALOG_METADATA_KEYS = new Set([
  'object',
  'type',
  'owned_by',
  'created',
  'created_at',
  'updated_at',
  'total',
  'total_count',
  'count',
  'has_more',
  'next',
  'next_page',
  'first_id',
  'last_id',
  'success',
  'ok',
  'code',
  'message',
  'status'
]);
const MAX_WRAPPER_DEPTH = 5;
const MAX_JSON_STRING_LAYERS = 2;

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function cleanModelId(value) {
  if (typeof value !== 'string') return '';
  const id = value.trim();
  if (!id || id.length > 240) return '';
  for (let index = 0; index < id.length; index++) {
    const code = id.charCodeAt(index);
    if (code < 32 || code === 127) return '';
  }
  return id;
}

function readModelId(item) {
  if (typeof item === 'string') return cleanModelId(item);
  if (!isPlainObject(item)) return '';
  for (const key of MODEL_ID_KEYS) {
    const id = cleanModelId(item[key]);
    if (id) return id;
  }
  return '';
}

function readStrongModelId(item) {
  if (!isPlainObject(item)) return '';
  for (const key of MODEL_ID_KEYS) {
    if (key === 'name') continue;
    const id = cleanModelId(item[key]);
    if (id) return id;
  }
  return '';
}

function readModelName(item) {
  if (!isPlainObject(item)) return '';
  for (const key of MODEL_NAME_KEYS) {
    const name = cleanModelId(item[key]);
    if (name) return name;
  }
  return '';
}

function normalizeRemoteModels(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const models = [];
  for (const item of items) {
    const id = readModelId(item);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const remoteName = readModelName(item);
    const inputModalities = typeof item === 'object' && item
      ? (item.inputModalities || item.input_modalities || item.modalities?.input || item.capabilities?.input_modalities || item.capabilities?.input)
      : null;
    const outputModalities = typeof item === 'object' && item
      ? (item.outputModalities || item.output_modalities || item.modalities?.output || item.capabilities?.output_modalities || item.capabilities?.output)
      : null;
    const explicitModelType = typeof item === 'object' && item
      ? String(item.modelType || item.model_type || item.capabilities?.modelType || item.capabilities?.model_type || '').trim().toLowerCase()
      : '';
    const explicitVision = typeof item === 'object' && item && typeof item.capabilities?.vision === 'boolean'
      ? item.capabilities.vision
      : null;
    const model = { id, name: remoteName || id };
    if (Array.isArray(inputModalities)) model.inputModalities = inputModalities.map(String);
    if (Array.isArray(outputModalities)) model.outputModalities = outputModalities.map(String);
    if (['text', 'image', 'video'].includes(explicitModelType)) {
      model.modelType = explicitModelType;
    } else if (Array.isArray(outputModalities)) {
      const outputs = outputModalities.map(value => String(value).toLowerCase());
      if (!outputs.includes('text') && outputs.includes('video')) model.modelType = 'video';
      else if (!outputs.includes('text') && outputs.includes('image')) model.modelType = 'image';
    }
    if (explicitVision !== null) model.capabilities = { vision: explicitVision };
    models.push(model);
    if (models.length >= 500) break;
  }
  return models;
}

function decodeJsonValue(value) {
  let current = value;
  for (let layer = 0; layer < MAX_JSON_STRING_LAYERS && typeof current === 'string'; layer++) {
    const text = current.trim();
    if (!text) return current;
    const first = text[0];
    if (first !== '[' && first !== '{' && first !== '"') return current;
    try {
      current = JSON.parse(text);
    } catch {
      return current;
    }
  }
  return current;
}

function mappingToModelItems(value, allowStringValues) {
  if (!isPlainObject(value)) return null;
  const entries = Object.entries(value).filter(([key]) => !CATALOG_METADATA_KEYS.has(key));
  if (!entries.length) return allowStringValues ? [] : null;

  const items = [];
  for (const [key, rawValue] of entries) {
    const idFromKey = cleanModelId(key);
    if (!idFromKey || CATALOG_WRAPPER_KEYS.includes(key) || key === 'error' || key === 'errors') return null;
    const item = decodeJsonValue(rawValue);
    if (isPlainObject(item)) {
      items.push(readModelId(item) ? item : { ...item, id: idFromKey });
      continue;
    }
    if (allowStringValues && typeof item === 'string') {
      items.push({ id: idFromKey, name: item });
      continue;
    }
    if (item === null) {
      items.push({ id: idFromKey });
      continue;
    }
    return null;
  }
  return items;
}

function findCatalogItems(value, depth = 0, wrapped = false) {
  if (depth > MAX_WRAPPER_DEPTH) return null;
  const decoded = decodeJsonValue(value);
  if (Array.isArray(decoded)) return decoded;
  if (!isPlainObject(decoded)) return null;

  let emptyCandidate = null;
  for (const key of CATALOG_WRAPPER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(decoded, key)) continue;
    const nested = findCatalogItems(decoded[key], depth + 1, true);
    if (nested === null) continue;
    if (nested.length > 0) return nested;
    emptyCandidate = nested;
  }
  if (emptyCandidate !== null) return emptyCandidate;

  const singleModelId = wrapped ? readModelId(decoded) : readStrongModelId(decoded);
  if (singleModelId) return [decoded];

  return mappingToModelItems(decoded, wrapped);
}

function catalogErrorMessage(payload) {
  if (!isPlainObject(payload)) return '';
  const error = payload.error ?? payload.errors;
  const firstError = Array.isArray(error) ? error[0] : error;
  if (typeof firstError === 'string') return firstError;
  if (isPlainObject(firstError)) {
    return String(firstError.message || firstError.detail || firstError.code || '').trim();
  }
  if (payload.success === false || payload.ok === false) {
    return String(payload.message || payload.detail || payload.code || '').trim();
  }
  return '';
}

function findCatalogError(payload, depth = 0) {
  if (depth > MAX_WRAPPER_DEPTH) return '';
  const decoded = decodeJsonValue(payload);
  const direct = catalogErrorMessage(decoded);
  if (direct) return direct;
  if (!isPlainObject(decoded)) return '';
  for (const key of CATALOG_WRAPPER_KEYS) {
    if (!Object.prototype.hasOwnProperty.call(decoded, key)) continue;
    const nested = findCatalogError(decoded[key], depth + 1);
    if (nested) return nested;
  }
  return '';
}

function parseRemoteModelCatalog(payload) {
  const decoded = decodeJsonValue(payload);
  const remoteError = findCatalogError(decoded);
  if (remoteError) throw new Error(`模型接口返回错误：${remoteError.slice(0, 300)}`);
  const items = findCatalogItems(decoded);
  if (items === null) {
    throw new Error('模型接口未返回可识别的模型列表');
  }
  const models = normalizeRemoteModels(items);
  if (items.length > 0 && models.length === 0) {
    throw new Error('模型列表存在，但没有可识别的模型 ID');
  }
  return models;
}

function readApiError(payload, fallback) {
  const message = payload?.error?.message || payload?.message || fallback || '请求失败';
  return String(message).slice(0, 300);
}

async function fetchRemoteModelCatalog({ baseUrl, apiKey, apiFormat = 'openai', fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!String(apiKey || '').trim()) throw new Error('请先填写 API Key');
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${String(baseUrl || '').replace(/\/$/, '')}/models`;
    const headers = String(apiFormat).toLowerCase() === 'anthropic'
      ? {
          Accept: 'application/json',
          'x-api-key': String(apiKey).trim(),
          'anthropic-version': '2023-06-01'
        }
      : {
          Accept: 'application/json',
          Authorization: `Bearer ${String(apiKey).trim()}`
        };
    const response = await fetchImpl(url, {
      method: 'GET',
      headers,
      signal: controller.signal
    });
    const text = await response.text();
    let payload = text || null;
    try { payload = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${readApiError(payload, text)}`);
    return parseRemoteModelCatalog(payload);
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('加载模型超时，请稍后重试');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  CATALOG_WRAPPER_KEYS,
  fetchRemoteModelCatalog,
  normalizeRemoteModels,
  parseRemoteModelCatalog
};

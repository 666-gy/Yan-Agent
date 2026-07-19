'use strict';

function normalizeRemoteModels(items) {
  if (!Array.isArray(items)) return [];
  const seen = new Set();
  const models = [];
  for (const item of items) {
    const id = String(typeof item === 'string' ? item : item?.id || '').trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const remoteName = typeof item === 'object' && item
      ? String(item.display_name || item.name || '').trim()
      : '';
    const inputModalities = typeof item === 'object' && item
      ? (item.inputModalities || item.input_modalities || item.modalities?.input || item.capabilities?.input_modalities || item.capabilities?.input)
      : null;
    const explicitVision = typeof item === 'object' && item && typeof item.capabilities?.vision === 'boolean'
      ? item.capabilities.vision
      : null;
    const model = { id, name: remoteName || id, price: '' };
    if (Array.isArray(inputModalities)) model.inputModalities = inputModalities.map(String);
    if (explicitVision !== null) model.capabilities = { vision: explicitVision };
    models.push(model);
    if (models.length >= 500) break;
  }
  return models;
}

function parseRemoteModelCatalog(payload) {
  const items = Array.isArray(payload)
    ? payload
    : (Array.isArray(payload?.data) ? payload.data : null);
  if (!items) throw new Error('模型接口未返回标准的 data 数组');
  return normalizeRemoteModels(items);
}

function readApiError(payload, fallback) {
  const message = payload?.error?.message || payload?.message || fallback || '请求失败';
  return String(message).slice(0, 300);
}

async function fetchRemoteModelCatalog({ baseUrl, apiKey, fetchImpl = globalThis.fetch, timeoutMs = 15000 }) {
  if (!String(apiKey || '').trim()) throw new Error('请先填写 API Key');
  if (typeof fetchImpl !== 'function') throw new Error('当前运行环境不支持网络请求');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `${String(baseUrl || '').replace(/\/$/, '')}/models`;
    const response = await fetchImpl(url, {
      method: 'GET',
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${String(apiKey).trim()}`
      },
      signal: controller.signal
    });
    const text = await response.text();
    let payload = null;
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
  fetchRemoteModelCatalog,
  normalizeRemoteModels,
  parseRemoteModelCatalog
};

'use strict';

const fs = require('fs');
const path = require('path');

// This is a runtime input, never a member of the persistent/public Yan config.
const PROVIDER_ID = 'magpie-runtime';
const MAX_BYTES = 2 * 1024 * 1024;
function invalid() { throw new Error('Magpie 配置无效，请重新连接或删除 magpie.json 后重试。'); }
function text(value, max) {
  return typeof value === 'string' && value.length > 0 && value.length <= max
    && value === value.trim() && !/[\x00-\x1f\x7f]/.test(value);
}
function tokens(value) {
  return Number.isSafeInteger(value) && value > 0 && value <= 10000000 ? value : undefined;
}
function readMagpieConfig(dataDir) {
  let raw;
  try {
    const file = path.join(dataDir, 'magpie.json');
    if (fs.statSync(file).size > MAX_BYTES) invalid();
    raw = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    invalid();
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) invalid();
  // Magpie restores absent fields by removing them; an empty object is off.
  if (!Object.keys(raw).length || raw.enabled === false) return null;
  if (raw.version !== 1 || raw.enabled !== true || raw.apiFormat !== 'openai'
    || !text(raw.model, 512) || !text(raw.apiKey, 8192) || !text(raw.baseUrl, 2048)
    || !Array.isArray(raw.models) || raw.models.length > 10000) invalid();
  let url;
  try { url = new URL(raw.baseUrl); } catch { invalid(); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) invalid();
  const model = raw.models.find(entry => entry && entry.id === raw.model);
  if (!model || !text(model.id, 512)) invalid();
  const efforts = Array.isArray(model.efforts)
    ? [...new Set(model.efforts.filter(value => ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'].includes(value)))] : [];
  const capabilities = {
    imageInput: model.images === true,
    vision: model.images === true,
    reasoning: efforts.some(value => value !== 'none'),
    reasoningEffortLevels: efforts,
    ...(tokens(model.output) ? { maxOutputTokens: tokens(model.output) } : {})
  };
  return {
    selection: { providerId: PROVIDER_ID, supplierId: 'magpie', modelId: model.id,
      modelType: 'text', name: text(model.name, 512) ? model.name : model.id, capabilities },
    connection: { baseUrl: url.href.replace(/\/$/, ''), apiKey: raw.apiKey },
    contextWindow: tokens(model.context),
    apiFormat: 'openai'
  };
}

module.exports = { readMagpieConfig, PROVIDER_ID };

'use strict';

const DEFAULT_CONTEXT_SETTINGS = Object.freeze({
  maxTokens: 1_000_000,
  compactionThreshold: 800_000
});

function positiveSafeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) return 0;
  const rounded = Math.round(number);
  return Number.isSafeInteger(rounded) && rounded > 0 ? rounded : 0;
}

function normalizeContextSettings(value = {}, fallback = DEFAULT_CONTEXT_SETTINGS) {
  const source = value && typeof value === 'object' ? value : {};
  const fallbackSource = fallback && typeof fallback === 'object' ? fallback : DEFAULT_CONTEXT_SETTINGS;
  const maxTokens = positiveSafeInteger(source.maxTokens)
    || positiveSafeInteger(fallbackSource.maxTokens)
    || DEFAULT_CONTEXT_SETTINGS.maxTokens;
  const requestedThreshold = positiveSafeInteger(source.compactionThreshold)
    || positiveSafeInteger(fallbackSource.compactionThreshold)
    || DEFAULT_CONTEXT_SETTINGS.compactionThreshold;
  return {
    maxTokens,
    compactionThreshold: requestedThreshold < maxTokens
      ? requestedThreshold
      : Math.max(1, maxTokens - 1)
  };
}

function contextKToTokens(value) {
  const raw = String(value ?? '').trim();
  if (!/^(?:\d+(?:\.\d*)?|\.\d+)$/.test(raw)) return 0;
  return positiveSafeInteger(Number(raw) * 1_000);
}

function contextTokensToK(value) {
  const tokens = positiveSafeInteger(value);
  return tokens ? String(tokens / 1_000) : '';
}

function resolveModelContextSettings(options = {}) {
  const explicit = positiveSafeInteger(options.contextWindow);
  const declared = positiveSafeInteger(options.capabilities?.contextWindow);
  // A user override may describe a gateway with a larger window. Never clamp
  // it to the model catalog. Only an absent override uses model defaults.
  const maxTokens = explicit || declared || 128000;
  const threshold = positiveSafeInteger(options.compactionThreshold)
    || Math.floor(maxTokens * 0.8);
  return { ...normalizeContextSettings({ maxTokens, compactionThreshold: threshold }),
    source: explicit ? 'manual' : declared ? 'model' : 'fallback' };
}

module.exports = {
  DEFAULT_CONTEXT_SETTINGS,
  normalizeContextSettings,
  contextKToTokens,
  contextTokensToK,
  resolveModelContextSettings
};

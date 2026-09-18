'use strict';

const REASONING_SPEED_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const LEGACY_REASONING_SPEED_MAP = Object.freeze({
  fast: 'low',
  balanced: 'medium',
  smart: 'high'
});

// Model-specific reasoning budgets. A model that silently treats unknown
// values as its maximum (GLM-5.3-Flash 官方文档：仅 low/high/max，其他值按 max)
// turns a user's "medium" into the slowest tier — so we map explicitly to the
// NEAREST supported value (ties round UP: quality-preserving, never dumber
// than requested, and strictly faster than the official silent-max fallback).
const MODEL_REASONING_CAPABILITIES = Object.freeze({
  'glm-5.3': Object.freeze({ supported: Object.freeze(['low', 'high', 'max']), tieBreak: 'up' }),
  'qwen3.8-max': Object.freeze({ supported: Object.freeze(['low', 'medium', 'xhigh']), tieBreak: 'up' }),
  'qwen3.8-flash-next': Object.freeze({ supported: Object.freeze(['low', 'medium', 'xhigh']), tieBreak: 'up' }),
  'kimi-k3': Object.freeze({ supported: Object.freeze(['low', 'high', 'max']), tieBreak: 'up' })
});

function normalizeReasoningSpeed(value, { thinking = false } = {}) {
  const normalized = String(value || '').trim().toLowerCase();
  if (REASONING_SPEED_LEVELS.includes(normalized)) return normalized;
  if (LEGACY_REASONING_SPEED_MAP[normalized]) return LEGACY_REASONING_SPEED_MAP[normalized];
  return thinking ? 'high' : 'medium';
}

function reasoningSpeedEnablesThinking(value) {
  return ['high', 'xhigh', 'max'].includes(normalizeReasoningSpeed(value));
}

// Resolve the effort value actually safe to send for a given model.
// Returns { effort, adjusted, requested?, model? } — adjusted=true means the
// requested tier is not supported by this model and was mapped explicitly.
function resolveReasoningForModel(modelId, requested, { thinking = false, supported = null, capabilityLabel = '' } = {}) {
  const effort = normalizeReasoningSpeed(requested, { thinking });
  const key = String(modelId || '').toLowerCase();
  const explicitSupported = Array.isArray(supported)
    ? [...new Set(supported.map(value => String(value || '').trim().toLowerCase()))]
      .filter(value => REASONING_SPEED_LEVELS.includes(value))
    : [];
  const capability = explicitSupported.length
    ? [String(capabilityLabel || modelId || 'model'), { supported: explicitSupported, tieBreak: 'up' }]
    : Object.entries(MODEL_REASONING_CAPABILITIES).find(([id]) => {
      const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      return new RegExp(`(?:^|[/\\s])${escaped}(?:[-:\\s]|\\[|$)`, 'i').test(key);
    });
  if (!capability) return { effort, adjusted: false };
  const [id, spec] = capability;
  if (spec.supported.includes(effort)) return { effort, adjusted: false };
  const order = REASONING_SPEED_LEVELS;
  const rank = order.indexOf(effort);
  let nearest = null;
  let nearestDistance = Infinity;
  for (const candidate of spec.supported) {
    const distance = Math.abs(order.indexOf(candidate) - rank);
    if (distance < nearestDistance
      || (distance === nearestDistance && spec.tieBreak === 'up'
        && order.indexOf(candidate) > order.indexOf(nearest))) {
      nearest = candidate;
      nearestDistance = distance;
    }
  }
  return { effort: nearest, adjusted: true, requested: effort, model: id };
}

module.exports = {
  LEGACY_REASONING_SPEED_MAP,
  MODEL_REASONING_CAPABILITIES,
  REASONING_SPEED_LEVELS,
  normalizeReasoningSpeed,
  reasoningSpeedEnablesThinking,
  resolveReasoningForModel
};

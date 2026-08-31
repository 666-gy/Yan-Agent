'use strict';

const REASONING_SPEED_LEVELS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
const LEGACY_REASONING_SPEED_MAP = Object.freeze({
  fast: 'low',
  balanced: 'medium',
  smart: 'high'
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

module.exports = {
  LEGACY_REASONING_SPEED_MAP,
  REASONING_SPEED_LEVELS,
  normalizeReasoningSpeed,
  reasoningSpeedEnablesThinking
};

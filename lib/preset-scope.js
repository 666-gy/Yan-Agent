'use strict';

const { normalizeAgentPreset } = require('./custom-agents');

// Relay providers and upstream gateways can reject an entire request when its
// prompt carries the uncensored preset's wording, even for a standard-mode run.
// Keep that wording inside uncensored runs by filtering memory, policies and
// harness entries before they are rendered into a system prompt.
const UNCENSORED_CONTENT_RE = /无审查|uncensored/i;

function isUncensoredPreset(request = {}) {
  return normalizeAgentPreset(request.agentPreset) === 'uncensored';
}

function presetContentAllowed(text, request = {}) {
  return isUncensoredPreset(request) || !UNCENSORED_CONTENT_RE.test(String(text ?? ''));
}

function filterPresetEntries(items, request = {}, textOf = item => String(item?.content ?? '')) {
  const list = Array.isArray(items) ? items : [];
  if (isUncensoredPreset(request)) return list;
  return list.filter(item => presetContentAllowed(textOf(item), request));
}

module.exports = { UNCENSORED_CONTENT_RE, isUncensoredPreset, presetContentAllowed, filterPresetEntries };

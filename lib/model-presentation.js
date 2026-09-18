(function exposeModelPresentation(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanModelPresentation = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // GPT classification lives in lib/gpt-model-profile.js. Node reaches it via
  // require; the renderer loads it as a plain script before this file, so the
  // browser path reads the same table instead of keeping a second regex.
  let gptProfile = null;
  if (typeof module === 'object' && module.exports) {
    try {
      gptProfile = require('./gpt-model-profile.js');
    } catch {
      gptProfile = null;
    }
  }
  if (!gptProfile && typeof globalThis !== 'undefined' && globalThis.YanGptModelProfile) {
    gptProfile = globalThis.YanGptModelProfile;
  }

  function normalizeModelId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const slash = raw.lastIndexOf('/');
    return slash >= 0 ? raw.slice(slash + 1) : raw;
  }

  function isGptActionProgressModel(value) {
    const modelId = normalizeModelId(value);
    if (!modelId) return false;
    if (typeof gptProfile?.presentationModeFor === 'function') {
      return gptProfile.presentationModeFor(modelId) === 'gpt-action-progress';
    }
    return /^(?:gpt(?:[-_.]|\d|$)|o[134](?:[-_.]|\d|$)|codex(?:[-_.]|\d|$))/i.test(modelId);
  }

  function presentationModeForModel(value) {
    return isGptActionProgressModel(value) ? 'gpt-action-progress' : 'standard';
  }

  return { normalizeModelId, isGptActionProgressModel, presentationModeForModel };
}));

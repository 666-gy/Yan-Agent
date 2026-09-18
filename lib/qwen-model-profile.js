(function exposeQwenModelProfile(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanQwenModelProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // Contracts verified against Qwen's September 2026 docs. Unknown versions
  // remain passthrough; a family name alone does not prove capabilities.
  function normalizeModelId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const slash = raw.lastIndexOf('/');
    const bare = slash >= 0 ? raw.slice(slash + 1) : raw;
    return bare.startsWith('qwen/') ? bare.slice(5) : bare;
  }

  // 'qwen3.8-max' → { major: 3, minor: 8, variant: 'max' }
  // 'qwen3-coder-plus' → { major: 3, minor: null, variant: 'coder-plus' }
  function parseQwenVersion(id) {
    const match = /^qwen-?(\d+)(?:\.(\d+))?(?:[-_]?([a-z0-9][a-z0-9._-]*))?$/.exec(id);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: match[2] == null ? null : Number(match[2]),
      variant: String(match[3] || '').replace(/-\d{4}-\d{2}-\d{2}$/, '')
    };
  }

  const cache = new Map();

  function profileFor(value) {
    const id = normalizeModelId(value);
    if (!id) return baseProfile('');
    const cached = cache.get(id);
    if (cached) return cached;
    const profile = buildProfile(id);
    cache.set(id, profile);
    return profile;
  }

  function baseProfile(id) {
    return {
      id,
      kind: 'unknown',
      family: '',
      major: 0,
      minor: null,
      variant: '',
      hybridThinking: false,
      defaultThinking: false,
      thinkingOnly: false,
      explicitCache: false,
      minCacheTokens: 1024,
      reasoningContentField: 'reasoning_content',
      efforts: Object.freeze([]),
      vision: false
    };
  }

  function buildProfile(id) {
    const profile = { ...baseProfile(id) };

    if (/^qwen-(?:plus|flash|turbo)(?:-|$)/.test(id)) {
      return Object.freeze({ ...profile, kind: 'qwen', hybridThinking: true });
    }
    const version = parseQwenVersion(id);
    if (!version) return Object.freeze(profile);
    Object.assign(profile, version, { family: `qwen${version.major}${version.minor == null ? '' : `.${version.minor}`}` });
    if (version.major < 3) return Object.freeze({ ...profile, kind: 'qwen-legacy' });
    if (version.major !== 3 || ![5, 6, 7, 8].includes(version.minor)) return Object.freeze(profile);
    const knownVariant = /^(?:max|plus|flash|27b|2\.4t-a95b|thinking)(?:-|$)/.test(version.variant);
    if (!knownVariant) return Object.freeze(profile);
    profile.kind = 'qwen';
    profile.thinkingOnly = /(?:^|-)thinking(?:-|$)/.test(version.variant)
      || (version.minor === 8 && /^2\.4t-a95b(?:-|$)/.test(version.variant));
    profile.hybridThinking = !profile.thinkingOnly;
    profile.defaultThinking = true;
    profile.explicitCache = true;
    profile.vision = /^(?:plus|flash)(?:-|$)/.test(version.variant)
      || (version.minor === 8 && /^max(?:-|$)/.test(version.variant));
    if (version.minor === 8 && /^(?:max|flash-next)(?:-|$)/.test(version.variant)) {
      profile.efforts = Object.freeze(['low', 'medium', 'xhigh']);
    }
    return Object.freeze(profile);
  }

  function enableThinkingFor(modelId, requestedEffort) {
    const profile = profileFor(modelId);
    if (!profile.hybridThinking || requestedEffort == null) return null;
    return !['none', 'off', 'disabled', 'false'].includes(String(requestedEffort).trim().toLowerCase());
  }

  return {
    normalizeModelId,
    parseQwenVersion,
    profileFor,
    enableThinkingFor
  };
}));

(function exposeKimiModelProfile(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanKimiModelProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // Known contracts only. Future releases do not inherit protocol constraints.
  const K3_RULES = Object.freeze({
    alwaysThinking: true,
    efforts: Object.freeze(['low', 'high', 'max']),
    defaultEffort: 'max',
    reasoningContentField: 'reasoning_content',
    multiTurnReasoningReplay: true,
    vision: true,
    contextWindow: 1_000_000,
    stripSampling: true
  });

  function normalizeModelId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const slash = raw.lastIndexOf('/');
    const bare = slash >= 0 ? raw.slice(slash + 1) : raw;
    return bare.startsWith('moonshot/') || bare.startsWith('kimi/')
      ? bare.slice(bare.indexOf('/') + 1) : bare;
  }

  // 'kimi-k3' → { major: 3, minor: null, variant: '' }
  // 'kimi-k2.6' / 'kimi-k2-6' → { major: 2, minor: 6, variant: '' }
  // 'kimi-k2-turbo-0711' → { major: 2, minor: null, variant: 'turbo' }
  function parseKimiVersion(id) {
    const match = /^kimi-?k(\d+)(?:[._-](\d+))?(?:[-_]?([a-z0-9][a-z0-9._-]*))?$/.exec(id);
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
      alwaysThinking: false,
      efforts: Object.freeze([]),
      defaultEffort: '',
      reasoningContentField: 'reasoning_content',
      multiTurnReasoningReplay: false,
      vision: false,
      contextWindow: 0,
      stripSampling: false,
      minCachePrefixTokens: 256
    };
  }

  function buildProfile(id) {
    const profile = { ...baseProfile(id) };

    const version = parseKimiVersion(id);
    if (!version) return Object.freeze(profile);

    profile.major = version.major;
    profile.minor = version.minor;
    profile.variant = version.variant;
    profile.family = `kimi-k${version.major}${version.minor == null ? '' : `.${version.minor}`}`;
    profile.kind = 'kimi';

    if (version.major === 3 && version.minor == null && /^(?:|preview|\d{4}(?:-\d{2})*)$/.test(version.variant)) {
      // K3 verified API contract.
      profile.alwaysThinking = K3_RULES.alwaysThinking;
      profile.efforts = K3_RULES.efforts;
      profile.defaultEffort = K3_RULES.defaultEffort;
      profile.reasoningContentField = K3_RULES.reasoningContentField;
      profile.multiTurnReasoningReplay = K3_RULES.multiTurnReasoningReplay;
      profile.vision = K3_RULES.vision;
      profile.contextWindow = K3_RULES.contextWindow;
      profile.stripSampling = K3_RULES.stripSampling;
      return Object.freeze(profile);
    }

    if (version.major === 2 && ([5, 6].includes(version.minor)
        || (version.minor === 7 && /^code(?:-|$)/.test(version.variant)))) {
      profile.alwaysThinking = version.minor === 7;
      profile.thinkingSwitch = !profile.alwaysThinking;
      profile.stripSampling = true;
      profile.contextWindow = 262_144;
      profile.multiTurnReasoningReplay = profile.alwaysThinking;
      return Object.freeze(profile);
    }
    if (version.major >= 2) return Object.freeze({ ...profile, kind: 'unknown' });

    // K1-era: legacy passthrough.
    profile.kind = 'kimi-legacy';
    return Object.freeze(profile);
  }

  // Nearest supported reasoning effort; ties round up (never dumber than
  // requested). Always-thinking models have no 'off': an explicitly off
  // request clamps to the lightest rung, which is the closest legal ask.
  function clampEffort(modelId, requested) {
    const profile = profileFor(modelId);
    if (!profile.efforts.length) return { effort: '', adjusted: false, supported: profile.efforts };
    const normalized = String(requested ?? '').trim().toLowerCase();
    if (profile.efforts.includes(normalized)) {
      return { effort: normalized, adjusted: false, supported: profile.efforts };
    }
    const off = ['none', 'off', 'disabled', 'false'].includes(normalized);
    const rank = off ? -1 : Math.max(0, EFFORT_POSITIONS.indexOf(normalized));
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of profile.efforts) {
      const distance = Math.abs(EFFORT_POSITIONS.indexOf(candidate) - rank);
      if (distance < bestDistance
        || (distance === bestDistance && best != null && EFFORT_POSITIONS.indexOf(candidate) > EFFORT_POSITIONS.indexOf(best))) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return { effort: best, adjusted: true, requested: normalized, model: profile.id, supported: profile.efforts };
  }

  const EFFORT_POSITIONS = Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']);

  return {
    clampEffort,
    normalizeModelId,
    parseKimiVersion,
    profileFor
  };
}));

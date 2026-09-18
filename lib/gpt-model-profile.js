(function exposeGptModelProfile(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanGptModelProfile = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // GPTL — single source of truth for OpenAI GPT family capabilities.
  //
  // Compatibility policy (2026-09-16): active shaping starts at the GPT-5.6
  // family. Everything older (gpt-5.0…5.5, o-series, 4.x) shares one
  // always-valid reasoning ladder — low/medium/high — so a legacy model can
  // never receive a parameter it rejects, and no per-minor table needs
  // maintenance. Future minors (5.7+) and majors (gpt-7, gpt-8, …) inherit
  // the newest rule set, so a new model id never needs a code change.
  //
  // Reasoning effort ladders, in increasing depth:
  //   none < minimal < low < medium < high < xhigh < max

  const EFFORT_LADDER = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max']);

  const GPT6_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max']);
  const O_SERIES_EFFORTS = Object.freeze(['low', 'medium', 'high']);
  // Pre-5.6 compatibility ladder: accepted by every GPT-5 minor and every
  // o-series snapshot, so clamping can only ever land on a legal value.
  const LEGACY_EFFORTS = Object.freeze(['low', 'medium', 'high']);

  // GPT-5.6 is the oldest family with the full modern surface:
  // none…max efforts, reasoning mode/context, Responses-only function tools.
  const GPT5_EFFORT_TIERS = Object.freeze([
    Object.freeze({
      minor: 6,
      efforts: Object.freeze(['none', 'low', 'medium', 'high', 'xhigh', 'max']),
      defaultEffort: 'medium',
      reasoningMode: true,
      reasoningContextDefault: 'all_turns',
      requiresResponsesForTools: true
    })
  ]);

  // Chat-only families: no reasoning effort, sampling parameters stay legal.
  const CHAT_FAMILY_PATTERN = /^gpt-?(?:3\.5|4o|4(?:\.\d+)?-turbo|4-vision|4\.5|5-chat)/;
  // Media / non-text models: never part of the text runtime.
  const MEDIA_MODEL_PATTERN = /^(?:gpt-image|dall-e|sora|gpt-audio|gpt-live|gpt-realtime|gpt-transcribe|gpt-4o-(?:mini-)?(?:tts|transcribe)|omni)/;

  const KNOWN_SNAPSHOT_SUFFIX = /-\d{4}-\d{2}-\d{2}$/;

  function normalizeModelId(value) {
    const raw = String(value || '').trim().toLowerCase();
    if (!raw) return '';
    const slash = raw.lastIndexOf('/');
    const bare = slash >= 0 ? raw.slice(slash + 1) : raw;
    return bare.startsWith('openai/') ? bare.slice(7) : bare;
  }

  // 'gpt-5.6-sol' → { major: 5, minor: 6, variant: 'sol' }
  // 'gpt4o'        → { major: 4, minor: null, variant: 'o' }
  // 'gpt-5'        → { major: 5, minor: null, variant: '' }
  function parseGptVersion(id) {
    const match = /^gpt-?(\d+)(?:[._](\d+))?(?:[-._]?([a-z0-9][a-z0-9._-]*))?$/.exec(id);
    if (!match) return null;
    const minorText = match[2];
    return {
      major: Number(match[1]),
      minor: minorText == null ? null : Number(minorText),
      variant: String(match[3] || '').replace(KNOWN_SNAPSHOT_SUFFIX, '')
    };
  }

  // Mid-station aliases drop the `gpt-` prefix (`5.6`, `5.6-sol`). Only accept
  // ids that cannot belong to another vendor: a leading 5/6/7/8/9 version.
  function parseBareVersion(id) {
    const match = /^([5-9])(?:[._](\d+))?(?:[-._]([a-z][a-z0-9._-]*))?$/.exec(id);
    if (!match) return null;
    return {
      major: Number(match[1]),
      minor: match[2] == null ? null : Number(match[2]),
      variant: String(match[3] || '').replace(KNOWN_SNAPSHOT_SUFFIX, '')
    };
  }

  function ladderIndex(effort) {
    const index = EFFORT_LADDER.indexOf(String(effort || '').trim().toLowerCase());
    return index < 0 ? -1 : index;
  }

  // Chat Completions only accepts tool names matching ^[a-zA-Z0-9_-]{1,64}$.
  // Long names keep a short deterministic tail so two names that share a
  // prefix cannot collide after truncation. Callers that rewrite names MUST
  // also restore the original name on the response path.
  function sanitizeToolName(name, maxChars = 64) {
    const raw = String(name || '');
    if (!raw) return '';
    const limit = Math.max(8, Number(maxChars) || 64);
    if (new RegExp(`^[a-zA-Z0-9_-]{1,${limit}}$`).test(raw)) return raw;
    let cleaned = raw.replace(/[^a-zA-Z0-9_-]/g, '_');
    if (cleaned.length > limit) {
      let hash = 0x811c9dc5;
      for (let index = 0; index < raw.length; index += 1) {
        hash ^= raw.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193) >>> 0;
      }
      const suffix = hash.toString(36);
      cleaned = `${cleaned.slice(0, Math.max(1, limit - suffix.length - 1))}_${suffix}`;
    }
    return cleaned;
  }

  // 5.6 is the only maintained GPT-5 minor. Older minors (and anything not in
  // the table) get the pre-5.6 compatibility ladder; future minors inherit
  // the newest entry.
  function supportedEffortsForMinor(minor) {
    const exact = GPT5_EFFORT_TIERS.find(tier => tier.minor === minor);
    if (exact) return exact;
    const lower = GPT5_EFFORT_TIERS.filter(tier => tier.minor <= minor).pop() || null;
    if (lower) return lower;
    return { efforts: LEGACY_EFFORTS, defaultEffort: 'medium' };
  }

  function baseProfile(id) {
    return {
      id,
      kind: 'unknown',
      family: '',
      major: 0,
      minor: null,
      variant: '',
      reasoning: false,
      efforts: Object.freeze([]),
      defaultEffort: '',
      supportsReasoningMode: false,
      reasoningContextDefault: '',
      requiresResponsesForTools: false,
      chatEndpoint: true,
      responsesEndpoint: true,
      toolsOnChat: true,
      supportsTemperature: true,
      vision: false,
      contextWindow: 0,
      maxOutputTokens: 0,
      maxToolNameChars: 64
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

  function buildProfile(id) {
    const profile = { ...baseProfile(id) };

    if (MEDIA_MODEL_PATTERN.test(id)) {
      profile.kind = 'media';
      profile.family = 'media';
      profile.chatEndpoint = false;
      profile.responsesEndpoint = false;
      profile.toolsOnChat = false;
      return Object.freeze(profile);
    }

    // o-series: o1, o1-mini, o3, o3-pro, o4-mini.
    const oMatch = /^o(\d+)(?:-(.+))?$/.exec(id);
    if (oMatch) {
      const series = Number(oMatch[1]);
      const variant = String(oMatch[2] || '');
      const mini = /^mini/.test(variant);
      profile.kind = 'o-series';
      profile.family = `o${series}`;
      profile.major = series;
      profile.variant = variant;
      profile.reasoning = true;
      profile.supportsTemperature = false;
      // o1-mini accepts no reasoning_effort value at all (the empty ladder
      // tells shaping to strip the key entirely); every other o-series
      // snapshot takes low/medium/high.
      profile.efforts = series === 1 && mini ? Object.freeze([]) : O_SERIES_EFFORTS;
      profile.defaultEffort = 'medium';
      // o1-mini / o1-preview ship without image input; every other o-series
      // snapshot in the catalog accepts images.
      profile.vision = !(series === 1 && (mini || variant === 'preview'));
      profile.contextWindow = 200_000;
      profile.maxOutputTokens = 100_000;
      return Object.freeze(profile);
    }

    if (/^codex(?:-|$)/.test(id)) {
      profile.kind = 'codex';
      profile.family = 'codex';
      profile.reasoning = true;
      profile.supportsTemperature = false;
      profile.efforts = O_SERIES_EFFORTS;
      profile.defaultEffort = 'medium';
      profile.vision = true;
      profile.contextWindow = 200_000;
      profile.maxOutputTokens = 100_000;
      return Object.freeze(profile);
    }

    if (/^chatgpt-4o/.test(id)) {
      profile.kind = 'chat';
      profile.family = 'gpt-4o';
      profile.vision = true;
      profile.contextWindow = 128_000;
      profile.maxOutputTokens = 16_384;
      return Object.freeze(profile);
    }

    const version = parseGptVersion(id) || parseBareVersion(id);
    if (version) {
      profile.major = version.major;
      profile.minor = version.minor;
      profile.variant = version.variant;
      const chatVariant = /^chat(?:-|$)/.test(version.variant);
      const chatFamily = CHAT_FAMILY_PATTERN.test(id) || chatVariant;

      if (chatFamily) {
        profile.kind = 'chat';
        profile.family = `gpt-${version.major}${version.minor == null ? '' : `.${version.minor}`}`;
        profile.vision = /^gpt-(?:4o|4\.1|4\.5|4-turbo|4-vision)|^gpt4o/.test(id) || version.major >= 5;
        profile.contextWindow = version.major >= 5 ? 400_000 : 128_000;
        profile.maxOutputTokens = version.major >= 5 ? 128_000 : 16_384;
        return Object.freeze(profile);
      }

      if (version.major >= 6) {
        // Future-proof rule: every GPT-6-or-later family inherits the GPT-6
        // capability set (low…max, no 'none', Responses required for tools).
        profile.kind = 'gpt';
        profile.family = `gpt-${version.major}`;
        profile.reasoning = true;
        profile.supportsTemperature = false;
        profile.efforts = GPT6_EFFORTS;
        profile.defaultEffort = 'medium';
        profile.supportsReasoningMode = true;
        profile.reasoningContextDefault = 'all_turns';
        profile.requiresResponsesForTools = true;
        profile.toolsOnChat = false;
        profile.vision = true;
        profile.contextWindow = 1_050_000;
        profile.maxOutputTokens = 128_000;
        return Object.freeze(profile);
      }

      if (version.major === 5) {
        // Bare `gpt-5` and every minor below 5.6 share the legacy ladder.
        const tier = supportedEffortsForMinor(version.minor == null ? 0 : version.minor);
        profile.kind = 'gpt';
        profile.family = version.minor == null ? 'gpt-5' : `gpt-5.${version.minor}`;
        profile.reasoning = true;
        profile.supportsTemperature = false;
        profile.efforts = tier.efforts;
        profile.defaultEffort = tier.defaultEffort || 'medium';
        profile.supportsReasoningMode = tier.reasoningMode === true;
        profile.reasoningContextDefault = tier.reasoningContextDefault || '';
        profile.requiresResponsesForTools = tier.requiresResponsesForTools === true;
        profile.toolsOnChat = !profile.requiresResponsesForTools;
        profile.vision = true;
        const newerContext = version.minor != null && version.minor >= 4;
        profile.contextWindow = newerContext ? 1_050_000 : 400_000;
        profile.maxOutputTokens = 128_000;
        if (/(?:^|-)cyber$/.test(version.variant)) {
          profile.chatEndpoint = false;
          profile.toolsOnChat = false;
          profile.requiresResponsesForTools = true;
        }
        return Object.freeze(profile);
      }

      if (version.major === 4) {
        const visionTurbo = /^(?:turbo|vision)/.test(version.variant) || /^gpt-4-vision/.test(id);
        const modernChat = /^gpt-?4o|^gpt-4\.\d/.test(id);
        profile.kind = 'chat';
        profile.family = 'gpt-4';
        profile.vision = visionTurbo || modernChat;
        profile.contextWindow = 128_000;
        profile.maxOutputTokens = modernChat ? 16_384 : 4_096;
        return Object.freeze(profile);
      }

      profile.kind = 'gpt';
      profile.family = `gpt-${version.major}`;
      profile.vision = true;
      profile.contextWindow = 128_000;
      profile.maxOutputTokens = 32_000;
      return Object.freeze(profile);
    }

    return Object.freeze(profile);
  }

  // Nearest supported effort (ties round up: never dumber than requested).
  // Returns { effort, adjusted, requested?, model? , supported }.
  function clampEffort(modelId, requested, { thinking = false } = {}) {
    const profile = profileFor(modelId);
    const normalized = String(requested || '').trim().toLowerCase();
    const requestedEffort = EFFORT_LADDER.includes(normalized)
      ? normalized
      : (thinking ? 'high' : 'medium');
    if (!profile.efforts.length) return { effort: '', adjusted: false, supported: profile.efforts };
    if (profile.efforts.includes(requestedEffort)) {
      return { effort: requestedEffort, adjusted: false, supported: profile.efforts };
    }
    const rank = ladderIndex(requestedEffort);
    let best = null;
    let bestDistance = Infinity;
    for (const candidate of profile.efforts) {
      const candidateRank = ladderIndex(candidate);
      const distance = Math.abs(candidateRank - rank);
      if (distance < bestDistance
        || (distance === bestDistance && candidateRank > ladderIndex(best))) {
        best = candidate;
        bestDistance = distance;
      }
    }
    return { effort: best, adjusted: true, requested: requestedEffort, model: profile.id, supported: profile.efforts };
  }

  // Wire-format routing for one request. `apiFormat` is the user's explicit
  // connection choice: 'openai' | 'responses' | 'auto' | ''.
  //
  // In automatic mode, models that require Responses for tools stay on Responses for every
  // request, tool-less turns included: the two endpoints keep separate prompt
  // caches and different serializations, so a session that flips between them
  // pays a full cache re-miss on every flip.
  function routeFor(modelId, { hasTools = false, apiFormat = '' } = {}) {
    const profile = profileFor(modelId);
    const format = String(apiFormat || '').trim().toLowerCase();
    if (profile.kind === 'media') return '';
    if (format === 'responses') return profile.responsesEndpoint ? 'responses' : '';
    // The gateway protocol is a user choice, not a property of a model name.
    if (format === 'openai') return 'chat';
    if (profile.requiresResponsesForTools || !profile.toolsOnChat) {
      return profile.responsesEndpoint ? 'responses' : '';
    }
    return profile.chatEndpoint ? 'chat' : (profile.responsesEndpoint ? 'responses' : '');
  }

  // GPT-family ids that use Yan's action-progress presentation (the Codex-like
  // thinking chain). Media models and non-GPT vendors stay in standard mode.
  function presentationModeFor(modelId) {
    const profile = profileFor(modelId);
    if (profile.kind === 'media' || profile.kind === 'unknown') return 'standard';
    return 'gpt-action-progress';
  }

  function isGptActionProgressModel(modelId) {
    return presentationModeFor(modelId) === 'gpt-action-progress';
  }

  return {
    EFFORT_LADDER,
    GPT5_EFFORT_TIERS,
    GPT6_EFFORTS,
    O_SERIES_EFFORTS,
    clampEffort,
    isGptActionProgressModel,
    normalizeModelId,
    parseGptVersion,
    presentationModeFor,
    profileFor,
    routeFor,
    sanitizeToolName
  };
}));

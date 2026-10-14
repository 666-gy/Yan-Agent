(function exposeModelBudgetProfiles(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.YanModelBudgetProfiles = api;
}(typeof globalThis !== 'undefined' ? globalThis : this, () => {
  'use strict';

  // Official limits, checked 2026-10-09. This is a maintained snapshot, not a
  // heuristic for future versions. Dates/aliases must be added explicitly.
  // Compaction is a client policy (80%), not a vendor model specification.
  const COVERAGE = Object.freeze({ from: '2026-07-09', through: '2026-10-09' });
  const rows = [
    ['deepseek-v4.1-flash', 1_048_576, 393_216,
      ['deepseek-flash', 'ds-v4.1-flash', 'deepseek-v4-flash', 'deepseek-v4-flash-vision-exp'], 'https://api-docs.deepseek.com/quick_start/pricing'],
    ['deepseek-v4-pro-0813', 1_048_576, 393_216,
      ['deepseek-v4-pro'], 'https://api-docs.deepseek.com/quick_start/pricing'],
    ['gpt-5.6-sol', 1_050_000, 128_000, ['gpt-5.6'], 'https://developers.openai.com/api/docs/models/gpt-5.6-sol'],
    ['gpt-5.6-terra', 1_050_000, 128_000, [], 'https://developers.openai.com/api/docs/models/gpt-5.6-terra'],
    ['gpt-5.6-luna', 1_050_000, 128_000, [], 'https://developers.openai.com/api/docs/models/gpt-5.6-luna'],
    ['gpt-6-astra', 1_050_000, 128_000, [], 'https://developers.openai.com/api/docs/models/gpt-6-astra'],
    ['gpt-6-sol', 1_050_000, 128_000, [], 'https://developers.openai.com/api/docs/models/gpt-6-sol'],
    ['gpt-6.1-sol', 1_050_000, 128_000, [], 'https://developers.openai.com/api/docs/models/gpt-6.1-sol'],
    ['gpt-6-luna', 1_050_000, 128_000, [], 'https://developers.openai.com/api/docs/models/gpt-6-luna'],
    ['claude-fable-5-1', 1_000_000, 128_000, ['claude-fable-5.1'], 'https://platform.claude.com/docs/en/models/overview'],
    ['claude-opus-5-5', 1_000_000, 128_000, ['claude-opus-5.5'], 'https://platform.claude.com/docs/en/models/overview'],
    ['claude-sonnet-5-5', 1_000_000, 128_000, ['claude-sonnet-5.5'], 'https://platform.claude.com/docs/en/models/overview'],
    ['claude-haiku-5-5', 1_000_000, 128_000, ['claude-haiku-5.5'], 'https://platform.claude.com/docs/en/models/overview'],
    ['gemini-3.7-flash', 1_048_576, 65_536, [], 'https://ai.google.dev/gemini-api/docs/models/gemini-3.7-flash'],
    ['gemini-3.6-flash', 1_048_576, 65_536, [], 'https://ai.google.dev/gemini-api/docs/models/gemini-3.6-flash'],
    ['gemini-3.5-flash-lite', 1_048_576, 65_536, [], 'https://ai.google.dev/gemini-api/docs/models/gemini-3.5-flash-lite'],
    ['gemini-3.8-flash', 1_048_576, 65_536, [], 'https://ai.google.dev/gemini-api/docs/models/gemini-3.8-flash'],
    ['qwen3.7-flash', 1_000_000, 131_072, ['qwen3.7-flash-2026-07-15'], 'https://help.aliyun.com/zh/model-studio/qwen3-7-flash'],
    ['qwen3.8-max', 1_000_000, 131_072, ['qwen3.8-max-0902', 'qwen3.8-max-2026-09-02'], 'https://help.aliyun.com/zh/model-studio/qwen3-8-max'],
    ['qwen3.8-flash', 1_000_000, 131_072, [], 'https://help.aliyun.com/zh/model-studio/qwen3-8-flash'],
    ['kimi-k3', 1_048_576, 1_048_576, [], 'https://platform.kimi.com/docs/api/chat'],
    ['glm-5.3', 1_048_576, 131_072, [], 'https://docs.bigmodel.cn/cn/guide/models/text/glm-5.3'],
    ['glm-5.3-flash', 1_048_576, 131_072, [], 'https://help.aliyun.com/zh/model-studio/newly-released-models'],
    ['glm-5.3-flashx', 1_048_576, 131_072, [], 'https://help.aliyun.com/zh/model-studio/newly-released-models'],
    // Grok has no separate text output cap; its context is the total ceiling.
    ['grok-4.7', 500_000, 500_000, [], 'https://docs.x.ai/developers/grok-4-7', 'context'],
    ['step-5-preview', 1_000_000, 65_536, [], 'https://platform.stepfun.com/docs/zh/step-plan/integrations/kilo-code'],
    ['mimo-v2.6-pro', 1_048_576, 131_072, [], 'https://mimo.mi.com/docs/en-US/quick-start/summary/model'],
    ['mimo-v2.6-flash', 1_048_576, 131_072, [], 'https://mimo.mi.com/docs/en-US/quick-start/summary/model'],
    ['mimo-v2.6-pro-ultraspeed', 1_048_576, 131_072, [], 'https://mimo.mi.com/docs/en-US/quick-start/summary/model'],
    // These vendors publish a context window but no independent output maximum.
    // Do not invent an official output value; the existing fallback still works.
    ['minimax-m3.1-flash-preview', 1_000_000, null, [], 'https://platform.minimax.io/docs/guides/models-intro', 'unpublished'],
    ['mistral-large-4', 1_000_000, null, [], 'https://docs.mistral.ai/models/mistral-large-4', 'unpublished']
  ];
  const PROFILES = Object.freeze(rows.map(([id, contextWindow, maxOutputTokens, aliases, source, outputConstraint = 'fixed']) => Object.freeze({
    id, contextWindow, compactionThreshold: Math.floor(contextWindow * 0.8), maxOutputTokens,
    aliases: Object.freeze(aliases), source, outputConstraint
  })));

  function normalizeModelId(value) {
    return String(value || '').trim().toLowerCase().replace(/_/g, '-');
  }
  const aliases = new Map();
  for (const profile of PROFILES) {
    for (const alias of [profile.id, ...profile.aliases]) aliases.set(normalizeModelId(alias), profile);
  }
  function lookupModelBudget(modelId) {
    const id = normalizeModelId(modelId);
    // Gateways commonly namespace IDs, e.g. deepseek-ai/DeepSeek-V4.1-Flash.
    // Do not strip arbitrary version, quantization or preview suffixes.
    return aliases.get(id) || aliases.get(id.slice(id.lastIndexOf('/') + 1))
      || (id.startsWith('anthropic.') ? aliases.get(id.slice(10)) : null) || null;
  }

  function positiveTokens(value) {
    const number = Math.round(Number(value));
    return Number.isSafeInteger(number) && number > 0 ? number : 0;
  }

  function automaticModelBudget(modelId, overrides = {}) {
    const profile = lookupModelBudget(modelId);
    if (!profile) return null;
    const contextWindow = positiveTokens(overrides.contextWindow) || profile.contextWindow;
    return {
      contextWindow,
      compactionThreshold: positiveTokens(overrides.compactionThreshold) || Math.floor(contextWindow * 0.8),
      ...(positiveTokens(overrides.maxOutputTokens) || profile.maxOutputTokens
        ? { maxOutputTokens: positiveTokens(overrides.maxOutputTokens) || profile.maxOutputTokens } : {})
    };
  }

  return { COVERAGE, PROFILES, lookupModelBudget, automaticModelBudget };
}));

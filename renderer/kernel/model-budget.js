/* Yan Agent — per-model runtime budget (long-run / strong-thinking) */
(function (K) {
  'use strict';

  /**
   * Output budget policy:
   * 1. Prefer the highest generation ceiling the vendor allows (large write_file turns).
   * 2. ALWAYS clamp to the provider's hard API range — sending 1M to DeepSeek
   *    yields HTTP 400: valid range is [1, 393216].
   * Gateways may still clamp lower; the kernel must never send an illegal value.
   */
  K.DEFAULT_RUN_BUDGET = {
    maxLoopIterations: 160,
    maxTokens: 393_216,
    maxNoProgressRounds: 10,
    maxIdenticalErrorCode: 20,
    maxIdenticalToolFailures: 20,
    // contextWindow = the model's real input window (tokens). compressSoftThreshold is
    // DERIVED from it (≈70%) in resolveModelBudget — never trust a fixed char threshold,
    // it silently 400s small-window models. 128k is the safe floor for unknown providers.
    contextWindow: 128_000,
    compressSoftThreshold: 600_000,
    lengthContinueLimit: 16,
    gateBlockLimit: 8,
    label: 'default'
  };
  // Fraction of the context window at which we start compressing / hard-cap.
  K.CONTEXT_COMPRESS_SOFT_RATIO = 0.70;
  K.CONTEXT_COMPRESS_HARD_RATIO = 0.85;
  K.REASONING_SPEED_MODES = new Set(['fast', 'balanced', 'smart']);

  K.getReasoningSpeed = function (apiConfig = {}) {
    const value = String(apiConfig.reasoningSpeed || '').toLowerCase();
    if (K.REASONING_SPEED_MODES.has(value)) return value;
    return apiConfig.thinking ? 'smart' : 'balanced';
  };

  K.getReasoningEffort = function (apiConfig = {}) {
    return { fast: 'low', balanced: 'medium', smart: 'high' }[K.getReasoningSpeed(apiConfig)];
  };

  K.resolveRuntimeModelId = function (apiConfig = {}) {
    const provider = String(apiConfig.provider || '').toLowerCase();
    const model = String(apiConfig.model || '').trim();
    const speed = K.getReasoningSpeed(apiConfig);
    if (!['fast', 'smart'].includes(speed)) return model;
    if (provider === 'moonshot' && model === 'kimi-k2.7-code') return 'kimi-k2.7-code-highspeed';
    if (provider === 'minimax' && model === 'MiniMax-M2.7') return 'MiniMax-M2.7-highspeed';
    return model;
  };

  /**
   * Hard API ceilings for max_tokens (inclusive).
   * Keys: provider id, then optional model overrides.
   * DeepSeek official error: valid range [1, 393216].
   */
  K.PROVIDER_MAX_TOKENS_CAP = {
    deepseek: 393_216,
    moonshot: 10_000_000,
    openai: 1_000_000,
    anthropic: 200_000,
    qwen: 1_000_000,
    glm: 128_000,
    doubao: 128_000,
    stepfun: 128_000,
    minimax: 128_000,
    grok: 256_000,
    agnes: 128_000,
    custom: 1_000_000,
    default: 393_216
  };

  /** Ordered: first match wins. maxTokens = desired headroom (clamped later). */
  K.MODEL_BUDGET_RULES = [
    {
      id: 'kimi-k3',
      test: (model) => model === 'kimi-k3',
      budget: {
        maxLoopIterations: 240,
        maxTokens: 10_000_000,
        maxNoProgressRounds: 16,
        maxIdenticalErrorCode: 20,
        maxIdenticalToolFailures: 20,
        compressSoftThreshold: 900_000,
        lengthContinueLimit: 24,
        gateBlockLimit: 10,
        contextWindow: 262_144,
        label: 'kimi-k3'
      }
    },
    {
      id: 'kimi-k2.7-code',
      test: (model) => /^kimi-k2\.7-code(?:-highspeed)?$/.test(model),
      budget: {
        maxLoopIterations: 220,
        maxTokens: 4_000_000,
        maxNoProgressRounds: 14,
        maxIdenticalErrorCode: 20,
        maxIdenticalToolFailures: 20,
        compressSoftThreshold: 800_000,
        lengthContinueLimit: 20,
        gateBlockLimit: 10,
        contextWindow: 262_144,
        label: 'kimi-k2.7-code'
      }
    },
    {
      id: 'kimi-k2.x',
      test: (model) => /^kimi-k2\.(?:6|5)$/.test(model),
      budget: {
        maxLoopIterations: 180,
        maxTokens: 2_000_000,
        maxNoProgressRounds: 12,
        maxIdenticalErrorCode: 20,
        maxIdenticalToolFailures: 20,
        compressSoftThreshold: 700_000,
        lengthContinueLimit: 16,
        gateBlockLimit: 8,
        contextWindow: 131_072,
        label: 'kimi-k2.x'
      }
    },
    {
      id: 'deepseek',
      // Match by model id OR provider deepseek (V3/V4/R1/chat/reasoner).
      test: (model, provider) => provider === 'deepseek' || /deepseek/i.test(model),
      budget: {
        maxLoopIterations: 200,
        // Official API max is 393216 — do not request more (HTTP 400).
        maxTokens: 393_216,
        maxNoProgressRounds: 12,
        maxIdenticalErrorCode: 20,
        maxIdenticalToolFailures: 20,
        compressSoftThreshold: 700_000,
        lengthContinueLimit: 16,
        gateBlockLimit: 8,
        contextWindow: 131_072,
        label: 'deepseek'
      }
    },
    {
      id: 'claude-class',
      test: (model) => /claude|sonnet|opus|gpt-5|o3|o4-mini|gemini-2\.5|gemini-3/i.test(model),
      budget: {
        maxLoopIterations: 200,
        maxTokens: 200_000,
        maxNoProgressRounds: 12,
        maxIdenticalErrorCode: 20,
        maxIdenticalToolFailures: 20,
        compressSoftThreshold: 700_000,
        lengthContinueLimit: 16,
        gateBlockLimit: 8,
        contextWindow: 200_000,
        label: 'frontier'
      }
    },
    {
      id: 'qwen-max',
      test: (model) => /qwen3\.(?:7|6)-max|qwen3-max|qwq/i.test(model),
      budget: {
        maxLoopIterations: 180,
        maxTokens: 1_000_000,
        maxNoProgressRounds: 12,
        maxIdenticalErrorCode: 20,
        maxIdenticalToolFailures: 20,
        compressSoftThreshold: 700_000,
        lengthContinueLimit: 16,
        gateBlockLimit: 8,
        contextWindow: 1_000_000,
        label: 'qwen-max'
      }
    }
  ];

  K.getProviderMaxTokensCap = function (provider, model) {
    const p = String(provider || '').toLowerCase();
    const m = String(model || '').toLowerCase();
    // Model-first when vendor is obvious from the id.
    if (/deepseek/.test(m) || p === 'deepseek') return K.PROVIDER_MAX_TOKENS_CAP.deepseek;
    if (/^kimi-|^moonshot/.test(m) || p === 'moonshot') return K.PROVIDER_MAX_TOKENS_CAP.moonshot;
    if (p && K.PROVIDER_MAX_TOKENS_CAP[p] != null) return K.PROVIDER_MAX_TOKENS_CAP[p];
    return K.PROVIDER_MAX_TOKENS_CAP.default;
  };

  /**
   * Clamp requested max_tokens into the legal API range for this provider/model.
   * Always returns an integer in [1, cap].
   */
  K.clampMaxTokensForApi = function (requested, apiConfig = {}, options = {}) {
    const provider = String(apiConfig.provider || options.provider || '');
    const model = String(apiConfig.model || options.model || '');
    const cap = Number(options.cap) || K.getProviderMaxTokensCap(provider, model);
    let n = Number(requested);
    if (!Number.isFinite(n) || n < 1) n = cap;
    return Math.max(1, Math.min(Math.floor(n), cap));
  };

  K.resolveModelBudget = function (apiConfig = {}, options = {}) {
    const mergedConfig = { ...options, ...apiConfig };
    const model = String(K.resolveRuntimeModelId(mergedConfig) || options.model || '').trim();
    const provider = String(apiConfig.provider || options.provider || '').trim();
    const reasoningSpeed = K.getReasoningSpeed(mergedConfig);
    const thinking = reasoningSpeed === 'smart' || !!(apiConfig.thinking || options.thinking);
    const base = { ...K.DEFAULT_RUN_BUDGET };
    const apiCap = K.getProviderMaxTokensCap(provider, model);

    let matched = null;
    for (const rule of K.MODEL_BUDGET_RULES) {
      if (rule.test(model, provider)) {
        matched = rule;
        break;
      }
    }
    const budget = matched ? { ...base, ...matched.budget } : { ...base };

    // User-enabled deep thinking without a dedicated rule still needs headroom.
    if (!matched && thinking) {
      budget.maxLoopIterations = Math.max(budget.maxLoopIterations, 180);
      budget.maxTokens = Math.max(budget.maxTokens, apiCap);
      budget.maxNoProgressRounds = Math.max(budget.maxNoProgressRounds, 12);
      budget.lengthContinueLimit = Math.max(budget.lengthContinueLimit, 16);
      budget.gateBlockLimit = Math.max(budget.gateBlockLimit, 8);
      budget.label = 'thinking-default';
    }

    // Derive compression thresholds from the model's real context window.
    // A model with a 128k window must start compressing around ~90k tokens, not 600k.
    const contextWindow = Number(budget.contextWindow) || 128_000;
    const softRatio = Number(K.CONTEXT_COMPRESS_SOFT_RATIO) || 0.70;
    const hardRatio = Number(K.CONTEXT_COMPRESS_HARD_RATIO) || 0.85;
    const derivedSoft = Math.floor(contextWindow * softRatio);
    // Take the lower of the rule's stated soft threshold and the window-derived one,
    // so large-window models keep their generous ceiling while small ones get protected.
    budget.compressSoftThreshold = Math.min(
      Number(budget.compressSoftThreshold) || derivedSoft,
      derivedSoft
    );
    budget.compressHardThreshold = Math.floor(contextWindow * hardRatio);
    budget.contextWindow = contextWindow;

    // Explicit user maxTokens preferred, then always clamp to vendor hard cap.
    if (typeof apiConfig.maxTokens === 'number' && apiConfig.maxTokens > 0) {
      budget.maxTokens = apiConfig.maxTokens;
      budget.userMaxTokens = true;
    }

    // Speed controls per-response reasoning headroom, never the total task loop
    // ceiling. Long tasks can still finish; fast mode just avoids one huge turn.
    if (!budget.userMaxTokens) {
      if (reasoningSpeed === 'fast') budget.maxTokens = Math.min(budget.maxTokens, 131_072);
      else budget.maxTokens = Math.min(budget.maxTokens, 524_288);
    }

    budget.apiMaxTokensCap = apiCap;
    budget.maxTokens = K.clampMaxTokensForApi(budget.maxTokens, apiConfig, { provider, model, cap: apiCap });

    // Test/runtime hard override: FORCE_MAX_LOOP_ITERATIONS pins the ceiling.
    if (K.FORCE_MAX_LOOP_ITERATIONS && typeof K.MAX_LOOP_ITERATIONS === 'number' && K.MAX_LOOP_ITERATIONS > 0) {
      budget.maxLoopIterations = K.MAX_LOOP_ITERATIONS;
    }

    budget.model = model;
    budget.provider = provider;
    budget.reasoningSpeed = reasoningSpeed;
    return budget;
  };

  K.applyRunBudget = function (runCtx, apiConfig) {
    const budget = K.resolveModelBudget(apiConfig || {});
    if (runCtx) {
      runCtx.runBudget = budget;
      runCtx.maxLoopIterations = budget.maxLoopIterations;
      if (runCtx.progress) {
        runCtx.progress.maxNoProgressRounds = budget.maxNoProgressRounds;
        runCtx.progress.maxIdenticalErrorCode = budget.maxIdenticalErrorCode;
      }
    }
    return budget;
  };

})(window.YanKernel);

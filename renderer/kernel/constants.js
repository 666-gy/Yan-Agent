/* Yan Agent — kernel module */
(function (K) {
  'use strict';

  K.CONTEXT_TOKEN_MAX = 1_000_000;
  // Soft compress kicks in earlier for long runs; hard threshold remains high for big models.
  K.CONTEXT_TOKEN_COMPRESS_SOFT = 600_000;
  K.CONTEXT_TOKEN_COMPRESS_THRESHOLD = 800_000;
  /** @deprecated use CONTEXT_TOKEN_COMPRESS_THRESHOLD */
  K.CONTEXT_TOKEN_THRESHOLD = K.CONTEXT_TOKEN_COMPRESS_THRESHOLD;
  K.CONTEXT_KEEP_RECENT = 16;
  // Global floor — resolveModelBudget raises this for strong-thinking models.
  K.MAX_LOOP_ITERATIONS = 120;
  K.MAX_IDENTICAL_TOOL_FAILURES = 20;
  K.MAX_SUBAGENT_ITERATIONS = 16;
  K.MAX_EDIT_REPAIR_ATTEMPTS = 2;
  // Set true only in tests that need a hard low cap (e.g. iteration exhaustion).
  K.FORCE_MAX_LOOP_ITERATIONS = false;

})(window.YanKernel);

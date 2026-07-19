/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

  K.CONTEXT_TOKEN_MAX = 1_000_000;
  K.CONTEXT_TOKEN_COMPRESS_THRESHOLD = 800_000;
  /** @deprecated use CONTEXT_TOKEN_COMPRESS_THRESHOLD */
  K.CONTEXT_TOKEN_THRESHOLD = K.CONTEXT_TOKEN_COMPRESS_THRESHOLD;
  K.CONTEXT_KEEP_RECENT = 12;
  K.MAX_LOOP_ITERATIONS = 40;
  K.MAX_SUBAGENT_ITERATIONS = 12;


})(window.YanKernel);

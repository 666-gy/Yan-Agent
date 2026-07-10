/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

  K.CONTEXT_TOKEN_THRESHOLD = 60000;
  K.CONTEXT_KEEP_RECENT = 12;
  K.MAX_LOOP_ITERATIONS = 40;
  K.MAX_SUBAGENT_ITERATIONS = 12;


})(window.YanKernel);

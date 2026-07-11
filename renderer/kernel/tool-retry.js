/* Yan Agent — kernel module */
(function (K) {
  'use strict';

  K.MAX_TOOL_RETRIES = 4;

  K.isRetriableToolError = function (raw) {
    try {
      const o = JSON.parse(raw);
      if (o.ok) return false;
      if (o.meta?.policy || o.meta?.denied || o.meta?.noRetry) return false;
      const err = String(o.error || '').toLowerCase();
      if (err.includes('policy:') || err.includes('permission') || err.includes('denied')) return false;
      return true;
    } catch {
      return false;
    }
  };

  K.executeToolWithRetry = async function (name, args, runCtx) {
    if (name === 'execute_shell') {
      return K.executeTool(name, args, runCtx);
    }
    if (name === 'spawn_subagent' || name === 'spawn_subagents') {
      return K.executeTool(name, args, runCtx);
    }
    let lastOutput = await K.executeTool(name, args, runCtx);
    if (K.parseToolOutputOk(lastOutput) !== false) return lastOutput;

    for (let attempt = 1; attempt <= K.MAX_TOOL_RETRIES; attempt++) {
      if (!K.isRetriableToolError(lastOutput)) return lastOutput;
      await new Promise(r => setTimeout(r, 250 * attempt));
      lastOutput = await K.executeTool(name, args, runCtx);
      if (K.parseToolOutputOk(lastOutput) !== false) {
        try {
          const o = JSON.parse(lastOutput);
          o.meta = { ...(o.meta || {}), retried: attempt };
          return JSON.stringify(o, null, 2);
        } catch {
          return lastOutput;
        }
      }
    }
    try {
      const o = JSON.parse(lastOutput);
      o.meta = { ...(o.meta || {}), retried: K.MAX_TOOL_RETRIES, exhaustedRetries: true };
      return JSON.stringify(o, null, 2);
    } catch {
      return lastOutput;
    }
  };
})(window.YanKernel);

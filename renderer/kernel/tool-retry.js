/* Yan Agent — kernel module */
(function (K) {
  'use strict';

  K.MAX_TOOL_RETRIES = 2;
  K.TOOL_RETRY_BASE_DELAY_MS = 300;

  K.isTransientToolError = function (raw) {
    try {
      const o = JSON.parse(raw);
      if (o.ok) return false;
      if (o.meta?.policy || o.meta?.denied || o.meta?.noRetry) return false;
      if (o.meta?.retryable === false) return false;
      if (o.meta?.retryable === true || o.meta?.transient === true) return true;
      if (String(o.meta?.code || '') === 'TRANSIENT') return true;
      const status = Number(o.meta?.status || o.meta?.statusCode);
      if ([408, 425, 429, 500, 502, 503, 504].includes(status)) return true;
      const err = String(o.error || '').toLowerCase();
      if (err.includes('policy:') || err.includes('permission') || err.includes('denied')) return false;
      return /\b(?:econnreset|econnrefused|etimedout|eai_again|ebusy)\b|rate.?limit|too many requests|temporar(?:y|ily)|network (?:error|failure)|http (?:408|425|429|500|502|503|504)\b/.test(err);
    } catch {
      return false;
    }
  };

  K.isRetriableToolError = function (raw, name, args = {}) {
    if (name && (!K.isToolRetrySafe || !K.isToolRetrySafe(name, args))) return false;
    return K.isTransientToolError(raw);
  };

  K.computeToolRetryDelay = function (retryIndex) {
    const base = Math.max(0, Number(K.TOOL_RETRY_BASE_DELAY_MS) || 0);
    return Math.min(5000, base * (2 ** Math.max(0, retryIndex - 1)) + Math.floor(Math.random() * Math.max(1, base)));
  };

  K.executeToolWithRetry = async function (name, args, runCtx) {
    const executeOnce = async () => {
      try {
        return await K.executeTool(name, args, runCtx);
      } catch (error) {
        return K.toolError(name, error?.message || String(error), {
          exception: true,
          code: error?.code,
          transient: /^(?:ECONNRESET|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN|EBUSY)$/.test(String(error?.code || ''))
        });
      }
    };

    let lastOutput = await executeOnce();
    if (K.parseToolOutputOk(lastOutput) !== false) return lastOutput;

    for (let attempt = 1; attempt <= K.MAX_TOOL_RETRIES; attempt++) {
      if (runCtx?.shouldAbort || !K.isRetriableToolError(lastOutput, name, args)) return lastOutput;
      const delay = K.computeToolRetryDelay(attempt);
      if (delay > 0) await new Promise(r => setTimeout(r, delay));
      lastOutput = await executeOnce();
      if (K.parseToolOutputOk(lastOutput) !== false) {
        return K.mergeToolResultMeta(lastOutput, { retried: attempt, attempts: attempt + 1 });
      }
    }
    return K.mergeToolResultMeta(lastOutput, {
      retried: K.MAX_TOOL_RETRIES,
      attempts: K.MAX_TOOL_RETRIES + 1,
      exhaustedRetries: true
    });
  };
})(window.YanKernel);

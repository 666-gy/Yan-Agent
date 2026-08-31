'use strict';

// Central home for OpenCode run-stability machinery: transient-failure
// classification and bounded retry. The sidecar's prompt and polling paths
// share these so recovery behavior stays in one place and never nests
// per-call retry logic inside the run flow.

const PROMPT_RETRY_ATTEMPTS = 3; // 1 initial attempt + 2 retries
const PROMPT_RETRY_BACKOFF_MS = 1_000; // delay grows linearly per attempt
const POLL_RETRY_ATTEMPTS = 3;
const POLL_RETRY_BACKOFF_MS = 200;
// If the run's session disappears from the status map and never comes back
// within this window, the run is dead; fail it instead of polling forever.
const SESSION_MISSING_GRACE_MS = 10_000;

// Mid-stream interruptions, transport failures, provider timeouts, and
// throttling are worth a bounded retry. Everything else (config, auth,
// context overflow, user abort) must surface as-is.
const TRANSIENT_ERROR_PATTERNS = [
  /upstream response stream was interrupted/i,
  /response stream was interrupted/i,
  /stream (?:was )?interrupted/i,
  // Emitted by the drip-stream watchdog (probeGenerationStall) when effective
  // output stays near zero while SSE chunks keep trickling in.
  /generation stalled/i,
  /incomplete tool call block/i,
  /incomplete dsml/i,
  /socket hang up/i,
  /fetch failed/i,
  /econnreset/i,
  /econnrefused/i,
  /econnaborted/i,
  /etimedout/i,
  /network (?:error|failure)/i,
  /aborted due to timeout/i,
  /timed ?out/i,
  /^429\b/i,
  /^5\d\d\b/i,
  /status (?:429|5\d\d)/i,
  /request failed with status 5/i,
  /rate ?limit/i,
  /internal server error/i,
  /bad gateway/i,
  /service unavailable/i,
  /gateway timeout/i,
  /temporar(?:y|ily)/i,
  /transient/i,
  /DeepSeek 工具调用适配失败/i
];

function isTransientOpenCodeError(error) {
  const message = String(
    error?.message
    || error?.data?.message
    || error?.error?.message
    || error
    || ''
  );
  return !!message && TRANSIENT_ERROR_PATTERNS.some(pattern => pattern.test(message));
}

function createAbortError(message = 'OpenCode operation aborted') {
  const error = new Error(message);
  error.name = 'AbortError';
  return error;
}

function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason || createAbortError());
      return;
    }
    const timer = setTimeout(() => {
      cleanup();
      resolve();
    }, ms);
    const onAbort = () => {
      cleanup();
      reject(signal.reason || createAbortError());
    };
    const cleanup = () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

// Runs `operation(attempt)` up to `attempts` times. Retries only while the
// error is transient and the abort signal (if any) stays clear; delay grows
// as baseDelayMs * attempt. `onRetry(attempt, error)` fires before each
// retry for logging/events.
async function withRetries(operation, {
  attempts = PROMPT_RETRY_ATTEMPTS,
  baseDelayMs = PROMPT_RETRY_BACKOFF_MS,
  signal = null,
  isRetryable = isTransientOpenCodeError,
  onRetry = null
} = {}) {
  let lastError;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    if (signal?.aborted) throw signal.reason || createAbortError();
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      // A cancellation that lands mid-operation wins over the operation's
      // own error: the run was stopped on purpose, not by a failure.
      if (signal?.aborted) throw signal.reason || error;
      if (attempt >= attempts || !isRetryable(error)) throw error;
      onRetry?.(attempt, error);
      await abortableDelay(baseDelayMs * attempt, signal);
    }
  }
  throw lastError;
}

module.exports = {
  PROMPT_RETRY_ATTEMPTS,
  PROMPT_RETRY_BACKOFF_MS,
  POLL_RETRY_ATTEMPTS,
  POLL_RETRY_BACKOFF_MS,
  SESSION_MISSING_GRACE_MS,
  TRANSIENT_ERROR_PATTERNS,
  isTransientOpenCodeError,
  withRetries,
  createAbortError
};

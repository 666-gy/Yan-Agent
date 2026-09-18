'use strict';

// Effective input throughput includes cached input and end-to-end TTFT;
// it is not a measurement of the provider's GPU prefill speed. Preserve
// observations independently of the bounded budgets used by tools.
const DEFAULT_DECLARED_TOKENS_PER_SECOND = 10_000;

// A run only proves throughput when it actually pushed a meaningful prompt
// through prefill. Tiny prompts make TTFT-dominated rates meaningless.
const MIN_EVIDENCE_PROMPT_TOKENS = 2_000;

// Coarse planning estimates keep tool budgets from reacting to small changes.
// The learned speed belongs to the current turn, outside the system prefix.
const THROUGHPUT_BUCKETS = [
  500, 1_000, 1_500, 2_000, 3_000, 4_000, 6_000, 8_000, 10_000, 12_000,
  16_000, 20_000, 30_000, 40_000, 60_000, 80_000, 100_000
];

const MAX_STORED_MEASUREMENTS = 32;

function sanitizeMeasuredSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  return speed;
}

function bucketizeMeasuredSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  if (speed < THROUGHPUT_BUCKETS[0] || speed > THROUGHPUT_BUCKETS.at(-1)) {
    const magnitude = 10 ** Math.floor(Math.log10(speed));
    const steps = [1, 1.2, 1.6, 2, 3, 4, 6, 8];
    return steps.filter(step => step * magnitude <= speed).at(-1) * magnitude || speed;
  }
  let bucket = THROUGHPUT_BUCKETS[0];
  for (const step of THROUGHPUT_BUCKETS) {
    if (speed >= step) bucket = step;
    else break;
  }
  return bucket;
}

// performance comes from summarizeRunPerformance(); usage from the run result.
function isTrustworthyMeasurement(performance) {
  const rate = Number(performance?.effectiveInputTokensPerSecond);
  if (!Number.isFinite(rate) || rate <= 0) return false;
  const measuredRequests = (performance?.requests || []).filter(request => (
    Number.isFinite(request.ttftMs) && request.ttftMs > 0 && request.usage
  ));
  const promptTokens = measuredRequests.reduce((sum, request) => {
    const usage = request.usage;
    return sum + [usage.input, usage.cacheRead ?? usage.cache?.read, usage.cacheWrite ?? usage.cache?.write]
      .reduce((tokens, value) => tokens + (Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0), 0);
  }, 0);
  if (promptTokens < MIN_EVIDENCE_PROMPT_TOKENS) return false;
  return measuredRequests.length > 0;
}

// Exponential smoothing so one fast/slow outlier cannot flip behavior. The
// first samples lean toward the latest observation to converge quickly.
function smoothMeasurement(previous, latest) {
  const next = sanitizeMeasuredSpeed(latest);
  const prior = sanitizeMeasuredSpeed(previous);
  if (!next) return prior;
  if (!prior) return next;
  return prior * 0.7 + next * 0.3;
}

function measurementKey(providerId, modelId) {
  return `${String(providerId || '')}:${String(modelId || '')}`;
}

function normalizeMeasurementStore(store) {
  if (!store || typeof store !== 'object' || Array.isArray(store)) return {};
  const cleaned = {};
  for (const [key, entry] of Object.entries(store)) {
    if (!key || typeof entry !== 'object' || entry === null) continue;
    const tokensPerSecond = sanitizeMeasuredSpeed(entry.tokensPerSecond);
    if (!tokensPerSecond) continue;
    cleaned[key] = {
      tokensPerSecond,
      samples: Math.max(1, Math.min(999, Number(entry.samples) || 1)),
      updatedAt: Math.max(0, Number(entry.updatedAt) || 0),
      ...(entry.metric === 'prompt-tokens-per-observed-ttft-v2' ? { metric: entry.metric } : {})
    };
  }
  const entries = Object.entries(cleaned)
    .sort((left, right) => (right[1].updatedAt || 0) - (left[1].updatedAt || 0));
  return Object.fromEntries(entries.slice(0, MAX_STORED_MEASUREMENTS));
}

// Returns the functional speed for a run: the learned measurement when one
// exists (even below the 10k declared baseline — reality wins), otherwise the
// declared baseline. This is the single switch that makes the number real.
function functionalInputSpeed({ measured = 0, declared = DEFAULT_DECLARED_TOKENS_PER_SECOND } = {}) {
  const sanitizedMeasured = sanitizeMeasuredSpeed(measured);
  if (sanitizedMeasured > 0) return sanitizedMeasured;
  const declaredSpeed = Number(declared);
  return Number.isFinite(declaredSpeed) && declaredSpeed > 0
    ? declaredSpeed
    : DEFAULT_DECLARED_TOKENS_PER_SECOND;
}

module.exports = {
  DEFAULT_DECLARED_TOKENS_PER_SECOND,
  MAX_STORED_MEASUREMENTS,
  bucketizeMeasuredSpeed,
  functionalInputSpeed,
  isTrustworthyMeasurement,
  measurementKey,
  normalizeMeasurementStore,
  sanitizeMeasuredSpeed,
  smoothMeasurement
};

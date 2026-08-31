'use strict';

// Input-throughput learning: every completed run measures the real prefill
// rate (prompt tokens / summed TTFT). These helpers keep that measurement
// honest, stable, and model-agnostic — no provider or model is special-cased;
// each (provider, model) pair learns its own speed.

const MIN_MEASURED_TOKENS_PER_SECOND = 500;
const MAX_MEASURED_TOKENS_PER_SECOND = 100_000;
const DEFAULT_DECLARED_TOKENS_PER_SECOND = 10_000;

// A run only proves throughput when it actually pushed a meaningful prompt
// through prefill. Tiny prompts make TTFT-dominated rates meaningless.
const MIN_EVIDENCE_PROMPT_TOKENS = 2_000;

// Cache-safe buckets: the system prompt embeds the measured speed, so it must
// only change when throughput genuinely crosses a step (not every run).
const THROUGHPUT_BUCKETS = [
  500, 1_000, 1_500, 2_000, 3_000, 4_000, 6_000, 8_000, 10_000, 12_000,
  16_000, 20_000, 30_000, 40_000, 60_000, 80_000, 100_000
];

const MAX_STORED_MEASUREMENTS = 32;

function sanitizeMeasuredSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  return Math.min(
    MAX_MEASURED_TOKENS_PER_SECOND,
    Math.max(MIN_MEASURED_TOKENS_PER_SECOND, Math.round(speed))
  );
}

function bucketizeMeasuredSpeed(value) {
  const speed = Number(value);
  if (!Number.isFinite(speed) || speed <= 0) return 0;
  let bucket = THROUGHPUT_BUCKETS[0];
  for (const step of THROUGHPUT_BUCKETS) {
    if (speed >= step) bucket = step;
    else break;
  }
  return bucket;
}

// performance comes from summarizeRunPerformance(); usage from the run result.
function isTrustworthyMeasurement(performance, usage = {}) {
  const rate = Number(performance?.effectiveInputTokensPerSecond);
  if (!Number.isFinite(rate) || rate <= 0) return false;
  const promptTokens = (Number(usage?.input) || 0) + (Number(usage?.cacheRead) || 0);
  if (promptTokens < MIN_EVIDENCE_PROMPT_TOKENS) return false;
  const measuredRequests = (performance?.requests || []).some(request => request?.usage);
  if (!measuredRequests) return false;
  return true;
}

// Exponential smoothing so one fast/slow outlier cannot flip behavior. The
// first samples lean toward the latest observation to converge quickly.
function smoothMeasurement(previous, latest) {
  const next = sanitizeMeasuredSpeed(latest);
  if (!next) return Number(previous) || 0;
  const prior = Number(previous);
  if (!Number.isFinite(prior) || prior <= 0) return next;
  return Math.round(prior * 0.7 + next * 0.3);
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
      updatedAt: Math.max(0, Number(entry.updatedAt) || 0)
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
    ? Math.min(MAX_MEASURED_TOKENS_PER_SECOND, Math.round(declaredSpeed))
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

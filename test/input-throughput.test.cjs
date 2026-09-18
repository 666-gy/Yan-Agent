'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  bucketizeMeasuredSpeed,
  functionalInputSpeed,
  isTrustworthyMeasurement,
  measurementKey,
  normalizeMeasurementStore,
  sanitizeMeasuredSpeed,
  smoothMeasurement
} = require('../lib/input-throughput');

test('measured speeds preserve slow and fast observations without budget clamps', () => {
  assert.equal(sanitizeMeasuredSpeed(0), 0);
  assert.equal(sanitizeMeasuredSpeed(-5), 0);
  assert.equal(sanitizeMeasuredSpeed('abc'), 0);
  assert.equal(sanitizeMeasuredSpeed(120), 120);
  assert.equal(sanitizeMeasuredSpeed(0.25), 0.25);
  assert.equal(sanitizeMeasuredSpeed(Infinity), 0);
  assert.equal(sanitizeMeasuredSpeed(3_000), 3_000);
  assert.equal(sanitizeMeasuredSpeed(9_999_999), 9_999_999);
});

test('bucketize is cache-stable and monotonic', () => {
  assert.equal(bucketizeMeasuredSpeed(0), 0);
  assert.equal(bucketizeMeasuredSpeed(10_100), 10_000);
  assert.equal(bucketizeMeasuredSpeed(10_900), 10_000);
  assert.equal(bucketizeMeasuredSpeed(11_000), 10_000);
  assert.equal(bucketizeMeasuredSpeed(12_500), 12_000);
  assert.equal(bucketizeMeasuredSpeed(45_000), 40_000);
  assert.equal(bucketizeMeasuredSpeed(250_000), 200_000);
  assert.equal(bucketizeMeasuredSpeed(2_500_000), 2_000_000);
  assert.equal(bucketizeMeasuredSpeed(120), 120);
  assert.ok(bucketizeMeasuredSpeed(10_100) === bucketizeMeasuredSpeed(10_900));
});

test('trustworthiness requires real prefill evidence', () => {
  const perf = (rate, requests = [{ ttftMs: 100, usage: { input: 8000 } }]) => ({
    effectiveInputTokensPerSecond: rate,
    requests
  });
  assert.equal(isTrustworthyMeasurement(perf(30_000)), true);
  assert.equal(isTrustworthyMeasurement(perf(0)), false);
  assert.equal(isTrustworthyMeasurement(perf(30_000, [{ ttftMs: 100, usage: { input: 500 } }]), { input: 8000 }), false);
  assert.equal(isTrustworthyMeasurement(perf(30_000, [{ ttftMs: null, usage: { input: 8000 } }])), false);
  assert.equal(isTrustworthyMeasurement(perf(30_000, [{ ttftMs: 0, usage: { input: 8000 } }])), false);
  assert.equal(isTrustworthyMeasurement(perf(30_000, [{ ttftMs: 100, usage: { cache: { write: 8000 } } }])), true);
});

test('smoothing converges without flipping on one outlier', () => {
  assert.equal(smoothMeasurement(0, 30_000), 30_000);
  assert.equal(smoothMeasurement(30_000, 30_000), 30_000);
  assert.equal(smoothMeasurement(0, 233_458), 233_458);
  assert.equal(smoothMeasurement(200_000, 300_000), 230_000);
  assert.equal(smoothMeasurement(Infinity, 'oops'), 0);
  // One slow outlier moves a well-established fast measurement only slightly.
  const afterOutlier = smoothMeasurement(40_000, 1_000);
  assert.ok(afterOutlier > 27_000 && afterOutlier < 31_000);
  // Invalid latest keeps the previous value.
  assert.equal(smoothMeasurement(20_000, 'oops'), 20_000);
});

test('store normalization drops junk and caps size', () => {
  const entries = {};
  for (let index = 0; index < 40; index += 1) {
    entries[`p${index}:m`] = { tokensPerSecond: 5_000, samples: 2, updatedAt: index };
  }
  entries['bad:entry'] = { tokensPerSecond: 0 };
  entries['bad:shape'] = 'nope';
  const cleaned = normalizeMeasurementStore(entries);
  assert.equal(Object.keys(cleaned).length, 32);
  assert.equal(cleaned['bad:entry'], undefined);
  assert.equal(cleaned['bad:shape'], undefined);
  // Most recently updated entries survive the cap.
  assert.ok(cleaned['p39:m']);
  assert.equal(cleaned['p0:m'], undefined);
  assert.equal(cleaned['p39:m'].tokensPerSecond, 5_000);
});

test('functional speed prefers the learned measurement over the declared baseline', () => {
  assert.equal(functionalInputSpeed({ measured: 3_000, declared: 10_000 }), 3_000);
  assert.equal(functionalInputSpeed({ measured: 40_000, declared: 10_000 }), 40_000);
  assert.equal(functionalInputSpeed({ measured: 0, declared: 10_000 }), 10_000);
  assert.equal(functionalInputSpeed({}), 10_000);
  assert.equal(functionalInputSpeed({ measured: 'junk', declared: 10_000 }), 10_000);
  assert.equal(measurementKey('deepseek', 'deepseek-chat'), 'deepseek:deepseek-chat');
  const measured = normalizeMeasurementStore({ 'ds:flash': { tokensPerSecond: 233458, samples: 2, metric: 'prompt-tokens-per-observed-ttft-v2' } });
  assert.equal(measured['ds:flash'].tokensPerSecond, 233458);
  assert.equal(measured['ds:flash'].metric, 'prompt-tokens-per-observed-ttft-v2');
  assert.equal(functionalInputSpeed({ measured: 233458 }), 233458);
});

test('a measured 233458 tokens/s survives learning, persistence and the next sample', () => {
  const { createRunPerformance, beginPerformanceRequest, observePerformanceEvent, finishPerformanceRequest, summarizeRunPerformance } = require('../lib/open-code-stream');
  const run = createRunPerformance(1000);
  beginPerformanceRequest(run, 1000, 'fast-response');
  observePerformanceEvent(run, { type: 'message.part.delta', data: { messageID: 'fast-response', partID: 'text', field: 'text', delta: 'done' } }, 2000);
  finishPerformanceRequest(run, { input: 3458, cacheRead: 230000 }, 2200, 'fast-response');
  const measurement = summarizeRunPerformance(run, {}, 2300);
  assert.equal(isTrustworthyMeasurement(measurement), true);
  const stored = normalizeMeasurementStore({ 'ds:flash': {
    tokensPerSecond: smoothMeasurement(0, measurement.effectiveInputTokensPerSecond),
    samples: 1, updatedAt: 2300, metric: measurement.inputThroughputMetric
  } });
  const reloaded = normalizeMeasurementStore(JSON.parse(JSON.stringify(stored)));
  assert.equal(reloaded['ds:flash'].tokensPerSecond, 233458);
  assert.equal(reloaded['ds:flash'].metric, measurement.inputThroughputMetric);
  assert.equal(functionalInputSpeed({ measured: reloaded['ds:flash'].tokensPerSecond }), 233458);
  assert.ok(smoothMeasurement(reloaded['ds:flash'].tokensPerSecond, 300000) > 233458);
});

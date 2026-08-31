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

test('sanitize clamps measured speeds into a sane range', () => {
  assert.equal(sanitizeMeasuredSpeed(0), 0);
  assert.equal(sanitizeMeasuredSpeed(-5), 0);
  assert.equal(sanitizeMeasuredSpeed('abc'), 0);
  assert.equal(sanitizeMeasuredSpeed(120), 500);
  assert.equal(sanitizeMeasuredSpeed(3_000), 3_000);
  assert.equal(sanitizeMeasuredSpeed(9_999_999), 100_000);
});

test('bucketize is cache-stable and monotonic', () => {
  assert.equal(bucketizeMeasuredSpeed(0), 0);
  assert.equal(bucketizeMeasuredSpeed(10_100), 10_000);
  assert.equal(bucketizeMeasuredSpeed(10_900), 10_000);
  assert.equal(bucketizeMeasuredSpeed(11_000), 10_000);
  assert.equal(bucketizeMeasuredSpeed(12_500), 12_000);
  assert.equal(bucketizeMeasuredSpeed(45_000), 40_000);
  assert.equal(bucketizeMeasuredSpeed(250_000), 100_000);
  assert.ok(bucketizeMeasuredSpeed(10_100) === bucketizeMeasuredSpeed(10_900));
});

test('trustworthiness requires real prefill evidence', () => {
  const perf = (rate, requests = [{ usage: { input: 100 } }]) => ({
    effectiveInputTokensPerSecond: rate,
    requests
  });
  assert.equal(isTrustworthyMeasurement(perf(30_000), { input: 8_000 }), true);
  assert.equal(isTrustworthyMeasurement(perf(0), { input: 8_000 }), false);
  assert.equal(isTrustworthyMeasurement(perf(30_000), { input: 500 }), false);
  assert.equal(isTrustworthyMeasurement(perf(30_000, [{ usage: null }]), { input: 8_000 }), false);
});

test('smoothing converges without flipping on one outlier', () => {
  assert.equal(smoothMeasurement(0, 30_000), 30_000);
  assert.equal(smoothMeasurement(30_000, 30_000), 30_000);
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
});

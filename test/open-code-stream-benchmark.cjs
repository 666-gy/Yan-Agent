'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { performance } = require('node:perf_hooks');
const { OpenCodeEventBatcher } = require('../lib/open-code-stream');

const REPLAY_TOKENS = 120;
const REPLAY_RATES = [100, 300, 1_000, 3_000];

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * ratio))] || 0;
}

async function replay(rate) {
  const expected = Array.from({ length: REPLAY_TOKENS }, (_, index) => `${index}|`).join('');
  let received = '';
  let sent = 0;
  let batches = 0;
  const latencies = [];
  const startedAt = performance.now();
  const batcher = new OpenCodeEventBatcher({
    flushIntervalMs: 16,
    onBatch(_runId, events) {
      batches += 1;
      const observedAt = performance.now();
      for (const event of events) {
        received += String(event.data?.delta || '');
        latencies.push(observedAt - Number(event.data?.sentAt || observedAt));
      }
    }
  });

  await new Promise(resolve => {
    const timer = setInterval(() => {
      const elapsed = performance.now() - startedAt;
      const due = Math.min(REPLAY_TOKENS, Math.floor(elapsed * rate / 1_000));
      while (sent < due) {
        batcher.push('replay', {
          type: 'session.next.text.delta',
          data: { textID: 'stream', delta: `${sent}|`, sentAt: performance.now() }
        });
        sent += 1;
      }
      if (sent < REPLAY_TOKENS) return;
      clearInterval(timer);
      setTimeout(resolve, 24);
    }, 2);
  });
  batcher.close();

  return {
    rate,
    received,
    expected,
    batches,
    events: REPLAY_TOKENS,
    reduction: 1 - batches / REPLAY_TOKENS,
    p95Ms: percentile(latencies, 0.95),
    elapsedMs: performance.now() - startedAt
  };
}

test('offline stream replay preserves ordered output through 3000 tok/s', async () => {
  const results = [];
  for (const rate of REPLAY_RATES) results.push(await replay(rate));
  for (const result of results) {
    assert.equal(result.received, result.expected, `${result.rate} tok/s replay changed stream order`);
    assert.ok(result.p95Ms < 100, `${result.rate} tok/s p95 latency was ${result.p95Ms.toFixed(1)} ms`);
    assert.ok(result.batches < result.events, `${result.rate} tok/s did not reduce IPC traffic`);
  }
  console.table(results.map(result => ({
    target_tps: result.rate,
    token_events: result.events,
    ipc_batches: result.batches,
    ipc_reduction: `${(result.reduction * 100).toFixed(1)}%`,
    p95_latency_ms: result.p95Ms.toFixed(1),
    elapsed_ms: result.elapsedMs.toFixed(1)
  })));
});

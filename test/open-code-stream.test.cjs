'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  OpenCodeEventBatcher,
  beginPerformanceRequest,
  coalesceOpenCodeEvents,
  createRunPerformance,
  finishPerformanceRequest,
  observePerformanceEvent,
  probeGenerationStall,
  summarizeRunPerformance
} = require('../lib/open-code-stream');

function textDelta(text, id = 'text-1') {
  return { type: 'session.next.text.delta', data: { textID: id, delta: text } };
}

test('coalesces only adjacent deltas from the same stream', () => {
  const events = coalesceOpenCodeEvents([
    textDelta('one'),
    textDelta(' two'),
    { type: 'session.next.reasoning.delta', data: { reasoningID: 'r1', delta: 'think' } },
    textDelta(' three')
  ]);
  assert.equal(events.length, 3);
  assert.equal(events[0].data.delta, 'one two');
  assert.equal(events[1].data.delta, 'think');
  assert.equal(events[2].data.delta, ' three');
});

test('batches deltas and flushes them synchronously before lifecycle events', async () => {
  const batches = [];
  const batcher = new OpenCodeEventBatcher({
    flushIntervalMs: 5,
    onBatch(runId, events) { batches.push({ runId, events }); }
  });
  assert.equal(batcher.push('run-1', textDelta('a')), true);
  assert.equal(batcher.push('run-1', textDelta('b')), true);
  const flushed = batcher.flush('run-1');
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].data.delta, 'ab');
  assert.deepEqual(batches.map(batch => batch.runId), ['run-1']);
  batcher.close();
});

test('renderer prefers canonical output throughput and retains historical fallbacks', () => {
  const rendererSource = fs.readFileSync(path.join(__dirname, '..', 'renderer', 'renderer.js'), 'utf8');
  const fields = [
    'performance?.outputTokensPerSecond',
    'performance?.visibleOutputTokensPerSecond',
    'performance?.providerOutputTokensPerSecond'
  ];
  const positions = fields.map(field => rendererSource.indexOf(field));
  assert.ok(positions.every(position => position >= 0), 'renderer output-throughput fallback is incomplete');
  assert.ok(positions[0] < positions[1] && positions[1] < positions[2], 'renderer output-throughput fallback order changed');
});

test('summarizes cache, TTFT, and provider stream throughput without wall-clock inflation', () => {
  const performance = createRunPerformance(1_000);
  performance.kernelReadyAt = 1_010;
  performance.sessionReadyAt = 1_025;
  beginPerformanceRequest(performance, 1_100);
  observePerformanceEvent(performance, textDelta('hello'), 1_200);
  observePerformanceEvent(performance, textDelta(' world'), 1_300);
  finishPerformanceRequest(performance, {
    input: 100,
    output: 20,
    reasoning: 15,
    cache: { read: 900, write: 0 }
  }, 1_350);
  const summary = summarizeRunPerformance(performance, {
    input: 100,
    output: 20,
    reasoning: 15,
    cacheRead: 900
  }, 1_400);
  assert.equal(summary.kernelWaitMs, 10);
  assert.equal(summary.sessionSetupMs, 15);
  assert.equal(summary.firstTtftMs, 100);
  assert.equal(summary.prefillMs, 100);
  assert.equal(summary.effectiveInputTokensPerSecond, 10_000);
  assert.equal(summary.effectiveUncachedInputTokensPerSecond, 1_000);
  assert.equal(summary.effectiveCacheReadTokensPerSecond, 9_000);
  assert.equal(summary.decodeMs, 100);
  assert.equal(summary.responseGenerationMs, 150);
  assert.equal(summary.unobservedGenerationMs, 50);
  assert.equal(summary.providerOutputTokensPerSecond, 20 / 0.15);
  assert.equal(summary.visibleOutputTokensPerSecond, 200);
  assert.equal(summary.outputTokensPerSecond, 200);
  assert.equal(summary.cacheHitRate, 0.9);
  assert.equal(summary.streamEvents, 2);
});

test('starts visible decode timing at the first streamed delta, not step-start', () => {
  const performance = createRunPerformance(1_000);
  beginPerformanceRequest(performance, 1_000, 'step-with-preface');
  observePerformanceEvent(performance, {
    type: 'message.part.updated',
    data: { part: { messageID: 'step-with-preface', type: 'step-start' } }
  }, 1_100);
  observePerformanceEvent(performance, textDelta('first'), 1_400);
  observePerformanceEvent(performance, textDelta(' second'), 1_500);
  finishPerformanceRequest(performance, {
    input: 1_000,
    output: 20,
    cache: { read: 0, write: 0 }
  }, 1_550, 'step-with-preface');

  const summary = summarizeRunPerformance(performance, {}, 1_600);
  assert.equal(summary.firstTtftMs, 100);
  assert.equal(summary.decodeMs, 100);
  assert.equal(summary.visibleOutputTokensPerSecond, 200);
  assert.equal(summary.outputTokensPerSecond, 200);
});

test('measures every internal assistant step instead of inflating one outer request', () => {
  const performance = createRunPerformance(1_000);
  beginPerformanceRequest(performance, 1_050);
  observePerformanceEvent(performance, {
    type: 'message.updated',
    data: { info: { id: 'step-1', role: 'assistant', time: { created: 1_100 } } }
  }, 1_100);
  observePerformanceEvent(performance, {
    type: 'message.part.updated',
    data: { part: { messageID: 'step-1', type: 'step-start' } }
  }, 1_200);
  observePerformanceEvent(performance, {
    type: 'message.updated',
    data: {
      info: {
        id: 'step-1', role: 'assistant', time: { created: 1_100, completed: 1_250 },
        tokens: { input: 100, output: 10, cache: { read: 900, write: 0 } }
      }
    }
  }, 1_250);
  observePerformanceEvent(performance, {
    type: 'message.updated',
    data: { info: { id: 'step-2', role: 'assistant', time: { created: 1_300 } } }
  }, 1_300);
  observePerformanceEvent(performance, {
    type: 'message.part.updated',
    data: { part: { messageID: 'step-2', type: 'step-start' } }
  }, 1_500);
  observePerformanceEvent(performance, {
    type: 'message.updated',
    data: {
      info: {
        id: 'step-2', role: 'assistant', time: { created: 1_300, completed: 1_550 },
        tokens: { input: 2_000, output: 20, cache: { read: 0, write: 0 } }
      }
    }
  }, 1_550);

  const summary = summarizeRunPerformance(performance, {}, 1_600);
  assert.equal(summary.requests.length, 2);
  assert.equal(summary.prefillMs, 300);
  assert.equal(summary.effectiveInputTokensPerSecond, 10_000);
  assert.equal(summary.p10InputTokensPerSecond, 10_000);
  assert.equal(summary.medianInputTokensPerSecond, 10_000);
  assert.equal(summary.requestsBelow2000TokensPerSecond, 0);
});

test('excludes synthetic lifecycle requests without token usage from measured prefill', () => {
  const performance = createRunPerformance(1_000);
  beginPerformanceRequest(performance, 1_050);
  observePerformanceEvent(performance, textDelta('lifecycle'), 1_350);
  finishPerformanceRequest(performance, null, 2_000);
  beginPerformanceRequest(performance, 2_100, 'provider-step');
  observePerformanceEvent(performance, {
    type: 'message.part.updated',
    data: { part: { messageID: 'provider-step', type: 'text', text: 'done' } }
  }, 2_500);
  finishPerformanceRequest(performance, {
    input: 3_000,
    output: 10,
    cache: { read: 1_000, write: 0 }
  }, 2_700, 'provider-step');

  const summary = summarizeRunPerformance(performance, {}, 2_800);
  assert.equal(summary.requests.length, 2);
  assert.equal(summary.prefillMs, 400);
  assert.equal(summary.effectiveInputTokensPerSecond, 10_000);
});

test('probeGenerationStall flags the drip-stream pathology and spares healthy flows', () => {
  const minute = 60_000;
  // Drip stream: 1 char per minute for 20 minutes.
  const drip = createRunPerformance(0);
  drip.activeRequest = { messageID: 'm1', submittedAt: 0, firstDeltaAt: 1_000 };
  for (let t = minute; t <= 20 * minute; t += minute) {
    observePerformanceEvent(drip, textDelta('x'.repeat(1)), t);
  }
  assert.equal(probeGenerationStall(drip, 20 * minute).stalled, true);

  // Slow but productive reasoning stream stays well above the floor.
  const healthy = createRunPerformance(0);
  healthy.activeRequest = { messageID: 'm2', submittedAt: 0, firstDeltaAt: 1_000 };
  for (let t = 30_000; t <= 10 * minute; t += 30_000) {
    observePerformanceEvent(healthy, textDelta('正常速度的推理输出流。'.repeat(4)), t);
  }
  assert.equal(probeGenerationStall(healthy, 10 * minute).stalled, false);
});

test('probeGenerationStall respects grace period, silence and tool activity', () => {
  const now = 30 * 60_000;
  // First delta inside the grace window is never a stall.
  const fresh = createRunPerformance(0);
  fresh.activeRequest = { messageID: 'm3', submittedAt: 0, firstDeltaAt: now - 1_000 };
  observePerformanceEvent(fresh, textDelta('a'), now);
  assert.equal(probeGenerationStall(fresh, now).stalled, false);

  // A request that has not produced any delta yet is chunkTimeout territory.
  const silent = createRunPerformance(0);
  silent.activeRequest = { messageID: 'm4', submittedAt: 0, firstDeltaAt: 0 };
  assert.equal(probeGenerationStall(silent, now).stalled, false);

  // Recent tool activity counts as progress (long tool execution).
  const toolBusy = createRunPerformance(0);
  toolBusy.activeRequest = { messageID: 'm5', submittedAt: 0, firstDeltaAt: 1_000 };
  toolBusy.lastToolActivityAt = now - 10_000;
  assert.equal(probeGenerationStall(toolBusy, now).stalled, false);

  // No active request at all -> nothing to judge.
  assert.equal(probeGenerationStall(createRunPerformance(0), now).stalled, false);
});

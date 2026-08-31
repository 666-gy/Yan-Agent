'use strict';

const DEFAULT_FLUSH_INTERVAL_MS = 16;

// Drip-stream pathology: SSE chunks keep trickling past the kernel's silent
// chunk timeout while producing almost nothing. The watchdog looks at
// effective output over a trailing window instead of inter-chunk silence.
const STALL_WINDOW_MS = 6 * 60 * 1000;
// ≈1.3 chars/s. Real slow-but-productive streams exceed this by far (slow
// visible CoT still emits hundreds of chars/min); the measured drip-stream
// incident produced ~340 chars over this span.
const STALL_MIN_WINDOW_CHARS = 480;
const STALL_FIRST_TOKEN_GRACE_MS = 90 * 1000;
const STALL_DELTA_LOG_LIMIT = 600;

function eventData(event = {}) {
  if (event.data && typeof event.data === 'object') return event.data;
  if (event.properties && typeof event.properties === 'object') return event.properties;
  return {};
}

function deltaDescriptor(event = {}) {
  const data = eventData(event);
  if (event.type === 'message.part.delta' && (data.field === 'text' || data.field === 'reasoning')) {
    return { key: `part:${String(data.partID || '')}`, delta: String(data.delta || '') };
  }
  if (event.type === 'session.next.text.delta') {
    return { key: `text:${String(data.textID || 'stream')}`, delta: String(data.delta || '') };
  }
  if (event.type === 'session.next.reasoning.delta') {
    return { key: `reasoning:${String(data.reasoningID || 'stream')}`, delta: String(data.delta || '') };
  }
  return null;
}

function withMergedDelta(event, delta) {
  const key = event.data && typeof event.data === 'object' ? 'data' : 'properties';
  return {
    ...event,
    [key]: {
      ...eventData(event),
      delta
    }
  };
}

function coalesceOpenCodeEvents(events = []) {
  const output = [];
  for (const event of Array.isArray(events) ? events : []) {
    const descriptor = deltaDescriptor(event);
    const previous = output.at(-1);
    const previousDescriptor = deltaDescriptor(previous);
    if (descriptor && previousDescriptor && descriptor.key === previousDescriptor.key && event.type === previous.type) {
      output[output.length - 1] = withMergedDelta(previous, previousDescriptor.delta + descriptor.delta);
    } else {
      output.push(event);
    }
  }
  return output;
}

class OpenCodeEventBatcher {
  constructor({ onBatch, flushIntervalMs = DEFAULT_FLUSH_INTERVAL_MS } = {}) {
    if (typeof onBatch !== 'function') throw new TypeError('OpenCodeEventBatcher requires onBatch.');
    this.onBatch = onBatch;
    this.flushIntervalMs = Math.max(0, Number(flushIntervalMs) || 0);
    this.pending = new Map();
    this.timers = new Map();
  }

  push(runId, event) {
    const id = String(runId || '');
    if (!id || !deltaDescriptor(event)) return false;
    const events = this.pending.get(id) || [];
    events.push(event);
    this.pending.set(id, events);
    if (!this.timers.has(id)) {
      const timer = setTimeout(() => this.flush(id), this.flushIntervalMs);
      timer.unref?.();
      this.timers.set(id, timer);
    }
    return true;
  }

  flush(runId) {
    const id = String(runId || '');
    const timer = this.timers.get(id);
    if (timer) clearTimeout(timer);
    this.timers.delete(id);
    const events = this.pending.get(id) || [];
    this.pending.delete(id);
    if (!events.length) return [];
    const batch = coalesceOpenCodeEvents(events);
    this.onBatch(id, batch);
    return batch;
  }

  flushAll() {
    for (const runId of [...this.pending.keys()]) this.flush(runId);
  }

  close() {
    this.flushAll();
    for (const timer of this.timers.values()) clearTimeout(timer);
    this.timers.clear();
  }
}

function createRunPerformance(startedAt = Date.now()) {
  return {
    startedAt,
    kernelReadyAt: 0,
    sessionReadyAt: 0,
    streamEvents: 0,
    streamChars: 0,
    requests: [],
    activeRequest: null,
    requestsByMessageID: new Map(),
    // Rolling delta samples (at, chars) for the generation-stall watchdog.
    deltaLog: [],
    lastToolActivityAt: 0
  };
}

function requestMessageID(event = {}) {
  const data = eventData(event);
  return String(data.messageID || data.part?.messageID || data.info?.id || '');
}

function requestForMessage(performance, messageID) {
  if (!performance || !messageID) return null;
  return performance.requestsByMessageID?.get(String(messageID)) || null;
}

function beginPerformanceRequest(performance, submittedAt = Date.now(), messageID = '') {
  if (!performance) return null;
  const id = String(messageID || '');
  const existing = requestForMessage(performance, id);
  if (existing) return existing;
  if (id && performance.activeRequest && !performance.activeRequest.messageID && !performance.activeRequest.firstDeltaAt) {
    const request = performance.activeRequest;
    request.messageID = id;
    request.submittedAt = Number(submittedAt) || request.submittedAt;
    performance.requestsByMessageID.set(id, request);
    return request;
  }
  const request = {
    messageID: id,
    submittedAt,
    firstDeltaAt: 0,
    firstStreamDeltaAt: 0,
    lastDeltaAt: 0,
    completedAt: 0,
    streamEvents: 0,
    streamChars: 0,
    usage: null
  };
  performance.requests.push(request);
  performance.activeRequest = request;
  if (id) performance.requestsByMessageID.set(id, request);
  return request;
}

function observePerformanceEvent(performance, event, observedAt = Date.now()) {
  if (!performance || !event?.type) return;
  const data = eventData(event);
  if (event.type === 'message.updated') {
    const info = data.info || {};
    if (String(info.role || '') !== 'assistant' || !info.id) return;
    const request = beginPerformanceRequest(
      performance,
      Number(info.time?.created) || observedAt,
      String(info.id)
    );
    if (info.time?.completed) {
      finishPerformanceRequest(
        performance,
        info.tokens,
        Number(info.time.completed) || observedAt,
        String(info.id)
      );
    }
    return request;
  }

  const descriptor = deltaDescriptor(event);
  const part = data.part || {};
  const responseStarted = descriptor || (
    event.type === 'message.part.updated'
    && ['step-start', 'reasoning', 'text', 'tool'].includes(String(part.type || ''))
  );
  if (!responseStarted) return;
  if (event.type === 'message.part.updated' && String(part.type || '') === 'tool') {
    performance.lastToolActivityAt = observedAt;
  }
  const messageID = requestMessageID(event);
  const request = requestForMessage(performance, messageID)
    || performance.activeRequest
    || beginPerformanceRequest(performance, observedAt, messageID);
  if (!request) return;
  if (!request.firstDeltaAt) request.firstDeltaAt = observedAt;

  if (!descriptor) return;
  if (!request.firstStreamDeltaAt) request.firstStreamDeltaAt = observedAt;
  performance.streamEvents += 1;
  performance.streamChars += descriptor.delta.length;
  if (Array.isArray(performance.deltaLog)) {
    performance.deltaLog.push({ at: observedAt, chars: descriptor.delta.length });
    if (performance.deltaLog.length > STALL_DELTA_LOG_LIMIT * 2) {
      performance.deltaLog.splice(0, performance.deltaLog.length - STALL_DELTA_LOG_LIMIT);
    }
  }
  request.lastDeltaAt = observedAt;
  request.streamEvents += 1;
  request.streamChars += descriptor.delta.length;
}

function finishPerformanceRequest(performance, usage, completedAt = Date.now(), messageID = '') {
  const request = requestForMessage(performance, messageID) || performance?.activeRequest;
  if (!request) return null;
  request.completedAt ||= completedAt;
  request.usage = usage && typeof usage === 'object' ? usage : null;
  if (performance.activeRequest === request) performance.activeRequest = null;
  return request;
}

function usageTotals(usage = {}) {
  const cache = usage.cache && typeof usage.cache === 'object' ? usage.cache : {};
  return {
    input: Math.max(0, Number(usage.input) || 0),
    output: Math.max(0, Number(usage.output) || 0),
    reasoning: Math.max(0, Number(usage.reasoning) || 0),
    cacheRead: Math.max(0, Number(usage.cacheRead ?? cache.read) || 0),
    cacheWrite: Math.max(0, Number(usage.cacheWrite ?? cache.write) || 0)
  };
}

function summarizeRunPerformance(performance, usage = {}, completedAt = Date.now()) {
  if (!performance) return null;
  const requests = performance.requests.filter(request => (
    request.firstDeltaAt || request.completedAt || request.usage
  )).map(request => {
    const requestCompletedAt = request.completedAt || completedAt;
    return {
      messageID: request.messageID || '',
      ttftMs: request.firstDeltaAt ? Math.max(0, request.firstDeltaAt - request.submittedAt) : null,
      streamMs: request.firstStreamDeltaAt && request.lastDeltaAt
        ? Math.max(0, request.lastDeltaAt - request.firstStreamDeltaAt)
        : 0,
      generationMs: request.firstDeltaAt
        ? Math.max(0, requestCompletedAt - request.firstDeltaAt)
        : 0,
      totalMs: Math.max(0, requestCompletedAt - request.submittedAt),
      streamEvents: request.streamEvents,
      streamChars: request.streamChars,
      usage: request.usage ? usageTotals(request.usage) : null
    };
  });
  const observedTotals = requests.reduce((sum, request) => {
    if (!request.usage) return sum;
    for (const key of Object.keys(sum)) sum[key] += request.usage[key] || 0;
    return sum;
  }, { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
  const observedPromptTokens = observedTotals.input + observedTotals.cacheRead;
  const totals = observedPromptTokens > 0 ? observedTotals : usageTotals(usage);
  const measuredRequests = requests.filter(request => request.usage && (
    request.usage.input > 0 || request.usage.cacheRead > 0 || request.usage.cacheWrite > 0
  ));
  const decodeMs = requests.reduce((sum, request) => sum + request.streamMs, 0);
  const responseGenerationMs = requests.reduce((sum, request) => (
    sum + ((request.usage?.output || 0) > 0 ? request.generationMs : 0)
  ), 0);
  // Only provider responses with token usage are evidence of model prefill.
  // OpenCode can emit a synthetic lifecycle request before the real assistant
  // message; counting that request understated the measured input rate.
  const prefillMs = measuredRequests.reduce((sum, request) => sum + (request.ttftMs || 0), 0);
  const promptTokens = totals.input + totals.cacheRead;
  const requestInputRates = measuredRequests.flatMap(request => {
    const requestTokens = (request.usage?.input || 0) + (request.usage?.cacheRead || 0);
    return request.ttftMs > 0 && requestTokens > 0
      ? [requestTokens / (request.ttftMs / 1000)]
      : [];
  }).sort((left, right) => left - right);
  const percentile = ratio => requestInputRates.length
    ? requestInputRates[Math.min(requestInputRates.length - 1, Math.floor((requestInputRates.length - 1) * ratio))]
    : null;
  const providerOutputTokensPerSecond = responseGenerationMs > 0 && totals.output > 0
    ? totals.output / (responseGenerationMs / 1000)
    : null;
  const visibleOutputTokensPerSecond = decodeMs > 0 && totals.output > 0
    ? totals.output / (decodeMs / 1000)
    : null;
  return {
    totalMs: Math.max(0, completedAt - performance.startedAt),
    kernelWaitMs: performance.kernelReadyAt
      ? Math.max(0, performance.kernelReadyAt - performance.startedAt)
      : null,
    sessionSetupMs: performance.sessionReadyAt && performance.kernelReadyAt
      ? Math.max(0, performance.sessionReadyAt - performance.kernelReadyAt)
      : null,
    requestCount: requests.length,
    firstTtftMs: requests.find(request => request.ttftMs !== null)?.ttftMs ?? null,
    prefillMs,
    decodeMs,
    responseGenerationMs,
    unobservedGenerationMs: Math.max(0, responseGenerationMs - decodeMs),
    effectiveInputTokensPerSecond: prefillMs > 0 && promptTokens > 0
      ? promptTokens / (prefillMs / 1000)
      : null,
    effectiveUncachedInputTokensPerSecond: prefillMs > 0 && totals.input > 0
      ? totals.input / (prefillMs / 1000)
      : null,
    effectiveCacheReadTokensPerSecond: prefillMs > 0 && totals.cacheRead > 0
      ? totals.cacheRead / (prefillMs / 1000)
      : null,
    medianInputTokensPerSecond: percentile(0.5),
    p10InputTokensPerSecond: percentile(0.1),
    requestsBelow2000TokensPerSecond: requestInputRates.filter(rate => rate < 2_000).length,
    // The UI reports decode throughput when deltas are observable. Tool-only
    // responses have no visible decode span, so retain provider throughput as
    // the honest fallback instead of dropping the metric entirely.
    outputTokensPerSecond: visibleOutputTokensPerSecond ?? providerOutputTokensPerSecond,
    providerOutputTokensPerSecond,
    visibleOutputTokensPerSecond,
    cacheHitRate: promptTokens > 0 ? totals.cacheRead / promptTokens : null,
    streamEvents: performance.streamEvents,
    streamChars: performance.streamChars,
    requests
  };
}

// Detects the drip-stream pathology: deltas keep arriving (so a silent-chunk
// timeout never fires) while effective output over the trailing window is
// negligible. Requires an active request that already produced its first
// delta; fully silent streams stay the kernel chunkTimeout's job. Tool activity
// within the window counts as progress — a long tool execution is not a stall.
// The timing knobs are injectable so tests (and future tuning) can tighten
// them without touching wall-clock code paths.
function probeGenerationStall(performance, now = Date.now(), {
  windowMs = STALL_WINDOW_MS,
  minChars = STALL_MIN_WINDOW_CHARS,
  graceMs = STALL_FIRST_TOKEN_GRACE_MS
} = {}) {
  if (!performance || !performance.activeRequest) return { stalled: false, reason: '' };
  // Activity is judged from the delta log, not from one request object:
  // several request records can coexist for a turn (synthetic lifecycle
  // request, per-message records) and activeRequest may be one that never
  // saw a delta.
  const samples = performance.deltaLog || [];
  if (!samples.length) return { stalled: false, reason: '' };
  const firstSampleAt = samples[0].at;
  const lastSampleAt = samples[samples.length - 1].at;
  if (now - lastSampleAt > windowMs) {
    // No deltas in the whole trailing window: the stream went fully silent,
    // which is the kernel chunkTimeout's territory, not a drip stall.
    return { stalled: false, reason: '' };
  }
  // Grace covers warmup after the stream started producing at all, never
  // keyed on the latest drip (a dripping stream would refresh it forever).
  if (now - firstSampleAt < graceMs) return { stalled: false, reason: '' };
  const windowChars = samples
    .filter(sample => sample.at > now - windowMs)
    .reduce((sum, sample) => sum + sample.chars, 0);
  if (performance.lastToolActivityAt > now - windowMs) {
    return { stalled: false, reason: '' };
  }
  if (windowChars < minChars) {
    return {
      stalled: true,
      reason: `模型输出近乎停滞：最近 ${Math.round(Math.min(windowMs, now - firstSampleAt) / 1000)} 秒仅产出 ${windowChars} 字符，已自动重试。`
    };
  }
  return { stalled: false, reason: '' };
}

module.exports = {
  DEFAULT_FLUSH_INTERVAL_MS,
  OpenCodeEventBatcher,
  beginPerformanceRequest,
  coalesceOpenCodeEvents,
  createRunPerformance,
  deltaDescriptor,
  finishPerformanceRequest,
  observePerformanceEvent,
  probeGenerationStall,
  STALL_FIRST_TOKEN_GRACE_MS,
  STALL_MIN_WINDOW_CHARS,
  STALL_WINDOW_MS,
  summarizeRunPerformance,
  usageTotals
};

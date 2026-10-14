'use strict';
// Main-thread half of the kernel event stream reader.
//
// Returns the same `{ stream: AsyncIterable }` shape the vendor SDK's
// `client.event.subscribe()` returns, so the sidecar's existing consume /
// reconnect loop works unchanged. The socket, the byte-level framing and the
// JSON parsing all live in lib/kernel-event-worker.js; this file only shuttles
// small events to the consumer and hands credit back so the worker keeps
// reading.

const path = require('node:path');
const { Worker } = require('node:worker_threads');

const WORKER_FILE = path.join(__dirname, 'kernel-event-worker.js')
  .replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');

const DEFAULT_CREDIT_WINDOW = 256;
const DEFAULT_CREDIT_REFILL = 128;

// Thrown when the subscription dies. The sidecar treats any stream death as a
// reconnect trigger, so this only has to be honest and descriptive.
const streamError = (message, name) => {
  const error = new Error(message);
  if (name) error.name = name;
  return error;
};

const buildEventUrl = (baseUrl, directory) => {
  const trimmed = String(baseUrl || '').replace(/\/$/, '');
  const params = new URLSearchParams();
  if (directory) params.set('directory', String(directory));
  const query = params.toString();
  return query ? `${trimmed}/event?${query}` : `${trimmed}/event`;
};

// A push-based async iterable: the worker's messages are buffered here and
// pulled by the consumer. `onConsume` fires as each item is handed out, which
// is where credit is actually earned back — counting on arrival instead would
// let a stalled consumer grow this buffer without limit.
function createEventQueue({ onConsume } = {}) {
  const items = [];
  let resolveNext = null;
  let failure = null;
  let finished = false;

  const settle = () => {
    if (!resolveNext) return;
    if (items.length || failure || finished) {
      const resolve = resolveNext;
      resolveNext = null;
      resolve();
    }
  };

  return {
    push(event) { items.push(event); settle(); },
    // The first terminal signal wins: an exit that follows a clean end (or an
    // abort) must not be reported to the consumer as a failure.
    fail(error) {
      if (finished || failure) return;
      failure = error;
      settle();
    },
    close() {
      if (failure) return;
      finished = true;
      settle();
    },
    size() { return items.length; },
    async *[Symbol.asyncIterator]() {
      try {
        for (;;) {
          if (items.length) {
            const event = items.shift();
            onConsume?.();
            yield event;
            continue;
          }
          if (failure) throw failure;
          if (finished) return;
          await new Promise(resolve => { resolveNext = resolve; });
        }
      } finally {
        // Runs on return() too, so a consumer that breaks out of the loop
        // still releases the worker and its socket.
        this.onReturn?.();
      }
    }
  };
}

/**
 * Open the kernel's SSE event stream and deliver parsed, size-limited events.
 *
 * `onStats` receives worker statistics (frames, trimmed, abandoned, bytes) —
 * the numbers the stability log records. `onWarning` receives non-fatal notices
 * such as an oversized event being reduced to a skeleton.
 */
function openKernelEventStream({
  baseUrl,
  directory = '',
  headers = {},
  signal,
  log,
  onStats,
  onWarning,
  workerOptions,
  creditWindow = DEFAULT_CREDIT_WINDOW,
  creditRefill = DEFAULT_CREDIT_REFILL
} = {}) {
  if (!baseUrl) throw new Error('openKernelEventStream requires a baseUrl');

  let credits = creditWindow;
  let consumed = 0;
  let terminated = false;
  const queue = createEventQueue({
    onConsume() {
      consumed += 1;
      credits -= 1;
      if (credits > 0) return;
      credits += creditRefill;
      // Refill one window at a time: the worker then never has more than
      // `creditWindow` events in flight, so this queue stays bounded.
      try { worker.postMessage({ kind: 'credit', amount: creditRefill }); } catch {}
    }
  });

  const worker = new Worker(WORKER_FILE, {
    workerData: {
      url: buildEventUrl(baseUrl, directory),
      headers,
      options: { creditWindow, ...(workerOptions || {}) }
    },
    name: 'yan-kernel-events',
    // A runaway frame should kill this worker, not the app: the stream dies,
    // the sidecar reconnects, and the main process is untouched.
    resourceLimits: { maxOldGenerationSizeMb: 768 }
  });

  const onAbort = () => {
    cleanup();
    queue.close();
  };
  if (signal) {
    if (signal.aborted) onAbort();
    else signal.addEventListener('abort', onAbort, { once: true });
  }

  function cleanup() {
    if (terminated) return;
    terminated = true;
    signal?.removeEventListener?.('abort', onAbort);
    try { worker.postMessage({ kind: 'abort' }); } catch {}
    // terminate() reports exit code 1; `terminated` is what keeps that from
    // being mistaken for a stream failure.
    setTimeout(() => { try { worker.terminate(); } catch {} }, 0).unref?.();
  }
  queue.onReturn = cleanup;

  worker.on('message', message => {
    if (!message || typeof message !== 'object') return;
    if (message.kind === 'event') {
      if (message.oversized) {
        onWarning?.({
          type: message.oversized,
          bytes: message.event?.properties?.yanOversizedBytes || 0,
          eventType: message.event?.type || ''
        });
      }
      queue.push(message.event);
      return;
    }
    if (message.kind === 'stats') {
      onStats?.(message.stats);
      return;
    }
    if (message.kind === 'error') {
      cleanup();
      queue.fail(streamError(message.message || 'OpenCode event stream failed', message.name));
      return;
    }
    if (message.kind === 'end') {
      // A clean end still means the subscription is gone; the sidecar decides
      // whether that is legitimate (it throws unless the run is aborting).
      cleanup();
      queue.close();
    }
  });

  worker.on('error', error => {
    log?.warn?.(`[opencode] Event stream worker failed: ${error?.message || error}`);
    cleanup();
    queue.fail(streamError(error?.message || 'OpenCode event stream worker failed', error?.name));
  });

  worker.on('exit', code => {
    if (terminated) return;
    cleanup();
    if (code === 0) queue.close();
    else queue.fail(streamError(`OpenCode event stream worker exited (${code})`));
  });

  return {
    stream: queue,
    // Exposed so the sidecar can abandon the stream without aborting the run.
    close() { onAbort(); }
  };
}

module.exports = { openKernelEventStream, buildEventUrl };

'use strict';
// Kernel event-stream reader, running in a worker thread.
//
// Why this exists: the kernel's /event stream carries whole-session snapshots.
// A single session.updated frame can reach tens of megabytes (permission rule
// arrays and per-message diffs are unbounded), and the vendor SDK parses the
// stream on the main thread with a whole-buffer replace + split per network
// read — quadratic, and the reason Yan froze permanently in 2026-09.
//
// This worker owns the socket and does the framing at the byte level:
//   * frames are found by scanning forward from where the last scan stopped,
//     never by re-splitting the whole accumulated buffer;
//   * a frame that grows past the raw cap is abandoned mid-flight — its bytes
//     are discarded as they arrive, so it is never held in memory or parsed;
//   * parseable frames are trimmed (permission rules, diffs, huge strings) and
//     reduced to a skeleton if trimming cannot get them under the delivery cap;
//   * reading pauses when the main thread falls behind (credit-based
//     backpressure), which pushes pressure onto the TCP connection instead of
//     onto the heap.
//
// The main thread only ever receives small, structured events.

const { parentPort, workerData } = require('node:worker_threads');

const DEFAULTS = {
  // A frame larger than this is never assembled or parsed. The kernel writes
  // one `data:` line per frame; a frame this big is already pathological.
  maxRawFrameBytes: 64 * 1024 * 1024,
  // Ceiling for what may cross the thread boundary.
  maxDeliveredBytes: 4 * 1024 * 1024,
  // Strings longer than this inside an event are truncated.
  maxStringBytes: 256 * 1024,
  // Arrays longer than this are truncated (permission rules, diffs, parts).
  maxArrayItems: 2000,
  // Nested depth beyond which values are replaced by a marker.
  maxDepth: 12,
  // How many events may be in flight to the parent before reading pauses.
  creditWindow: 256,
  // Head of an abandoned frame kept for identifier recovery.
  skeletonHeadBytes: 64 * 1024
};

const options = { ...DEFAULTS, ...(workerData?.options || {}) };
const url = String(workerData?.url || '');
const headers = workerData?.headers && typeof workerData.headers === 'object' ? workerData.headers : {};

const stats = {
  frames: 0,
  delivered: 0,
  trimmed: 0,
  skeletonized: 0,
  abandoned: 0,
  abandonedBytes: 0,
  bytes: 0,
  maxFrameBytes: 0,
  maxDeliveredBytes: 0,
  creditWaits: 0
};

let aborted = false;
let controller = null;
let credit = options.creditWindow;
let creditWaiter = null;

const post = message => { try { parentPort.postMessage(message); } catch {} };
const postStats = () => post({ kind: 'stats', stats: { ...stats } });

// Set when something abnormal happened (a trim, a skeleton, an abandoned or
// megabyte-sized frame). Those statistics are posted at once instead of on the
// 5 s timer, so a short run that hit one still reports it before it ends.
const ALERT_FRAME_BYTES = 1024 * 1024;
let anomaly = false;

let statsTimer = null;
const scheduleStats = () => {
  if (statsTimer) return;
  statsTimer = setTimeout(() => { statsTimer = null; postStats(); }, 5000);
  statsTimer.unref?.();
};

const awaitCredit = () => {
  if (credit > 0 || aborted) return null;
  stats.creditWaits++;
  if (!creditWaiter) {
    let resolve;
    const promise = new Promise(r => { resolve = r; });
    creditWaiter = { promise, resolve };
  }
  return creditWaiter.promise;
};

const releaseCreditWaiter = () => {
  const waiter = creditWaiter;
  creditWaiter = null;
  waiter?.resolve();
};

const jsonSize = value => {
  try { return Buffer.byteLength(JSON.stringify(value), 'utf8'); }
  catch { return Number.MAX_SAFE_INTEGER; }
};

// Generic size clamp, applied only when the named trims were not enough.
const truncate = (value, depth = 0) => {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'string' && Buffer.byteLength(value, 'utf8') > options.maxStringBytes) {
      return `${value.slice(0, options.maxStringBytes)}…[yanTruncated ${value.length} chars]`;
    }
    return value;
  }
  if (depth >= options.maxDepth) return '[yanTruncated depth]';
  if (Array.isArray(value)) {
    const limit = Math.min(value.length, options.maxArrayItems);
    const out = [];
    for (let i = 0; i < limit; i++) out.push(truncate(value[i], depth + 1));
    if (value.length > limit) out.push(`[yanTruncated ${value.length - limit} more items]`);
    return out;
  }
  const out = {};
  for (const key of Object.keys(value)) out[key] = truncate(value[key], depth + 1);
  return out;
};

// The two shapes that actually ballooned the real database, handled by name so
// everything else keeps its faithful shape.
const trimKnown = event => {
  // Global streams wrap the event as { directory, payload: { type, ... } }.
  const inner = event?.payload && typeof event.payload === 'object' && event.payload.type ? event.payload : event;
  const info = inner?.properties?.info;
  if (!info || typeof info !== 'object') return event;
  let trimmed = false;
  if (Array.isArray(info.permission) && info.permission.length > options.maxArrayItems) {
    // The kernel resolves a permission by the LAST matching rule, so the tail
    // is the part that still decides anything.
    const total = info.permission.length;
    const keep = Math.min(64, options.maxArrayItems);
    info.permission = info.permission.slice(-keep);
    info.permission.unshift(`[yanTruncated ${total - keep} earlier rules]`);
    trimmed = true;
  }
  const summary = info.summary;
  const diffs = summary && typeof summary === 'object' ? summary.diffs : null;
  if (Array.isArray(diffs) && diffs.length) {
    let bytes = 0;
    const kept = [];
    for (const diff of diffs) {
      bytes += jsonSize(diff);
      if (bytes > options.maxStringBytes) break;
      kept.push(diff);
    }
    if (kept.length < diffs.length) {
      // These diffs are only a transcript preview; a run's real change set is
      // collected from the REST message history at finalization.
      summary.diffs = kept;
      summary.yanDiffsTruncated = diffs.length - kept.length;
      trimmed = true;
    }
  }
  if (trimmed) { stats.trimmed++; anomaly = true; }
  return event;
};

// Identifiers appear at the head of every kernel frame
// ({"id":...,"type":...,"properties":{"sessionID":...,"info":{...}}}), so a
// bounded head is enough to keep routing the event even when its payload is
// discarded. The sidecar routes subagent, permission and part traffic by these.
const skeleton = (head, bytes, reason) => {
  const pick = key => {
    const match = head.match(new RegExp(`"${key}"\\s*:\\s*"([^"\\\\]{0,160})"`));
    return match ? match[1] : '';
  };
  stats.skeletonized++;
  anomaly = true;
  const properties = { yanOversized: reason, yanOversizedBytes: bytes };
  const sessionID = pick('sessionID');
  const messageID = pick('messageID');
  const partID = pick('partID');
  if (sessionID) properties.sessionID = sessionID;
  if (messageID) properties.messageID = messageID;
  if (partID) properties.partID = partID;
  return {
    id: pick('id') || `evt_oversized_${Date.now().toString(36)}`,
    type: pick('type') || 'unknown',
    properties
  };
};

const emit = (event, oversized) => {
  credit -= 1;
  stats.delivered++;
  post(oversized ? { kind: 'event', event, oversized } : { kind: 'event', event });
  if (anomaly) {
    anomaly = false;
    postStats();
    return;
  }
  scheduleStats();
};

const handleFrame = frame => {
  // Framing is byte-level so a multi-byte character split across two reads is
  // only ever decoded here, after its frame has been joined whole.
  const text = Buffer.isBuffer(frame) ? frame.toString('utf8') : String(frame);
  const payload = extractData(text);
  if (!payload) return; // comment / heartbeat line
  const bytes = Buffer.byteLength(payload, 'utf8');
  stats.frames++;
  if (bytes > stats.maxFrameBytes) stats.maxFrameBytes = bytes;
  if (bytes >= ALERT_FRAME_BYTES) anomaly = true;
  let parsed;
  try { parsed = JSON.parse(payload); }
  catch { return; }
  let event = trimKnown(parsed);
  let delivered = jsonSize(event);
  if (delivered > options.maxDeliveredBytes) {
    event = trimKnown(truncate(event));
    delivered = jsonSize(event);
  }
  if (delivered > options.maxDeliveredBytes) {
    emit(skeleton(payload.slice(0, options.skeletonHeadBytes), bytes, 'payload'), 'payload');
    return;
  }
  if (delivered > stats.maxDeliveredBytes) stats.maxDeliveredBytes = delivered;
  emit(event);
};

// The kernel writes a single `data:` line per frame (verified against opencode
// 1.18.11: no `id:`, `event:` or `retry:` lines, `server.heartbeat` every 10s).
// Multi-line data is still joined so a future kernel cannot silently break it.
const extractData = text => {
  if (!text) return '';
  if (text.charCodeAt(0) === 58) return ''; // ":" comment/heartbeat line
  let data = '';
  let start = 0;
  const length = text.length;
  while (start <= length) {
    let end = text.indexOf('\n', start);
    if (end < 0) end = length;
    let lineEnd = end;
    if (lineEnd > start && text.charCodeAt(lineEnd - 1) === 13) lineEnd -= 1; // CR
    if (text.startsWith('data:', start)) {
      let valueStart = start + 5;
      if (text.charCodeAt(valueStart) === 32) valueStart += 1;
      const value = text.slice(valueStart, lineEnd);
      data = data ? `${data}\n${value}` : value;
    }
    if (end >= length) break;
    start = end + 1;
  }
  return data;
};

const LF = 10;
const CR = 13;

// Framing works on raw bytes, in one forward pass over each arriving chunk.
// Nothing is re-scanned and no partial frame is ever re-concatenated: pending
// chunks are held in a list and joined exactly once, when their frame ends.
// (Assembling frames by string += and re-running indexOf is the quadratic
// behaviour this worker exists to remove.)
const createFramer = ({ maxRawFrameBytes, skeletonHeadBytes, onFrame, onAbandon }) => {
  let pending = [];
  let pendingBytes = 0;
  // The last two bytes seen, so a blank line split across reads is still found.
  let prev1 = -1;
  let prev2 = -1;
  let abandoning = null;

  // Only the head of an abandoned frame is kept, so join just enough pieces.
  const startAbandon = () => {
    const pieces = [];
    let size = 0;
    for (const piece of pending) {
      if (size >= skeletonHeadBytes) break;
      pieces.push(piece);
      size += piece.length;
    }
    const head = Buffer.concat(pieces, size).subarray(0, skeletonHeadBytes);
    abandoning = { head: head.toString('utf8'), bytes: pendingBytes };
    pending = [];
    pendingBytes = 0;
  };

  return {
    get abandoning() { return abandoning; },
    // Feed one network chunk. `onFrame(buffer)` is called per complete frame;
    // it is awaited before scanning continues so backpressure reaches the
    // socket. A frame may carry its trailing line-break bytes; the SSE line
    // parser ignores them.
    async push(chunk) {
      const length = chunk.length;
      let start = 0;
      let from = 0;
      while (from < length) {
        // Native memchr, so the per-byte cost stays out of JavaScript.
        const i = chunk.indexOf(LF, from);
        if (i < 0) break;
        from = i + 1;
        const p1 = i >= 1 ? chunk[i - 1] : prev1;
        const p2 = i >= 2 ? chunk[i - 2] : (i === 1 ? prev1 : prev2);
        // A blank line ends the frame: "\n\n" or "\n\r\n".
        if (!(p1 === LF || (p1 === CR && p2 === LF))) continue;
        if (abandoning) {
          abandoning.bytes += i - start;
          const finished = abandoning;
          abandoning = null;
          start = from;
          await onAbandon(finished);
          continue;
        }
        let frame;
        if (pending.length) {
          pending.push(chunk.subarray(start, i));
          frame = Buffer.concat(pending, pendingBytes + (i - start));
          pending = [];
          pendingBytes = 0;
        } else {
          frame = chunk.subarray(start, i);
        }
        start = from;
        if (frame.length) await onFrame(frame);
      }
      if (length >= 2) { prev2 = chunk[length - 2]; prev1 = chunk[length - 1]; }
      else if (length === 1) { prev2 = prev1; prev1 = chunk[0]; }
      const rest = length - start;
      if (rest <= 0) return;
      if (abandoning) { abandoning.bytes += rest; return; }
      pending.push(chunk.subarray(start));
      pendingBytes += rest;
      if (pendingBytes > maxRawFrameBytes) {
        // The frame in flight is too large to hold, let alone parse. Discard its
        // bytes as they arrive and resynchronise on the next blank line. This is
        // the case that used to freeze Yan for good.
        startAbandon();
      }
    },
    // Anything still buffered when the stream ends is a complete frame only if
    // the server closed right after it; deliver it rather than lose events.
    async flush() {
      if (abandoning) {
        const finished = abandoning;
        abandoning = null;
        await onAbandon(finished);
        return;
      }
      if (!pendingBytes) return;
      const frame = Buffer.concat(pending, pendingBytes);
      pending = [];
      pendingBytes = 0;
      await onFrame(frame);
    }
  };
};

parentPort.on('message', message => {
  if (!message || typeof message !== 'object') return;
  if (message.kind === 'credit') {
    credit += Number(message.amount) || 0;
    if (credit > 0) releaseCreditWaiter();
    return;
  }
  if (message.kind === 'abort') {
    aborted = true;
    releaseCreditWaiter();
    try { controller?.abort(); } catch {}
  }
});

// Pause until the main thread has room for another event. Returns false when
// the run was aborted while waiting.
const gate = async () => {
  if (aborted) return false;
  if (credit > 0) return true;
  const wait = awaitCredit();
  if (wait) await wait;
  return !aborted;
};

const main = async () => {
  controller = new AbortController();
  if (aborted) return;
  const response = await fetch(url, { headers, signal: controller.signal, redirect: 'error' });
  if (!response.ok) throw new Error(`OpenCode event stream responded ${response.status}`);
  if (!response.body) throw new Error('OpenCode event stream had no body');
  const reader = response.body.getReader();

  const framer = createFramer({
    maxRawFrameBytes: options.maxRawFrameBytes,
    skeletonHeadBytes: options.skeletonHeadBytes,
    onFrame: async frame => {
      if (!(await gate())) return;
      handleFrame(frame);
    },
    onAbandon: async finished => {
      stats.abandoned++;
      stats.abandonedBytes += finished.bytes;
      anomaly = true;
      if (finished.bytes > stats.maxFrameBytes) stats.maxFrameBytes = finished.bytes;
      if (!(await gate())) return;
      emit(skeleton(extractData(finished.head) || finished.head, finished.bytes, 'raw'), 'raw');
    }
  });

  try {
    for (;;) {
      if (!(await gate())) break;
      const { done, value } = await reader.read();
      if (done) {
        // The stream ending is not a reason to lose a frame already received.
        await framer.flush();
        break;
      }
      stats.bytes += value.length;
      await framer.push(Buffer.from(value.buffer, value.byteOffset, value.byteLength));
    }
  } finally {
    // An abort rejects the pending read; releasing the reader keeps the socket
    // from being held open by this worker.
    try { reader.cancel().catch(() => {}); } catch {}
  }
};

main().then(
  () => {
    postStats();
    post({ kind: 'end', aborted });
  },
  error => {
    postStats();
    post({
      kind: 'error',
      name: error?.name || '',
      message: error?.message ? String(error.message) : String(error)
    });
  }
);

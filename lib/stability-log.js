'use strict';
// Bounded, append-only record of the numbers that predict a freeze.
//
// The 2026-09 freeze grew silently for weeks: permission arrays doubled on
// every request and single kernel events reached hundreds of MB before anyone
// could see it. This log keeps the few figures that would have shown it early
// (event-stream sizes, trimmed/abandoned frames, session rule counts, database
// size) so the next regression is visible in one file instead of a debugger.
//
// It must never become the problem it watches: one writer per file, writes are
// asynchronous and serialized, lines are capped, and the file rotates once at
// a fixed size.

const fs = require('node:fs');
const path = require('node:path');

const STABILITY_LOG_NAME = 'stability.log';
const DEFAULT_MAX_BYTES = 1024 * 1024;
const MAX_LINE_BYTES = 8 * 1024;

const encodeLine = entry => {
  let line;
  try { line = JSON.stringify({ at: new Date().toISOString(), ...entry }); }
  catch { line = JSON.stringify({ at: new Date().toISOString(), event: 'log-encode-failed' }); }
  if (Buffer.byteLength(line, 'utf8') > MAX_LINE_BYTES) {
    line = JSON.stringify({ at: new Date().toISOString(), event: entry?.event || 'unknown', truncated: true });
  }
  return `${line}\n`;
};

function createStabilityLog({ dataDir, fileName = STABILITY_LOG_NAME, maxBytes = DEFAULT_MAX_BYTES } = {}) {
  const logPath = dataDir ? path.join(dataDir, fileName) : '';
  let size = -1;
  let chain = Promise.resolve();

  const append = async line => {
    if (size < 0) {
      try { size = (await fs.promises.stat(logPath)).size; } catch { size = 0; }
    }
    if (size + line.length > maxBytes) {
      try { await fs.promises.rename(logPath, `${logPath}.1`); } catch {}
      size = 0;
    }
    await fs.promises.mkdir(path.dirname(logPath), { recursive: true });
    await fs.promises.appendFile(logPath, line, 'utf8');
    size += Buffer.byteLength(line, 'utf8');
  };

  return {
    logPath,
    // Fire-and-forget. A logging failure is swallowed: the log exists to help
    // diagnose Yan, never to take it down.
    record(event, fields = {}) {
      if (!logPath) return chain;
      const line = encodeLine({ event, ...fields });
      chain = chain.then(() => append(line)).catch(() => {});
      return chain;
    },
    flush() { return chain; }
  };
}

// The subset of worker statistics worth keeping per run.
const summarizeEventStats = stats => {
  if (!stats || typeof stats !== 'object') return null;
  const pick = key => Number(stats[key]) || 0;
  return {
    frames: pick('frames'),
    delivered: pick('delivered'),
    bytes: pick('bytes'),
    maxFrameBytes: pick('maxFrameBytes'),
    maxDeliveredBytes: pick('maxDeliveredBytes'),
    trimmed: pick('trimmed'),
    skeletonized: pick('skeletonized'),
    abandoned: pick('abandoned'),
    abandonedBytes: pick('abandonedBytes'),
    creditWaits: pick('creditWaits')
  };
};

// A run may reconnect and so read several streams; each reports its own
// cumulative statistics. Counters add up, maxima take the largest.
const MAX_KEYS = new Set(['maxFrameBytes', 'maxDeliveredBytes']);
const mergeEventStats = list => {
  const summaries = (Array.isArray(list) ? list : []).map(summarizeEventStats).filter(Boolean);
  if (!summaries.length) return null;
  const merged = summarizeEventStats({});
  for (const summary of summaries) {
    for (const key of Object.keys(merged)) {
      merged[key] = MAX_KEYS.has(key) ? Math.max(merged[key], summary[key]) : merged[key] + summary[key];
    }
  }
  merged.streams = summaries.length;
  return merged;
};

// A run is worth a line when something about its event stream was abnormal.
// Ordinary runs are not logged, so the file stays small and every entry means
// something.
const EVENT_ALERT_FRAME_BYTES = 1024 * 1024;
const eventStatsNeedAttention = summary => !!summary && (
  summary.trimmed > 0
  || summary.skeletonized > 0
  || summary.abandoned > 0
  || summary.maxFrameBytes >= EVENT_ALERT_FRAME_BYTES
);

module.exports = {
  STABILITY_LOG_NAME,
  EVENT_ALERT_FRAME_BYTES,
  createStabilityLog,
  summarizeEventStats,
  mergeEventStats,
  eventStatsNeedAttention
};

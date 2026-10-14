'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createStabilityLog,
  summarizeEventStats,
  mergeEventStats,
  eventStatsNeedAttention,
  EVENT_ALERT_FRAME_BYTES,
  STABILITY_LOG_NAME
} = require('../lib/stability-log');

const tempDir = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-stability-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
};

const readLines = file => fs.readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));

test('record appends one JSON line per event with a timestamp', async t => {
  const dir = tempDir(t);
  const log = createStabilityLog({ dataDir: dir });
  assert.equal(log.logPath, path.join(dir, STABILITY_LOG_NAME));
  log.record('event-stream', { frames: 12, trimmed: 1 });
  log.record('run', { status: 'finished' });
  await log.flush();
  const lines = readLines(log.logPath);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].event, 'event-stream');
  assert.equal(lines[0].frames, 12);
  assert.equal(lines[1].event, 'run');
  assert.ok(!Number.isNaN(Date.parse(lines[0].at)));
});

test('writes are serialized in call order', async t => {
  const dir = tempDir(t);
  const log = createStabilityLog({ dataDir: dir });
  for (let i = 0; i < 50; i++) log.record('n', { i });
  await log.flush();
  const lines = readLines(log.logPath);
  assert.equal(lines.length, 50);
  assert.deepEqual(lines.map(line => line.i), Array.from({ length: 50 }, (_, i) => i));
});

test('rotates once and keeps the rotated file bounded', async t => {
  const dir = tempDir(t);
  const log = createStabilityLog({ dataDir: dir, maxBytes: 600 });
  for (let i = 0; i < 40; i++) log.record('n', { i, pad: 'x'.repeat(40) });
  await log.flush();
  const rotated = `${log.logPath}.1`;
  assert.ok(fs.existsSync(rotated), 'a rotated file exists');
  assert.ok(fs.statSync(log.logPath).size <= 600, 'live file stays under the cap');
  assert.ok(fs.statSync(rotated).size <= 600, 'rotated file stays under the cap');
  // Both halves together still carry the most recent entries.
  const all = [...readLines(rotated), ...readLines(log.logPath)];
  assert.equal(all.at(-1).i, 39);
  assert.ok(all.length >= 10 && all.length < 40, `bounded total, got ${all.length}`);
});

test('a line too large to be useful is replaced by its event name', async t => {
  const dir = tempDir(t);
  const log = createStabilityLog({ dataDir: dir });
  log.record('event-stream', { blob: 'y'.repeat(64 * 1024) });
  await log.flush();
  const [line] = readLines(log.logPath);
  assert.equal(line.event, 'event-stream');
  assert.equal(line.truncated, true);
  assert.equal(line.blob, undefined);
  assert.ok(fs.statSync(log.logPath).size < 1024);
});

test('a value JSON cannot encode still writes a line', async t => {
  const dir = tempDir(t);
  const log = createStabilityLog({ dataDir: dir });
  const circular = {};
  circular.self = circular;
  log.record('event-stream', { circular });
  await log.flush();
  const [line] = readLines(log.logPath);
  assert.equal(line.event, 'log-encode-failed');
});

test('a missing data directory disables writing instead of throwing', async () => {
  const log = createStabilityLog({});
  assert.equal(log.logPath, '');
  await assert.doesNotReject(() => log.record('event-stream', { frames: 1 }));
  log.record('event-stream', { frames: 2 });
  await log.flush();
});

test('append failures are swallowed so logging never breaks a run', async t => {
  const dir = tempDir(t);
  // A directory where the log file should be: appendFile must fail.
  fs.mkdirSync(path.join(dir, STABILITY_LOG_NAME));
  const log = createStabilityLog({ dataDir: dir });
  log.record('event-stream', { frames: 1 });
  log.record('event-stream', { frames: 2 });
  await assert.doesNotReject(() => log.flush());
});

test('summarizeEventStats keeps the counters and drops the rest', () => {
  const summary = summarizeEventStats({ frames: 5, trimmed: 1, maxFrameBytes: 900, junk: 'x' });
  assert.deepEqual(summary, {
    frames: 5,
    delivered: 0,
    bytes: 0,
    maxFrameBytes: 900,
    maxDeliveredBytes: 0,
    trimmed: 1,
    skeletonized: 0,
    abandoned: 0,
    abandonedBytes: 0,
    creditWaits: 0
  });
  assert.equal(summarizeEventStats(null), null);
  assert.equal(summarizeEventStats(undefined), null);
});

test('mergeEventStats adds counters and takes the largest maxima', () => {
  const merged = mergeEventStats([
    { frames: 10, trimmed: 1, maxFrameBytes: 3 * 1024 * 1024, bytes: 100, maxDeliveredBytes: 10 },
    null,
    { frames: 4, trimmed: 2, maxFrameBytes: 1024, bytes: 50, maxDeliveredBytes: 99 }
  ]);
  assert.equal(merged.frames, 14);
  assert.equal(merged.trimmed, 3);
  assert.equal(merged.bytes, 150);
  assert.equal(merged.maxFrameBytes, 3 * 1024 * 1024);
  assert.equal(merged.maxDeliveredBytes, 99);
  assert.equal(merged.streams, 2);
  assert.equal(mergeEventStats([]), null);
  assert.equal(mergeEventStats(undefined), null);
});

test('eventStatsNeedAttention fires on every abnormality and on nothing else', () => {
  const quiet = summarizeEventStats({ frames: 900, delivered: 900, bytes: 5 * 1024 * 1024 });
  assert.equal(eventStatsNeedAttention(quiet), false);
  assert.equal(eventStatsNeedAttention(summarizeEventStats({ trimmed: 1 })), true);
  assert.equal(eventStatsNeedAttention(summarizeEventStats({ skeletonized: 1 })), true);
  assert.equal(eventStatsNeedAttention(summarizeEventStats({ abandoned: 1 })), true);
  assert.equal(eventStatsNeedAttention(summarizeEventStats({ maxFrameBytes: EVENT_ALERT_FRAME_BYTES })), true);
  // One byte under the alert size is ordinary.
  assert.equal(eventStatsNeedAttention(summarizeEventStats({ maxFrameBytes: EVENT_ALERT_FRAME_BYTES - 1 })), false);
  assert.equal(eventStatsNeedAttention(null), false);
});

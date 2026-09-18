'use strict';

// Streaming behavior of the event store: none of these tests may rely on
// reading a whole log file into a single string, so they push file sizes past
// the 8MB read-chunk boundary where chunk-seam bugs would show.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { YanCoreStore } = require('../lib/yan-core/store');

const QUIET = { warn() {}, info() {}, error() {} };

function makeStoreRoot(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-core-store-stream-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

// Writes `count` events directly into events.jsonl, padding each payload so
// the file crosses several internal read chunks.
function seedEventLog(store, count, padBytes = 400) {
  fs.mkdirSync(store.rootDir, { recursive: true });
  const lines = [];
  for (let index = 1; index <= count; index += 1) {
    lines.push(JSON.stringify({
      sequence: index,
      type: 'test.event',
      payload: { index, pad: 'x'.repeat(padBytes) }
    }));
  }
  fs.writeFileSync(store.eventsPath, `${lines.join('\n')}\n`, 'utf8');
  return lines;
}

test('countEvents counts a multi-chunk log exactly', t => {
  const root = makeStoreRoot(t);
  const store = new YanCoreStore({ rootDir: root, logger: QUIET });
  seedEventLog(store, 25_000, 400); // ~10MB: more than one 8MB chunk
  assert.equal(store.countEvents(), 25_000);
});

test('readEvents preserves sequence/limit semantics across chunk seams', t => {
  const root = makeStoreRoot(t);
  const store = new YanCoreStore({ rootDir: root, logger: QUIET });
  seedEventLog(store, 25_000, 400);

  const first = store.readEvents({ afterSequence: 0, limit: 10 });
  assert.equal(first.length, 10);
  assert.equal(first[0].sequence, 1);
  assert.equal(first[9].sequence, 10);

  const window = store.readEvents({ afterSequence: 24_990, limit: 100 });
  assert.equal(window.length, 10);
  assert.equal(window[0].sequence, 24_991);
  assert.equal(window.at(-1).sequence, 25_000);

  // A torn final line (no trailing newline, unparsable) is ignored.
  fs.appendFileSync(store.eventsPath, '{"sequence":25001,"type":"torn', 'utf8');
  assert.equal(store.readEvents({ afterSequence: 25_000, limit: 10 }).length, 0);
});

test('compaction keeps the maxEvents tail of a multi-chunk log and updates the count', async t => {
  const root = makeStoreRoot(t);
  const store = new YanCoreStore({ rootDir: root, maxEvents: 2_000, logger: QUIET });
  const lines = seedEventLog(store, 20_000, 400); // ~8MB, above threshold
  store.eventCount = 20_000;

  const compacted = await store.compactEventsAsync({ force: true });
  assert.equal(compacted, true);
  const kept = fs.readFileSync(store.eventsPath, 'utf8').trimEnd().split('\n');
  assert.equal(kept.length, 2_000);
  assert.equal(kept.length, store.eventCount);
  const parsed = JSON.parse(kept[0]);
  assert.equal(parsed.sequence, 20_000 - 2_000 + 1, 'the oldest kept line is the first survivor');
  assert.equal(JSON.parse(kept.at(-1)).sequence, 20_000);
  assert.ok(!fs.existsSync(`${store.eventsPath}.tmp`), 'no temporary files leak');
  assert.equal(lines.length, 20_000);
});

test('compaction survives a multi-GB-scale log without loading it as one string', async t => {
  // Prove the string-limit crash is gone by pointing the store at a sparse
  // file far beyond the V8 max string length. Sparse files cost no disk.
  const root = makeStoreRoot(t);
  const store = new YanCoreStore({ rootDir: root, maxEvents: 100, logger: QUIET });
  fs.mkdirSync(root, { recursive: true });
  const fileSize = 1_200_000_000;
  const handle = fs.openSync(store.eventsPath, 'w');
  fs.writeSync(handle, `${JSON.stringify({ sequence: 1, type: 'head' })}\n`, 0);
  fs.truncateSync(store.eventsPath, fileSize);
  // A block of real events near the tail, then one final event whose '\n' is
  // the last byte of the file. writeSync needs explicit positions here.
  const tailLine = `${JSON.stringify({ sequence: 2, type: 'tail', payload: 'y'.repeat(2000) })}\n`;
  const blockLines = Array.from({ length: 150 }, (_, index) => JSON.stringify({
    sequence: 1000 + index,
    type: 'bulk',
    payload: 'b'.repeat(900)
  }));
  const block = `${blockLines.join('\n')}\n`;
  fs.writeSync(handle, block, fileSize - block.length - tailLine.length);
  fs.writeSync(handle, tailLine, fileSize - tailLine.length);
  fs.closeSync(handle);

  store.eventCount = 200; // pretend the counter crossed the threshold
  const compacted = await store.compactEventsAsync({ force: true });
  assert.equal(compacted, true);
  const stat = fs.statSync(store.eventsPath);
  assert.ok(stat.size < 1_000_000, `compacted log should be tiny, got ${stat.size}`);
  const events = store.readEvents({});
  assert.equal(events.length, store.eventCount);
  assert.equal(events.at(-1).sequence, 2, 'the newest event survives');
  assert.ok(events.at(-2).sequence > 1000, 'the previous events come from the tail block');
});

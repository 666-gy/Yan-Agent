'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { projectReviewSummary } = require('../lib/review-data');
const { runReviewTask } = require('../lib/review-worker');
const { summarizeOpenCodeToolChanges, collectWorkspaceFileSweep } = require('../lib/run-change-summary');
const { OpenCodeSidecar } = require('../lib/opencode-sidecar');

function workspace(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-loading-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('yan-review-loading-'));
    fs.rmSync(root, { recursive: true, force: true });
  });
  return root;
}

test('manifest projection never reads heavy persisted fields or leaks them over IPC', () => {
  const file = { path: 'src/a.js', additions: 8, deletions: 3, status: 'modified' };
  for (const key of ['diff', 'patch', 'image', 'document', 'before']) {
    Object.defineProperty(file, key, { enumerable: true, get() { throw new Error(`eager ${key}`); } });
  }
  const summary = projectReviewSummary({ files: [file] });
  assert.deepEqual(summary, { source: 'opencode', count: 1, additions: 8, deletions: 3, files: [{ path: 'src/a.js', additions: 8, deletions: 3, status: 'modified' }] });
  assert.equal(projectReviewSummary(null), null);
  assert.deepEqual(projectReviewSummary({ files: [] }).files, []);
});

test('a single-file request filters other baselines before reading or diffing', async t => {
  const root = workspace(t);
  const selected = path.join(root, 'selected.txt');
  const unrelated = path.join(root, 'unrelated.txt');
  fs.writeFileSync(selected, 'new\n');
  const blocked = { path: unrelated };
  Object.defineProperty(blocked, 'before', { get() { throw new Error('unrelated baseline was read'); } });
  const result = await summarizeOpenCodeToolChanges(root, [], {
    paths: ['selected.txt'], includeDiff: false,
    baselines: new Map([[selected, { path: selected, before: 'old\n' }], [unrelated, blocked]])
  });
  assert.equal(result.length, 1);
  assert.equal(result[0].additions, 1);
  assert.equal(result[0].deletions, 1);
  assert.equal(result[0].patch, undefined);
});

test('a scoped workspace sweep retains shell-created files without scanning other files', async t => {
  const root = workspace(t);
  fs.writeFileSync(path.join(root, 'selected.txt'), 'created\n');
  fs.writeFileSync(path.join(root, 'other.txt'), 'other\n');
  const baselines = await collectWorkspaceFileSweep(root, { startTime: Date.now() - 1000, paths: ['selected.txt'] });
  assert.equal(baselines.size, 1);
  assert.equal([...baselines.values()][0].before, null);
  assert.equal(path.basename([...baselines.values()][0].path), 'selected.txt');
});

test('expensive review diffing leaves the calling event loop responsive and preserves exact counts', async t => {
  const root = workspace(t);
  const file = path.join(root, 'rewrite.txt');
  const before = Array.from({ length: 2000 }, (_, i) => `before ${i}`).join('\n') + '\n';
  fs.writeFileSync(file, Array.from({ length: 2000 }, (_, i) => `after ${i}`).join('\n') + '\n');
  let ticks = 0;
  const timer = setInterval(() => ticks++, 5);
  try {
    const result = await runReviewTask('legacyChanges', root, [{ path: file, before }], { includeDiff: false });
    assert.equal(result.additions, 2000);
    assert.equal(result.deletions, 2000);
    assert.equal(result.files[0].diff, undefined);
    assert.ok(ticks >= 3, `review blocked its caller (${ticks} timer ticks)`);
    await assert.rejects(runReviewTask('invalid-operation'), /Unknown review operation/);
    const next = await runReviewTask('openCodeDiffs', root, [{ file, additions: 2, deletions: 1, status: 'modified' }], { includeDiff: false });
    assert.equal(next.additions, 2, 'the worker remains usable after a failed job');
  } finally { clearInterval(timer); }
});

test('overlapping session review requests share the history read and scoped reconstruction', async t => {
  const root = workspace(t);
  const sidecar = new OpenCodeSidecar({ appRoot: path.resolve(__dirname, '..'), dataDir: root });
  let reads = 0;
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  sidecar.client = { session: {
    messages: async () => { reads++; await gate; return { data: [] }; },
    diff: async () => ({ data: [] })
  } };
  const payload = { sessionId: 'session-test', directory: root, startTime: 1, includeDiff: false, paths: ['selected.txt'] };
  const first = sidecar.sessionChanges(payload);
  const second = sidecar.sessionChanges(payload);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(reads, 1);
  release();
  assert.deepEqual(await first, []);
  assert.deepEqual(await second, []);
  assert.equal(sidecar.reviewLoads.size, 0);
});

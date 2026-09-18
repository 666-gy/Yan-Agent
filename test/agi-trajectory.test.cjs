'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { createTrajectoryStore } = require('../lib/agi/trajectory');

function withTempDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-trajectory-'));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('records round-trip through the NDJSON store with the newest first', () => {
  withTempDir(dir => {
    const store = createTrajectoryStore({ dir, now: () => 1000 });
    const first = store.record({
      runId: 'run-1',
      workspace: 'D:/workspace',
      outcome: 'success',
      verification: { verdict: 'pass' },
      steps: [
        { tool: 'read', ok: true, target: 'lib/a.js' },
        { tool: 'edit', ok: false, target: 'lib/b.js' }
      ],
      summary: 'did the thing'
    });
    assert.equal(first.ok, true);
    assert.equal(first.record.v, 1);
    assert.equal(first.record.runId, 'run-1');
    assert.equal(first.record.outcome, 'success');
    assert.equal(first.record.verificationVerdict, 'pass');
    assert.equal(first.record.stepCount, 2);
    assert.equal(first.record.redacted, false);
    assert.ok(fs.existsSync(path.join(dir, 'trajectories.ndjson')));

    store.record({ runId: 'run-2', outcome: 'failure', verification: { verdict: 'fail' } });
    const recent = store.list();
    assert.equal(recent.length, 2);
    assert.equal(recent[0].runId, 'run-2');
    assert.deepEqual(recent[1].steps, [
      { tool: 'read', ok: true, target: 'lib/a.js' },
      { tool: 'edit', ok: false, target: 'lib/b.js' }
    ]);
  });
});

test('record rejects a missing runId and writes nothing', () => {
  withTempDir(dir => {
    const store = createTrajectoryStore({ dir });
    const rejected = store.record({ outcome: 'success', steps: [{ tool: 'read', ok: true }] });
    assert.equal(rejected.ok, false);
    assert.match(rejected.error, /runId/);
    assert.equal(store.list().length, 0);
    assert.equal(fs.existsSync(path.join(dir, 'trajectories.ndjson')), false);
  });
});

test('steps, tool names, targets and summaries are clipped to their bounds', () => {
  withTempDir(dir => {
    const store = createTrajectoryStore({ dir });
    const steps = Array.from({ length: 80 }, (_, index) => ({
      tool: `tool-${index}`.padEnd(100, 'x'),
      ok: index % 2 === 0,
      target: `target-${index}`.padEnd(300, 'y')
    }));
    const written = store.record({ runId: 'run-big', steps, summary: 's'.repeat(900) });
    assert.equal(written.ok, true);
    assert.equal(written.record.stepCount, 60);
    assert.equal(written.record.steps.length, 60);
    assert.equal(written.record.steps[0].tool.length, 60);
    assert.equal(written.record.steps[0].target.length, 200);
    assert.equal(written.record.steps[0].ok, true);
    assert.equal(written.record.steps[1].ok, false);
    assert.equal(written.record.summary.length, 600);
  });
});

test('unsafe content is redacted before it reaches disk', () => {
  withTempDir(dir => {
    const store = createTrajectoryStore({ dir });
    const secret = 'api_key: sk-abcdefgh1234';
    const written = store.record({
      runId: 'run-secret',
      outcome: 'success',
      steps: [{ tool: 'bash', ok: true, target: `export ${secret}` }],
      summary: secret
    });
    assert.equal(written.ok, true);
    assert.equal(written.record.redacted, true);
    assert.equal(written.record.summary, '');
    assert.equal(written.record.steps[0].target, '');

    const disk = fs.readFileSync(path.join(dir, 'trajectories.ndjson'), 'utf8');
    assert.equal(disk.includes('sk-abcdefgh1234'), false);
    const stored = JSON.parse(disk.trim());
    assert.equal(stored.redacted, true);
    assert.equal(stored.steps[0].target, '');
  });
});

test('the store rewrites itself when it exceeds maxRecords', () => {
  withTempDir(dir => {
    const store = createTrajectoryStore({ dir, maxRecords: 2, now: () => 5000 });
    store.record({ runId: 'run-1' });
    store.record({ runId: 'run-2' });
    const third = store.record({ runId: 'run-3' });
    assert.equal(third.pruned, true);

    const lines = fs.readFileSync(path.join(dir, 'trajectories.ndjson'), 'utf8').trim().split('\n');
    assert.equal(lines.length, 2);
    assert.deepEqual(store.list({ limit: 10 }).map(item => item.runId), ['run-3', 'run-2']);
    const summary = store.summarize();
    assert.equal(summary.total, 2);
    assert.deepEqual(summary.byOutcome, { success: 0, failure: 0, neutral: 2 });
  });
});

test('summarize counts outcomes and reports a lastAt timestamp', () => {
  withTempDir(dir => {
    const store = createTrajectoryStore({ dir, now: () => 42 });
    assert.deepEqual(store.summarize(), { total: 0, byOutcome: { success: 0, failure: 0, neutral: 0 }, lastAt: 0 });

    store.record({ runId: 'run-a', outcome: 'success' });
    store.record({ runId: 'run-b', outcome: 'success' });
    store.record({ runId: 'run-c', outcome: 'failure' });
    store.record({ runId: 'run-d' });

    const summary = store.summarize();
    assert.equal(summary.total, 4);
    assert.deepEqual(summary.byOutcome, { success: 2, failure: 1, neutral: 1 });
    assert.equal(typeof summary.lastAt, 'number');
    assert.ok(summary.lastAt > 0);
  });
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  ensureProtocol,
  loadProtocol,
  readProtocol,
  updateFeature,
  recordProgress,
  smokePlan,
  renderProtocolPrompt
} = require('../lib/agi/long-horizon');

const FIXED_ISO = '2026-01-02T03:04:05.000Z';
const LATER_ISO = '2026-01-02T05:06:07.000Z';
const fixedNow = () => new Date(FIXED_ISO).getTime();
const laterNow = () => new Date(LATER_ISO).getTime();

function makeWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-horizon-'));
}

function cleanup(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}

test('ensureProtocol writes feature-list, progress, init.sh and protocol', () => {
  const ws = makeWorkspace();
  try {
    const result = ensureProtocol({
      workspace: ws,
      goal: 'Ship adaptive compute',
      features: [{ title: 'Alpha task' }, { id: 'Beta-Task', title: 'Beta task' }],
      smokeCommands: ['node --version', 'node --test test/foo.test.cjs'],
      now: fixedNow
    });
    assert.equal(result.ok, true);
    assert.match(result.taskId, /^lh-[0-9a-f]{12}$/);
    for (const name of ['feature-list.json', 'progress.md', 'init.sh', 'protocol.json']) {
      assert.ok(fs.existsSync(path.join(result.dir, name)), `${name} exists`);
    }

    const list = readJsonFile(path.join(result.dir, 'feature-list.json'));
    assert.equal(list.version, 1);
    assert.equal(list.taskId, result.taskId);
    assert.equal(list.goal, 'Ship adaptive compute');
    assert.equal(list.createdAt, FIXED_ISO);
    assert.deepEqual(list.features.map(f => f.id), ['alpha-task', 'beta-task']);
    for (const feature of list.features) {
      assert.equal(feature.status, 'failing');
      assert.equal(feature.evidence, '');
    }

    const progress = fs.readFileSync(path.join(result.dir, 'progress.md'), 'utf8');
    assert.ok(progress.startsWith('# Progress — Ship adaptive compute\n'));

    const script = fs.readFileSync(path.join(result.dir, 'init.sh'), 'utf8');
    assert.ok(script.startsWith('#!/usr/bin/env bash\nset -e\n'));
    assert.ok(script.includes('node --version'));
    assert.ok(script.includes('node --test test/foo.test.cjs'));
    assert.equal(script.includes('\r'), false);
    assert.match(script, /echo "smoke ok: lh-[0-9a-f]{12}"/);

    const protocol = readJsonFile(path.join(result.dir, 'protocol.json'));
    assert.deepEqual(protocol.smokeCommands, ['node --version', 'node --test test/foo.test.cjs']);
    assert.equal(protocol.updatedAt, FIXED_ISO);
  } finally {
    cleanup(ws);
  }
});

test('ensureProtocol rejects unsafe or incomplete input', () => {
  const ws = makeWorkspace();
  try {
    assert.equal(ensureProtocol({ workspace: ws, goal: 'rm -rf /', features: [{ title: 'x' }] }).ok, false);
    assert.equal(
      ensureProtocol({ workspace: ws, goal: 'safe goal', features: [{ title: 'leak password=hunter2xyz' }] }).ok,
      false
    );
    assert.equal(
      ensureProtocol({ workspace: ws, goal: 'safe goal', features: [{ title: 'ok' }], smokeCommands: ['rm -rf /'] }).ok,
      false
    );
    assert.equal(ensureProtocol({ workspace: '', goal: 'safe', features: [{ title: 'x' }] }).ok, false);
    assert.equal(ensureProtocol({ workspace: ws, goal: '', features: [{ title: 'x' }] }).ok, false);
    assert.equal(ensureProtocol({ workspace: ws, goal: 'safe', features: [] }).ok, false);
  } finally {
    cleanup(ws);
  }
});

test('ensureProtocol is idempotent and never downgrades passing features', () => {
  const ws = makeWorkspace();
  try {
    const first = ensureProtocol({
      workspace: ws,
      goal: 'Idempotent goal',
      features: [{ title: 'Alpha' }, { title: 'Beta' }],
      now: fixedNow
    });
    assert.equal(first.ok, true);
    const update = updateFeature({
      workspace: ws,
      taskId: first.taskId,
      featureId: 'alpha',
      status: 'passing',
      evidence: 'node --test green',
      now: fixedNow
    });
    assert.equal(update.ok, true);

    const second = ensureProtocol({
      workspace: ws,
      goal: 'Idempotent goal',
      features: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }],
      now: laterNow
    });
    assert.equal(second.ok, true);
    assert.equal(second.taskId, first.taskId);

    const list = readJsonFile(path.join(second.dir, 'feature-list.json'));
    assert.equal(list.features.length, 3);
    const alpha = list.features.find(f => f.id === 'alpha');
    assert.equal(alpha.status, 'passing');
    assert.equal(alpha.evidence, 'node --test green');
    assert.equal(list.createdAt, FIXED_ISO);
    assert.equal(readJsonFile(path.join(second.dir, 'protocol.json')).updatedAt, LATER_ISO);
  } finally {
    cleanup(ws);
  }
});

test('loadProtocol picks the newest task and readProtocol round-trips', () => {
  const ws = makeWorkspace();
  try {
    const older = ensureProtocol({
      workspace: ws,
      goal: 'Older goal',
      features: [{ title: 'one' }],
      now: fixedNow
    });
    const newer = ensureProtocol({
      workspace: ws,
      goal: 'Newer goal',
      features: [{ title: 'two' }],
      now: laterNow
    });

    const loaded = loadProtocol({ workspace: ws });
    assert.ok(loaded);
    assert.equal(loaded.protocol.goal, 'Newer goal');
    assert.equal(loaded.dir, newer.dir);

    const read = readProtocol({ workspace: ws, taskId: older.taskId });
    assert.equal(read.ok, true);
    assert.equal(read.protocol.goal, 'Older goal');
    assert.equal(read.features.length, 1);
    assert.ok(read.progressTail.includes('# Progress — Older goal'));

    const recorded = recordProgress({
      workspace: ws,
      taskId: older.taskId,
      note: 'session one start',
      now: laterNow
    });
    assert.equal(recorded.ok, true);
    assert.ok(readProtocol({ workspace: ws, taskId: older.taskId }).progressTail.includes('session one start'));
  } finally {
    cleanup(ws);
  }
});

test('updateFeature validates status, evidence and feature id', () => {
  const ws = makeWorkspace();
  try {
    const created = ensureProtocol({
      workspace: ws,
      goal: 'Validation goal',
      features: [{ title: 'Alpha' }, { title: 'Beta' }],
      now: fixedNow
    });
    const base = { workspace: ws, taskId: created.taskId, now: fixedNow };
    assert.equal(updateFeature({ ...base, featureId: 'alpha', status: 'passing', evidence: '   ' }).ok, false);
    assert.equal(updateFeature({ ...base, featureId: 'alpha', status: 'done', evidence: 'x' }).ok, false);
    assert.equal(updateFeature({ ...base, featureId: 'missing', status: 'failing', evidence: '' }).ok, false);

    const failing = updateFeature({ ...base, featureId: 'Beta', status: 'failing', evidence: '' });
    assert.equal(failing.ok, true);
    assert.equal(failing.feature.status, 'failing');

    const passing = updateFeature({
      ...base,
      featureId: 'alpha',
      status: 'passing',
      evidence: 'e'.repeat(900)
    });
    assert.equal(passing.ok, true);
    assert.equal(passing.feature.evidence.length, 600);

    const read = readProtocol({ workspace: ws, taskId: created.taskId });
    assert.equal(read.features.find(f => f.id === 'alpha').status, 'passing');
  } finally {
    cleanup(ws);
  }
});

test('recordProgress appends timestamped lines, run ids and clips long notes', () => {
  const ws = makeWorkspace();
  try {
    const created = ensureProtocol({
      workspace: ws,
      goal: 'Progress goal',
      features: [{ title: 'Alpha' }],
      now: fixedNow
    });
    const first = recordProgress({ workspace: ws, taskId: created.taskId, note: 'session started', now: fixedNow });
    assert.equal(first.ok, true);
    assert.equal(first.line, `- [${FIXED_ISO}] session started`);

    const second = recordProgress({
      workspace: ws,
      taskId: created.taskId,
      note: 'tests finished',
      runId: 'run-42',
      now: laterNow
    });
    assert.ok(second.line.includes('tests finished'));
    assert.ok(second.line.includes('(run run-42)'));
    assert.ok(second.line.startsWith(`- [${LATER_ISO}]`));

    const long = recordProgress({
      workspace: ws,
      taskId: created.taskId,
      note: 'n'.repeat(1000),
      now: laterNow
    });
    assert.equal(long.ok, true);
    assert.ok(long.line.length <= 700);

    assert.equal(recordProgress({ workspace: ws, taskId: 'lh-missing', note: 'x' }).ok, false);

    const tail = readProtocol({ workspace: ws, taskId: created.taskId }).progressTail;
    assert.ok(tail.includes('(run run-42)'));
    assert.ok(tail.includes(`- [${FIXED_ISO}] session started`));
  } finally {
    cleanup(ws);
  }
});

test('renderProtocolPrompt stays bounded and never cuts a line in half', () => {
  const ws = makeWorkspace();
  try {
    const features = [];
    for (let i = 0; i < 25; i += 1) {
      features.push({
        id: `f-${i}`,
        title: `Feature ${i} ${'x'.repeat(280)}`,
        status: i < 3 ? 'passing' : 'failing',
        evidence: ''
      });
    }
    const protocol = {
      version: 1,
      taskId: 'lh-abcdef123456',
      goal: 'G'.repeat(400),
      smokeCommands: ['node --test test/all.test.cjs']
    };
    const progressTail = 'line1\nline2\nline3\nline4';

    const full = renderProtocolPrompt({ protocol, features, progressTail, maxChars: 100000 });
    const bounded = renderProtocolPrompt({ protocol, features, progressTail, maxChars: 500 });
    assert.ok(full.length > 500);
    assert.ok(bounded.length <= 500, 'bounded length');
    assert.equal(full.slice(0, bounded.length), bounded, 'bounded is a prefix of the full text');
    assert.equal(full[bounded.length], '\n', 'cut lands on a line boundary');
    assert.ok(bounded.includes('goal:'));
    assert.ok(bounded.includes('failing: 22/25'));
    assert.ok(full.includes('next: f-3'));
    assert.ok(full.includes('todo (top 10):'));
    assert.ok(full.includes('smoke:'));

    const fallback = renderProtocolPrompt({ protocol, features, progressTail });
    assert.ok(fallback.length <= 1800);
    const tiny = renderProtocolPrompt({ protocol, features, progressTail, maxChars: 60 });
    assert.ok(tiny.length <= 60);

    const empty = renderProtocolPrompt({ protocol, features: [], maxChars: 0 });
    assert.equal(empty, '');
  } finally {
    cleanup(ws);
  }
});

test('loadProtocol and readProtocol fail safely on corrupt or missing storage', () => {
  const empty = makeWorkspace();
  try {
    assert.equal(loadProtocol({ workspace: empty }), null);
    assert.equal(readProtocol({ workspace: empty, taskId: 'lh-x' }).ok, false);
    assert.equal(loadProtocol({ workspace: '' }), null);
  } finally {
    cleanup(empty);
  }

  const ws = makeWorkspace();
  try {
    const corruptDir = path.join(ws, '.yanagent', 'agi', 'long-horizon', 'lh-corrupt');
    fs.mkdirSync(corruptDir, { recursive: true });
    fs.writeFileSync(path.join(corruptDir, 'protocol.json'), '{broken json', 'utf8');
    assert.equal(loadProtocol({ workspace: ws }), null);
    assert.equal(readProtocol({ workspace: ws, taskId: 'lh-corrupt' }).ok, false);

    const created = ensureProtocol({
      workspace: ws,
      goal: 'Valid goal',
      features: [{ title: 'A' }],
      now: fixedNow
    });
    fs.writeFileSync(path.join(created.dir, 'feature-list.json'), 'garbage', 'utf8');
    const read = readProtocol({ workspace: ws, taskId: created.taskId });
    assert.equal(read.ok, true);
    assert.deepEqual(read.features, []);
    const loaded = loadProtocol({ workspace: ws });
    assert.ok(loaded);
    assert.equal(loaded.protocol.taskId, created.taskId);
  } finally {
    cleanup(ws);
  }
});

test('smokePlan returns commands and a Windows execution note', () => {
  const ws = makeWorkspace();
  try {
    const created = ensureProtocol({
      workspace: ws,
      goal: 'Smoke goal',
      features: [{ title: 'Alpha' }],
      smokeCommands: ['node --version'],
      now: fixedNow
    });
    const plan = smokePlan(created.protocol);
    assert.deepEqual(plan.commands, ['node --version']);
    assert.ok(plan.note.includes('Git Bash'));

    const empty = smokePlan(null);
    assert.deepEqual(empty.commands, []);
    assert.equal(typeof empty.note, 'string');
  } finally {
    cleanup(ws);
  }
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  TOPOLOGY_VARIANTS,
  selectVariant,
  recordRun,
  loadHistory,
  summarizeHistory
} = require('../lib/agi/topology');
const { SUBAGENT_ROLE_IDS } = require('../lib/subagent');

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-topology-'));
}

function runsFor(variantId, okCount, total, cost = 1) {
  return Array.from({ length: total }, (_, index) => ({
    variantId,
    ok: index < okCount,
    cost,
    runId: `${variantId}-${index}`,
    evidenceDigest: '',
    at: index
  }));
}

test('variant table exposes a legal baseline and richer topologies', () => {
  assert.ok(Array.isArray(TOPOLOGY_VARIANTS));
  assert.ok(TOPOLOGY_VARIANTS.length >= 3);
  const ids = TOPOLOGY_VARIANTS.map(variant => variant.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes('baseline'));

  for (const variant of TOPOLOGY_VARIANTS) {
    assert.equal(typeof variant.label, 'string');
    assert.equal(typeof variant.description, 'string');
    assert.ok(variant.costMultiplier > 0);
    assert.ok(Array.isArray(variant.roles) && variant.roles.length > 0);
    for (const role of variant.roles) {
      assert.ok(SUBAGENT_ROLE_IDS.includes(role.role), `${role.role} is not a subagent role`);
      assert.equal(Number.isInteger(role.order), true);
    }
  }

  const baseline = TOPOLOGY_VARIANTS.find(variant => variant.id === 'baseline');
  assert.equal(baseline.costMultiplier, 1);

  const reviewerFirst = TOPOLOGY_VARIANTS.find(variant => variant.id === 'reviewer-first');
  assert.ok(reviewerFirst.costMultiplier > 1 && reviewerFirst.costMultiplier < 1.5);
  const reviewerIndex = reviewerFirst.roles.findIndex(role => role.role === 'reviewer');
  const reviewerFirstBuilderIndex = reviewerFirst.roles.findIndex(role => role.role === 'builder');
  assert.ok(reviewerIndex >= 0 && reviewerIndex < reviewerFirstBuilderIndex);

  const dualBuilder = TOPOLOGY_VARIANTS.find(variant => variant.id === 'dual-builder');
  assert.ok(dualBuilder.costMultiplier > reviewerFirst.costMultiplier);
  assert.equal(dualBuilder.concurrency, 2);
  const builders = dualBuilder.roles.filter(role => role.role === 'builder');
  assert.equal(builders.length, 2);
  assert.equal(new Set(builders.map(role => role.slot)).size, 2);
  assert.ok(builders.every(role => role.parallel === true));

  assert.equal(Object.isFrozen(TOPOLOGY_VARIANTS), true);
  assert.equal(Object.isFrozen(dualBuilder), true);
  assert.equal(Object.isFrozen(dualBuilder.roles), true);
  assert.equal(Object.isFrozen(dualBuilder.roles[0]), true);
});

test('insufficient evidence or samples keeps the baseline inactive', () => {
  const bare = selectVariant();
  assert.equal(bare.variantId, 'baseline');
  assert.equal(bare.active, false);
  assert.match(bare.reason, /evidence/i);

  const history = [...runsFor('baseline', 1, 5), ...runsFor('dual-builder', 5, 5, 1.8)];
  const noEvidence = selectVariant({ history, evidence: null });
  assert.equal(noEvidence.variantId, 'baseline');
  assert.equal(noEvidence.active, false);
  assert.match(noEvidence.reason, /evidence/i);

  const shortHistory = [...runsFor('baseline', 2, 2), ...runsFor('dual-builder', 2, 2, 1.8)];
  const shortSamples = selectVariant({ history: shortHistory, evidence: { ok: true } });
  assert.equal(shortSamples.variantId, 'baseline');
  assert.equal(shortSamples.active, false);
  assert.match(shortSamples.reason, /insufficient/i);
  assert.match(shortSamples.reason, /2\/5/);
});

test('a qualified variant with the highest gain is selected', () => {
  const history = [
    ...runsFor('baseline', 1, 5, 1),
    ...runsFor('reviewer-first', 3, 5, 1.3),
    ...runsFor('dual-builder', 5, 5, 1.8)
  ];
  const decision = selectVariant({ history, evidence: { ok: true, digest: 'eval-1' }, minPairRuns: 5, minGain: 0.1 });
  assert.deepEqual(Object.keys(decision).sort(), ['active', 'reason', 'variantId']);
  assert.equal(decision.variantId, 'dual-builder');
  assert.equal(decision.active, true);
  assert.match(decision.reason, /dual-builder/);
  assert.match(decision.reason, /gain 0\.8/);
});

test('evidence that is not ok blocks a switch even with strong history', () => {
  const history = [...runsFor('baseline', 0, 5), ...runsFor('dual-builder', 5, 5, 1.8)];
  for (const evidence of [{ ok: false }, { passed: 5 }, { ok: 'true' }, null]) {
    const decision = selectVariant({ history, evidence });
    assert.equal(decision.variantId, 'baseline');
    assert.equal(decision.active, false);
    assert.match(decision.reason, /evidence/i);
  }
});

test('variants above the cost ceiling are excluded', () => {
  const history = [...runsFor('baseline', 0, 5), ...runsFor('dual-builder', 5, 5, 1.8)];
  const blocked = selectVariant({ history, evidence: { ok: true }, maxCostMultiplier: 1.5 });
  assert.equal(blocked.variantId, 'baseline');
  assert.equal(blocked.active, false);
  assert.match(blocked.reason, /cost/i);

  const allowed = selectVariant({ history, evidence: { ok: true }, maxCostMultiplier: 2 });
  assert.equal(allowed.variantId, 'dual-builder');
  assert.equal(allowed.active, true);
});

test('recordRun rejects invalid variants and missing runIds without writing', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'topology.json');
    assert.equal(recordRun(file, { variantId: 'unknown', ok: true, runId: 'r1' }).ok, false);
    assert.equal(recordRun(file, { variantId: 'baseline', ok: true, runId: '' }).ok, false);
    assert.equal(recordRun('', { variantId: 'baseline', ok: true, runId: 'r2' }).ok, false);
    assert.equal(fs.existsSync(file), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('recordRun appends atomically, caps history and reloads the tail', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'nested', 'topology.json');
    const seed = Array.from({ length: 500 }, (_, index) => ({
      variantId: index % 2 === 0 ? 'baseline' : 'dual-builder',
      ok: index % 3 === 0,
      cost: 1,
      runId: `seed-${index}`,
      evidenceDigest: '',
      at: index
    }));
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify({ version: 1, runs: seed })}\n`, 'utf8');

    const appended = recordRun(file, {
      variantId: 'reviewer-first',
      ok: true,
      cost: 1.3,
      runId: 'new-run',
      evidenceDigest: 'digest-9',
      now: 4242
    });
    assert.equal(appended.ok, true);

    const loaded = loadHistory(file);
    assert.equal(loaded.version, 1);
    assert.equal(loaded.runs.length, 500);
    assert.equal(loaded.runs[0].runId, 'seed-1');
    const last = loaded.runs[499];
    assert.equal(last.variantId, 'reviewer-first');
    assert.equal(last.ok, true);
    assert.equal(last.cost, 1.3);
    assert.equal(last.evidenceDigest, 'digest-9');
    assert.equal(last.at, 4242);

    const summary = summarizeHistory(loaded);
    assert.equal(summary.total, 500);
    assert.equal(summary.variants.length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('loadHistory tolerates missing and corrupt files', () => {
  const dir = tempDir();
  try {
    const file = path.join(dir, 'bad.json');
    assert.deepEqual(loadHistory(file), { version: 1, runs: [] });
    assert.deepEqual(loadHistory(''), { version: 1, runs: [] });

    fs.writeFileSync(file, '{not json', 'utf8');
    assert.deepEqual(loadHistory(file), { version: 1, runs: [] });

    fs.writeFileSync(file, JSON.stringify({ version: 1, runs: [null, { variantId: '' }, { variantId: 'baseline', ok: true }] }), 'utf8');
    const loaded = loadHistory(file);
    assert.equal(loaded.runs.length, 1);
    assert.equal(loaded.runs[0].variantId, 'baseline');
    assert.equal(loaded.runs[0].cost, 1);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('summarizeHistory reports per-variant success rate and average cost', () => {
  const history = {
    version: 1,
    runs: [
      { variantId: 'baseline', ok: true, cost: 1, runId: 'a' },
      { variantId: 'baseline', ok: false, cost: 3, runId: 'b' },
      { variantId: 'reviewer-first', ok: true, cost: 1.3, runId: 'c' },
      { variantId: 'reviewer-first', ok: true, cost: 1.7, runId: 'd' }
    ]
  };
  assert.deepEqual(summarizeHistory(history), {
    variants: [
      { variantId: 'baseline', runs: 2, successRate: 0.5, avgCost: 2 },
      { variantId: 'reviewer-first', runs: 2, successRate: 1, avgCost: 1.5 }
    ],
    total: 4
  });
  assert.deepEqual(summarizeHistory([]), { variants: [], total: 0 });
});

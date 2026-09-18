'use strict';

// P1-2: subagent role/topology evolution via A/B comparison (ADAS/AFlow).
// Pareto note: richer topologies gain more durably but cost more (multi-agent
// can be ~20x), so they stay opt-in. Switching needs a passing evaluation
// evidence record plus minPairRuns paired samples, and every run keeps cost
// in a bounded history for later audits.

const { clip, normalizeId, readJson, writeJsonAtomic } = require('./contracts');
const { SUBAGENT_ROLE_IDS } = require('../subagent');

const HISTORY_VERSION = 1;
const HISTORY_LIMIT = 500;
const RUN_ID_MAX = 120;
const DIGEST_MAX = 128;
const DEFAULT_MIN_PAIR_RUNS = 5;
const DEFAULT_MIN_GAIN = 0.1;
const DEFAULT_MAX_COST_MULTIPLIER = 2;

function makeVariant({ id, label, description, costMultiplier, roles, concurrency = 0 }) {
  const frozenRoles = Object.freeze(roles.map(role => Object.freeze({ ...role })));
  const variant = { id, label, description, costMultiplier, roles: frozenRoles };
  if (concurrency > 0) variant.concurrency = concurrency;
  return Object.freeze(variant);
}

// Role ids must stay inside lib/subagent SUBAGENT_ROLE_IDS (single source of
// truth, imported above). Parallel entries share an order and mark the slot
// they occupy so the scheduler can see the concurrency requirement.
const TOPOLOGY_VARIANTS = Object.freeze([
  makeVariant({
    id: 'baseline',
    label: 'Baseline',
    description: '既有默认角色序列：explorer → builder → tester → reviewer，单线执行，成本最低。',
    costMultiplier: 1,
    roles: [
      { role: 'explorer', order: 0 },
      { role: 'builder', order: 1 },
      { role: 'tester', order: 2 },
      { role: 'reviewer', order: 3 }
    ]
  }),
  makeVariant({
    id: 'reviewer-first',
    label: 'Reviewer first',
    description: '评审前置：reviewer 先审计划与接口，再交给 builder 实现，减少返工。',
    costMultiplier: 1.3,
    roles: [
      { role: 'explorer', order: 0 },
      { role: 'reviewer', order: 1 },
      { role: 'builder', order: 2 },
      { role: 'tester', order: 3 }
    ]
  }),
  makeVariant({
    id: 'dual-builder',
    label: 'Dual builder',
    description: '双 builder 并行实现可拆分任务 + tester 统一验收；需要两个并发槽。',
    costMultiplier: 1.8,
    concurrency: 2,
    roles: [
      { role: 'explorer', order: 0, optional: true },
      { role: 'builder', order: 1, parallel: true, slot: 1 },
      { role: 'builder', order: 1, parallel: true, slot: 2 },
      { role: 'tester', order: 2 }
    ]
  })
]);

function fail(error) {
  return { ok: false, error: String(error) };
}

function nowMs(now) {
  if (typeof now === 'function') {
    const value = now();
    if (Number.isFinite(value)) return value;
  }
  if (Number.isFinite(now)) return now;
  return Date.now();
}

function round3(value) {
  return Math.round(value * 1000) / 1000;
}

function variantById(value) {
  const id = normalizeId(value);
  if (!id) return null;
  return TOPOLOGY_VARIANTS.find(variant => variant.id === id) || null;
}

function sanitizeRun(entry) {
  if (!entry || typeof entry !== 'object') return null;
  const variantId = normalizeId(entry.variantId);
  if (!variantId) return null;
  const cost = Number(entry.cost);
  const at = Number(entry.at);
  return {
    variantId,
    ok: entry.ok === true,
    cost: Number.isFinite(cost) && cost >= 0 ? cost : 1,
    runId: clip(entry.runId, RUN_ID_MAX),
    evidenceDigest: clip(entry.evidenceDigest, DIGEST_MAX),
    at: Number.isFinite(at) ? at : 0
  };
}

function runsOf(history) {
  const raw = Array.isArray(history)
    ? history
    : history && Array.isArray(history.runs) ? history.runs : [];
  return raw.map(sanitizeRun).filter(Boolean);
}

function statsOf(runs) {
  const stats = new Map();
  for (const run of runs) {
    const stat = stats.get(run.variantId) || { runs: 0, ok: 0, cost: 0 };
    stat.runs += 1;
    if (run.ok) stat.ok += 1;
    stat.cost += run.cost;
    stats.set(run.variantId, stat);
  }
  return stats;
}

// Corrupt or missing files degrade to an empty v1 history.
function loadHistory(historyFile) {
  if (typeof historyFile !== 'string' || !historyFile) return { version: HISTORY_VERSION, runs: [] };
  const stored = readJson(historyFile, null);
  const runs = runsOf(stored).slice(-HISTORY_LIMIT);
  return { version: HISTORY_VERSION, runs };
}

// Appends one run and rewrites atomically; only the newest 500 runs survive.
function recordRun(historyFile, {
  variantId,
  ok = false,
  cost = 1,
  runId = '',
  evidenceDigest = '',
  now
} = {}) {
  if (typeof historyFile !== 'string' || !historyFile) return fail('historyFile is required');
  const variant = variantById(variantId);
  if (!variant) return fail(`invalid variantId: ${clip(variantId, 80) || 'missing'}`);
  const cleanRunId = clip(runId, RUN_ID_MAX);
  if (!cleanRunId) return fail('runId is required');
  const rawCost = Number(cost);
  const run = {
    variantId: variant.id,
    ok: ok === true,
    cost: Number.isFinite(rawCost) && rawCost >= 0 ? rawCost : 1,
    runId: cleanRunId,
    evidenceDigest: clip(evidenceDigest, DIGEST_MAX),
    at: nowMs(now)
  };
  const runs = [...loadHistory(historyFile).runs, run].slice(-HISTORY_LIMIT);
  writeJsonAtomic(historyFile, { version: HISTORY_VERSION, runs });
  return { ok: true, run, runs: runs.length };
}

// Pure selection: baseline unless a passing evidence record and enough paired
// samples prove a richer variant is both cheaper than the cost ceiling and
// worth at least minGain over baseline.
function selectVariant({
  history = [],
  evidence = null,
  minPairRuns = DEFAULT_MIN_PAIR_RUNS,
  minGain = DEFAULT_MIN_GAIN,
  maxCostMultiplier = DEFAULT_MAX_COST_MULTIPLIER
} = {}) {
  const runs = runsOf(history);
  const rawPairRuns = Math.floor(Number(minPairRuns));
  const pairRuns = Number.isFinite(rawPairRuns) && rawPairRuns > 0 ? rawPairRuns : DEFAULT_MIN_PAIR_RUNS;
  const rawGain = Number(minGain);
  const gainFloor = Number.isFinite(rawGain) ? Math.max(0, rawGain) : DEFAULT_MIN_GAIN;
  const rawMaxCost = Number(maxCostMultiplier);
  const costCeiling = Number.isFinite(rawMaxCost) && rawMaxCost > 0 ? rawMaxCost : DEFAULT_MAX_COST_MULTIPLIER;

  if (!evidence || typeof evidence !== 'object' || evidence.ok !== true) {
    return {
      variantId: 'baseline',
      active: false,
      reason: evidence && typeof evidence === 'object'
        ? 'evidence.ok is not true; topology stays on baseline'
        : 'no passing evaluation evidence; topology stays on baseline'
    };
  }

  const stats = statsOf(runs);
  const baseline = stats.get('baseline') || { runs: 0, ok: 0, cost: 0 };
  const baselineRate = baseline.runs > 0 ? baseline.ok / baseline.runs : 0;
  if (baseline.runs < pairRuns) {
    return {
      variantId: 'baseline',
      active: false,
      reason: `insufficient paired samples: baseline ${baseline.runs}/${pairRuns} runs`
    };
  }

  const candidates = [];
  for (const variant of TOPOLOGY_VARIANTS) {
    if (variant.id === 'baseline') continue;
    const stat = stats.get(variant.id) || { runs: 0, ok: 0, cost: 0 };
    const rate = stat.runs > 0 ? stat.ok / stat.runs : 0;
    candidates.push({ variant, runs: stat.runs, rate, gain: rate - baselineRate });
  }

  const eligible = candidates.filter(entry =>
    entry.runs >= pairRuns
    && entry.gain >= gainFloor
    && entry.variant.costMultiplier <= costCeiling
  );

  if (eligible.length === 0) {
    const blockers = candidates.map(entry => {
      if (entry.runs < pairRuns) return `${entry.variant.id} ${entry.runs}/${pairRuns} runs`;
      if (entry.gain < gainFloor) return `${entry.variant.id} gain ${round3(entry.gain)} < ${round3(gainFloor)}`;
      return `${entry.variant.id} cost x${entry.variant.costMultiplier} > x${round3(costCeiling)}`;
    });
    return {
      variantId: 'baseline',
      active: false,
      reason: `no variant qualifies: ${blockers.join('; ')}`
    };
  }

  eligible.sort((a, b) =>
    b.gain - a.gain
    || b.rate - a.rate
    || a.variant.costMultiplier - b.variant.costMultiplier
    || a.variant.id.localeCompare(b.variant.id)
  );
  const best = eligible[0];
  return {
    variantId: best.variant.id,
    active: true,
    reason: `switched to ${best.variant.id}: gain ${round3(best.gain)} over baseline, ${best.runs} runs, cost x${best.variant.costMultiplier}`
  };
}

function summarizeHistory(history) {
  const runs = runsOf(history).slice(-HISTORY_LIMIT);
  const stats = statsOf(runs);
  const variants = [...stats.entries()]
    .map(([variantId, stat]) => ({
      variantId,
      runs: stat.runs,
      successRate: round3(stat.ok / stat.runs),
      avgCost: round3(stat.cost / stat.runs)
    }))
    .sort((a, b) => a.variantId.localeCompare(b.variantId));
  return { variants, total: runs.length };
}

module.exports = { TOPOLOGY_VARIANTS, selectVariant, recordRun, loadHistory, summarizeHistory };

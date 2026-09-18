'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectWorkflowProposals,
  createEscalationMemo,
  createVerifiedRunIndex,
  maintainMemoryStore,
  raiseReasoningSpeed,
  runSignals
} = require('../lib/agi/runtime-bridge');
const { createTrajectoryStore } = require('../lib/agi/trajectory');
const { LongTermMemoryStore } = require('../lib/long-term-memory');
const { SkillEvolutionStore } = require('../lib/skill-evolution');
const { writeJsonAtomic } = require('../lib/agi/contracts');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('runSignals counts trailing tool failures only', () => {
  assert.deepEqual(
    runSignals({ toolCalls: [{ tool: 'read', ok: true }, { tool: 'edit', ok: false }, { tool: 'bash', ok: false }] }),
    { consecutiveToolFailures: 2, acceptanceFailed: false, loopRepeats: 0 }
  );
  assert.equal(runSignals({ toolCalls: [{ tool: 'read', ok: false }, { tool: 'edit', ok: true }] }).consecutiveToolFailures, 0);
  assert.equal(runSignals({ delivery: { review: { verdict: 'fail' } } }).acceptanceFailed, true);
});

test('escalation memo is a one-shot, workspace-scoped hint', () => {
  const dir = tempDir('yan-agi-bridge-');
  try {
    const file = path.join(dir, 'escalation.json');
    const memo = createEscalationMemo({ filePath: file });
    const quiet = memo.noteRun({ workspace: 'ws-a', result: { toolCalls: [{ tool: 'read', ok: true }] } });
    assert.equal(quiet.escalated, false);
    assert.equal(memo.consume({ workspace: 'ws-a' }), null);

    const escalated = memo.noteRun({
      workspace: 'ws-a',
      result: { toolCalls: [{ tool: 'edit', ok: false }, { tool: 'bash', ok: false }, { tool: 'bash', ok: false }] }
    });
    assert.equal(escalated.escalated, true);
    assert.equal(escalated.steps, 1);

    assert.equal(memo.consume({ workspace: 'ws-b' }), null, 'other workspace must not consume the hint');
    const hint = memo.consume({ workspace: 'ws-a' });
    assert.equal(hint.steps, 1);
    assert.equal(memo.consume({ workspace: 'ws-a' }), null, 'hint must be one-shot');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('escalation memo expires and acceptance failure escalates', () => {
  const dir = tempDir('yan-agi-bridge-');
  try {
    const file = path.join(dir, 'escalation.json');
    const memo = createEscalationMemo({ filePath: file, ttlMs: 1000 });
    const escalated = memo.noteRun({
      workspace: 'ws',
      result: { delivery: { review: { verdict: 'fail' } } },
      now: 1000
    });
    assert.equal(escalated.escalated, true);
    assert.equal(memo.consume({ workspace: 'ws', now: 5000 }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('raiseReasoningSpeed raises within the supported ladder and clamps', () => {
  assert.equal(raiseReasoningSpeed('medium', 1), 'high');
  assert.equal(raiseReasoningSpeed('medium', 2), 'xhigh');
  assert.equal(raiseReasoningSpeed('max', 2), 'max');
  assert.equal(raiseReasoningSpeed('unknown', 1), 'high');
});

test('verified run index only trusts passing trajectories', () => {
  const dir = tempDir('yan-agi-bridge-');
  try {
    const store = createTrajectoryStore({ dir });
    store.record({ runId: 'run-pass', outcome: 'success', verification: { verdict: 'pass' } });
    store.record({ runId: 'run-fail', outcome: 'success', verification: { verdict: 'fail' } });
    const index = createVerifiedRunIndex({ store, ttlMs: 60_000 });
    assert.equal(index.has('run-pass'), true);
    assert.equal(index.has('run-fail'), false);
    assert.deepEqual([...index.ids()], ['run-pass']);
    store.record({ runId: 'run-late', outcome: 'success', verification: { verdict: 'pass' } });
    const fresh = createVerifiedRunIndex({ store, ttlMs: 0 });
    assert.equal(fresh.has('run-late'), true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('memory maintenance decays stale entries only and never preferences', () => {
  const dir = tempDir('yan-agi-bridge-');
  try {
    const memoryPath = path.join(dir, 'memory.json');
    const old = Date.now() - 90 * 24 * 3600 * 1000;
    writeJsonAtomic(memoryPath, {
      version: 2,
      memories: [
        { id: 'm-stale', type: 'environment', scope: 'global', content: '旧的环境结论', confidence: 0.2, occurrences: 1, updatedAt: old, status: 'active', keywords: [] },
        { id: 'm-pref', type: 'preference', scope: 'global', content: '用中文回复', confidence: 0.9, occurrences: 1, updatedAt: old, status: 'active', keywords: [] }
      ],
      updatedAt: old
    });
    const store = new LongTermMemoryStore({ globalPath: memoryPath, yanagentDir: '.yanagent' });
    const result = maintainMemoryStore({ longTermMemory: store, memoryPath, workspace: '' });
    assert.equal(result.updated, 1);
    const persisted = JSON.parse(fs.readFileSync(memoryPath, 'utf8'));
    const stale = persisted.memories.find(item => item.id === 'm-stale');
    const preference = persisted.memories.find(item => item.id === 'm-pref');
    assert.ok(stale.confidence < 0.2, 'stale entry must decay');
    assert.equal(preference.confidence, 0.9, 'preference must stay untouched');
    assert.equal(preference.metadata?.decayedAt, undefined);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('workflow mining proposes shared sequences and the store accepts them', () => {
  const dir = tempDir('yan-agi-bridge-');
  try {
    const steps = [
      { tool: 'grep', ok: true, target: 'src' },
      { tool: 'read', ok: true, target: 'src/a.js' },
      { tool: 'edit', ok: true, target: 'src/a.js' },
      { tool: 'bash', ok: true, target: 'node --test' }
    ];
    const proposals = collectWorkflowProposals({
      runs: [
        { runId: 'r1', steps },
        { runId: 'r2', steps }
      ]
    });
    assert.equal(proposals.length, 1, JSON.stringify(proposals));
    const candidate = proposals[0];
    assert.deepEqual(candidate.verification.postconditions, ['序列内全部工具调用成功完成']);

    const store = new SkillEvolutionStore({ filePath: path.join(dir, 'skill-evolution.json') });
    const recorded = store.record(candidate, { verified: true, toolCallCount: 4, runId: 'r2' });
    assert.equal(recorded.ok, true, recorded.error);

    assert.equal(collectWorkflowProposals({ runs: [{ runId: 'r1', steps }] }).length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('memory query boosts entries from verified runs', () => {
  const dir = tempDir('yan-agi-bridge-');
  try {
    const memoryPath = path.join(dir, 'memory.json');
    const store = new LongTermMemoryStore({ globalPath: memoryPath, yanagentDir: '.yanagent' });
    store.upsert({ content: '部署流程：先构建再发布，目标环境为 staging', type: 'procedure', scope: 'global', confidence: 0.6 }, { runId: 'run-pass' });
    store.upsert({ content: '部署流程：先构建再发布，目标环境为 prod', type: 'procedure', scope: 'global', confidence: 0.6 }, { runId: 'run-fail' });
    const plain = store.query({ query: '部署流程 构建 发布 staging prod', workspace: '', maxChars: 4000, limit: 5 });
    const boosted = store.query({
      query: '部署流程 构建 发布 staging prod',
      workspace: '',
      maxChars: 4000,
      limit: 5,
      boostRunIds: new Set(['run-pass'])
    });
    assert.ok(plain.memories.length >= 2, 'both memories must be retrievable');
    assert.equal(boosted.memories[0].content.includes('staging'), true, JSON.stringify(boosted.memories.map(item => item.content)));
    assert.notEqual(plain.memories[0].id, boosted.memories[0].id, 'boost must change the ranking');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

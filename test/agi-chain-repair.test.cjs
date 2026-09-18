'use strict';

// Regression tests for the AGI chain repair (2026-09-15): every fix closes a
// link that existed as code but never carried a real signal in production.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  collectExperienceEdgeContext,
  createEscalationMemo,
  recordTopologyOutcome,
  runSignals,
  selectTopologyForRun,
  verifiedRunsFromTrajectories
} = require('../lib/agi/runtime-bridge');
const { createExperienceGraph } = require('../lib/agi/memory-consolidation');
const {
  budgetForMode,
  sidepathCeiling,
  validateSidepathBrief
} = require('../lib/agi/reasoning-sidepath');
const {
  evaluateSkillCandidate,
  SKILL_VALIDATION_SUITE_ID
} = require('../lib/agi/eval');
const {
  deliveryReviewDiagnostics,
  describeReviewDiagnostics
} = require('../lib/delivery-policy');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

test('runSignals treats a dropped review block as an acceptance failure', () => {
  assert.equal(
    runSignals({ toolCalls: [], delivery: { review: null, reviewIssues: { blockSeen: true, parseError: 'Unexpected end of JSON input' } } }).acceptanceFailed,
    true
  );
  assert.equal(
    runSignals({ toolCalls: [], delivery: { review: null } }).acceptanceFailed,
    false
  );
});

test('escalation consume returns bestOfN so it can map to real compute', () => {
  const dir = tempDir('yan-agi-chain-');
  try {
    const file = path.join(dir, 'escalation.json');
    const memo = createEscalationMemo({ filePath: file });
    memo.noteRun({
      workspace: 'ws',
      result: {
        toolCalls: [{ tool: 'edit', ok: false }, { tool: 'bash', ok: false }, { tool: 'bash', ok: false }],
        delivery: { review: { verdict: 'fail' } }
      }
    });
    const hint = memo.consume({ workspace: 'ws' });
    assert.ok(hint);
    assert.equal(hint.bestOfN, 2);
    assert.ok(hint.steps >= 1);
    assert.equal(memo.consume({ workspace: 'ws' }), null);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('verifiedRunsFromTrajectories keeps only pass-verdict runs of the workspace', () => {
  const records = [
    { runId: 'a', workspace: 'ws', verificationVerdict: 'pass', steps: [{ tool: 'read', ok: true }] },
    { runId: 'b', workspace: 'ws', verificationVerdict: '', steps: [{ tool: 'read', ok: true }] },
    { runId: 'c', workspace: 'ws', verificationVerdict: 'fail', steps: [{ tool: 'read', ok: false }] },
    { runId: 'd', workspace: 'other', verificationVerdict: 'pass', steps: [{ tool: 'read', ok: true }] },
    { runId: 'e', workspace: 'ws', verificationVerdict: 'pass', steps: [] }
  ];
  const verified = verifiedRunsFromTrajectories(records, 'ws');
  assert.deepEqual(verified.map(record => record.runId), ['a', 'e']);
});

test('experience edge context renders matched failure-repair edges as data', () => {
  const dir = tempDir('yan-agi-chain-');
  try {
    const graph = createExperienceGraph({ filePath: path.join(dir, 'graph.json') });
    graph.record({ runId: 'r1', action: '批量替换配置文件', failure: '替换后 JSON 解析失败' });
    graph.record({ runId: 'r2', action: '背景视差动画', failure: '图层速度取错字段导致静止' });
    const context = collectExperienceEdgeContext(graph, '替换配置文件');
    assert.ok(context.includes('失败：替换后 JSON 解析失败'), context);
    assert.ok(!context.includes('背景视差'), 'unrelated edges must not leak into the context');

    assert.equal(collectExperienceEdgeContext(graph, '完全不相关的查询词组'), '');
    assert.equal(collectExperienceEdgeContext(null, '任何查询'), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('topology selection needs a passing evidence record and switches with roles', () => {
  const dir = tempDir('yan-agi-chain-');
  try {
    const historyFile = path.join(dir, 'topology-history.json');
    const evidenceFile = path.join(dir, 'eval-evidence.json');
    fs.writeFileSync(evidenceFile, `${JSON.stringify({ ok: true, rubricVersion: 1 })}\n`, 'utf8');

    // No history yet: baseline, not active.
    const first = selectTopologyForRun({ historyFile, evidenceFile });
    assert.equal(first.active, false);
    assert.equal(first.variantId, 'baseline');

    // Record paired runs: baseline 4/5 ok (rate 0.8) + reviewer-first 5/5
    // (gain 0.2 >= minGain 0.1, cost x1.3 <= ceiling x2).
    for (let index = 0; index < 5; index += 1) {
      recordTopologyOutcome({ historyFile, variantId: 'baseline', runId: `b${index}`, ok: index < 4 });
      recordTopologyOutcome({ historyFile, variantId: 'reviewer-first', runId: `r${index}`, ok: true, cost: 1.3 });
    }
    const selected = selectTopologyForRun({ historyFile, evidenceFile });
    assert.equal(selected.active, true);
    assert.equal(selected.variantId, 'reviewer-first');
    assert.deepEqual(selected.roles, ['explorer', 'reviewer', 'builder', 'tester']);

    // A missing or failing evidence file pins the run to baseline again.
    fs.writeFileSync(evidenceFile, `${JSON.stringify({ ok: false })}\n`, 'utf8');
    const pinned = selectTopologyForRun({ historyFile, evidenceFile });
    assert.equal(pinned.active, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('escalated ceilings raise the real contract and briefs enforce upper bounds', () => {
  const normal = sidepathCeiling({ workMode: 'normal' });
  const escalated = sidepathCeiling({ workMode: 'normal', escalated: true });
  const agi = sidepathCeiling({ workMode: 'agi' });
  assert.ok(escalated.candidates > normal.candidates);
  assert.ok(escalated.verification > normal.verification);
  assert.equal(budgetForMode('exploratory', agi).candidates, 4);
  assert.equal(budgetForMode('exploratory', normal).candidates, 2);
  assert.equal(agi.candidates, 5, 'AGI ceiling widens the candidate space');

  const base = {
    mode: 'structured',
    deliverable: 'code',
    userIntent: '把首页的加载动画改快',
    understanding: '用户希望减少首屏加载动画的时长',
    task: '缩短首页加载动画时长并保持可访问性',
    ambiguities: [],
    methods: ['decompose', 'relations'],
    relations: ['动画时长驱动首屏可交互时间'],
    candidates: [{ decision: '压缩关键帧', status: 'chosen', why: '保留现有动效语言' }],
    verification: [{ claim: '动画在400毫秒内结束', check: '用秒表量三次取中位数' }]
  };
  assert.equal(validateSidepathBrief(base, { ceiling: normal }).ok, true);

  // A declared method without its artifact is rejected: methods are executed
  // operations, not tags.
  const taggedOnly = { ...base, methods: ['decompose', 'constraints'], constraints: [] };
  const methodRejected = validateSidepathBrief(taggedOnly, { ceiling: normal });
  assert.equal(methodRejected.ok, false);
  assert.ok(methodRejected.errors.some(error => error.includes('constraints')));

  const overCeiling = {
    ...base,
    verification: [
      ...base.verification,
      { claim: '按钮悬停有反馈', check: '截取悬停前后帧对比' },
      { claim: 'reduced-motion 生效', check: '模拟系统偏好后观察帧率' },
      { claim: '加载中不闪跳', check: '低性能模式下逐帧检查' }
    ]
  };
  const rejected = validateSidepathBrief(overCeiling, { ceiling: normal });
  assert.equal(rejected.ok, false);
  assert.ok(rejected.errors.some(error => error.includes('runtime ceiling')));

  assert.equal(validateSidepathBrief(overCeiling, { ceiling: agi }).ok, true, 'AGI ceiling accepts the same brief');
});

test('evaluateSkillCandidate: static checks plus judge verdict form the evidence', () => {
  const good = {
    id: 'wf-good',
    name: '工作流：读取后替换',
    description: '先读取目标文件确认范围，再执行替换，最后复核内容。',
    prompt: '请在 {{workspace}} 中按顺序复现以下已验证的工具序列：\n1. 调用 read，输入：{{input_1}}，输出：{{output_1}}\n2. 调用 edit，输入：{{input_2}}，输出：{{output_2}}\n3. 调用 read，输入：{{input_3}}，输出：{{output_3}}',
    verification: { preconditions: ['目标文件存在'], postconditions: ['替换后内容一致'] }
  };
  const badPaths = {
    ...good,
    id: 'wf-bad',
    prompt: `${good.prompt}\n结果写入 C:\\Users\\ somebody\\report.md`
  };

  const passing = evaluateSkillCandidate({ candidate: good, judge: { executable: true, issues: [], summary: '步骤具体有序' } });
  assert.equal(passing.ok, true);
  assert.equal(passing.suiteId, SKILL_VALIDATION_SUITE_ID);
  assert.ok(passing.taskIds.includes('model-executable'));

  const noJudge = evaluateSkillCandidate({ candidate: good, judge: null });
  assert.equal(noJudge.ok, false, 'missing judge must fail the gate, not fake a pass');
  assert.ok(noJudge.taskIds.includes('model-executable'));

  const rejectedJudge = evaluateSkillCandidate({ candidate: good, judge: { executable: false, issues: ['第二步没有说明替换目标'], summary: '占位符未落地' } });
  assert.equal(rejectedJudge.ok, false);

  const hardcoded = evaluateSkillCandidate({ candidate: badPaths, judge: { executable: true, issues: [], summary: 'ok' } });
  assert.equal(hardcoded.ok, false);
  assert.ok(hardcoded.taskIds.includes('no-absolute-paths'));
});

function reviewText(criteria, contractId) {
  return `<yan-delivery-review>${JSON.stringify({ contractId, criteria })}</yan-delivery-review>`;
}

test('deliveryReviewDiagnostics explains dropped review blocks instead of silence', () => {
  const contract = { intent: 'delivery', artifact: 'frontend', scope: '首页动效', acceptance: '动画时长减半' };
  const messages = [{ role: 'assistant', parts: [{ type: 'text', text: '' }] }];

  // A truncated JSON block inside a closed tag (the pelican case) reports a
  // parse error instead of vanishing.
  const truncated = [{ role: 'assistant', parts: [{ type: 'text', text: '<yan-delivery-review>{"contractId":"x","criteria":{"scope":{"status":"pass","evidence":"完成"},</yan-delivery-review>' } ] }];
  const parseDiag = deliveryReviewDiagnostics(truncated, { contract });
  assert.equal(parseDiag.blockSeen, true);
  assert.ok(parseDiag.parseError);
  assert.ok(describeReviewDiagnostics(parseDiag).includes('解析失败'));

  // A wrong contractId is counted, not silently discarded.
  const mismatched = [{ role: 'assistant', parts: [{ type: 'text', text: reviewText({ scope: { status: 'pass', evidence: '完成' } }, 'wrong-id') }] }];
  const mismatchDiag = deliveryReviewDiagnostics(mismatched, { contract });
  assert.equal(mismatchDiag.contractIdMismatch, 1);

  // contractId correct but criteria incomplete → incompleteFields (this path
  // used to throw ReferenceError: validCriterion is not defined in production).
  const { deliveryContractId } = require('../lib/delivery-policy');
  const realId = deliveryContractId(contract);
  const incomplete = [{ role: 'assistant', parts: [{ type: 'text', text: reviewText({ scope: { status: 'pass', evidence: '完成' } }, realId) }] }];
  const incompleteDiag = deliveryReviewDiagnostics(incomplete, { contract });
  assert.equal(incompleteDiag.incompleteFields, 1);
  assert.equal(describeReviewDiagnostics(incompleteDiag).includes('缺少必需条款'), true);

  // A complete, well-formed review is accepted.
  const complete = { scope: { status: 'pass', evidence: '首页动效' }, direction: { status: 'pass', evidence: '动画时长减半' }, decisions: { status: 'pass', evidence: '压缩关键帧' }, worldview: { status: 'pass', evidence: '保持现有视觉语言' }, acceptance: { status: 'pass', evidence: 'index.html 动画 400ms' } };
  const acceptedDiag = deliveryReviewDiagnostics(
    [{ role: 'assistant', parts: [{ type: 'text', text: reviewText(complete, realId) }] }],
    { contract }
  );
  assert.equal(acceptedDiag.accepted, 1);
  assert.equal(acceptedDiag.parseError, '');
  assert.equal(acceptedDiag.incompleteFields, 0);

  // No review block at all: diagnostics stay honest about that.
  const none = deliveryReviewDiagnostics(messages, { contract });
  assert.equal(none.blockSeen, false);
  assert.equal(describeReviewDiagnostics(none), '模型没有输出验收记录');
});

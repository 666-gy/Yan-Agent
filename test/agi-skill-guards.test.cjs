'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

const {
  checkConsistency,
  detectSelfConfirmation,
  regressionCheck,
  DEFAULT_GUARD_RULES
} = require('../lib/agi/skill-guards');

function codes(result) {
  return result.issues.map(issue => issue.code);
}

test('a documented read-only skill passes without issues', () => {
  const result = checkConsistency({
    name: 'report-writer',
    description: 'Read workspace data and summarize results into a report',
    prompt: 'Run a read-only flow: read workspace data and summarize results into a report for {{workspace}}.'
  });
  assert.equal(result.ok, true);
  assert.deepEqual(result.issues, []);
});

test('flags executable prompt content the description never declares', () => {
  const result = checkConsistency({
    name: 'dependency-notes',
    description: 'Collect raw dependency information and archive it',
    prompt: '```bash\nnpm install left-pad\n```'
  });
  assert.equal(result.ok, false);
  assert.ok(codes(result).includes('undocumented-execution'));
});

test('accepts executable prompts when the description declares the run', () => {
  const result = checkConsistency({
    name: 'dependency-installer',
    description: '运行 npm install 安装依赖',
    prompt: '```bash\nnpm install left-pad\n```',
    declaredEffect: 'write'
  });
  assert.equal(codes(result).includes('undocumented-execution'), false);
  assert.equal(codes(result).includes('effect-mismatch'), false);
});

test('flags read-declared prompts containing write/delete patterns', () => {
  const result = checkConsistency({
    name: 'cleanup',
    description: '运行清理流程',
    prompt: '运行清理流程：rm old.log 并 write 汇总报告。'
  });
  assert.ok(codes(result).includes('effect-mismatch'));

  const allowed = checkConsistency({
    name: 'cleanup',
    description: '运行清理流程',
    prompt: '运行清理流程：rm old.log 并 write 汇总报告。',
    declaredEffect: 'write'
  });
  assert.equal(codes(allowed).includes('effect-mismatch'), false);
});

test('flags large description/prompt keyword gaps but not aligned pairs', () => {
  const gapped = checkConsistency({
    name: 'legacy-notes',
    description: 'Maintain a catalog of legacy migration notes',
    prompt: 'compile kernel modules with the build toolchain'
  });
  assert.ok(codes(gapped).includes('promise-gap'));
  assert.equal(gapped.ok, false);

  const aligned = checkConsistency({
    name: 'kernel-builder',
    description: 'Compile kernel modules with cargo and report build size',
    prompt: 'compile kernel modules with cargo, then report build size into {{workspace}}'
  });
  assert.equal(codes(aligned).includes('promise-gap'), false);
  assert.equal(aligned.ok, true);
});

test('empty name or prompt fails with empty-content', () => {
  const blank = checkConsistency({});
  assert.equal(blank.ok, false);
  assert.deepEqual(codes(blank), ['empty-content']);

  const missingPrompt = checkConsistency({ name: 'x' });
  assert.equal(missingPrompt.ok, false);
  assert.ok(codes(missingPrompt).includes('empty-content'));
});

test('warns when generator and judge are the same model after normalization', () => {
  const same = detectSelfConfirmation({ generatorModel: 'GPT-5.1', judgeModel: 'gpt_5-1' });
  assert.equal(same.warn, true);
  assert.ok(same.reason.includes('同源'));
  assert.ok(same.reason.includes('自确认'));

  const different = detectSelfConfirmation({
    generatorModel: 'gpt-5.1',
    judgeModel: 'claude-4',
    generatorRole: 'build-agent',
    judgeRole: 'review-agent'
  });
  assert.equal(different.warn, false);
  assert.ok(different.reason.length > 0);
});

test('warns on shared role families even when model ids differ', () => {
  const shared = detectSelfConfirmation({
    generatorModel: 'model-a',
    judgeModel: 'model-b',
    generatorRole: 'build-agent',
    judgeRole: 'build-reviewer'
  });
  assert.equal(shared.warn, true);
  assert.ok(shared.reason.includes('角色族'));

  const heterogeneous = detectSelfConfirmation({ generatorModel: 'a', judgeModel: 'b', generatorRole: '', judgeRole: '' });
  assert.equal(heterogeneous.warn, false);
});

test('regressionCheck accepts after evidence that covers baseline and required tasks', () => {
  const before = { ok: true, rubricVersion: 1, taskIds: ['fs', 'json'], passed: 2, failed: 0 };
  const after = { ok: true, rubricVersion: 1, taskIds: ['fs', 'json', 'diff'], passed: 3, failed: 0 };
  const result = regressionCheck({ beforeEvidence: before, afterEvidence: after, requiredTaskIds: ['diff'] });
  assert.equal(result.ok, true);
  assert.ok(result.reason.includes('通过'));
});

test('regressionCheck rejects missing evidence, failed runs and version drift', () => {
  const baseline = { ok: true, rubricVersion: 1, taskIds: ['fs'] };
  assert.equal(regressionCheck({ beforeEvidence: baseline }).ok, false);
  assert.equal(regressionCheck({ beforeEvidence: baseline, afterEvidence: null }).ok, false);
  assert.equal(regressionCheck({ beforeEvidence: baseline, afterEvidence: { ...baseline, ok: false } }).ok, false);
  assert.equal(regressionCheck({ beforeEvidence: baseline, afterEvidence: { ...baseline, rubricVersion: 2 } }).ok, false);
  assert.equal(regressionCheck({ beforeEvidence: baseline, afterEvidence: { ok: true, taskIds: ['fs'] } }).ok, false);
});

test('regressionCheck rejects required-task gaps and coverage regressions', () => {
  const before = { ok: true, rubricVersion: 1, taskIds: ['fs', 'json'] };
  const after = { ok: true, rubricVersion: 1, taskIds: ['fs', 'json', 'diff'] };
  assert.equal(regressionCheck({ beforeEvidence: before, afterEvidence: after, requiredTaskIds: ['markdown'] }).ok, false);

  const regressed = regressionCheck({
    beforeEvidence: before,
    afterEvidence: { ok: true, rubricVersion: 1, taskIds: ['fs', 'diff'] }
  });
  assert.equal(regressed.ok, false);
  assert.ok(regressed.reason.includes('回退'));
});

test('DEFAULT_GUARD_RULES exposes a frozen, stable rule catalog', () => {
  assert.ok(Object.isFrozen(DEFAULT_GUARD_RULES));
  const ruleCodes = new Set(DEFAULT_GUARD_RULES.map(rule => rule.code));
  for (const code of ['empty-content', 'undocumented-execution', 'effect-mismatch', 'promise-gap', 'self-confirmation', 'regression']) {
    assert.ok(ruleCodes.has(code), code);
  }
  for (const rule of DEFAULT_GUARD_RULES) {
    assert.ok(Object.isFrozen(rule));
    assert.ok(rule.description.length > 0);
  }
});

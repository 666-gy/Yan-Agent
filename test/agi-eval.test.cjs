'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const {
  CORE_SUITE_ID,
  RUBRIC_VERSION,
  createCoreSuite,
  runSuite,
  evidenceRecord,
  writeEvidence,
  evaluatePromotion,
  createExperienceStore,
  auditSuiteStability,
  rubricInfo
} = require('../lib/agi/eval');

function makeWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-eval-'));
  return {
    root,
    sandbox: path.join(root, 'sandbox'),
    cleanup() {
      fs.rmSync(root, { recursive: true, force: true });
    }
  };
}

test('core suite exposes six deterministic tasks that all pass', () => {
  const workspace = makeWorkspace();
  try {
    const suite = createCoreSuite({ rootDir: workspace.root });
    assert.equal(suite.suiteId, CORE_SUITE_ID);
    assert.equal(suite.rubricVersion, RUBRIC_VERSION);
    assert.equal(suite.tasks.length, 6);
    assert.equal(new Set(suite.tasks.map(task => task.id)).size, 6);
    for (const task of suite.tasks) {
      assert.equal(typeof task.run, 'function');
      assert.equal(typeof task.verify, 'function');
      assert.ok(Array.isArray(task.tags) && task.tags.length > 0, `${task.id} has tags`);
    }

    const report = runSuite({ suite, sandboxDir: workspace.sandbox });
    assert.equal(report.ok, true);
    assert.equal(report.passed, 6);
    assert.equal(report.failed, 0);
    assert.equal(report.suiteId, CORE_SUITE_ID);
    assert.equal(report.rubricVersion, RUBRIC_VERSION);
    assert.equal(typeof report.startedAt, 'number');
    for (const result of report.results) {
      assert.equal(result.ok, true, `${result.id}: ${result.detail}`);
      assert.equal(typeof result.ms, 'number');
      assert.ok(result.detail.length > 0);
    }
  } finally {
    workspace.cleanup();
  }
});

test('runSuite isolates a throwing task without aborting the rest', () => {
  const workspace = makeWorkspace();
  try {
    const suite = createCoreSuite({ rootDir: workspace.root });
    const broken = {
      ...suite,
      tasks: [...suite.tasks, {
        id: 'boom',
        tags: ['meta'],
        run() { throw new Error('exploded'); },
        verify() { return { ok: true, detail: 'never reached' }; }
      }]
    };
    const report = runSuite({ suite: broken, sandboxDir: workspace.sandbox });
    assert.equal(report.ok, false);
    assert.equal(report.passed, 6);
    assert.equal(report.failed, 1);
    const boom = report.results.find(result => result.id === 'boom');
    assert.equal(boom.ok, false);
    assert.match(boom.detail, /exploded/);
  } finally {
    workspace.cleanup();
  }
});

test('two suite runs produce identical digests', () => {
  const workspace = makeWorkspace();
  try {
    const suite = createCoreSuite({ rootDir: workspace.root });
    const first = runSuite({ suite, sandboxDir: path.join(workspace.sandbox, 'first') });
    const second = runSuite({ suite, sandboxDir: path.join(workspace.sandbox, 'second') });
    assert.match(evidenceRecord(first).digest, /^[0-9a-f]{64}$/);
    assert.equal(evidenceRecord(first).digest, evidenceRecord(second).digest);

    const stability = auditSuiteStability({ suite, sandboxDir: path.join(workspace.sandbox, 'stability'), runs: 2 });
    assert.equal(stability.stable, true);
    assert.equal(stability.digests.length, 2);
    assert.equal(stability.digests[0], stability.digests[1]);
  } finally {
    workspace.cleanup();
  }
});

test('evidence records and files round-trip without time leaking into the digest', () => {
  const workspace = makeWorkspace();
  try {
    const suite = createCoreSuite({ rootDir: workspace.root });
    const report = runSuite({ suite, sandboxDir: workspace.sandbox });
    const record = evidenceRecord(report);
    assert.equal(record.suiteId, CORE_SUITE_ID);
    assert.equal(record.rubricVersion, RUBRIC_VERSION);
    assert.equal(record.ok, true);
    assert.equal(record.passed, 6);
    assert.equal(record.failed, 0);
    assert.equal(typeof record.ranAt, 'number');
    assert.deepEqual(record.taskIds, report.results.map(result => result.id));

    const filePath = path.join(workspace.root, 'evidence', 'core.json');
    const written = writeEvidence(filePath, report);
    assert.deepEqual(written, record);
    assert.deepEqual(JSON.parse(fs.readFileSync(filePath, 'utf8')), record);

    const shifted = { ...report, startedAt: report.startedAt + 5000 };
    assert.equal(evidenceRecord(shifted).digest, record.digest);
  } finally {
    workspace.cleanup();
  }
});

test('promotion rejects missing, failing, low-rate, incomplete and version-mismatched evidence', () => {
  const workspace = makeWorkspace();
  try {
    const suite = createCoreSuite({ rootDir: workspace.root });
    const report = runSuite({ suite, sandboxDir: workspace.sandbox });
    const clean = evidenceRecord(report);
    const taskIds = clean.taskIds;

    assert.equal(evaluatePromotion({}).ok, false);
    assert.equal(evaluatePromotion({ evidence: null }).ok, false);

    const failing = evaluatePromotion({ evidence: { ...clean, ok: false, passed: 5, failed: 1 } });
    assert.equal(failing.ok, false);
    assert.match(failing.reason, /passing run/i);

    const partial = { ...clean, passed: 4, failed: 2 };
    assert.equal(evaluatePromotion({ evidence: partial, minPassRate: 1 }).ok, false);
    assert.equal(evaluatePromotion({ evidence: partial, minPassRate: 0.5 }).ok, true);

    const missingTask = evaluatePromotion({ evidence: clean, requiredTaskIds: [...taskIds, 'ghost-task'] });
    assert.equal(missingTask.ok, false);
    assert.match(missingTask.reason, /ghost-task/);

    const wrongVersion = evaluatePromotion({ evidence: { ...clean, rubricVersion: RUBRIC_VERSION + 1 } });
    assert.equal(wrongVersion.ok, false);
    assert.match(wrongVersion.reason, /rubric version/i);

    const accepted = evaluatePromotion({ evidence: clean, requiredTaskIds: taskIds.slice(0, 3) });
    assert.equal(accepted.ok, true);
    assert.equal(typeof accepted.reason, 'string');
  } finally {
    workspace.cleanup();
  }
});

test('experience store walks candidate -> validated -> reusable with evidence gating', () => {
  const workspace = makeWorkspace();
  try {
    const store = createExperienceStore({ filePath: path.join(workspace.root, 'experience.json') });
    const proposed = store.propose({
      id: 'Flow Repair',
      kind: 'computer-use',
      title: '修复流程',
      content: '把步骤 2 的点击坐标替换为语义定位'
    });
    assert.equal(proposed.ok, true);
    assert.equal(proposed.record.id, 'flow-repair');
    assert.equal(proposed.record.state, 'candidate');
    assert.equal(store.validate('flow-repair').ok, false);

    const suite = createCoreSuite({ rootDir: workspace.root });
    const evidence = evidenceRecord(runSuite({ suite, sandboxDir: workspace.sandbox }));
    assert.equal(store.attachEvidence('flow-repair', evidence).ok, true);
    const validated = store.validate('flow-repair');
    assert.equal(validated.ok, true);
    assert.equal(validated.record.state, 'validated');

    assert.equal(store.markReusable('flow-repair', { runId: 'run-1' }).ok, false);
    assert.equal(store.markReusable('flow-repair', { independentSuccess: false, runId: 'run-1' }).ok, false);
    const reused = store.markReusable('flow-repair', { independentSuccess: true, runId: 'run-1' });
    assert.equal(reused.ok, true);
    assert.equal(reused.record.state, 'reusable');
    assert.equal(store.get('flow-repair').state, 'reusable');
  } finally {
    workspace.cleanup();
  }
});

test('propose rejects unsafe or empty input and re-proposing resets validation', () => {
  const workspace = makeWorkspace();
  try {
    const store = createExperienceStore({ filePath: path.join(workspace.root, 'experience.json') });
    assert.equal(store.propose({ id: '   ', content: 'x' }).ok, false);
    assert.equal(store.propose({ id: 'empty', content: '   ' }).ok, false);
    assert.equal(store.propose({ id: 'unsafe', content: 'run rm -rf / on the sandbox' }).ok, false);
    assert.equal(store.get('unsafe'), null);
    assert.equal(store.propose({ id: 'secret', content: 'password = 12345678' }).ok, false);

    const suite = createCoreSuite({ rootDir: workspace.root });
    const evidence = evidenceRecord(runSuite({ suite, sandboxDir: workspace.sandbox }));
    store.propose({ id: 'flow', content: '第一版内容' });
    store.attachEvidence('flow', evidence);
    assert.equal(store.validate('flow').ok, true);

    const reproposed = store.propose({ id: 'flow', content: '第二版内容' });
    assert.equal(reproposed.ok, true);
    assert.equal(reproposed.record.state, 'candidate');
    assert.equal(reproposed.record.evidence, null);
    const reverdict = store.validate('flow');
    assert.equal(reverdict.ok, false);
    assert.match(reverdict.reason, /evidence/i);
  } finally {
    workspace.cleanup();
  }
});

test('rejected experiences are terminal and unknown ids fail every transition', () => {
  const workspace = makeWorkspace();
  try {
    const store = createExperienceStore({ filePath: path.join(workspace.root, 'experience.json') });
    store.propose({ id: 'dead-end', content: '不再使用的经验' });

    assert.equal(store.validate('ghost').ok, false);
    assert.equal(store.attachEvidence('ghost', { ok: true, rubricVersion: RUBRIC_VERSION }).ok, false);
    assert.equal(store.markReusable('ghost', { independentSuccess: true }).ok, false);
    assert.equal(store.reject('ghost', 'missing').ok, false);

    const rejected = store.reject('dead-end', '事实不再成立');
    assert.equal(rejected.ok, true);
    assert.equal(rejected.record.state, 'rejected');
    assert.match(store.validate('dead-end').reason, /rejected/i);
    assert.equal(store.markReusable('dead-end', { independentSuccess: true }).ok, false);
    assert.equal(store.attachEvidence('dead-end', { ok: true, rubricVersion: RUBRIC_VERSION }).ok, false);
    assert.equal(store.reject('dead-end', 'again').ok, true);
  } finally {
    workspace.cleanup();
  }
});

test('experience store persists records and restores them on reload', () => {
  const workspace = makeWorkspace();
  try {
    const filePath = path.join(workspace.root, 'state', 'experience.json');
    const suite = createCoreSuite({ rootDir: workspace.root });
    const evidence = evidenceRecord(runSuite({ suite, sandboxDir: workspace.sandbox }));

    const first = createExperienceStore({ filePath });
    first.propose({ id: 'keep-me', kind: 'eval', title: '保留经验', content: '离线评估器通过后晋升' });
    first.attachEvidence('keep-me', evidence);
    assert.equal(first.validate('keep-me').ok, true);
    assert.equal(first.markReusable('keep-me', { independentSuccess: true, runId: 'run-42' }).ok, true);
    first.propose({ id: 'still-candidate', content: '等待验证' });
    const before = first.list();

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    assert.equal(raw.version, 1);
    assert.equal(raw.records.length, 2);

    const second = createExperienceStore({ filePath });
    assert.deepEqual(second.list(), before);
    assert.equal(second.get('keep-me').state, 'reusable');
    assert.equal(second.get('keep-me').reuse.runId, 'run-42');

    second.propose({ id: 'third', content: '第三个' });
    const third = createExperienceStore({ filePath });
    assert.equal(third.list().length, 3);
  } finally {
    workspace.cleanup();
  }
});

test('rubricInfo exposes the versioned suite identity', () => {
  const info = rubricInfo();
  assert.equal(info.suiteId, CORE_SUITE_ID);
  assert.equal(info.rubricVersion, RUBRIC_VERSION);
  assert.deepEqual(info.changelog, []);
});

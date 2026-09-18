'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { SkillEvolutionStore } = require('../lib/skill-evolution');
const { combineTurnPrompt } = require('../lib/opencode-sidecar');
const { ensureProtocol, loadProtocol, readProtocol, renderProtocolPrompt } = require('../lib/agi/long-horizon');

function tempDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function minedCandidate(overrides = {}) {
  return {
    id: 'wf-abc1234567',
    name: '重复工作流：先搜索再替换',
    description: '当需要批量替换时，先搜索确认范围再执行替换。',
    prompt: '工作流候选：\n1. 使用 grep 搜索目标模式并确认命中范围。\n2. 使用 edit 执行精确替换。\n3. 使用 read 复核结果并保留证据。\n参数：{{workspace}}。验收：替换后的文件内容与预期一致。',
    triggers: ['grep', 'edit'],
    evidence: 'Workflow repeated 3 times across verified runs.',
    verification: {
      preconditions: ['目标文件存在'],
      postconditions: ['替换后的内容与预期一致']
    },
    ...overrides
  };
}

test('mined candidates cannot be promoted before Yan Eval validation', () => {
  const dir = tempDir('yan-agi-wiring-');
  try {
    const store = new SkillEvolutionStore({ filePath: path.join(dir, 'skill-evolution.json') });
    const recorded = store.record(minedCandidate(), {
      verified: true,
      toolCallCount: 5,
      runId: 'run-1',
      sessionId: 'sess-1',
      workspace: dir
    });
    assert.equal(recorded.ok, true);
    assert.deepEqual(recorded.candidate.verification.postconditions, ['替换后的内容与预期一致']);

    assert.equal(store.canPromote('wf-abc1234567', { requireValidation: true }).ok, false);
    assert.equal(store.canPromote('wf-abc1234567', { requireValidation: false }).ok, true);

    const rejectedEvidence = store.attachValidation('wf-abc1234567', { ok: false, rubricVersion: 1 });
    assert.equal(rejectedEvidence.ok, false);

    const attached = store.attachValidation('wf-abc1234567', {
      ok: true,
      suiteId: 'yan-eval-core',
      rubricVersion: 1,
      digest: 'deadbeef',
      taskIds: ['fs-roundtrip', 'exact-replace']
    });
    assert.equal(attached.ok, true);
    assert.equal(attached.validation.state, 'validated');

    assert.equal(store.canPromote('wf-abc1234567', { requireValidation: true }).ok, true);

    const reloaded = new SkillEvolutionStore({ filePath: path.join(dir, 'skill-evolution.json') });
    assert.equal(reloaded.canPromote('wf-abc1234567', { requireValidation: true }).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('legacy reviewer candidates keep promoting without the strict flag', () => {
  const dir = tempDir('yan-agi-wiring-');
  try {
    const store = new SkillEvolutionStore({ filePath: path.join(dir, 'skill-evolution.json') });
    const legacy = minedCandidate();
    delete legacy.verification;
    const recorded = store.record(legacy, {
      verified: true,
      toolCallCount: 5,
      runId: 'run-2',
      sessionId: 'sess-2',
      workspace: dir
    });
    assert.equal(recorded.ok, true);
    assert.equal(store.canPromote('wf-abc1234567', { requireValidation: false }).ok, true);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('long-horizon protocol renders into the turn context only when present', () => {
  const base = { providerId: 'deepseek', modelId: 'deepseek-v4-flash', prompt: 'hi' };
  assert.doesNotMatch(combineTurnPrompt(base, base.prompt, false), /yan-long-horizon-protocol/);
  const withProtocol = combineTurnPrompt(
    { ...base, workMode: 'agi', longHorizonContext: '目标：交付登录页\n冒烟：npm test' },
    base.prompt,
    false
  );
  assert.match(withProtocol, /<yan-long-horizon-protocol>/);
  assert.match(withProtocol, /交付登录页/);
  assert.match(withProtocol, /npm test/);
});

test('protocol artifacts survive a session restart and reach the prompt', () => {
  const workspace = tempDir('yan-agi-wiring-ws-');
  try {
    const created = ensureProtocol({
      workspace,
      goal: '完成登录页并保持回归通过',
      features: [{ title: '表单校验' }, { title: '错误提示' }],
      smokeCommands: ['node --test test/login.test.cjs'],
      now: 1_700_000_000_000
    });
    assert.equal(created.ok, true);
    assert.equal(fs.existsSync(path.join(created.dir, 'feature-list.json')), true);
    assert.equal(fs.existsSync(path.join(created.dir, 'progress.md')), true);
    assert.equal(fs.existsSync(path.join(created.dir, 'init.sh')), true);

    const latest = loadProtocol({ workspace });
    assert.equal(latest.protocol.taskId, created.taskId);
    const full = readProtocol({ workspace, taskId: created.taskId });
    assert.equal(full.ok, true);
    assert.equal(full.features.length, 2);

    const section = renderProtocolPrompt(full);
    assert.match(section, /完成登录页并保持回归通过/);
    assert.match(section, /node --test test\/login\.test\.cjs/);

    const prompt = combineTurnPrompt({
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      prompt: '继续',
      workMode: 'agi',
      longHorizonContext: section
    }, '继续', false);
    assert.match(prompt, /<yan-long-horizon-protocol>/);
    assert.match(prompt, /表单校验/);
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
});

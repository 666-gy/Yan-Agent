'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { combineTurnPrompt, permissionForRun } = require('../lib/opencode-sidecar');
const { stripProtocolBlocks } = require('../lib/delivery-contract');
const { ContinualHarnessStore } = require('../lib/continual-harness');
const { sidepathCeiling } = require('../lib/agi/reasoning-sidepath');

test('the vocabulary and side-path requirement appear only in AGI mode', () => {
  const base = { providerId: 'deepseek', modelId: 'deepseek-v4-flash', prompt: '写一个鹈鹕骑自行车 注意AGI' };
  assert.doesNotMatch(combineTurnPrompt(base, base.prompt, false), /Yan 系统词表/);
  assert.doesNotMatch(combineTurnPrompt(base, base.prompt, false), /AGI reasoning side-path/);

  const withSidepath = combineTurnPrompt({
    ...base,
    workMode: 'agi',
    reasoningSidepath: { required: true, followupRound: true, ceiling: sidepathCeiling() }
  }, base.prompt, false);
  assert.match(withSidepath, /AGI reasoning side-path/);
  assert.match(withSidepath, /follow-up round/);
  assert.match(withSidepath, /intentDelta/);
  assert.match(withSidepath, /<yan-reasoning-sidepath>/);

  const ungated = combineTurnPrompt({
    ...base,
    reasoningSidepath: { required: false, followupRound: false, ceiling: sidepathCeiling() }
  }, base.prompt, false);
  assert.doesNotMatch(ungated, /AGI reasoning side-path/);
});

test('the side-path block never leaks into user-facing text', () => {
  const text = '前言<yan-reasoning-sidepath>{"task":"x"}</yan-reasoning-sidepath>后记';
  assert.equal(stripProtocolBlocks(text), '前言后记');
});

test('full access keeps the side-path decision point for gated runs', () => {
  const plain = permissionForRun({ accessMode: 'full' });
  assert.equal(plain.edit, 'allow');

  const gated = permissionForRun({
    accessMode: 'full',
    workMode: 'agi',
    reasoningSidepath: { required: true, mode: 'exploratory' }
  });
  assert.equal(gated.edit, 'ask');
  assert.equal(gated.write, 'ask');
  assert.equal(gated.apply_patch, 'ask');

  const ungated = permissionForRun({
    accessMode: 'full',
    reasoningSidepath: { required: false, mode: 'direct' }
  });
  assert.equal(ungated.edit, 'allow');

  const plan = permissionForRun({
    accessMode: 'full',
    workMode: 'plan',
    reasoningSidepath: { required: true, mode: 'exploratory' }
  });
  assert.equal(plan.edit, 'deny');

  const request = permissionForRun({
    accessMode: 'request',
    reasoningSidepath: { required: true, mode: 'structured' }
  });
  assert.equal(request.edit, 'ask');
});

test('AGI mode announces the dual chain, the floor and the runtime audit', () => {
  const base = {
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    prompt: '写一个鹈鹕骑自行车html',
    workMode: 'agi'
  };
  const prompt = combineTurnPrompt({
    ...base,
    reasoningSidepath: { required: true, followupRound: false, ceiling: sidepathCeiling({ workMode: 'agi' }) }
  }, base.prompt, false);
  assert.match(prompt, /AGI mode: the AGI reasoning side-path and self-evolution run as one chain/);
  assert.match(prompt, /widens your thinking space/, 'AGI copy must be expansion-oriented');
  assert.match(prompt, /uplift/);
  assert.match(prompt, /deliverable=visual/);
  assert.match(prompt, /independently measures the produced visual artifact/);
});

test('normal mode may use verified experience but not unverified entries', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-agi-sidepath-harness-'));
  try {
    const store = new ContinualHarnessStore({
      globalPath: path.join(dir, 'harness-state.json'),
      yanagentDir: '.yanagent'
    });
    await store.apply({
      id: 'seed-verified-experience',
      trigger: 'seed entries for the verified-experience filter',
      edits: [
        {
          action: 'create',
          kind: 'skill',
          id: 'verified-skill',
          title: '验证过的技能',
          content: '先搜索确认范围，再执行替换，替换后跑回归。',
          path: 'learned',
          scope: 'global',
          metadata: { status: 'active' }
        },
        {
          action: 'create',
          kind: 'skill',
          id: 'fresh-skill',
          title: '未验证技能',
          content: '这个技能还没有被任何一次运行验证过。',
          path: 'learned',
          scope: 'global',
          metadata: { status: 'active' }
        },
        {
          action: 'create',
          kind: 'prompt',
          id: 'user-policy',
          title: '用户策略',
          content: '回复始终使用简体中文。',
          path: 'user-policy',
          scope: 'global',
          metadata: { status: 'active', basis: 'explicit_user_statement', enforcement: 'mandatory' }
        }
      ]
    }, { scope: 'global' });

    await store.recordUsage({
      runId: 'run-1',
      outcome: 'success',
      entries: [{ kind: 'skill', id: 'verified-skill', scope: 'global' }]
    }, {});

    const normal = store.evolutionContext({ requireVerified: true });
    const normalIds = normal.entries.map(entry => entry.id);
    assert.ok(normalIds.includes('verified-skill'), JSON.stringify(normalIds));
    assert.ok(normalIds.includes('user-policy'), JSON.stringify(normalIds));
    assert.equal(normalIds.includes('fresh-skill'), false, JSON.stringify(normalIds));

    const evolution = store.evolutionContext({});
    assert.ok(evolution.entries.some(entry => entry.id === 'fresh-skill'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

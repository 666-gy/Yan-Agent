'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const {
  derivePolicyControls,
  hasAnySearchRoute,
  authoritativePolicySystem,
} = require('../lib/behavior-policy');

const {
  ContinualHarnessStore
} = require('../lib/continual-harness');
const { combineSystem, permissionForRun } = require('../lib/kernel-policy');

function policy(content = '以后搜索优先使用 AnySearch，只有不可用时才回退内置浏览器。') {
  return {
    id: 'prompt-search-routing',
    kind: 'prompt',
    scope: 'global',
    title: 'Explicit user policy',
    content,
    metadata: { status: 'active', enforcement: 'mandatory' },
    updatedAt: Date.now()
  };
}

test('durable search policy produces an executable route control', () => {
  const current = policy();
  assert.deepEqual(derivePolicyControls(current.content), {
    searchRoute: 'anysearch',
    requiredFirstTool: 'anysearch_cli',
    blockedBeforeRequired: ['yan_browser', 'webfetch', 'websearch']
  });
  assert.equal(hasAnySearchRoute([current], { prompt: '搜索 Astra 模型介绍' }), true);
  assert.equal(hasAnySearchRoute([current], { prompt: '打开这个网页并截图' }), false);
});

test('AnySearch routing does not require the user to name a browser and covers search-plus-page tasks', () => {
  const current = policy('以后所有搜索都优先使用 AnySearch，其他渠道仅在结果不足时使用。');
  assert.equal(derivePolicyControls(current.content).searchRoute, 'anysearch');
  assert.equal(hasAnySearchRoute([current], { prompt: '搜索 Astra 官网，然后打开最相关的页面' }), true);
  assert.equal(hasAnySearchRoute([current], { prompt: '打开 https://example.com 并查询页面内容' }), false);
});







test('active policies are placed in the authoritative system layer', () => {
  const system = combineSystem({
    workMode: 'evolution',
    prompt: '搜索 Astra 模型介绍',
    yanBrowserAvailable: true,
    behaviorPolicies: [policy()],
    availableSkills: [],
    availableMcpServers: []
  });
  assert.match(system, /Yan authoritative durable policies/);
  assert.match(system, /AnySearch first/);
  assert.match(authoritativePolicySystem([policy()], { prompt: '搜索 Astra' }), /binding/);
});

test('session permissions turn on the application gate for a relevant search task', () => {
  const permissions = permissionForRun({
    workMode: 'evolution',
    accessMode: 'full',
    prompt: '搜索 Astra',
    behaviorPolicies: [policy()],
    permissions: { allowNetwork: true },
    mcpServers: [{ id: 'yan_browser', enabled: true, command: 'node' }]
  });
  assert.equal(permissions['yan_browser_*'], 'ask');
  assert.equal(permissions.bash, 'ask');
  assert.equal(permissions.webfetch, 'ask');
  assert.equal(permissions.websearch, 'ask');
});



test('explicit policies and legacy rejected refinements are durable in the Harness', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-policy-'));
  const store = new ContinualHarnessStore({ globalPath: path.join(root, 'harness-state.json') });
  try {
    const rejected = await store.apply({
      id: 'old-refinement',
      trigger: 'Agent-requested refinement: 以后搜索优先使用 AnySearch，只有不可用时才回退内置浏览器。',
      evidence: 'reviewer failed',
      expectedOutcome: 'Keep current harness unchanged.',
      edits: []
    }, { scope: 'global', source: 'agent_refine' });
    await store.recordOutcome(rejected.refinement.id, { status: 'rejected', evidence: 'reviewer failed' });

    const recovered = await store.recoverRejectedAgentRefinements({ scope: 'global' });
    assert.equal(recovered.length, 1);
    const entry = store.get('prompt', 'prompt-search-routing');
    assert.equal(entry.metadata.status, 'active');
    assert.equal(entry.metadata.enforcement, 'mandatory');
    assert.equal(store.activePolicies({ query: '搜索 Astra' }).length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
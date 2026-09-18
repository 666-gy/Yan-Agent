'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  derivePolicyControls,
  hasAnySearchRoute,
  policyPermissionDecision,
  authoritativePolicySystem,
  anySearchOutputFailed,
  anySearchOutputInsufficient
} = require('../lib/behavior-policy');
const {
  ContinualHarnessStore
} = require('../lib/continual-harness');
const {
  combineSystem,
  observeBehaviorPolicyTool,
  permissionForRun
} = require('../lib/opencode-sidecar');

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

test('search policy blocks browser permissions until AnySearch settles', () => {
  const current = policy();
  const before = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: {},
    permission: 'yan_browser_open_builtin_browser'
  });
  assert.equal(before.reply, 'reject');

  const after = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: { anySearchFailed: true },
    permission: 'yan_browser_open_builtin_browser'
  });
  assert.equal(after.reply, 'once');
});

test('search policy also gates network-capable Bash commands', () => {
  const current = policy();
  const local = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: {},
    permission: 'bash',
    patterns: ['Get-Content -Raw README.md']
  });
  assert.equal(local.reply, 'once');
  const bypass = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: {},
    permission: 'bash',
    patterns: ['Invoke-WebRequest https://example.com']
  });
  assert.equal(bypass.reply, 'reject');
  const inlineBypass = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: {},
    permission: 'bash',
    patterns: ["node -e \"require('https').get('example.com')\""]
  });
  assert.equal(inlineBypass.reply, 'reject');
  const unknownScript = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: {},
    permission: 'bash',
    patterns: ['node local-script.js']
  });
  assert.equal(unknownScript.reply, 'reject');
  const fallback = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: { anySearchFailed: true },
    permission: 'bash',
    patterns: ['Invoke-WebRequest https://example.com']
  });
  assert.equal(fallback.reply, 'once');
});

test('a successful AnySearch result does not authorize unrelated browser fallback', () => {
  const current = policy();
  const blocked = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra 模型介绍' },
    state: { anySearchSucceeded: true },
    permission: 'websearch'
  });
  assert.equal(blocked.reply, 'reject');
  const pageFollowUp = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra 官网，然后打开页面核对截图' },
    state: { anySearchSucceeded: true },
    permission: 'yan_browser_open_builtin_browser'
  });
  assert.equal(pageFollowUp.reply, 'once');
  const emptyResult = policyPermissionDecision({
    policies: [current],
    request: { prompt: '搜索 Astra' },
    state: { anySearchSucceeded: true, anySearchFallbackEligible: true },
    permission: 'websearch'
  });
  assert.equal(emptyResult.reply, 'once');
  assert.equal(anySearchOutputInsufficient('{"results":[]}'), true);
  assert.equal(anySearchOutputInsufficient('{"results":[{"title":"Astra"}]}'), false);
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

test('a completed AnySearch command releases the fallback gate', () => {
  const run = {
    request: { prompt: '搜索 Astra', behaviorPolicies: [policy()] },
    policyState: { anySearchAttempted: false, anySearchSucceeded: false, anySearchFailed: false }
  };
  observeBehaviorPolicyTool(run, {
    type: 'message.part.updated',
    properties: {
      part: {
        type: 'tool',
        tool: 'bash',
        state: {
          status: 'completed',
          input: { command: 'node "C:\\Yan\\anysearch_cli.js" search Astra' }
        }
      }
    }
  });
  assert.equal(run.policyState.anySearchAttempted, true);
  assert.equal(run.policyState.anySearchSucceeded, true);
});

test('AnySearch completed output with a nonzero result remains a failure', () => {
  assert.equal(anySearchOutputFailed('{"ok":false,"error":"network unavailable"}'), true);
  assert.equal(anySearchOutputFailed('exit code: 1\nnetwork unavailable'), true);
  assert.equal(anySearchOutputFailed('{"ok":true,"results":[{"title":"Astra"}]}'), false);
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

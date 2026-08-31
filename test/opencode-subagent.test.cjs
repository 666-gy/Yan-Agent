const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOpenCodeConfig,
  combineSystem,
  isAssistantImmediatePartEvent,
  nextSubagentPermission,
  permissionRulesForRun,
  sessionPermissionForRun
} = require('../lib/opencode-sidecar');

function ruleFor(rules, permission) {
  return rules.find(rule => rule.permission === permission && rule.pattern === '*');
}

test('native subagent delegation is disabled by default', () => {
  const rules = permissionRulesForRun({});
  assert.equal(ruleFor(rules, 'task')?.action, 'deny');
  const config = buildOpenCodeConfig({ providerId: 'test', modelId: 'model' });
  assert.equal(config.subagent_depth, undefined);
  assert.deepEqual(Object.keys(config.agent), ['build', 'plan', 'skill-reader']);
  assert.equal(config.agent['skill-reader'].hidden, true);
  assert.equal(config.agent['skill-reader'].maxSteps, 1);
  assert.equal(config.agent['skill-reader'].tools.read, false);
  assert.equal(config.agent['skill-reader'].permission.read, 'deny');
  assert.match(combineSystem({ enableSubagents: false }), /subagents are disabled/);
});

test('skill-only runtime keeps only Yan Skills MCP and its permission namespace', () => {
  const config = buildOpenCodeConfig({
    providerId: 'test',
    modelId: 'model',
    skillOnly: true,
    mcpServers: [
      { id: 'yan_skills', runtime: 'yan-skills', command: process.execPath, enabled: true },
      { id: 'yan_browser', runtime: 'yan-browser', command: process.execPath, enabled: true },
      { id: 'third-party', command: process.execPath, enabled: true }
    ],
    enableSubagents: true
  });
  assert.deepEqual(Object.keys(config.mcp), ['yan_skills']);
  assert.equal(config.subagent_depth, undefined);
  assert.equal(config.permission['yan_skills_*'], 'allow');
  assert.equal(config.permission['yan_browser_*'], undefined);
  assert.equal(config.permission['third-party_*'], undefined);
  assert.equal(config.permission['yan_media_*'], undefined);
});

test('skill-only session permissions exclude unrelated built-in MCP namespaces', () => {
  const permissions = sessionPermissionForRun({ skillOnly: true, hasUserWorkspace: false });
  const names = new Set(permissions.map(rule => rule.permission));
  assert.equal(names.has('yan_skills_*'), true);
  assert.equal(names.has('yan_browser_*'), false);
  assert.equal(names.has('yan_media_*'), false);
  assert.equal(names.has('yan_session_*'), false);
});

test('task capability flags deny irrelevant MCP tools at the session boundary', () => {
  const rules = sessionPermissionForRun({
    hasUserWorkspace: true,
    permissions: { allowNetwork: true },
    mcpServers: [
      { id: 'yan_skills', runtime: 'yan-skills', command: process.execPath, enabled: true, taskEnabled: true },
      { id: 'yan_media', runtime: 'yan-media', command: process.execPath, enabled: true, taskEnabled: false },
      { id: 'yan_browser', runtime: 'yan-browser', command: process.execPath, enabled: true, taskEnabled: false },
      { id: 'custom-tools', command: process.execPath, enabled: true, taskEnabled: true }
    ]
  });
  assert.equal(ruleFor(rules, 'yan_skills_*')?.action, 'allow');
  assert.equal(ruleFor(rules, 'yan_media_*')?.action, 'deny');
  assert.equal(ruleFor(rules, 'yan_browser_*')?.action, 'deny');
  assert.equal(ruleFor(rules, 'custom-tools_*')?.action, 'ask');
});

test('enabling native subagents exposes bounded child agents to the parent', () => {
  const options = {
    enableSubagents: true,
    hasUserWorkspace: true,
    permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true }
};
  const rules = permissionRulesForRun(options);
  assert.equal(ruleFor(rules, 'task')?.action, 'ask');
  const config = buildOpenCodeConfig({ providerId: 'test', modelId: 'model', ...options });
  assert.equal(config.subagent_depth, 1);
  assert.deepEqual(
    Object.keys(config.agent).sort(),
    ['build', 'explorer', 'researcher', 'reviewer', 'tester', 'plan', 'skill-reader'].sort()
  );
  assert.equal(config.agent.explorer.mode, 'subagent');
  assert.equal(config.agent.explorer.tools.task, false);
  assert.equal(config.agent.explorer.tools.write, false);
  assert.equal(config.agent.explorer.permission.task, 'deny');
  assert.equal(config.agent.explorer.permission.edit, 'deny');
  assert.equal(config.agent.explorer.permission.question, 'deny');
  assert.equal(config.agent.explorer.permission['yan_skills_*'], 'allow');
  assert.equal(config.agent.explorer.permission.external_directory, 'deny');
  assert.match(config.agent.explorer.prompt, /High-throughput execution contract/);
  assert.match(config.agent.explorer.prompt, /batch independent read\/glob\/grep/);
  assert.match(config.agent.explorer.prompt, /yan_skills_read_skill/);
  assert.equal(config.agent.explorer.permission.read['*'], 'allow');
  assert.equal(config.agent.explorer.permission.read[Object.keys(config.agent.explorer.permission.read)
    .find(pattern => pattern.endsWith('/lib/skills/*'))], 'deny');
  assert.equal(config.agent.researcher.permission.webfetch, 'allow');
  assert.equal(config.agent.tester.permission.bash['*'], 'deny');
  assert.equal(config.agent.tester.permission.bash['node --test*'], 'allow');
  assert.match(combineSystem(options), /native subagents are enabled/);
});

test('assistant tool parts bypass role-gating so tool UI starts immediately', () => {
  assert.equal(isAssistantImmediatePartEvent({
    type: 'message.part.updated',
    data: { part: { type: 'tool', messageID: 'assistant-step' } }
  }), true);
  assert.equal(isAssistantImmediatePartEvent({
    type: 'message.part.updated',
    data: { part: { type: 'subtask', messageID: 'assistant-step' } }
  }), true);
  assert.equal(isAssistantImmediatePartEvent({
    type: 'message.part.updated',
    data: { part: { type: 'text', messageID: 'assistant-step' } }
  }), false);
  assert.equal(isAssistantImmediatePartEvent({
    type: 'message.part.delta',
    data: { partID: 'assistant-step', delta: 'text' }
  }), false);
});

test('explorer instructions stay config-stable across runs (no per-run values)', () => {
  const config = buildOpenCodeConfig({
    providerId: 'test', modelId: 'model', enableSubagents: true,
    yanTaskId: 'yan-run-cache-123', inputTokensPerSecond: 20_000
  });
  assert.match(config.agent.explorer.prompt, /task_id stated in the turn-context system instructions/);
  assert.match(config.agent.explorer.prompt, /reuses the parent task cache/);
  assert.match(config.agent.explorer.prompt, /input_tokens_per_second value stated in the input-throughput system instructions/);
  // Per-run values must NOT leak into the config (they would change
  // configSignature and restart the kernel between tasks).
  assert.doesNotMatch(config.agent.explorer.prompt, /yan-run-cache-123/);
  assert.doesNotMatch(config.agent.explorer.prompt, /20000/);
  const crypto = require('node:crypto');
  const signature = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const other = buildOpenCodeConfig({
    providerId: 'test', modelId: 'model', enableSubagents: true,
    yanTaskId: 'a-different-task', measuredInputTokensPerSecond: 45_000
  });
  assert.equal(signature(config), signature(other));
});

test('role switches expose only the selected built-in child agents', () => {
  const options = {
    enableSubagents: true,
    subagentRoles: { explorer: false, reviewer: true, researcher: false, tester: true }
  };
  const config = buildOpenCodeConfig({ providerId: 'test', modelId: 'model', ...options });
  assert.deepEqual(Object.keys(config.agent).sort(), ['build', 'plan', 'reviewer', 'tester', 'skill-reader'].sort());
  assert.equal(config.subagent_depth, 1);
  assert.equal(permissionRulesForRun(options).find(rule => rule.permission === 'task')?.action, 'ask');
  const disabled = buildOpenCodeConfig({
    providerId: 'test', modelId: 'model', enableSubagents: true,
    subagentRoles: { explorer: false, reviewer: false, researcher: false, tester: false }
  });
  assert.equal(disabled.subagent_depth, undefined);
  assert.deepEqual(Object.keys(disabled.agent), ['build', 'plan', 'skill-reader']);
  assert.equal(permissionRulesForRun({ ...options, subagentRoles: { explorer: false, reviewer: false, researcher: false, tester: false } })
    .find(rule => rule.permission === 'task')?.action, 'deny');
});

test('no-workspace sessions preserve the guarded task permission', () => {
  const disabled = sessionPermissionForRun({ hasUserWorkspace: false });
  const enabled = sessionPermissionForRun({ hasUserWorkspace: false, enableSubagents: true });
  assert.equal(ruleFor(disabled, 'task')?.action, 'deny');
  assert.equal(ruleFor(enabled, 'task')?.action, 'ask');
});

test('parent task permission has a hard child limit', () => {
  const run = { subagentPermissionCount: 0, subagentMaxChildren: 2 };
  assert.deepEqual(nextSubagentPermission(run), { granted: true, used: 1, limit: 2 });
  assert.deepEqual(nextSubagentPermission(run), { granted: true, used: 2, limit: 2 });
  assert.deepEqual(nextSubagentPermission(run), { granted: false, used: 2, limit: 2 });
  assert.equal(run.subagentPermissionCount, 2);
});

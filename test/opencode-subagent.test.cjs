const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildOpenCodeConfig,
  builderSessionPermissionForRun,
  combineSystem,
  isAssistantImmediatePartEvent,
  nextSubagentPermission,
  releaseReadSubagentSlot,
  permissionForRun,
  permissionRulesForRun,
  sessionPermissionForRun
} = require('../lib/opencode-sidecar');

function ruleFor(rules, permission) {
  return rules.find(rule => rule.permission === permission && rule.pattern === '*');
}

const { startRun } = require('../lib/run-orchestrator');
const { createRunContext } = require('./helpers/run-context.cjs');
const { builderPermissionRequestAllowed } = require('../lib/subagent');

test('provider dispatch preserves turn-selected roles in the model system prompt', async t => {
  for (const selected of [['mapper'], ['tracer', 'reverser'], [], undefined, 'mapper']) {
    const fixture = createRunContext(t);
    const result = await startRun(fixture.ctx, { runId: 'roles-test', prompt: 'hello', subagentRoles: selected });
    assert.equal(result.ok, true);
    const roles = fixture.calls.provider[0].request.subagentRoles;
    assert.deepEqual(roles, Array.isArray(selected) ? selected : []);
    assert.deepEqual(fixture.calls.core[0].intent.subagentRoles, roles);
    const system = combineSystem({ subagentRoles: roles });
    if (roles.length) {
      const labels = { mapper: 'Sub Mapper Agent', tracer: 'Sub Tracer Agent', reverser: 'Sub Reverser Agent' };
      assert.ok(system.includes('The user explicitly selected these roles for this turn: ' + roles.map(role => labels[role]).join(', ')));
    } else {
      assert.ok(!system.includes('The user explicitly selected these roles for this turn:'));
    }
    fixture.complete({ status: 'done', text: 'done' });
    await fixture.idle;
  }
});

test('native subagent delegation is enabled with all roles by default', () => {
  const rules = permissionRulesForRun({});
  assert.equal(ruleFor(rules, 'task')?.action, 'ask');
  const config = buildOpenCodeConfig({ providerId: 'test', modelId: 'model' });
  assert.equal(config.subagent_depth, 1);
  assert.deepEqual(Object.keys(config.agent).sort(), ['build', 'builder', 'explorer', 'mapper', 'researcher', 'reverser', 'reviewer', 'tester', 'tracer', 'plan', 'skill-reader'].sort());
  assert.equal(config.agent['skill-reader'].hidden, true);
  assert.equal(config.agent['skill-reader'].maxSteps, 1);
  assert.equal(config.agent['skill-reader'].tools.read, false);
  assert.equal(config.agent['skill-reader'].permission.read, 'deny');
  assert.match(combineSystem({}), /native subagents are enabled/);
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
  assert.equal(config.agent.build.tools.task, true);
  assert.deepEqual(
    Object.keys(config.agent).sort(),
    ['build', 'builder', 'explorer', 'mapper', 'researcher', 'reverser', 'reviewer', 'tester', 'tracer', 'plan', 'skill-reader'].sort()
  );
  assert.equal(config.agent.explorer.mode, 'subagent');
  assert.equal(config.agent.explorer.tools.task, false);
  assert.equal(config.agent.explorer.tools.write, false);
  assert.equal(config.agent.explorer.permission.task, 'deny');
  assert.equal(config.agent.explorer.permission.edit, 'deny');
  assert.equal(config.agent.explorer.permission.question, 'deny');
  assert.equal(config.agent.explorer.permission['yan_skills_*'], 'allow');
  assert.equal(config.agent.explorer.permission.external_directory, 'allow');
  // Cross-workspace work is unrestricted for the parent and for every child,
  // so a subagent can read/write a sibling copy of the project like the parent.
  for (const role of ['explorer', 'builder', 'mapper', 'researcher', 'reverser', 'reviewer', 'tester', 'tracer']) {
    assert.equal(config.agent[role].permission.external_directory, 'allow', `${role} must allow external directories`);
  }
  assert.equal(
    builderSessionPermissionForRun({ permissions: { allowFileWrite: true } })
      .find(rule => rule.permission === 'external_directory')?.action,
    'allow',
    'a native builder child session must allow external directories'
  );
  assert.match(config.agent.explorer.prompt, /High-throughput execution contract/);
  assert.match(config.agent.explorer.prompt, /batch independent read\/glob\/grep/);
  assert.match(config.agent.explorer.prompt, /yan_skills_read_skill/);
  assert.match(config.agent.explorer.prompt, /never return an empty result/);
  assert.equal(config.agent.explorer.permission.read['*'], 'allow');
  assert.equal(config.agent.explorer.permission.read[Object.keys(config.agent.explorer.permission.read)
    .find(pattern => pattern.endsWith('/lib/skills/*'))], 'deny');
  assert.equal(config.agent.researcher.permission.webfetch, 'allow');
  assert.equal(config.agent.tester.permission.bash['*'], 'deny');
  assert.equal(config.agent.tester.permission.bash['node --test*'], 'allow');
  assert.match(combineSystem(options), /native subagents are enabled/);
  assert.match(combineSystem(options), /small batches/);
  assert.match(combineSystem(options), /resume the same task_id/);
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
  assert.match(config.agent.explorer.prompt, /input_tokens_per_second value stated in the input-throughput instructions for the current turn/);
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

test('role selections are treated as turn focus while all built-in child agents remain available', () => {
  const options = {
    enableSubagents: true,
    subagentRoles: { explorer: false, reviewer: true, researcher: false, tester: true }
  };
  const config = buildOpenCodeConfig({ providerId: 'test', modelId: 'model', ...options });
  assert.deepEqual(Object.keys(config.agent).sort(), ['build', 'builder', 'explorer', 'mapper', 'researcher', 'reverser', 'reviewer', 'tester', 'tracer', 'plan', 'skill-reader'].sort());
  assert.equal(config.subagent_depth, 1);
  assert.equal(permissionRulesForRun(options).find(rule => rule.permission === 'task')?.action, 'ask');
  const disabled = buildOpenCodeConfig({
    providerId: 'test', modelId: 'model', enableSubagents: true,
    subagentRoles: { explorer: false, reviewer: false, researcher: false, tester: false }
  });
  assert.equal(disabled.subagent_depth, 1);
  assert.deepEqual(Object.keys(disabled.agent).sort(), ['build', 'builder', 'explorer', 'mapper', 'researcher', 'reverser', 'reviewer', 'tester', 'tracer', 'plan', 'skill-reader'].sort());
  assert.equal(permissionRulesForRun({ ...options, subagentRoles: { explorer: false, reviewer: false, researcher: false, tester: false } })
    .find(rule => rule.permission === 'task')?.action, 'ask');
});

test('no-workspace sessions preserve the guarded task permission', () => {
  const disabled = sessionPermissionForRun({ hasUserWorkspace: false });
  const enabled = sessionPermissionForRun({ hasUserWorkspace: false, enableSubagents: true });
  assert.equal(ruleFor(disabled, 'task')?.action, 'ask');
  assert.equal(ruleFor(enabled, 'task')?.action, 'ask');
});

test('parent task permission bounds occupied slots', () => {
  const run = { subagentPermissionCount: 0, subagentMaxChildren: 2 };
  assert.deepEqual(nextSubagentPermission(run), { granted: true, used: 1, limit: 2 });
  assert.deepEqual(nextSubagentPermission(run), { granted: true, used: 2, limit: 2 });
  assert.deepEqual(nextSubagentPermission(run), { granted: false, used: 2, limit: 2 });
  assert.equal(run.subagentPermissionCount, 2);
});

test('read-only capacity queues later waves and ignores repeated completion', async () => {
  const run = { subagentMaxChildren: 2, subagentPermissionCount: 0, subagentReadClaims: new Set(), subagentPermissionQueue: [] };
  const started = [];
  const start = id => {
    assert.equal(nextSubagentPermission(run).granted, true);
    run.subagentReadClaims.add(id);
    started.push(id);
  };
  start('a'); start('b');
  run.subagentPermissionQueue.push(() => start('c'), () => start('d'));
  await releaseReadSubagentSlot(run, 'a', 'running');
  assert.deepEqual(started, ['a', 'b']);
  await releaseReadSubagentSlot(run, 'a', 'completed');
  assert.deepEqual(started, ['a', 'b', 'c']);
  assert.equal(run.subagentPermissionCount, 2);
  await releaseReadSubagentSlot(run, 'a', 'completed');
  assert.equal(started.length, 3);
  await releaseReadSubagentSlot(run, 'b', 'error');
  assert.deepEqual(started, ['a', 'b', 'c', 'd']);
  await releaseReadSubagentSlot(run, 'c', 'completed');
  run.subagentPermissionQueue.push(() => start('e'));
  await releaseReadSubagentSlot(run, 'd', 'cancelled', { aborted: true });
  assert.equal(started.length, 4);
  assert.equal(run.subagentPermissionCount, 0);
});

test('mapper, tracer and reverser ship as independent tool-capable child agents', () => {
  const config = buildOpenCodeConfig({ providerId: 'test', modelId: 'model' });

  // Mapper: read-only structure reconnaissance with its own shell rules.
  assert.equal(config.agent.mapper.mode, 'subagent');
  assert.match(config.agent.mapper.description, /Mapper/);
  assert.equal(config.agent.mapper.tools.bash, true);
  assert.equal(config.agent.mapper.permission.bash['*'], 'deny');
  assert.equal(config.agent.mapper.permission.bash['node *'], 'allow');
  assert.equal(config.agent.mapper.permission.bash['git ls-files*'], 'allow');
  assert.equal(config.agent.mapper.permission.bash['npm test*'], undefined);
  assert.match(config.agent.mapper.prompt, /file:line evidence/);

  // Tracer: a superset of the mapper's reach plus focused dynamic probes.
  assert.equal(config.agent.tracer.permission.bash['node *'], 'allow');
  assert.equal(config.agent.tracer.permission.bash['node --test*'], 'allow');
  assert.equal(config.agent.tracer.permission.bash['npm test -- *'], 'allow');
  assert.equal(config.agent.tracer.permission.bash['git grep*'], 'allow');
  assert.match(config.agent.tracer.prompt, /quantify chain breadth/);

  // Reverser: a write-capable offline lab with its own shell rules.
  assert.equal(config.agent.reverser.tools.edit, true);
  assert.equal(config.agent.reverser.tools.write, true);
  assert.equal(config.agent.reverser.permission.edit, 'allow');
  assert.equal(config.agent.reverser.permission.bash['python *'], 'allow');
  assert.equal(config.agent.reverser.permission.bash['Format-Hex *'], 'allow');
  assert.equal(config.agent.reverser.permission.bash['npm test*'], undefined);
  assert.match(config.agent.reverser.prompt, /replayed every sample/);
  assert.match(config.agent.reverser.prompt, /Never modify project source files/);

  // All three keep the shared child-agent guards.
  for (const role of ['mapper', 'tracer', 'reverser']) {
    assert.equal(config.agent[role].permission.task, 'deny');
    assert.equal(config.agent[role].permission['yan_skills_*'], 'allow');
  }
});

test('reverser disables native edits but preserves script execution when file writes are disallowed', () => {
  const config = buildOpenCodeConfig({
    providerId: 'test',
    modelId: 'model',
    permissions: { allowFileWrite: false }
  });
  assert.equal(config.agent.reverser.tools.edit, false);
  assert.equal(config.agent.reverser.permission.edit, 'deny');
  assert.equal(config.agent.reverser.permission.write, 'deny');
  assert.equal(config.agent.reverser.permission.bash['python *'], 'allow');
});

test('analysis tools honor file-read permissions for parent and analyst children', () => {
  const config = buildOpenCodeConfig({ providerId: 'test', modelId: 'model', permissions: { allowFileRead: false } });
  assert.equal(config.permission['yan_analysis_*'], 'deny');
  for (const role of ['mapper', 'tracer', 'reverser']) {
    assert.equal(config.agent[role].permission['yan_analysis_*'], 'deny');
    assert.equal(config.agent[role].tools.bash, true);
  }
});

test('external directories are allowed in every access mode and without a workspace', () => {
  for (const accessMode of ['request', 'delegate', 'full']) {
    assert.equal(
      permissionForRun({ accessMode, permissions: { allowFileRead: true, allowFileWrite: true } }).external_directory,
      'allow',
      `${accessMode} must allow external directories`
    );
    for (const hasUserWorkspace of [true, false]) {
      const rules = sessionPermissionForRun({
        hasUserWorkspace,
        accessMode,
        permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true }
      });
      const external = rules.filter(rule => rule.permission === 'external_directory');
      assert.equal(external.length > 0, true, `${accessMode}/${hasUserWorkspace} must declare external_directory`);
      assert.equal(
        external.every(rule => rule.action === 'allow'),
        true,
        `${accessMode}/${hasUserWorkspace} must allow every external_directory rule`
      );
    }
  }
  // Bash is the escape hatch that made the old restriction feel arbitrary:
  // it must keep working across workspaces too.
  const rules = permissionRulesForRun({ hasUserWorkspace: true, accessMode: 'request', permissions: { allowFileRead: true } });
  assert.equal(rules.find(rule => rule.permission === 'bash' && rule.pattern === '*')?.action, 'ask');
});

test('child permission requests allow external directories like the parent', () => {
  assert.equal(builderPermissionRequestAllowed({ permission: 'external_directory' }, true), true);
  assert.equal(builderPermissionRequestAllowed({ permission: 'external_directory' }, false), true);
  assert.equal(builderPermissionRequestAllowed({ permission: 'read' }, true), true);
  // Write still follows the run's file-write permission, and shell stays bounded.
  assert.equal(builderPermissionRequestAllowed({ permission: 'edit' }, false), false);
  assert.equal(builderPermissionRequestAllowed({ permission: 'write' }, true), true);
  assert.equal(builderPermissionRequestAllowed({ permission: 'bash', patterns: ['rm -rf /'] }, true), false);
});

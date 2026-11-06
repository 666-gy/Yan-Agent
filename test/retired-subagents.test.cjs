'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenCodeConfig, combineSystem } = require('../lib/kernel-policy');
const { permissions } = require('../lib/kernel-v2/config');
const { createConfigStore } = require('../lib/main/config');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');

test('old settings cannot re-enable role configs, providers, permissions or prompt instructions', () => {
  const legacy = { enableSubagents: true, subagentMaxChildren: 128,
    subagentRoles: { builder: true }, subagentModels: { builder: { providerId: 'old', modelId: 'old' } },
    subagentConfigs: { builder: { model: 'old/model', provider: { old: { models: { model: {} } } } } } };
  const normalized = createConfigStore({}).normalizeAgentConfig(legacy);
  for (const key of ['enableSubagents', 'subagentMaxChildren', 'subagentRoles', 'subagentModels', 'subagentConfigs']) assert.equal(key in normalized, false);
  const config = buildOpenCodeConfig(legacy);
  assert.deepEqual(Object.keys(config.agent).sort(), ['build', 'plan', 'skill-reader']);
  assert.ok(!Object.keys(config.provider).some(id => id.startsWith('yan-subagent-')));
  for (const accessMode of ['request', 'delegate', 'full']) {
    assert.equal(permissions({ ...legacy, accessMode }).findLast(rule => rule.action === 'subagent').effect, 'deny');
  }
  assert.doesNotMatch(combineSystem(legacy), /Available roles:|Dispatch in small batches|yan-plan:|Sub Build Agent/);
});

test('direct child guidance is rejected for both ID spellings without sending any prompt', async () => {
  const prompts = [];
  const adapter = { runs: new Map([['run', { sessionID: 'parent' }]]), client: { session: { prompt: async input => prompts.push(input) } } };
  for (const key of ['childSessionId', 'childSessionID']) {
    const result = await OpenCodeV2Adapter.prototype.deliverInterjection.call(adapter, 'run', { [key]: 'child', guidance: 'change something' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'SUBAGENT_DIRECT_GUIDANCE_DISABLED');
    assert.match(result.error, /主代理转达/);
  }
  assert.deepEqual(prompts, []);
});

test('user guidance about a child still reaches only the main agent', async () => {
  const prompts = [];
  const run = { sessionID: 'parent', emit: () => {} };
  const adapter = { runs: new Map([['run', run]]), client: { session: { prompt: async input => prompts.push(input) } } };
  const result = await OpenCodeV2Adapter.prototype.deliverInterjection.call(adapter, 'run', { guidance: '请让子代理优先检查取消流程' });
  assert.equal(result.delivered, true);
  assert.equal(prompts.length, 1);
  assert.equal(prompts[0].sessionID, 'parent');
  assert.equal(prompts[0].delivery, 'steer');
  assert.match(prompts[0].text, /请让子代理优先检查取消流程/);
});

test('Harness no longer advertises delegation roles or injects their legacy entries', () => {
  const { ContinualHarnessStore, HARNESS_KINDS } = require('../lib/continual-harness');
  assert.ok(!HARNESS_KINDS.includes('subagent'));
  const context = ContinualHarnessStore.prototype.promptContext.call({ list: () => [
    { kind: 'subagent', id: 'old', scope: 'global', content: 'OLD_ROLE_SENTINEL', metadata: {} },
    { kind: 'prompt', id: 'current', scope: 'global', content: 'CURRENT_POLICY', metadata: {} }
  ] });
  assert.doesNotMatch(context, /OLD_ROLE_SENTINEL/);
  assert.match(context, /CURRENT_POLICY/);
});

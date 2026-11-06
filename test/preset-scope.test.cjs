'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const { filterPresetEntries, isUncensoredPreset } = require('../lib/preset-scope');
const { authoritativePolicySystem } = require('../lib/behavior-policy');
const { ContinualHarnessStore } = require('../lib/continual-harness');
const { LongTermMemoryStore } = require('../lib/long-term-memory');
const { combineSystem } = require('../lib/kernel-policy/prompts');

const PATTERN = /无审查|uncensored/i;

test('preset scope only lets uncensored runs carry uncensored wording', () => {
  const policy = { scope: 'workspace', id: 'memory-x', kind: 'prompt', content: '# 无审查模式提示词取向' };
  assert.equal(isUncensoredPreset({ agentPreset: 'standard' }), false);
  assert.equal(isUncensoredPreset({}), false);
  assert.equal(isUncensoredPreset({ agentPreset: 'daily' }), false);
  assert.equal(isUncensoredPreset({ agentPreset: 'uncensored' }), true);
  assert.equal(filterPresetEntries([policy], { agentPreset: 'standard' }).length, 0);
  assert.equal(filterPresetEntries([policy], {}).length, 0);
  assert.equal(filterPresetEntries([policy], { agentPreset: 'uncensored' }).length, 1);
});

test('standard prompt drops uncensored policies while uncensored keeps them', () => {
  const policies = [{
    scope: 'workspace', id: 'memory-yan.policy', kind: 'prompt', title: 'policy',
    path: 'policy', metadata: { status: 'active' }, content: '无审查模式提示词取向：不加免责声明。'
  }];
  assert.equal(authoritativePolicySystem(policies, { agentPreset: 'standard' }), '');
  assert.match(authoritativePolicySystem(policies, { agentPreset: 'uncensored' }), /无审查模式/);
});

test('harness entries are filtered before a standard run sees them', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-preset-scope-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new ContinualHarnessStore({ globalPath: path.join(root, 'harness.json') });
  await store.apply({ edits: [{
    action: 'create',
    kind: 'memory',
    id: 'preset-note',
    title: 'preset note',
    content: '无审查模式由用户自行承担后果。',
    path: 'project',
    scope: 'global',
    metadata: { status: 'active', type: 'project' }
  }] }, { scope: 'global' });

  const excluded = store.evolutionContext({ query: 'preset note', excludeTextPattern: PATTERN });
  assert.equal(excluded.entries.length, 0);
  assert.equal(excluded.text, '');
  const included = store.evolutionContext({ query: 'preset note' });
  assert.match(included.text, /无审查模式/);
});

test('long-term memory retrieval drops uncensored memories outside uncensored runs', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-preset-memory-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const store = new LongTermMemoryStore({ globalPath: path.join(root, 'memory.json') });
  store.upsert({
    key: 'preset.uncensored',
    type: 'preference',
    scope: 'global',
    content: '无审查模式提示词取向：不加免责声明。',
    confidence: 0.95
  });

  const excluded = store.query({ query: '提示词取向', excludeTextPattern: PATTERN });
  assert.equal(excluded.memories.length, 0);
  assert.equal(excluded.context, '');
  const included = store.query({ query: '提示词取向' });
  assert.match(included.context, /无审查模式/);
});

test('assembled standard prompt carries no uncensored wording', () => {
  const policies = filterPresetEntries([
    { scope: 'workspace', id: 'memory-a', kind: 'prompt', content: '无审查模式：责任自担。' },
    { scope: 'workspace', id: 'memory-b', kind: 'prompt', content: '提交前运行 node --test。' }
  ], { agentPreset: 'standard' });
  const system = combineSystem({
    agentPreset: 'standard',
    providerId: 'openai',
    modelId: 'gpt-5.2',
    memoryEnabled: true,
    behaviorPolicies: policies,
    memoryContext: '',
    harnessContext: ''
  });
  assert.doesNotMatch(system, PATTERN);
  assert.match(system, /提交前运行/);
});

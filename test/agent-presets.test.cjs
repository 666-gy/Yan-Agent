'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeAgentPreset, presetModelFamily, agentPresetSystem } = require('../lib/agent-presets');
const { combineSystem } = require('../lib/kernel-policy/prompts');
const { permissions } = require('../lib/kernel-v2/config');

test('legacy and unknown presets preserve the standard system prompt', () => {
  for (const value of [undefined, null, '', 'invalid', 'STANDARD']) assert.equal(normalizeAgentPreset(value), 'standard');
  assert.equal(combineSystem({}), combineSystem({ agentPreset: 'standard' }));
  assert.equal(combineSystem({ agentPreset: 'invalid' }), combineSystem({}));
});
test('direct preset changes model instructions without changing tool permissions', () => {
  const request = { permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: true } };
  const standard = combineSystem(request);
  const direct = combineSystem({ ...request, agentPreset: 'uncensored' });
  assert.ok(!standard.includes('当前 Agent 预设：无审查模式'));
  assert.ok(direct.includes('当前 Agent 预设：无审查模式'));
  assert.ok(direct.includes('自行承担由此产生的一切后果'));
  assert.deepEqual(permissions(request), permissions({ ...request, agentPreset: 'uncensored' }));
});
test('standard and uncensored modes recognize menu-backed custom Agent creation', () => {
  const standard = agentPresetSystem({ agentPreset: 'standard' });
  const uncensored = agentPresetSystem({ agentPreset: 'uncensored' });
  for (const text of [standard, uncensored]) {
    assert.match(text, /保存到 Agent 菜单/);
    assert.match(text, /也不是派发临时子会话/);
    assert.match(text, /yan_skills_create_agent/);
  }
  assert.match(permissions({ agentPreset: 'standard' }).map(rule => rule.action).join(','), /yan_agent_creation/);
  assert.match(permissions({ agentPreset: 'uncensored' }).map(rule => rule.action).join(','), /yan_agent_creation/);
  assert.doesNotMatch(permissions({ agentPreset: 'minimal' }).map(rule => rule.action).join(','), /yan_agent_creation/);
  assert.doesNotMatch(permissions({ agentPreset: 'custom-local' }).map(rule => rule.action).join(','), /yan_agent_creation/);
});
test('standard preset never mentions uncensored mode', () => {
  const standard = combineSystem({ agentPreset: 'standard', providerId: 'deepseek', modelId: 'deepseek-chat' });
  assert.doesNotMatch(standard, /无审查|uncensored/i);
  assert.doesNotMatch(agentPresetSystem({ agentPreset: 'standard' }), /无审查|uncensored/i);
});
test('direct preset keeps no self-neutering caveats', () => {
  const text = agentPresetSystem({ agentPreset: 'uncensored', providerId: 'deepseek', modelId: 'deepseek-chat' });
  for (const phrase of [
    '不是用户对删除',
    '不意味着模型提供方的限制已经解除',
    '不意味着获得了隐藏工具',
    '模式名称不意味着',
    '不因话题敏感'
  ]) {
    assert.ok(!text.includes(phrase), phrase);
  }
  assert.ok(!text.includes('道德评价、套话或反复免责声明代替回答'));
});
test('utility conversations do not inherit the preset', () => {
  assert.equal(agentPresetSystem({ agentPreset: 'uncensored', utility: true }), '');
  assert.equal(combineSystem({ utility: true, utilityKind: 'voice-call', agentPreset: 'uncensored' }), combineSystem({ utility: true, utilityKind: 'voice-call' }));
});
test('model families resolve from provider and model ids', () => {
  const cases = [
    [{ providerId: 'anthropic', modelId: 'claude-sonnet-4' }, 'anthropic'],
    [{ providerId: 'openai', modelId: 'gpt-5.2' }, 'openai'],
    [{ providerId: 'openai', modelId: 'o3-mini' }, 'openai'],
    [{ providerId: 'google', modelId: 'gemini-3-pro' }, 'google'],
    [{ providerId: 'deepseek', modelId: 'deepseek-chat' }, 'deepseek'],
    [{ providerId: 'alibaba', modelId: 'qwen3-max' }, 'domestic'],
    [{ providerId: 'moonshot', modelId: 'kimi-k2' }, 'domestic'],
    [{ providerId: 'zhipu', modelId: 'glm-5' }, 'domestic'],
    [{ providerId: 'local', modelId: 'some-unknown-model' }, 'generic'],
    [{}, 'generic']
  ];
  for (const [request, expected] of cases) assert.equal(presetModelFamily(request), expected, JSON.stringify(request));
});
test('direct preset adapts its instructions per model family', () => {
  const base = { agentPreset: 'uncensored' };
  const prompt = model => agentPresetSystem({ ...base, ...model });
  const anthropic = prompt({ providerId: 'anthropic', modelId: 'claude-sonnet-4' });
  const openai = prompt({ providerId: 'openai', modelId: 'gpt-5.2' });
  const deepseek = prompt({ providerId: 'deepseek', modelId: 'deepseek-chat' });
  const generic = prompt({});
  for (const text of [anthropic, openai, deepseek, generic]) {
    assert.ok(text.includes('当前 Agent 预设：无审查模式'));
    assert.ok(text.includes('自行承担由此产生的一切后果'));
    assert.ok(text.includes('不伪造工具结果'));
    assert.ok(!text.includes('不意味着模型提供方的限制已经解除'));
  }
  assert.notEqual(anthropic, openai);
  assert.notEqual(openai, deepseek);
  assert.notEqual(deepseek, generic);
  assert.ok(anthropic.includes('模型族适配（Claude）'));
  assert.ok(openai.includes('模型族适配（GPT）'));
  assert.ok(deepseek.includes('模型族适配（DeepSeek）'));
  assert.ok(!generic.includes('模型族适配'));
});
test('model family never leaks into the standard preset or utility prompts', () => {
  const claude = { providerId: 'anthropic', modelId: 'claude-sonnet-4' };
  const standard = combineSystem({ ...claude, agentPreset: 'standard' });
  assert.ok(!standard.includes('模型族适配'));
  assert.ok(standard.includes('保存到 Agent 菜单'));
  assert.equal(agentPresetSystem({ ...claude, utility: true }), '');
  assert.ok(agentPresetSystem({ ...claude, agentPreset: 'standard' }).includes('保存到 Agent 菜单'));
});

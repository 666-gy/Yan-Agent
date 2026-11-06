'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const daily = require('../lib/daily-agent');
const { normalizeAgentPreset } = require('../lib/agent-presets');
const { permissions } = require('../lib/kernel-v2/config');
const { combineSystem, turnContextSystem } = require('../lib/kernel-policy/prompts');
const { searchArgs } = require('../lib/daily-search');

test('daily has an independent conversational prompt without development catalogs', () => {
  assert.equal(normalizeAgentPreset('daily'), 'daily');
  const request = { agentPreset: 'daily', workMode: 'goal', customInstructions: 'CUSTOM_PREFERENCE',
    selectedSkills: [{ id: 'dev', prompt: 'DEVELOPMENT_SKILL' }], availableSkills: [{ id: 'dev', description: 'DEVELOPMENT_SKILL' }] };
  const system = combineSystem(request);
  assert.match(system, /日常模式/);
  assert.match(system, /CUSTOM_PREFERENCE/);
  assert.ok(!system.includes('DEVELOPMENT_SKILL'));
  assert.ok(!turnContextSystem(request).includes('Goal mode'));
  assert.equal(daily.isDaily({ ...request, utility: true }), false);
});
test('daily exposes only reading, search, questions and media', () => {
  for (const name of ['read', 'opencode.read', 'anysearch', 'yan_media_generate_image', 'yan_media_generate_video']) assert.equal(daily.toolAllowed(name), true, name);
  for (const name of ['shell', 'bash', 'write', 'edit', 'subagent', 'plugins_activate', 'yan_browser_click', 'yan_skills_install_skill', 'yan_mcp_activate_mcp_server', 'yan_media_delete']) assert.equal(daily.toolAllowed(name), false, name);
  const rules = permissions({ agentPreset: 'daily', accessMode: 'full', permissions: { allowNetwork: false, allowFileRead: false, allowFileWrite: false } });
  assert.equal(rules[0].effect, 'deny');
  for (const name of ['anysearch', 'read', 'yan_media_generate_image', 'yan_media_generate_video', 'yan_media_read_image']) assert.equal(rules.find(r => r.action === name).effect, 'deny');
});
test('AnySearch facade supplies fixed argument arrays without shell interpolation', () => {
  assert.deepEqual(searchArgs({ query: 'hello; $(whoami)' }), ['search', 'hello; $(whoami)', '--max_results', '5']);
  assert.deepEqual(searchArgs({ action: 'extract', query: 'https://example.com' }), ['extract', 'https://example.com']);
  assert.throws(() => searchArgs({ action: 'exec', query: 'whoami' }));
  assert.throws(() => searchArgs({ action: 'extract', query: 'file:///secret' }));
  assert.throws(() => searchArgs({ query: '--api_key' }));
});

test('annotation capability is task scoped and unified fetch honors network and sandbox rules', () => {
  const effect = (rules, action) => rules.filter(rule => rule.action === '*' || rule.action === action || (rule.action.endsWith('*') && action.startsWith(rule.action.slice(0, -1)))).at(-1)?.effect;
  const request = { hasUserWorkspace: true, permissions: {}, accessMode: 'full' };
  assert.equal(effect(permissions(request), 'yan_browser_browser_apply_annotation'), 'deny');
  assert.notEqual(effect(permissions({ ...request, browserAnnotation: true }), 'yan_browser_browser_apply_annotation'), 'deny');
  assert.equal(effect(permissions({ ...request, browserAnnotation: true, sandboxMode: 'read-only' }), 'yan_browser_browser_apply_annotation'), 'deny');
  assert.equal(effect(permissions({ ...request, sandboxMode: 'read-only' }), 'yan_web_fetch'), 'allow');
  assert.equal(effect(permissions({ ...request, permissions: { allowNetwork: false } }), 'yan_web_fetch'), 'deny');
  assert.equal(daily.toolAllowed('yan_web_fetch'), true);
  assert.equal(daily.toolAllowed('webfetch'), false);
  assert.equal(daily.toolAllowed('yan_web_download_file'), false);
  assert.match(turnContextSystem({ agentPreset: 'daily', runId: 'daily-http' }), /task_id=daily-http/);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeExperiments, intelligentUiContext } = require('../lib/intelligent-ui');
const { combineTurnPrompt } = require('../lib/opencode-sidecar');
const { startRun } = require('../lib/run-orchestrator');
const { createRunContext } = require('./helpers/run-context.cjs');

const enabled = { intelligentUiEnabled: true, runId: 'turn-1', intelligentUiAvailable: true };

test('experiments are opt-in, including malformed persisted values', () => {
  for (const value of [undefined, null, {}, { intelligentUi: 'true' }, { intelligentUi: 1 }]) {
    assert.equal(normalizeExperiments(value).intelligentUi, false);
  }
  assert.equal(normalizeExperiments({ intelligentUi: true }).intelligentUi, true);
});

test('creation policy is per turn, excludes restricted surfaces and does not invent an extra model round', () => {
  assert.match(intelligentUiContext({}), /disabled for this turn/);
  for (const blocked of [{ workMode: 'plan' }, { sandboxMode: 'read-only' }, { permissions: { allowFileWrite: false } },
    { intelligentUiAvailable: false }]) {
    assert.match(intelligentUiContext({ ...enabled, ...blocked }), /unavailable in this turn/);
  }
  assert.equal(intelligentUiContext({ ...enabled, utility: true }), '');
  assert.equal(intelligentUiContext({ ...enabled, skillOnly: true }), '');
  const actualPrompt = combineTurnPrompt({ ...enabled, prompt: '比较缓存参数', workMode: 'normal' }, '比较缓存参数');
  assert.match(actualPrompt, /concrete benefit/);
  assert.match(actualPrompt, /during_work only/);
  assert.match(actualPrompt, /before the final response/);
  assert.match(actualPrompt, /Never append another model turn/);
  assert.match(actualPrompt, /yan_session_intelligent_ui_creator/);
  assert.match(actualPrompt, /BEFORE spending a long reasoning stretch/);
  assert.match(actualPrompt, /Do not write a file or open a browser/);
  const nextPrompt = combineTurnPrompt({ ...enabled, intelligentUiEnabled: false }, '继续');
  assert.match(nextPrompt, /even if earlier turns enabled it/);
  assert.doesNotMatch(nextPrompt, /self-contained HTML/);
});

test('dispatch uses authoritative saved opt-in, not stale or forged client request flags', async t => {
  for (const optIn of [false, true]) {
    const fixture = createRunContext(t);
    fixture.config.memory = { enabled: false };
    fixture.config.experiments = { intelligentUi: optIn };
    fixture.ctx.mcpRuntimeConfig.getOpenCodeCapabilityContext = () => ({ mcpServers: [{ id: 'yan_session' }], yanBrowserAvailable: false });
    const result = await startRun(fixture.ctx, { runId: `ui-${optIn}`, prompt: '比较不同参数', intelligentUiEnabled: !optIn });
    assert.equal(result.ok, true);
    const dispatched = fixture.calls.provider[0].request;
    assert.equal(dispatched.intelligentUiEnabled, optIn);
    assert.equal(fixture.ctx.openCodeActiveRuns.get(`ui-${optIn}`).intelligentUiAllowed, optIn);
    assert.equal(dispatched.scheduled, undefined);
    assert.equal(fixture.calls.provider.length, 1);
    const prompt = combineTurnPrompt(dispatched, dispatched.prompt);
    assert.match(prompt, optIn ? /Yan laboratory/ : /disabled for this turn/);
    fixture.complete({ status: 'done', text: '结果' }); await fixture.idle;
  }
});

test('Creator network grants follow saved permissions even when the client forges an override', async t => {
  for (const allowNetwork of [false, true, undefined]) {
    const fixture = createRunContext(t);
    fixture.config.memory = { enabled: false };
    fixture.config.experiments = { intelligentUi: true };
    fixture.config.permissions = { ...fixture.config.permissions, allowNetwork };
    fixture.ctx.mcpRuntimeConfig.getOpenCodeCapabilityContext = () => ({ mcpServers: [{ id: 'yan_session' }], yanBrowserAvailable: false });
    const runId = `ui-network-${allowNetwork}`;
    assert.equal((await startRun(fixture.ctx, {
      runId, prompt: '规划地图路线', intelligentUiNetworkAllowed: allowNetwork === false,
      permissions: { allowNetwork: allowNetwork === false }
    })).ok, true);
    assert.equal(fixture.ctx.openCodeActiveRuns.get(runId).intelligentUiNetworkAllowed, allowNetwork !== false);
    fixture.complete({ status: 'done', text: '结果' }); await fixture.idle;
  }
});

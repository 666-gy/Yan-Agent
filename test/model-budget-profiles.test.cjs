'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const budgets = require('../lib/model-budget-profiles');
const { decorateModel } = require('../lib/model-capabilities');
const { applyConnectionModelFlags } = require('../lib/connection-presets');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const { resolveModelContextSettings } = require('../lib/context-settings');

test('DeepSeek aliases, namespaces and case use exact official token counts', () => {
  for (const id of ['DeepSeek-v4.1-flash', 'deepseek-flash', 'deepseek-v4.1-flash',
    'ds-v4.1-flash', 'deepseek-ai/DeepSeek-V4.1-Flash', ' DEEPSEEK_V4.1_FLASH ']) {
    assert.deepEqual(budgets.automaticModelBudget(id), {
      contextWindow: 1_048_576, compactionThreshold: 838_860, maxOutputTokens: 393_216
    }, id);
  }
});

test('unknown, old, media, future and unlisted dated variants are not guessed', () => {
  for (const id of ['deepseek-v3.2', 'deepseek-v4.2-flash', 'gpt-7', 'gpt-5.5',
    'gemini-3.8-flash-image', 'qwen3.8-max-2027-01-01', 'my-gpt-6-sol', '', null]) {
    assert.equal(budgets.lookupModelBudget(id), null, String(id));
  }
  const media = decorateModel('conn-custom', { id: 'gpt-6-sol', modelType: 'image' });
  assert.equal(media.capabilities.contextWindow, undefined);
});

test('official decimal and binary limits stay distinct across vendors', () => {
  assert.equal(budgets.lookupModelBudget('gpt-6.1-sol').maxOutputTokens, 128_000);
  assert.equal(budgets.lookupModelBudget('Qwen/qwen3.8-max-0902').maxOutputTokens, 131_072);
  assert.equal(budgets.lookupModelBudget('google/gemini-3.8-flash').contextWindow, 1_048_576);
  assert.equal(budgets.lookupModelBudget('anthropic.claude-opus-5-5').maxOutputTokens, 128_000);
  assert.equal(budgets.lookupModelBudget('kimi-k3').maxOutputTokens, 1_048_576);
  assert.equal(budgets.lookupModelBudget('grok-4.7').outputConstraint, 'context');
});

test('automatic budgets reach runtime without requiring manual flags', () => {
  const model = decorateModel('conn-relay', { id: 'ds-v4.1-flash' });
  assert.equal(model.capabilities.userMaxOutputTokens, undefined);
  const config = buildOpenCodeConfig({ providerId: 'relay', modelId: model.id, capabilities: model.capabilities });
  assert.deepEqual(config.provider.relay.models[model.id].limit,
    { context: 1_048_576, input: 1_048_576, output: 393_216 });
  assert.equal(config.compaction.threshold, 838_860);
  const direct = buildOpenCodeConfig({ providerId: 'relay', modelId: 'gemini-3.8-flash' });
  assert.equal(direct.provider.relay.models['gemini-3.8-flash'].limit.output, 65_536);
  assert.equal(direct.provider.relay.models['gemini-3.8-flash'].limit.context, 1_048_576);
});

test('manual flags survive repeated decoration and recalculate automatic compaction', () => {
  const id = 'deepseek-flash';
  const original = decorateModel('conn-relay', { id });
  const [model] = applyConnectionModelFlags({ [id]: { contextWindow: 200_000, maxOutputTokens: 70_000 } }, [original]);
  const repeated = decorateModel('conn-relay', model);
  assert.equal(repeated.capabilities.compactionThreshold, 160_000);
  const config = buildOpenCodeConfig({ providerId: 'relay', modelId: id,
    contextWindow: model.contextWindow, compactionThreshold: model.compactionThreshold, capabilities: repeated.capabilities });
  assert.equal(config.provider.relay.models[id].limit.output, 70_000);
  assert.equal(config.compaction.threshold, 160_000);
  assert.equal(config.provider.relay.models[id].limit.context, 200_000);
  assert.equal(original.capabilities.contextWindow, 1_048_576);
  const [explicit] = applyConnectionModelFlags({ [id]: { contextWindow: 200_000, compactionThreshold: 120_000 } }, [original]);
  assert.equal(explicit.compactionThreshold, 120_000);
});

test('catalog declarations and unknown-model fallback are preserved', () => {
  const model = decorateModel('relay', { id: 'gpt-6-sol', contextWindow: 300_000,
    capabilities: { maxOutputTokens: 40_000 } });
  assert.equal(model.capabilities.contextWindow, 300_000);
  assert.equal(model.capabilities.compactionThreshold, 240_000);
  assert.equal(model.capabilities.maxOutputTokens, 40_000);
  assert.deepEqual(resolveModelContextSettings({}), { maxTokens: 128_000, compactionThreshold: 102_400, source: 'fallback' });
  assert.equal(resolveModelContextSettings({ capabilities: { contextWindow: 300_000, compactionThreshold: 150_000 } }).compactionThreshold, 150_000);
  const config = buildOpenCodeConfig({ providerId: 'relay', modelId: 'unknown-model' });
  assert.equal(config.provider.relay.models['unknown-model'].limit.output, 32_768);
  const partial = buildOpenCodeConfig({ providerId: 'relay', modelId: 'minimax-m3.1-flash-preview' });
  assert.equal(partial.provider.relay.models['minimax-m3.1-flash-preview'].limit.context, 1_000_000);
  assert.equal(partial.provider.relay.models['minimax-m3.1-flash-preview'].limit.output, 32_768);
  assert.equal(budgets.lookupModelBudget('minimax-m3.1-flash-preview').maxOutputTokens, null);
});

test('renderer fills automatic values without persisting them as manual overrides', () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/connection-dialog.js'), 'utf8');
  const functions = source.slice(source.indexOf('function connectionKInputValue'), source.indexOf('function renderConnectionModels'));
  const sandbox = { window: { YanModelBudgetProfiles: budgets }, connectionModelFlags: {},
    CONNECTION_MODEL_CAP_ORDER: [], connectionModelCapState: () => 'unknown',
    connectionModelType: (_entry, type) => type, connectionModelEnabled: () => true,
    connectionModelBaseType: () => 'text', escapeAttr: String, escapeHtml: String };
  vm.createContext(sandbox);
  vm.runInContext(functions, sandbox);
  const html = sandbox.connectionModelRowMarkup({ id: 'deepseek-flash' });
  assert.match(html, /value="1048.576"/);
  assert.match(html, /value="838.86"/);
  assert.match(html, /value="393.216"/);
  assert.match(html, /data-budget-mode="auto"/);
  assert.equal(JSON.stringify(sandbox.collectConnectionModelFlags()), '{}');
  sandbox.connectionModelFlags['deepseek-flash'] = { contextWindow: 200_000 };
  const overridden = sandbox.connectionModelRowMarkup({ id: 'deepseek-flash' });
  assert.match(overridden, /value="200"/);
  assert.match(overridden, /value="160"/);
  delete sandbox.connectionModelFlags['deepseek-flash'].contextWindow;
  assert.match(sandbox.connectionModelRowMarkup({ id: 'deepseek-flash' }), /value="1048.576"/);
});

test('browser and Node load the same maintained table', () => {
  const sandbox = {};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../lib/model-budget-profiles.js'), 'utf8'), sandbox);
  assert.equal(JSON.stringify(sandbox.YanModelBudgetProfiles.PROFILES), JSON.stringify(budgets.PROFILES));
  const html = fs.readFileSync(path.join(__dirname, '../renderer/index.html'), 'utf8');
  assert.ok(html.indexOf('model-budget-profiles.js') < html.indexOf('<script src="connection-dialog.js"'));
});

test('Kimi full-window output budget reserves space for the actual prompt', async () => {
  const { shapeKimiRequestBody } = await import('../lib/kimi-request-shaping.mjs');
  const body = { model: 'kimi-k3', max_tokens: 1_048_575, messages: [{ role: 'user', content: '你好' }] };
  const short = shapeKimiRequestBody(body);
  const longer = shapeKimiRequestBody({ ...body, messages: [{ role: 'user', content: '你好'.repeat(1000) }] });
  assert.ok(short.max_tokens < body.max_tokens);
  assert.ok(longer.max_tokens < short.max_tokens);
  assert.equal(shapeKimiRequestBody({ ...body, max_tokens: 1024 }).max_tokens, 1024);
  assert.equal(body.max_tokens, 1_048_575);
});

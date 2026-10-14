'use strict';

// Vendor adapter routing: the execution side must pick the request shape from
// the model the user selected, so a relay that fronts several vendors switches
// adapters per model instead of per connection.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { resolveProviderAdapter } = require('../lib/provider-adapter-routing');
const { resolveConnectionPreset } = require('../lib/connection-presets');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');

const FLAG_BY_PRESET = Object.freeze({ deepseek: 'dsml', glm: 'glmm', qwen: 'qwem', kimi: 'kiml',
  gptl: 'gptl', agnes: 'agnl', gemini: 'geml', grok: 'grol', anthropic: 'antl' });

// Mirrors lib/main/mcp-runtime-config.js: the preset resolved for the selected
// model becomes the explicit flag handed to the kernel config.
function optionsFor(connection, name, base, model) {
  const preset = resolveConnectionPreset(connection, name, base, model);
  const flag = FLAG_BY_PRESET[preset];
  return flag ? { [flag]: true } : {};
}

const RELAY = Object.freeze({ preset: 'auto', apiFormat: 'auto' });
const RELAY_NAME = '云雾API';
const RELAY_URL = 'https://yunwu.ai/v1';
const relayOptions = model => optionsFor(RELAY, RELAY_NAME, RELAY_URL, model);
const relayAdapter = model => resolveProviderAdapter({ apiFormat: 'auto', ...relayOptions(model) },
  { providerID: 'conn-1', providerName: RELAY_NAME, modelID: model, baseURL: RELAY_URL });

test('a multi-vendor relay switches adapter with the selected model', () => {
  assert.equal(relayAdapter('glm-4.6'), 'glm');
  assert.equal(relayAdapter('deepseek-chat'), 'deepseek');
  assert.equal(relayAdapter('qwen3-max'), 'qwen');
  assert.equal(relayAdapter('kimi-k2-0905-preview'), 'kimi');
  assert.equal(relayAdapter('grok-4'), 'grok');
  assert.equal(relayAdapter('gemini-2.5-pro'), 'gemini');
  assert.equal(relayAdapter('agnes-v2'), 'agnes');
});

test('a model without a dedicated adapter keeps the generic shape', () => {
  // Both of these would have been mis-routed to the connection's vendor if the
  // connection name were allowed to decide.
  const named = model => resolveProviderAdapter({ apiFormat: 'auto', ...optionsFor(RELAY, 'DeepSeek 中转', 'https://api.deepseek.com/v1', model) },
    { providerID: 'conn-1', providerName: 'DeepSeek 中转', modelID: model, baseURL: 'https://api.deepseek.com/v1' });
  // A Claude model still resolves by name even though the connection is a
  // DeepSeek relay: the model decides the adapter, never the connection.
  assert.equal(named('claude-sonnet-5'), 'anthropic');
  assert.equal(named('gpt-5'), '');
  assert.equal(named('glm-4.6'), 'glm');
});

test('an explicit preset still beats the model alias', () => {
  const explicit = optionsFor({ preset: 'kimi', apiFormat: 'auto' }, RELAY_NAME, RELAY_URL, 'glm-4.6');
  assert.deepEqual(explicit, { kiml: true });
  assert.equal(resolveProviderAdapter({ apiFormat: 'auto', ...explicit },
    { providerID: 'conn-1', providerName: RELAY_NAME, modelID: 'glm-4.6', baseURL: RELAY_URL }), 'kimi');
});

test('the kernel config loads the adapter module the model asks for', () => {
  const cases = [
    ['glm-4.6', 'opencode-glmm-provider.mjs'],
    ['deepseek-chat', 'opencode-dsml-provider.mjs'],
    ['qwen3-max', 'opencode-qwem-provider.mjs'],
    ['kimi-k2-0905-preview', 'opencode-kiml-provider.mjs'],
    ['grok-4', 'opencode-grol-provider.mjs'],
    ['gemini-2.5-pro', 'opencode-geml-provider.mjs'],
    ['agnes-v2', 'opencode-agnl-provider.mjs']
  ];
  for (const [model, expectedModule] of cases) {
    const built = buildOpenCodeConfig({
      providerId: 'conn-1',
      providerName: RELAY_NAME,
      modelId: model,
      apiKey: 'test',
      baseUrl: RELAY_URL,
      apiFormat: 'openai',
      mcpServers: [],
      enableSubagents: false,
      ...relayOptions(model)
    });
    const entry = built.provider['conn-1'];
    assert.equal(path.basename(String(entry.npm)), expectedModule, `model ${model} must load ${expectedModule}`);
  }
});

test('without a selected model the connection name still decides (unchanged)', () => {
  assert.equal(resolveProviderAdapter({ apiFormat: 'auto' },
    { providerID: 'conn-1', providerName: '智谱 GLM', modelID: '', baseURL: 'https://open.bigmodel.cn/api/paas/v4' }), 'glm');
});

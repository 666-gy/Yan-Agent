const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const { normalizeSubagentModels } = require('../lib/subagent');
const { createMcpRuntimeConfig } = require('../lib/main/mcp-runtime-config');

test('child models preserve independent credentials, adapters and model IDs containing slashes', () => {
  const child = buildOpenCodeConfig({ providerId: 'relay', modelId: 'vendor/cheap', apiKey: 'child-key',
    baseUrl: 'https://child.invalid/v1', apiFormat: 'anthropic' });
  const config = buildOpenCodeConfig({ providerId: 'relay', modelId: 'expensive', apiKey: 'parent-key',
    baseUrl: 'https://parent.invalid/v1', subagentConfigs: { explorer: child } });
  assert.equal(config.model, 'relay/expensive');
  assert.equal(config.agent.explorer.model, 'yan-subagent-explorer/vendor/cheap');
  assert.equal(config.agent.reviewer.model, undefined);
  assert.equal(config.provider.relay.options.apiKey, 'parent-key');
  assert.equal(config.provider['yan-subagent-explorer'].options.apiKey, 'child-key');
  assert.match(config.provider['yan-subagent-explorer'].npm, /antl/);
  assert.equal(config.provider['yan-subagent-explorer'].models['vendor/cheap'].id, 'vendor/cheap');
});

test('model bindings normalize only built-in roles and allow clearing a binding', () => {
  assert.deepEqual(normalizeSubagentModels({ explorer: null, reviewer: { providerId: ' p ', modelId: ' m ', supplierId: ' s ', apiKey: 'secret' },
    unknown: { providerId: 'p', modelId: 'm' }, tester: { providerId: 'p' } }), {
    reviewer: { providerId: 'p', supplierId: 's', modelId: 'm' }
  });
});

test('runtime resolves enabled child models and falls back when model or connection is unavailable', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-child-models-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const selection = { providerId: 'parent', supplierId: 's', modelId: 'expensive' };
  const connections = ['parent', 'child'].map(providerId => ({ providerId, supplierId: 's', modelFlags: {} }));
  let enabled = connections;
  const cfg = { api: { provider: 'parent', connections }, agent: { enableSubagents: true, subagentModels: {
    explorer: { providerId: 'child', supplierId: 's', modelId: 'cheap' },
    reviewer: { providerId: 'child', supplierId: 's', modelId: 'missing' }
  } } };
  const runtime = createMcpRuntimeConfig({ appRoot: path.resolve(__dirname, '..'), dataDir,
    MODEL_PROVIDERS: { parent: { name: 'Parent' }, child: { name: 'Child' } },
    modelState: { normalizeAgentModelSelection: () => selection },
    providerConfig: {
      getEnabledConnections: () => enabled,
      getRoleSupplierId: () => 's', getProviderSupplier: () => ({ id: 's' }), isConfiguredSupplier: () => true,
      getProviderConnectionForSupplier: (_cfg, id) => ({ apiKey: id + '-key', baseUrl: 'https://' + id + '.invalid/v1' }),
      getProviderModels: (_cfg, id) => [{ id: id === 'parent' ? 'expensive' : 'cheap', modelType: 'text' }],
      providerAdapterPreset: () => 'openai'
    }, mcpServerBuilders: {}, mcpDefaults: {}, DEFAULT_INPUT_TOKENS_PER_SECOND: 1000,
    normalizeInputTokensPerSecond: value => Number(value) || 1000
  });
  const build = () => runtime.getOpenCodeRuntimeConfig(cfg, { mcpServers: [] });
  const configured = build();
  assert.equal(configured.agent.explorer.model, 'yan-subagent-explorer/cheap');
  assert.equal(configured.agent.reviewer.model, undefined);
  assert.equal(configured.provider['yan-subagent-explorer'].options.apiKey, 'child-key');
  connections[1].modelFlags.cheap = { enabled: false };
  assert.equal(build().agent.explorer.model, undefined);
  connections[1].modelFlags.cheap = {};
  enabled = [connections[0]];
  assert.equal(build().agent.explorer.model, undefined);
  enabled = [];
  assert.equal(build().agent.explorer.model, undefined);
});

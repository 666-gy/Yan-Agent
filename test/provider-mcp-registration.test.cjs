'use strict';

const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const { createMcpServers } = require('../lib/main/mcp-servers');
const { createMcpRuntimeConfig } = require('../lib/main/mcp-runtime-config');
const { deferredServers, connectionName, toolNames } = require('../lib/kernel-v2/mcp-capabilities');

function buildBuilders(providerBridgePort) {
  return createMcpServers({
    dataDir: path.join(os.tmpdir(), 'yan-provider-registration'),
    providerConfig: {
      getConfiguredMediaModels: () => [],
      getProviderConnectionForSupplier: () => ({}),
      providerAdapterPreset: () => 'openai',
      getChildReadableAppRoot: () => appRoot
    },
    visionRelay: { getVisionRelayModels: () => [] },
    generatedMedia: { mediaWorkspaceRegistryPath: '' },
    skillsDir: path.join(os.tmpdir(), 'yan-provider-registration', 'skills'),
    configPath: path.join(os.tmpdir(), 'yan-provider-registration', 'config.json'),
    browserAgentBridgeToken: 'browser-token',
    getBrowserAgentBridgePort: () => 0,
    sessionAgentBridgeToken: 'session-token',
    getSessionAgentBridgePort: () => 0,
    providerBridgeToken: 'provider-token',
    getProviderBridgePort: () => providerBridgePort,
    continualHarnessPath: path.join(os.tmpdir(), 'yan-provider-registration', 'harness.json'),
    DEFAULT_INPUT_TOKENS_PER_SECOND: 10000,
    normalizeInputTokensPerSecond: value => value
  });
}

test('the provider MCP server is registered for every run with the bridge credentials', () => {
  const builders = buildBuilders(45678);
  const server = builders.buildYanProviderMcpServer({ permissions: { allowNetwork: true } }, appRoot);

  assert.equal(server.id, 'yan_provider');
  assert.equal(server.builtin, true);
  assert.equal(server.systemManaged, true);
  assert.equal(server.enabled, true);
  assert.deepEqual(server.args, [path.join(appRoot, 'lib', 'yan-provider-mcp.js')]);
  assert.equal(server.env.YAN_PROVIDER_BRIDGE_PORT, '45678');
  assert.equal(server.env.YAN_PROVIDER_BRIDGE_TOKEN, 'provider-token');
  assert.equal(server.env.YAN_PROVIDER_ALLOW_NETWORK, 'true');

  const denied = builders.buildYanProviderMcpServer({ permissions: { allowNetwork: false } }, appRoot);
  assert.equal(denied.env.YAN_PROVIDER_ALLOW_NETWORK, 'false');
});

test('the provider server is absent until its bridge is listening', () => {
  const builders = buildBuilders(0);
  assert.equal(builders.buildYanProviderMcpServer({ permissions: {} }, appRoot), null);
});

test('getOpenCodeMcpServers exposes yan_provider alongside the other built-ins', () => {
  const builders = buildBuilders(45678);
  const runtimeConfig = createMcpRuntimeConfig({
    providerConfig: { getChildReadableAppRoot: () => appRoot },
    MODEL_PROVIDERS: {},
    dataDir: path.join(os.tmpdir(), 'yan-provider-registration'),
    appRoot,
    mcpServers: new Map(),
    configStore: { loadConfig: () => ({}) },
    modelState: { normalizeAgentModelSelection: () => ({}) },
    skillsDir: path.join(os.tmpdir(), 'yan-provider-registration', 'skills'),
    getMergedSkills: () => [],
    mcpServerBuilders: builders,
    DEFAULT_INPUT_TOKENS_PER_SECOND: 10000,
    normalizeInputTokensPerSecond: value => value
  });

  const servers = runtimeConfig.getOpenCodeMcpServers({ mcpServers: [], permissions: {} }, { workspace: '', workMode: 'normal' });
  const provider = servers.find(server => server.id === 'yan_provider');
  assert.ok(provider, 'yan_provider is missing from the per-run MCP list');
  assert.equal(provider.taskEnabled, true);
  assert.equal(provider.builtin, true);
  assert.ok(servers.some(server => server.id === 'yan_skills'));

  // The kernel defers exactly these bundled entrypoints; yan_provider must be
  // among them or it would start at kernel boot instead of on demand.
  const deferred = deferredServers({ mcp: { servers: { yan_provider: {
    type: 'local',
    command: [process.execPath, path.join(appRoot, 'lib', 'yan-provider-mcp.js')]
  } } } });
  assert.deepEqual(Object.keys(deferred), ['yan_provider']);
  assert.equal(connectionName('yan_provider'), 'yan_provider_connect');
  assert.ok(toolNames('yan_provider').includes('yan_provider_configure_provider'));
});

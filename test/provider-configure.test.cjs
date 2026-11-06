'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const { createRuntimeDefaults } = require('../lib/main/runtime-defaults');
const { createProviderConfig } = require('../lib/main/provider-config');
const { createModelState } = require('../lib/main/model-state');
const { registerProviderIpc } = require('../lib/main/provider-ipc');
const { buildSelectableModelCatalog } = require('../lib/provider-model-catalog');
const { decorateModels } = require('../lib/model-capabilities');
const { getModelType } = require('../lib/model-roles');
const { normalizeRemoteModels } = require('../lib/model-catalog');
const { resolveConnectionPreset, resolveConnectionApiFormat } = require('../lib/connection-presets');

function createHarness() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-provider-configure-'));
  const {
    MODEL_PROVIDERS,
    STATIC_PROVIDER_SUPPLEMENTAL_MODELS,
    DEFAULT_MODEL_ROLES,
    EMPTY_MEDIA_CAPABILITIES,
    PROVIDER_MEDIA_CAPABILITIES,
    PROVIDER_MEDIA_ADAPTERS
  } = createRuntimeDefaults({ dataDir });

  let cfg = {
    api: {
      provider: '',
      baseUrl: '',
      apiKey: '',
      apiKeys: {},
      providerConfigs: {},
      providerSuppliers: {},
      providerActiveSupplierIds: {},
      model: '',
      connections: [],
      enabledConnections: [],
      connectionsMigrated: true
    },
    media: {},
    agentModel: { providerId: '', supplierId: '', modelId: '', name: '', capabilities: {} },
    providerModels: {},
    models: [],
    customModel: null,
    customProviders: []
  };

  const configStore = {
    loadConfig: () => cfg,
    saveConfig: next => { cfg = next; },
    publicConfig: value => value
  };

  let modelState;
  const providerConfig = createProviderConfig({
    MODEL_PROVIDERS,
    STATIC_PROVIDER_SUPPLEMENTAL_MODELS,
    DEFAULT_MODEL_ROLES,
    appRoot,
    normalizeRemoteModels,
    buildSelectableModelCatalog,
    decorateModels,
    getModelType,
    resolveConnectionPreset,
    resolveConnectionApiFormat,
    updateImageGenerationConfig: (...args) => modelState.updateImageGenerationConfig(...args)
  });
  modelState = createModelState({
    MODEL_PROVIDERS,
    providerConfig,
    configStore,
    getMainWindow: () => null
  });

  const providerIpc = registerProviderIpc(
    { ipcMain: { handle() {} } },
    {
      MODEL_PROVIDERS,
      providerConfig,
      configStore,
      modelState,
      EMPTY_MEDIA_CAPABILITIES,
      PROVIDER_MEDIA_CAPABILITIES,
      PROVIDER_MEDIA_ADAPTERS,
      STATIC_PROVIDER_SUPPLEMENTAL_MODELS
    }
  );

  return {
    dataDir,
    providerIpc,
    providerConfig,
    getConfig: () => cfg,
    dispose: () => fs.rmSync(dataDir, { recursive: true, force: true })
  };
}

async function startCatalogServer(models) {
  const server = http.createServer((req, res) => {
    if (req.url === '/v1/models' || req.url === '/models') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ object: 'list', data: models.map(id => ({ id, object: 'model' })) }));
      return;
    }
    res.writeHead(404, { 'content-type': 'application/json' });
    res.end('{"error":{"message":"not found"}}');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    server,
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`
  };
}

test('one natural-language call configures a provider and binds image/video roles', async t => {
  const harness = createHarness();
  const { server, baseUrl } = await startCatalogServer([
    'gpt-4.1',
    'gpt-image-1',
    'sora-2',
    'text-embedding-3-large'
  ]);
  t.after(() => {
    server.close();
    harness.dispose();
  });

  const result = await harness.providerIpc.configureProvider({
    name: '示例中转',
    base_url: baseUrl,
    api_key: 'sk-test-1234567890'
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.verified, true);
  assert.equal(result.connection.apiKeyMasked, 'sk-t…7890');
  assert.equal(result.connection.name, '示例中转');
  assert.equal(result.roles.text, 'gpt-4.1');
  assert.equal(result.roles.image, 'gpt-image-1');
  assert.equal(result.roles.video, 'sora-2');

  const cfg = harness.getConfig();
  assert.equal(cfg.api.connections.length, 1);
  const connection = cfg.api.connections[0];
  assert.equal(connection.modelFlags['gpt-image-1'].image, true);
  assert.equal(connection.modelFlags['sora-2'].video, true);
  assert.equal(connection.modelFlags['gpt-4.1'].enabled, true);
  assert.equal(cfg.api.providerSuppliers[connection.providerId][0].apiKey, 'sk-test-1234567890');
  assert.ok(cfg.api.enabledConnections.includes(connection.id));
  assert.equal(cfg.agentModel.providerId, connection.providerId);
  assert.equal(cfg.agentModel.modelId, 'gpt-4.1');
  assert.equal(cfg.media.imageModel, 'gpt-image-1');
  assert.equal(cfg.media.videoModel, 'sora-2');
  assert.equal(cfg.imageGeneration.available, true);
  assert.equal(cfg.imageGeneration.model, 'gpt-image-1');
});

test('adding a second provider never hijacks the existing chat or image model', async t => {
  const harness = createHarness();
  const { server, baseUrl } = await startCatalogServer(['gpt-4.1', 'gpt-image-1', 'sora-2']);
  t.after(() => {
    server.close();
    harness.dispose();
  });

  const first = await harness.providerIpc.configureProvider({ name: '主服务商', base_url: baseUrl, api_key: 'sk-first-000000' });
  assert.equal(first.ok, true, first.error);
  const second = await harness.providerIpc.configureProvider({ name: '第二服务商', base_url: baseUrl, api_key: 'sk-second-111111' });
  assert.equal(second.ok, true, second.error);

  const cfg = harness.getConfig();
  assert.equal(cfg.api.connections.length, 2);
  assert.equal(cfg.agentModel.modelId, 'gpt-4.1');
  assert.equal(cfg.media.imageModel, 'gpt-image-1');
  assert.equal(cfg.media.imageProvider, first.connection.providerId);
  assert.equal(second.roles.image, '');
  assert.equal(second.roles.text, '');
});

test('re-running with the same name and base URL updates the connection instead of duplicating it', async t => {
  const harness = createHarness();
  const { server, baseUrl } = await startCatalogServer(['gpt-4.1', 'gpt-image-1']);
  t.after(() => {
    server.close();
    harness.dispose();
  });

  const first = await harness.providerIpc.configureProvider({ name: '可更新连接', base_url: baseUrl, api_key: 'sk-old-000000' });
  const updated = await harness.providerIpc.configureProvider({ name: '可更新连接', base_url: baseUrl, api_key: 'sk-new-999999' });

  assert.equal(updated.ok, true, updated.error);
  assert.equal(updated.connection.id, first.connection.id);
  const cfg = harness.getConfig();
  assert.equal(cfg.api.connections.length, 1);
  assert.equal(cfg.api.providerSuppliers[first.connection.providerId][0].apiKey, 'sk-new-999999');
});

test('a catalog-less endpoint still works when the user names the models', async t => {
  const harness = createHarness();
  t.after(() => harness.dispose());

  const result = await harness.providerIpc.configureProvider({
    name: '无目录中转',
    base_url: 'http://127.0.0.1:1/v1',
    api_key: 'sk-dead-endpoint',
    image_models: ['flux-1.1-pro'],
    models: ['my-chat-model']
  });

  assert.equal(result.ok, true, result.error);
  assert.equal(result.verified, false);
  assert.equal(result.probe.ok, false);
  const cfg = harness.getConfig();
  assert.equal(cfg.media.imageModel, 'flux-1.1-pro');
  assert.equal(cfg.agentModel.modelId, 'my-chat-model');
  assert.equal(result.missingModels.length, 0);
});

test('invalid input is refused before anything is written', async t => {
  const harness = createHarness();
  t.after(() => harness.dispose());

  const noScheme = await harness.providerIpc.configureProvider({ base_url: 'api.example.com/v1', api_key: 'sk-x' });
  assert.equal(noScheme.ok, false);
  assert.match(noScheme.error, /http/);

  const noKey = await harness.providerIpc.configureProvider({ base_url: 'https://api.example.com/v1' });
  assert.equal(noKey.ok, false);
  assert.match(noKey.error, /API Key/);

  const unreachable = await harness.providerIpc.configureProvider({ base_url: 'http://127.0.0.1:1/v1', api_key: 'sk-x' });
  assert.equal(unreachable.ok, false);
  assert.match(unreachable.error, /模型/);

  assert.equal(harness.getConfig().api.connections.length, 0);
});

test('the provider bridge exposes the same actions to the MCP child process', async t => {
  const harness = createHarness();
  t.after(() => harness.dispose());
  const started = await harness.providerIpc.startProviderBridge();
  t.after(() => harness.providerIpc.stopProviderBridge());
  assert.ok(started.port > 0);
  assert.equal(started.token, harness.providerIpc.bridgeToken);

  const net = require('node:net');
  const request = (payload) => new Promise((resolve, reject) => {
    const socket = net.connect({ host: '127.0.0.1', port: started.port });
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('connect', () => socket.write(`${JSON.stringify(payload)}\n`));
    socket.on('data', chunk => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      socket.destroy();
      resolve(JSON.parse(buffer.slice(0, newline)));
    });
    socket.on('error', reject);
  });

  const unauthorized = await request({ token: 'wrong', action: 'provider.list', params: {} });
  assert.equal(unauthorized.ok, false);
  assert.match(unauthorized.error, /认证/);

  const listed = await request({ token: started.token, action: 'provider.list', params: {} });
  assert.equal(listed.ok, true);
  assert.deepEqual(listed.result.connections, []);
});

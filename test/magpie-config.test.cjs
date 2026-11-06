'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { pathToFileURL } = require('url');
const { readMagpieConfig } = require('../lib/magpie-config');
const { createMcpRuntimeConfig } = require('../lib/main/mcp-runtime-config');

function fixture(t) {
  const root = path.resolve(__dirname, '../.yanagent');
  fs.mkdirSync(root, { recursive: true });
  const dir = fs.mkdtempSync(path.join(root, 'magpie-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, file: path.join(dir, 'magpie.json'), write(value) {
    fs.writeFileSync(path.join(dir, 'magpie.json'), JSON.stringify(value));
  } };
}
function config() {
  return { version: 1, enabled: true, apiFormat: 'openai', baseUrl: 'http://127.0.0.1:9999/v1',
    apiKey: 'test-secret-never-log', model: 'group/team/deepseek-v4',
    models: [{ id: 'group/team/deepseek-v4', context: 64000, output: 8000, images: true, efforts: ['low', 'high'] }] };
}

test('official-shaped plugin writes only independent fields and preserves full ids', async t => {
  const f = fixture(t);
  const plugin = await import(pathToFileURL(path.resolve(__dirname, '../integrations/magpie/yan.agent.js')));
  assert.equal(plugin.agent.config, '$APPDATA/yan-agent/YanData/magpie.json');
  const input = config();
  const patches = plugin.connect({ gateway: { v1: input.baseUrl, key: input.apiKey }, models: input.models });
  f.write({ ...patches, [plugin.agent.model]: input.model });
  const snapshot = readMagpieConfig(f.dir);
  assert.equal(snapshot.selection.modelId, input.model);
  assert.equal(snapshot.contextWindow, 64000);
  assert.equal(snapshot.selection.capabilities.imageInput, true);
  f.write({ ...input, model: 'new/group', models: [{ id: 'new/group' }] });
  assert.equal(readMagpieConfig(f.dir).selection.modelId, 'new/group');
  assert.equal(snapshot.selection.modelId, input.model, 'existing run snapshot stays unchanged');
  assert.equal(readMagpieConfig(f.dir).selection.capabilities.imageInput, false);
  assert.equal(readMagpieConfig(f.dir).selection.capabilities.reasoning, false);
  f.write({ enabled: false }); assert.equal(readMagpieConfig(f.dir), null);
  f.write({}); assert.equal(readMagpieConfig(f.dir), null);
  fs.unlinkSync(f.file); assert.equal(readMagpieConfig(f.dir), null);
});

test('invalid, stale, oversized and unsafe config fails closed without leaking values', t => {
  const f = fixture(t);
  for (const change of [{ version: 2 }, { apiFormat: 'anthropic' }, { model: 'missing' },
    { baseUrl: 'file:///secret' }, { baseUrl: 'https://name:test-secret-never-log@example.com' },
    { baseUrl: 'https://example.com?key=test-secret-never-log' }, { apiKey: '' }, { models: {} }]) {
    f.write({ ...config(), ...change });
    assert.throws(() => readMagpieConfig(f.dir), error => error.message.includes('Magpie 配置无效') && !error.message.includes('test-secret'));
  }
  fs.writeFileSync(f.file, '{test-secret-never-log');
  assert.throws(() => readMagpieConfig(f.dir), /Magpie 配置无效/);
  fs.writeFileSync(f.file, ' '.repeat(2 * 1024 * 1024 + 1));
  assert.throws(() => readMagpieConfig(f.dir), /Magpie 配置无效/);
});

test('real runtime builder uses snapshot, restores original selection and never changes saved config', t => {
  const f = fixture(t);
  const selection = { providerId: 'original', supplierId: 'official', modelId: 'original-model', capabilities: {} };
  const cfg = { api: {}, agentModel: selection, agent: {} };
  const original = JSON.stringify(cfg);
  const runtime = createMcpRuntimeConfig({ dataDir: f.dir, appRoot: path.resolve(__dirname, '..'),
    skillsDir: f.dir, MODEL_PROVIDERS: { original: { name: 'Original', apiFormat: 'openai' } },
    DEFAULT_INPUT_TOKENS_PER_SECOND: 10000, normalizeInputTokensPerSecond: () => 10000,
    modelState: { normalizeAgentModelSelection: () => selection },
    providerConfig: { getProviderConnectionForSupplier: () => ({ apiKey: 'original-key', baseUrl: 'https://original.example/v1' }),
      getProviderModels: () => [selection], providerAdapterPreset: () => '', getChildReadableAppRoot: () => f.dir },
    mcpServerBuilders: { buildYanMediaEnvironment: () => ({}) } });
  f.write(config());
  const snapshot = readMagpieConfig(f.dir);
  const active = runtime.getOpenCodeRuntimeConfig(cfg, { magpie: snapshot, mcpServers: [] });
  assert.equal(active.model, 'magpie-runtime/group/team/deepseek-v4');
  assert.equal(active.provider['magpie-runtime'].options.apiKey, config().apiKey);
  assert.equal(active.provider['magpie-runtime'].models[config().model].limit.context, 64000);
  assert.equal(active.provider['magpie-runtime'].options.yanDsmlCompatibility, false);
  assert.equal(active.provider['magpie-runtime'].models[config().model].attachment, true);
  assert.equal(runtime.getOpenCodeRuntimeConfig(cfg, { magpie: null, mcpServers: [] }).model, 'original/original-model');
  fs.unlinkSync(f.file);
  assert.equal(runtime.getOpenCodeRuntimeConfig(cfg, { magpie: snapshot, mcpServers: [] }).model, active.model);
  assert.equal(runtime.getOpenCodeRuntimeConfig(cfg, { mcpServers: [] }).model, 'original/original-model');
  const { createConfigStore } = require('../lib/main/config');
  let saved;
  const store = createConfigStore({ ensureDirs() {}, safeStorage: { isEncryptionAvailable: () => false },
    writeAtomic: (_file, value) => { saved = value; } });
  store.saveConfig(cfg);
  assert.equal(JSON.stringify(cfg), original);
  assert.ok(!JSON.stringify(saved).includes('magpie'));
  assert.ok(!JSON.stringify(saved).includes(config().apiKey));
});

test('run admission uses Magpie identity and passes the same snapshot to runtime construction', async t => {
  const f = fixture(t);
  const { createRunContext } = require('./helpers/run-context.cjs');
  const { startRun } = require('../lib/run-orchestrator');
  const run = createRunContext(t);
  run.ctx.STABLE_DATA_DIR = f.dir;
  f.write(config());
  let captured;
  run.ctx.mcpRuntimeConfig.getOpenCodeRuntimeConfig = (_cfg, options) => {
    assert.equal(_cfg.api.reasoningSpeed, 'high');
    captured = options.magpie;
    fs.unlinkSync(f.file);
    return {};
  };
  const result = await startRun(run.ctx, { runId: 'magpie-admission', utility: true, prompt: 'hello', reasoningMode: 'high' });
  assert.equal(result.ok, true);
  assert.equal(captured.selection.modelId, config().model);
  assert.equal(run.calls.provider[0].request.modelId, config().model);
  assert.equal(run.calls.provider[0].request.providerId, 'magpie-runtime');
  assert.equal(run.config.api.reasoningSpeed, undefined, 'run-only reasoning selection is not persisted');
  run.complete({ status: 'done', text: 'done' });
  await run.idle;
});

test('manual compression uses runtime override identity including multi-part model id', async () => {
  const handlers = new Map();
  let captured;
  const { registerOpenCodeIpc } = require('../lib/main/ipc-opencode');
  registerOpenCodeIpc({ ipcMain: { handle: (name, fn) => handlers.set(name, fn) } }, {
    sessionStore: { isSessionRunActive: () => false, readSessionRecord: async () => ({ openCodeSessionId: 'ses_test', workspace: '' }) },
    manualContextCompressions: new Set(), withOpenCodeBackgroundLease: fn => fn(),
    configStore: { loadConfig: () => ({}) },
    modelState: { normalizeAgentModelSelection: () => ({ modelType: 'text', providerId: 'original', modelId: 'old' }) },
    skillsRuntime: { getNoWorkspaceAgentDirectory: () => __dirname },
    mcpRuntimeConfig: { getOpenCodeRuntimeConfig: () => ({ model: 'magpie-runtime/group/team/model' }) },
    ensureOpenCodeSidecar: async () => ({ compressSession: async args => { captured = args; return { compacted: true }; } })
  });
  const result = await handlers.get('opencode:compress-session')({}, { yanSessionId: 'sess_magpie_test' });
  assert.equal(result.ok, true);
  assert.equal(captured.providerId, 'magpie-runtime');
  assert.equal(captured.modelId, 'group/team/model');
});

'use strict';
// Behavioral checks for the user-specified vision-relay models:
//  - the relay candidate list is exactly the models the user marked
//    "支持多模态" on a connection; nothing vendor-specific is built in
//  - relay models only start once the user explicitly enables them AND the
//    connection still has a key/base URL
//  - the relay only runs for a text-only main model, never for a multimodal one
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const test = require('node:test');
const { createVisionRelayRuntime } = require('../lib/main/vision-relay-runtime');
const { normalizeVisionRelayModels } = require('../lib/model-roles');

function runtimeFixture() {
  const models = {
    'conn-a': [{ id: 'vision-a', name: 'Vision A' }, { id: 'text-a', name: 'Text A' }],
    'conn-b': [{ id: 'vision-b', name: 'Vision B' }]
  };
  const connectionsByProvider = {
    'conn-a': { apiKey: 'k', baseUrl: 'https://a.invalid/v1' },
    'conn-b': { apiKey: '', baseUrl: '' }
  };
  const runtime = createVisionRelayRuntime({
    MODEL_PROVIDERS: {
      'conn-a': { id: 'conn-a', name: 'Conn A' },
      'conn-b': { id: 'conn-b', name: 'Conn B' }
    },
    providerConfig: {
      getProviderSupplier: (_cfg, providerId, supplierId) => ({ id: supplierId, name: providerId }),
      getProviderConnectionForSupplier: (_cfg, providerId) => connectionsByProvider[providerId] || { apiKey: '', baseUrl: '' },
      getProviderModels: (_cfg, providerId) => models[providerId] || []
    },
    uploadStore: { resolveStoredUploadPath: filePath => filePath }
  });
  const connections = [
    { providerId: 'conn-a', supplierId: 'official', modelFlags: { 'vision-a': { multimodal: true }, 'text-a': {} } },
    { providerId: 'conn-b', supplierId: 'official', modelFlags: { 'vision-b': { multimodal: true } } }
  ];
  return { runtime, connections };
}

test('candidate list is exactly the multimodal-marked models', () => {
  const { runtime, connections } = runtimeFixture();
  const cfg = {
    api: {
      connections,
      visionRelayModels: [{ providerId: 'conn-a', supplierId: 'official', modelId: 'vision-a' }]
    }
  };
  const status = runtime.getVisionRelayStatus(cfg);
  assert.equal(status.candidateCount, 2, 'both multimodal marks listed, text-a excluded');
  assert.deepEqual(status.candidates.map(candidate => candidate.modelId).sort(), ['vision-a', 'vision-b']);
  assert.equal(status.candidates.find(candidate => candidate.modelId === 'vision-a').enabled, true);
  assert.equal(status.candidates.find(candidate => candidate.modelId === 'vision-a').configured, true);
  assert.equal(status.candidates.find(candidate => candidate.modelId === 'vision-b').configured, false);
  assert.equal(status.enabledCount, 1);
  assert.equal(status.availableCount, 1, 'an unconfigured connection never counts as available');
});

test('runtime relay models are the enabled ones that still resolve to a key and URL', () => {
  const { runtime, connections } = runtimeFixture();
  const cfg = {
    api: {
      connections,
      visionRelayModels: [
        { providerId: 'conn-b', supplierId: 'official', modelId: 'vision-b' },
        { providerId: 'conn-a', supplierId: 'official', modelId: 'vision-a' }
      ]
    }
  };
  const models = runtime.getVisionRelayModels(cfg);
  assert.deepEqual(models.map(model => model.modelId), ['vision-a'], 'the keyless conn-b is skipped in order');
  assert.equal(models[0].baseUrl, 'https://a.invalid/v1');
  assert.equal(models[0].apiKey, 'k');
});

test('relayImagesForTextModel only relays a text-only main model with a network grant', async () => {
  const { runtime, connections } = runtimeFixture();
  const noop = () => {};
  const attachments = [{ kind: 'image', path: 'C:/tmp/a.png' }];
  const request = { prompt: 'describe', attachments };

  const multimodal = await runtime.relayImagesForTextModel(
    { api: { connections }, permissions: { allowNetwork: true } },
    { capabilities: { imageInput: true } }, request, 'run-1', noop, undefined
  );
  assert.equal(multimodal.relay, null, 'a multimodal main model is never relayed');
  assert.equal(multimodal.attachments, attachments);

  await assert.rejects(
    () => runtime.relayImagesForTextModel(
      { api: { connections, visionRelayModels: [{ providerId: 'conn-a', supplierId: 'official', modelId: 'vision-a' }] }, permissions: { allowNetwork: false } },
      { capabilities: {} }, request, 'run-1', noop, undefined
    ),
    /网络权限/
  );

  await assert.rejects(
    () => runtime.relayImagesForTextModel(
      { api: { connections, visionRelayModels: [] }, permissions: { allowNetwork: true } },
      { capabilities: {} }, request, 'run-1', noop, undefined
    ),
    /视觉中继/
  );
});

test('normalizeVisionRelayModels keeps well-formed entries and dedupes', () => {
  assert.deepEqual(normalizeVisionRelayModels(null), []);
  assert.deepEqual(
    normalizeVisionRelayModels([
      { providerId: 'conn-a', modelId: 'm1' },
      { providerId: 'conn-a', supplierId: 'official', modelId: 'm1' },
      { providerId: '', modelId: 'm2' },
      { providerId: 'conn-b', modelId: '' },
      'not-an-object'
    ]),
    [
      { providerId: 'conn-a', supplierId: 'official', modelId: 'm1' }
    ]
  );
});

// --- config default + normalize (behavioral) --------------------------------
const { createConfigStore } = require('../lib/main/config');
const { normalizeReasoningSpeed, reasoningSpeedEnablesThinking } = require('../lib/reasoning-effort');

function mergeStub(target, source) {
  if (typeof source !== 'object' || source === null) return source;
  if (typeof target !== 'object' || target === null) return source;
  const out = Array.isArray(target) ? [...target] : { ...target };
  for (const key of Object.keys(source)) {
    out[key] = typeof source[key] === 'object' && source[key] !== null && !Array.isArray(source[key])
      ? mergeStub(target[key] || {}, source[key])
      : source[key];
  }
  return out;
}

function loadRelayConfig(configBody) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-relay-config-'));
  const configPath = path.join(dir, 'config.json');
  if (configBody) fs.writeFileSync(configPath, JSON.stringify(configBody));
  const store = createConfigStore({
    app: {
      getPath: () => dir,
      getVersion: () => '0.0.0-test',
      getLocale: () => 'zh',
      getPreferredSystemLanguages: () => ['zh-CN']
    },
    safeStorage: {
      isEncryptionAvailable: () => false,
      encryptString: value => value,
      decryptString: value => value
    },
    configPath,
    MODEL_PROVIDERS: {
      test: { id: 'test', name: 'Test', baseUrl: '', apiFormat: 'openai', models: [], dynamicModels: false },
      agnes: { id: 'agnes', name: 'Agnes', baseUrl: '', apiFormat: 'openai', models: [], dynamicModels: false }
    },
    providerConfig: {
      buildDefaultApiKeys: () => ({}),
      buildDefaultProviderConfigs: () => ({}),
      buildDefaultProviderSuppliers: () => ({}),
      migrateLegacyConnections: () => {},
      syncConnectionProviders: () => {},
      ensureProviderConfigs: () => {},
      ensureEnabledConnections: () => false,
      pruneUnlistedSupplierState: () => {},
      getProviderConnection: () => ({ apiKey: '', baseUrl: '' }),
      getProviderModels: () => []
    },
    PET_IDS: ['orb'],
    DEFAULT_MODELS: [],
    DEFAULT_SKILLS: [],
    DEFAULT_QUICK_INPUT_SHORTCUT: 'CommandOrControl+Shift+Y',
    ensureDefaultMcp: servers => servers,
    normalizeAgentModelSelection: () => ({ providerId: '', supplierId: '', modelId: '' }),
    updateImageGenerationConfig: () => {},
    normalizeQuickLaunchConfig: value => ({
      enabled: value?.enabled !== false,
      shortcut: String(value?.shortcut || 'CommandOrControl+Shift+Y')
    }),
    getFirstTextModel: () => null,
    ensureBundledAgentSkills: () => {},
    getMergedSkills: () => [],
    deepMerge: mergeStub,
    ensureDirs: () => {},
    writeAtomic: (file, value) => fs.writeFileSync(file, JSON.stringify(value, null, 2), 'utf8'),
    normalizeReasoningSpeed,
    reasoningSpeedEnablesThinking,
    normalizeVoice: value => String(value || ''),
    normalizeRate: value => String(value || '')
  });
  try {
    return store.loadConfig();
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test('loadConfig defaults the relay selection to empty and preserves a saved one', () => {
  assert.deepEqual(loadRelayConfig(null).api.visionRelayModels, [], 'no built-in relay model list any more');
  assert.ok(!('visionRelayEnabled' in loadRelayConfig(null).api), 'the master switch is gone');
  const saved = loadRelayConfig({
    api: {
      visionRelayModels: [
        { providerId: 'conn-a', supplierId: 'official', modelId: 'vision-a' },
        { providerId: 'conn-a', modelId: 'vision-a' },
        { providerId: '', modelId: 'x' }
      ]
    }
  });
  assert.deepEqual(saved.api.visionRelayModels, [
    { providerId: 'conn-a', supplierId: 'official', modelId: 'vision-a' }
  ]);
});

// --- sidecar/renderer no longer carry the switch -----------------------------
const sidecarSrc = fs.readFileSync('lib/opencode-sidecar.js', 'utf8');
assert.ok(!sidecarSrc.includes('visionRelayEnabled'), 'sidecar must not reference the removed switch');

console.log('vision relay selection checks: all pass');

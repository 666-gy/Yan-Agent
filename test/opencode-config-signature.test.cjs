'use strict';

// End-to-end signature verification against the REAL production builders.
// main.js is loaded under a stubbed Electron; the exported builders then
// produce full OpenCode configs for two different tasks, and the sidecar's
// configSignature must match. This is the test that would have caught the
// media-MCP workspace leak ("task B dies while task A runs").

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');
const crypto = require('node:crypto');

const appRoot = path.resolve(__dirname, '..');
const stubDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-main-stub-'));

const electronStub = {
  app: {
    getPath: () => stubDataDir,
    getName: () => 'yan-agent',
    getVersion: () => '1.4.0',
    getLocale: () => 'zh',
    getPreferredSystemLanguages: () => ['zh-CN'],
    isReady: () => false,
    requestSingleInstanceLock: () => true,
    setAppUserModelId: () => {},
    on: () => {},
    once: () => {},
    whenReady: () => new Promise(() => {}),
    commandLine: { appendSwitch: () => {}, appendArgument: () => {}, hasSwitch: () => false },
    isPackaged: false,
    getAppPath: () => stubDataDir,
    getLoginItemSettings: () => ({}),
    setLoginItemSettings: () => {}
  },
  BrowserWindow: class StubWindow {},
  Tray: class StubTray {},
  ipcMain: {
    handle: () => {},
    on: () => {},
    removeHandler: () => {}
  },
  ipcRenderer: {},
  dialog: {},
  shell: {},
  Menu: { buildFromTemplate: () => null, setApplicationMenu: () => {} },
  nativeImage: { createFromPath: () => ({}), createEmpty: () => ({}) },
  nativeTheme: { on: () => {}, removeListener: () => {}, shouldUseDarkColors: false, shouldUseDarkColorsForSystemIntegratedUI: false },
  safeStorage: { isEncryptionAvailable: () => false, encryptString: () => Buffer.from(''), decryptString: () => '' },
  desktopCapturer: { getSources: async () => [] },
  webContents: { fromId: () => null },
  screen: {
    getCursorScreenPoint: () => ({ x: 0, y: 0 }),
    getPrimaryDisplay: () => ({ workArea: { x: 0, y: 0, width: 1920, height: 1080 }, bounds: { x: 0, y: 0, width: 1920, height: 1080 } })
  },
  session: { defaultSession: { setSpellCheckerEnabled: () => {} } },
  clipboard: {},
  globalShortcut: { register: () => false, isRegistered: () => false, unregister: () => {}, unregisterAll: () => {} },
  net: {}
};

const originalLoad = Module._load;
Module._load = function stubbedLoad(request, parent, isMain) {
  if (request === 'electron') return electronStub;
  return originalLoad.call(this, request, parent, isMain);
};

let main;
try {
  process.env.YAN_MAIN_TEST_EXPORTS = '1';
  main = require(path.join(appRoot, 'main.js'));
} finally {
  Module._load = originalLoad;
}

const sidecar = require(path.join(appRoot, 'lib', 'opencode-sidecar.js'));

function signatureOf(config) {
  return crypto.createHash('sha256').update(JSON.stringify(config)).digest('hex');
}

test('real builders: config signature is identical across tasks with different workspaces', () => {
  assert.ok(main?.__test, 'main.js test exports missing');
  const workspaceA = path.join(stubDataDir, 'ws-a');
  const workspaceB = path.join(stubDataDir, 'ws-b');
  fs.mkdirSync(workspaceA, { recursive: true });
  fs.mkdirSync(workspaceB, { recursive: true });

  const mcpA = main.__test.getOpenCodeMcpServers({}, { workspace: workspaceA, workMode: 'normal' });
  const mcpB = main.__test.getOpenCodeMcpServers({}, { workspace: workspaceB, workMode: 'normal' });
  const configA = main.__test.getOpenCodeRuntimeConfig({}, {
    mcpServers: mcpA,
    workspace: workspaceA,
    taskId: 'yan-task-alpha',
    skillOnly: false
  });
  const configB = main.__test.getOpenCodeRuntimeConfig({}, {
    mcpServers: mcpB,
    workspace: workspaceB,
    taskId: 'yan-task-beta-different',
    skillOnly: false
  });
  assert.equal(signatureOf(configA), signatureOf(configB));
});

test('real builders: blank task and workspace task share one signature', () => {
  const workspace = path.join(stubDataDir, 'ws-c');
  fs.mkdirSync(workspace, { recursive: true });
  const blankMcp = main.__test.getOpenCodeMcpServers({}, { workspace: '', workMode: 'normal' });
  const wsMcp = main.__test.getOpenCodeMcpServers({}, { workspace, workMode: 'normal' });
  const pluginServer = wsMcp.find(server => server.id === 'yan_plugin');
  assert.ok(pluginServer, 'yan_plugin built-in server is registered');
  assert.equal(pluginServer.enabled, true);
  assert.equal(pluginServer.deferred, undefined);
  assert.equal(pluginServer.runtime, 'yan-plugin');
  assert.ok(pluginServer.args.some(arg => arg.endsWith('yan-plugin-mcp.js')));
  const blank = main.__test.getOpenCodeRuntimeConfig({}, { mcpServers: blankMcp, workspace: '', taskId: 't1', skillOnly: false });
  const withWs = main.__test.getOpenCodeRuntimeConfig({}, { mcpServers: wsMcp, workspace, taskId: 't2', skillOnly: false });
  assert.equal(signatureOf(blank), signatureOf(withWs));
});

test('real builders: a configured MCP set keeps the prewarm and run signatures identical', () => {
  // Regression: codegraph used to resolve only when the run had a workspace, so
  // the kernel prewarmed with no run options never matched and every first turn
  // spawned a fresh kernel. The prewarm builds its servers with NO run options.
  const cfg = {
    mcpServers: [
      { id: 'mcp_default_playwright', name: 'Playwright', command: 'npx', args: ['-y', '@playwright/mcp@latest'], enabled: true },
      { id: 'mcp_default_codegraph', name: 'CodeGraph', command: 'codegraph', runtime: 'codegraph', enabled: true },
      { id: 'mcp_1790004857986', name: 'ReactBits MCP', command: 'npx', args: ['-y', 'react-bits-mcp-server'], enabled: true }
    ]
  };
  const workspace = path.join(stubDataDir, 'ws-parity');
  fs.mkdirSync(workspace, { recursive: true });
  const build = mcpOptions => main.__test.getOpenCodeRuntimeConfig(cfg, {
    mcpServers: main.__test.getOpenCodeMcpServers(cfg, mcpOptions),
    taskId: 'yan-task-parity',
    skillOnly: false
  });
  const prewarm = build({});
  assert.equal(signatureOf(build({ workspace: '', workMode: 'normal', evolutionMode: false })), signatureOf(prewarm));
  assert.equal(signatureOf(build({ workspace, workMode: 'normal', evolutionMode: false })), signatureOf(prewarm));
});

test('real builders: switching models applies each model context instead of the legacy global context', () => {
  const runtimeConfig = modelId => ({
    api: {
      provider: 'conn-context-test',
      model: modelId,
      connections: [{
        id: 'conn-context-test', providerId: 'conn-context-test', supplierId: 'official',
        preset: 'openai', customModels: ['model-a', 'model-b'],
        modelFlags: {
          'model-a': { contextWindow: 100_000, compactionThreshold: 70_000 },
          'model-b': { contextWindow: 200_000, compactionThreshold: 150_000 }
        }
      }],
      providerActiveSupplierIds: { 'conn-context-test': 'official' },
      providerSuppliers: {
        'conn-context-test': [{
          id: 'official',
          name: 'Context test',
          kind: 'official',
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'test-key',
          models: [{ id: 'model-a', name: 'Model A' }, { id: 'model-b', name: 'Model B' }]
        }]
      }
    },
    agentModel: { providerId: 'conn-context-test', supplierId: 'official', modelId },
    context: { maxTokens: 1_000_000, compactionThreshold: 800_000 }
  });
  const firstConfig = runtimeConfig('model-a');
  main.__test.configStore.saveConfig(firstConfig);
  main.__test.configStore.loadConfig(); // Register the connection as production config loading does.
  const first = main.__test.getOpenCodeRuntimeConfig(firstConfig);
  const second = main.__test.getOpenCodeRuntimeConfig(runtimeConfig('model-b'));
  const firstProvider = Object.values(first.provider).find(item => item?.models);
  const secondProvider = Object.values(second.provider).find(item => item?.models);
  assert.notEqual(signatureOf(first), signatureOf(second));
  assert.equal(firstProvider.models['model-a'].limit.context, 100_000);
  assert.equal(first.compaction.threshold, 70_000);
  assert.equal(secondProvider.models['model-b'].limit.context, 200_000);
  assert.equal(second.compaction.threshold, 150_000);
});

test('media MCP env carries no per-run workspace and points at the registry', () => {
  const server = main.__test.buildYanMediaMcpServer({}, appRoot, { workspace: 'C:\\should-not-appear' });
  assert.ok(server, 'media server not built');
  assert.ok(server.env.YAN_MEDIA_WORKSPACE_REGISTRY, 'registry env missing');
  const decoded = JSON.parse(Buffer.from(server.env.YAN_MEDIA_RUNTIME, 'base64').toString('utf8'));
  assert.equal(decoded.access.workspace, undefined, 'per-run workspace leaked into media runtime env');
  assert.equal(JSON.stringify(server.env).includes('should-not-appear'), false);
});

test('a multimodal main model declares native image input; media relay follows the user selection', () => {
  const providerId = 'glm';
  const supplierId = 'official';
  const modelId = 'glm-4.6v-flash';
  const cfg = {
    api: {
      providerSuppliers: {
        [providerId]: [{
          id: supplierId,
          name: 'Native Vision Test',
          kind: 'official',
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'test-key',
          models: []
        }]
      },
      providerActiveSupplierIds: { [providerId]: supplierId },
      provider: providerId,
      model: modelId
    },
    agentModel: { providerId, supplierId, modelId }
  };
  const config = main.__test.getOpenCodeRuntimeConfig(cfg);
  const model = config.provider[providerId].models[modelId];
  assert.equal(model.attachment, true);
  assert.deepEqual(model.modalities.input, ['text', 'image']);

  const mediaServer = main.__test.buildYanMediaMcpServer(cfg, appRoot);
  const mediaRuntime = JSON.parse(Buffer.from(mediaServer.env.YAN_MEDIA_RUNTIME, 'base64').toString('utf8'));
  assert.equal(mediaRuntime.vision.enabled, false, 'no relay model is selected yet');

  cfg.api.visionRelayModels = [{ providerId, supplierId, modelId }];
  const relayRuntime = JSON.parse(Buffer.from(
    main.__test.buildYanMediaMcpServer(cfg, appRoot).env.YAN_MEDIA_RUNTIME,
    'base64'
  ).toString('utf8'));
  assert.equal(relayRuntime.vision.enabled, true);
  assert.equal(relayRuntime.vision.models[0].modelId, modelId);
});

test('task MCP capability flags do not change the shared kernel signature', () => {
  const servers = main.__test.getOpenCodeMcpServers({}, {
    workspace: stubDataDir,
    prompt: 'Fix the code and run tests',
    attachments: []
  });
  const enabled = main.__test.getOpenCodeRuntimeConfig({}, { mcpServers: servers });
  const disabled = main.__test.getOpenCodeRuntimeConfig({}, {
    mcpServers: servers.map(server => ({ ...server, taskEnabled: false }))
  });
  assert.equal(signatureOf(enabled), signatureOf(disabled));
});

test('self-evolution mode alone exposes the Harness MCP to a run', () => {
  const normal = main.__test.getOpenCodeMcpServers({}, {
    workspace: stubDataDir,
    workMode: 'normal',
    evolutionMode: false
  });
  const evolution = main.__test.getOpenCodeMcpServers({}, {
    workspace: stubDataDir,
    workMode: 'evolution',
    evolutionMode: true
  });
  assert.equal(normal.find(server => server.id === 'yan_harness').taskEnabled, false);
  assert.equal(evolution.find(server => server.id === 'yan_harness').taskEnabled, true);
  // Management listings keep the Harness visible when no run context decides.
  const management = main.__test.getOpenCodeMcpServers({}, { includeInactiveSerena: true });
  assert.notEqual(management.find(server => server.id === 'yan_harness').taskEnabled, false);
  // The per-run task flag never enters the shared kernel signature.
  const normalConfig = main.__test.getOpenCodeRuntimeConfig({}, { mcpServers: normal });
  const evolutionConfig = main.__test.getOpenCodeRuntimeConfig({}, { mcpServers: evolution });
  assert.equal(signatureOf(normalConfig), signatureOf(evolutionConfig));
});

test('task MCP trimming uses only construction-level signals, never prompt text', () => {
  // v1.6.0 regression: prompt-keyword trimming silently denied yan_media for
  // Chinese requests like "画一张海报" that missed the keyword list. A wrong
  // deny is a hard capability loss, so trimming must stay exact: builtins
  // only disappear when they cannot exist for this run, and workspace
  // indexers only when the run has no workspace at all.
  const prompts = ['画一只橘猫', '生成一张海报', '把天空改成粉色的', 'Read this image', 'Operate the desktop'];
  for (const prompt of prompts) {
    const caps = main.__test.inferMcpTaskCapabilities({ workspace: stubDataDir, prompt, attachments: [] });
    assert.equal(caps.media, true, prompt);
    assert.equal(caps.browser, true, prompt);
    assert.equal(caps.session, true, prompt);
    assert.equal(caps.desktop, true, prompt);
  }

  const withWorkspace = main.__test.inferMcpTaskCapabilities({ workspace: stubDataDir, prompt: '', attachments: [] });
  assert.equal(withWorkspace.code, true);
  assert.equal(withWorkspace.playwright, true);

  const withoutWorkspace = main.__test.inferMcpTaskCapabilities({ workspace: '', prompt: '画一只橘猫', attachments: [] });
  assert.equal(withoutWorkspace.code, false);
  assert.equal(withoutWorkspace.playwright, false);
  assert.equal(withoutWorkspace.media, true);

  const nonRunListing = main.__test.inferMcpTaskCapabilities({});
  assert.equal(nonRunListing.code, true);
});

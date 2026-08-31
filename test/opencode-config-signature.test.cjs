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
    commandLine: { appendSwitch: () => {}, appendArgument: () => {} }
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
  const blank = main.__test.getOpenCodeRuntimeConfig({}, { mcpServers: blankMcp, workspace: '', taskId: 't1', skillOnly: false });
  const withWs = main.__test.getOpenCodeRuntimeConfig({}, { mcpServers: wsMcp, workspace, taskId: 't2', skillOnly: false });
  assert.equal(signatureOf(blank), signatureOf(withWs));
});

test('media MCP env carries no per-run workspace and points at the registry', () => {
  const server = main.__test.buildYanMediaMcpServer({}, appRoot, { workspace: 'C:\\should-not-appear' });
  assert.ok(server, 'media server not built');
  assert.ok(server.env.YAN_MEDIA_WORKSPACE_REGISTRY, 'registry env missing');
  const decoded = JSON.parse(Buffer.from(server.env.YAN_MEDIA_RUNTIME, 'base64').toString('utf8'));
  assert.equal(decoded.access.workspace, undefined, 'per-run workspace leaked into media runtime env');
  assert.equal(JSON.stringify(server.env).includes('should-not-appear'), false);
});

test('real runtime config declares native image input when visual relay is disabled', () => {
  const providerId = 'glm';
  const supplierId = 'official';
  const modelId = 'future-native-vision-model';
  const cfg = {
    api: {
      visionRelayEnabled: false,
      providerSuppliers: {
        [providerId]: [{
          id: supplierId,
          name: 'Native Vision Test',
          kind: 'official',
          baseUrl: 'https://example.invalid/v1',
          apiKey: 'test-key',
          models: [{ id: modelId, name: 'Future Native Vision Model' }]
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
  assert.equal(mediaRuntime.vision.enabled, false);
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

test('task MCP classifier separates media, desktop, session, and code work', () => {
  const media = main.__test.inferMcpTaskCapabilities({ prompt: 'Read this image', attachments: [{ name: 'a.png' }] });
  assert.equal(media.media, true);
  assert.equal(media.desktop, false);

  const desktop = main.__test.inferMcpTaskCapabilities({ prompt: 'Operate the desktop PowerShell window', attachments: [] });
  assert.equal(desktop.desktop, true);
  assert.equal(desktop.media, false);

  const handoff = main.__test.inferMcpTaskCapabilities({ prompt: 'Continue in another workspace', attachments: [] });
  assert.equal(handoff.session, true);

  const code = main.__test.inferMcpTaskCapabilities({
    workspace: stubDataDir,
    prompt: 'Fix the browser E2E test',
    attachments: []
  });
  assert.equal(code.code, true);
  assert.equal(code.playwright, true);
});

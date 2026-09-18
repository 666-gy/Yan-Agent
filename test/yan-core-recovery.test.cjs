'use strict';

// Covers the durable journal API and the main-process recovery descriptor
// builder used to replay interrupted Turns after an application restart.

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Module = require('node:module');

const appRoot = path.resolve(__dirname, '..');
const stubDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-recovery-stub-'));

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
  ipcMain: { handle: () => {}, on: () => {}, removeHandler: () => {} },
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

const { YanCore } = require(path.join(appRoot, 'lib', 'yan-core'));

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-core-recovery-'));
}

function createTestCore() {
  const rootDir = tempDir();
  let timestamp = 1_700_000_000_000;
  const core = new YanCore({
    rootDir,
    clock: () => timestamp++,
    idFactory: prefix => `${prefix}_generated`
  });
  return { core, rootDir };
}

function startInterruptedTurn(core, { threadId, turnId, workspace = 'C:/ws', prompt = 'hello' } = {}) {
  core.startTurn({
    threadId,
    turnId,
    workspace,
    configSnapshot: { providerId: 'deepseek', modelId: 'deepseek-flash', workMode: 'normal' },
    intent: { prompt, workMode: 'normal' }
  });
}

test('journal keeps one Turn\'s provider events in order with their raw payloads', () => {
  const { core } = createTestCore();
  startInterruptedTurn(core, { threadId: 'thread-a', turnId: 'turn-a' });
  core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: '你' } });
  core.ingestProviderEvent('turn-a', { type: 'message.part.updated', data: { part: { id: 'p1', type: 'text', text: '你好' } } });
  core.ingestProviderEvent('turn-a', { type: 'session.next.tool.called', data: { callID: 'c1', tool: 'bash', input: { command: 'ls' } } });
  core.ingestProviderEvent('turn-a', { type: 'session.next.tool.success', data: { callID: 'c1', result: 'ok' } });

  const journal = core.listTurnEvents('turn-a');
  const providerEvents = journal.events.filter(event => event.payload?.rawType);
  assert.equal(providerEvents.length, 4);
  assert.equal(journal.truncated, false);
  assert.deepEqual(
    providerEvents.map(event => event.type),
    ['message.delta', 'provider.event', 'tool.started', 'tool.completed']
  );
  assert.equal(providerEvents[0].payload.rawType, 'message.part.delta');
  assert.equal(providerEvents[0].payload.raw.data.delta, '你');
  assert.equal(providerEvents[2].payload.callId, 'c1');
  assert.ok(journal.lastTimestamp > 0);
});

test('journal ignores other Turns and reports tail truncation', () => {
  const { core } = createTestCore();
  startInterruptedTurn(core, { threadId: 'thread-a', turnId: 'turn-a' });
  startInterruptedTurn(core, { threadId: 'thread-b', turnId: 'turn-b' });
  core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: 'a1' } });
  core.ingestProviderEvent('turn-b', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: 'b1' } });
  core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: 'a2' } });
  core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: 'a3' } });

  const providersOf = (turnId, options) => core.listTurnEvents(turnId, options)
    .events.filter(event => event.payload?.rawType)
    .map(event => event.payload.delta);

  assert.deepEqual(providersOf('turn-a'), ['a1', 'a2', 'a3']);
  const tail = core.listTurnEvents('turn-a', { maxEvents: 2 });
  assert.equal(tail.truncated, true);
  assert.deepEqual(providersOf('turn-a', { maxEvents: 2 }), ['a2', 'a3']);
  assert.deepEqual(providersOf('turn-b'), ['b1']);
});

test('a recovering Turn settles as aborted and keeps the recovered text as its final item', () => {
  const { core } = createTestCore();
  startInterruptedTurn(core, { threadId: 'thread-a', turnId: 'turn-a' });
  core.ingestProviderEvent('turn-a', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: '部分正文' } });

  const recovered = core.recoverInterruptedTurns();
  assert.equal(recovered.length, 1);
  assert.equal(core.getTurn('turn-a').status, 'recovering');

  const settled = core.completeTurn('turn-a', { status: 'interrupted', text: '恢复的正文' });
  assert.equal(settled.status, 'aborted');
  assert.equal(settled.result.status, 'interrupted');
  assert.equal(settled.result.text, '恢复的正文');
  const messageItem = core.getItem('turn-a', 'turn-a:message');
  assert.equal(messageItem.payload.text, '恢复的正文');
});

test('main recovery descriptors rebuild renderer events only for recovering Turns', () => {
  const { core } = createTestCore();
  startInterruptedTurn(core, { threadId: 'sess-a', turnId: 'run-a', workspace: 'C:/ws-a', prompt: '恢复测试' });
  core.ingestProviderEvent('run-a', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: '你好' } });
  core.ingestProviderEvent('run-a', { type: 'session.next.tool.called', data: { callID: 'c1', tool: 'bash', input: { command: 'ls' } } });

  const before = main.__test.buildRecoveredRunDescriptors([], core);
  assert.deepEqual(before, [], 'running Turns are not recoverable before restart recovery');

  core.recoverInterruptedTurns();
  const descriptors = main.__test.buildRecoveredRunDescriptors([], core);
  assert.equal(descriptors.length, 1);
  const [descriptor] = descriptors;
  assert.equal(descriptor.runId, 'run-a');
  assert.equal(descriptor.yanSessionId, 'sess-a');
  assert.equal(descriptor.workspace, 'C:/ws-a');
  assert.equal(descriptor.truncated, false);
  assert.ok(descriptor.journalEvents >= descriptor.events.length);
  assert.equal(descriptor.configSnapshot.modelId, 'deepseek-flash');
  assert.deepEqual(descriptor.events.map(event => event.type), ['message.part.delta', 'session.next.tool.called']);
  assert.equal(descriptor.events[0].data.delta, '你好');
  assert.equal(descriptor.events[1].data.input.command, 'ls');
});

test('main recovery descriptors honor the requested run id filter', () => {
  const { core } = createTestCore();
  startInterruptedTurn(core, { threadId: 'sess-a', turnId: 'run-a' });
  startInterruptedTurn(core, { threadId: 'sess-b', turnId: 'run-b' });
  core.ingestProviderEvent('run-a', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: 'A' } });
  core.ingestProviderEvent('run-b', { type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: 'B' } });
  core.recoverInterruptedTurns();

  const descriptors = main.__test.buildRecoveredRunDescriptors(['run-b'], core);
  assert.equal(descriptors.length, 1);
  assert.equal(descriptors[0].runId, 'run-b');
});

test('recoveryRendererEvent only accepts mapped provider journal entries', () => {
  assert.equal(main.__test.recoveryRendererEvent({ type: 'turn.started', payload: { turn: {} } }), null);
  assert.equal(main.__test.recoveryRendererEvent({ payload: { truncated: true, preview: '...' } }), null);
  assert.deepEqual(
    main.__test.recoveryRendererEvent({ payload: { rawType: 'message.part.delta', raw: { type: 'message.part.delta', data: { delta: 'x' } } } }),
    { type: 'message.part.delta', data: { delta: 'x' } }
  );
  assert.deepEqual(
    main.__test.recoveryRendererEvent({ payload: { rawType: 'session.next.tool.called', data: { callID: 'c1' } } }),
    { type: 'session.next.tool.called', data: { callID: 'c1' } }
  );
});

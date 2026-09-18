'use strict';

// Result attribution wiring against the REAL production main.js (stubbed
// Electron, same pattern as harness-activation.test.cjs). A run's verified
// outcome credits or blames exactly the entries that run injected, and three
// consecutive failures return an advisory entry to observing.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');

const appRoot = path.resolve(__dirname, '..');
const stubDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-harness-usage-'));

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

function memoryEdit(id, content) {
  return {
    action: 'create',
    kind: 'memory',
    id,
    title: id,
    content,
    path: 'notes',
    scope: 'global',
    metadata: { status: 'active', enforcement: 'advisory' }
  };
}

test('harnessRunOutcome only credits outcomes the run can prove', () => {
  assert.equal(main.__test.harnessRunOutcome({ status: 'error', todos: [] }), 'failure');
  assert.equal(main.__test.harnessRunOutcome({ status: 'done', todos: [{ done: true }, { done: true }] }), 'success');
  assert.equal(main.__test.harnessRunOutcome({ status: 'done', todos: [{ done: false }] }), '');
  assert.equal(main.__test.harnessRunOutcome({ status: 'cancelled', todos: [] }), '');
  assert.equal(main.__test.harnessRunOutcome({ status: 'done', userRequestedFinish: true }), 'success');
});

test('injected entries are attributed once from the verified run outcome', async () => {
  await main.__test.continualHarness.apply({
    edits: [memoryEdit('usage-e2e', '端到端归因：验证注入清单会被记账且只消费一次。')]
  }, { scope: 'global' });
  const file = main.__test.registerHarnessUsage({
    runId: 'run-usage-e2e',
    workspace: '',
    sessionId: 'sess-usage',
    entries: [{ kind: 'memory', id: 'usage-e2e', scope: 'global' }]
  });
  assert.ok(file && fs.existsSync(file));

  const attribution = await main.__test.attributeHarnessUsage({
    runId: 'run-usage-e2e',
    workspace: '',
    sessionId: 'sess-usage',
    result: { status: 'done', todos: [{ done: true }] }
  });
  assert.equal(attribution.ok, true);
  assert.equal(attribution.updated.length, 1);
  const entry = main.__test.continualHarness.get('memory', 'usage-e2e');
  assert.equal(entry.metadata.usage.successes.length, 1);
  assert.equal(entry.metadata.usage.injectedRuns.length, 1);

  assert.equal(await main.__test.attributeHarnessUsage({
    runId: 'run-usage-e2e',
    workspace: '',
    sessionId: 'sess-usage',
    result: { status: 'error', todos: [] }
  }), null, 'a consumed usage file is never attributed twice');
});

test('three consecutive failed uses demote an advisory entry to observing', async () => {
  await main.__test.continualHarness.apply({
    edits: [memoryEdit('usage-demote-e2e', '端到端降级：连续三次失败后回到 observing 并停止注入。')]
  }, { scope: 'global' });
  const injected = [{ kind: 'memory', id: 'usage-demote-e2e', scope: 'global' }];
  for (const runId of ['run-demote-1', 'run-demote-2', 'run-demote-3']) {
    main.__test.registerHarnessUsage({ runId, workspace: '', sessionId: 'sess-usage', entries: injected });
    const attribution = await main.__test.attributeHarnessUsage({
      runId,
      workspace: '',
      sessionId: 'sess-usage',
      result: { status: 'error', todos: [] }
    });
    assert.equal(attribution.ok, true);
  }
  const entry = main.__test.continualHarness.get('memory', 'usage-demote-e2e');
  assert.equal(entry.metadata.status, 'observing');
  assert.equal(entry.metadata.usage.consecutiveFailures, 3);
  const context = main.__test.continualHarness.evolutionContext({ workspace: '', query: '端到端降级 observing', maxEntries: 6 });
  assert.equal(context.entries.some(item => item.id === 'usage-demote-e2e'), false);
});

test('reviewer edits and usage attribution coexist for the same injected entries', async () => {
  const store = main.__test.continualHarness;
  await store.apply({ edits: [
    {
      action: 'create', kind: 'prompt', id: 'prompt-coexist', title: '协同策略',
      content: '这条策略会被审阅者更新，同时也会被结果归因记账。', path: 'policy', scope: 'global',
      metadata: { status: 'active', enforcement: 'advisory' }
    },
    {
      action: 'create', kind: 'memory', id: 'memory-coexist', title: '协同记忆',
      content: '这条记忆只会被结果归因记账，不会被审阅者改写。', path: 'notes', scope: 'global',
      metadata: { status: 'active' }
    }
  ] }, { scope: 'global' });
  const baseline = store.load({ scope: 'global' });
  main.__test.registerHarnessUsage({
    runId: 'run-coexist',
    workspace: '',
    sessionId: 'sess-coexist',
    entries: [
      { kind: 'prompt', id: 'prompt-coexist', scope: 'global' },
      { kind: 'memory', id: 'memory-coexist', scope: 'global' }
    ]
  });

  let reviewerCalled = false;
  await main.__test.reviewCompletedRunMemory({
    sidecar: {
      reviewMemory: async () => {
        reviewerCalled = true;
        return {
          memories: [],
          skillCandidate: null,
          refinementOutcomes: [],
          harnessCandidates: [{
            kind: 'prompt',
            id: 'coexist',
            title: '协同策略',
            content: '更新标记：这条策略会被审阅者更新，同时也会被结果归因记账，并在结论中附上校验结果。',
            path: 'policy',
            scope: 'global',
            evidence: '本轮工具输出证明校验脚本已通过。'
          }]
        };
      }
    },
    selection: { providerId: 'yan-provider', modelId: 'yan-model' },
    request: { history: [] },
    result: { status: 'done', todos: [{ done: true }], toolCalls: [], changes: [] },
    prompt: '普通任务',
    workspace: '',
    yanSessionId: 'sess-coexist',
    runId: 'run-coexist',
    harnessBaselines: { global: baseline },
    evolutionMode: true
  });

  assert.equal(reviewerCalled, true);
  const prompt = store.get('prompt', 'prompt-coexist');
  // The reviewer edit must apply despite the run-start baseline: if usage
  // attribution ran first it would change the fingerprint and the store would
  // reject the update as a stale-revision conflict.
  assert.match(prompt.content, /更新标记/);
  assert.equal(prompt.metadata.usage.successes.includes('run-coexist'), true);
  const memory = store.get('memory', 'memory-coexist');
  assert.equal(memory.metadata.usage.successes.includes('run-coexist'), true);
});

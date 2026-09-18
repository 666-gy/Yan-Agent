'use strict';

// Activation gate for harness candidates, against the REAL production
// builder. main.js is loaded under a stubbed Electron (same pattern as
// opencode-config-signature.test.cjs). Regression context: an explicitly
// user-ordered refinement ("prefer AnySearch from now on") used to land in
// the two-independent-runs 'observing' limbo - invisible to promptContext -
// so it could never gather its second evidence run and never activated.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const Module = require('node:module');
const crypto = require('node:crypto');

const appRoot = path.resolve(__dirname, '..');
const stubDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-harness-activate-'));

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

const { ContinualHarnessStore } = require('../lib/continual-harness');
// main.js derives dataDir as <app.getPath('userData')>/YanData.
const harness = new ContinualHarnessStore({
  globalPath: path.join(stubDataDir, 'YanData', 'harness', 'harness-state.json'),
  yanagentDir: path.join(stubDataDir, 'YanData', 'yanagent')
});

function candidateReview(overrides = {}) {
  return {
    memories: [],
    skillCandidate: null,
    refinementOutcomes: [],
    harnessCandidates: [{
      kind: 'prompt',
      id: 'prefer-anysearch',
      title: 'Prefer AnySearch for searches',
      content: 'For any web search request, prefer the AnySearch skill first; fall back to other channels only when it is unavailable or insufficient.',
      path: 'general',
      evidence: 'The user explicitly requested this durable search preference.',
      ...overrides
    }]
  };
}

test('agent-requested refinements activate immediately', async () => {
  const results = await main.__test.applyReviewedHarnessState(candidateReview(), {
    workspace: '',
    sessionId: 'sess-a',
    runId: 'run-a',
    harnessBaselines: { global: main.__test.continualHarness.load({ scope: 'global' }) },
    refineInstructions: 'User asked to prefer AnySearch for every future search.',
    verifiedSuccess: true
  });
  assert.equal(results.length, 1);
  assert.equal(results[0].result.ok, true);
  const entry = harness.get('prompt', 'prompt-prefer-anysearch', { scope: 'global' });
  assert.ok(entry, 'entry stored in the global scope');
  assert.equal(entry.metadata.status, 'active', 'user-ordered policy is active at once');
});

test('explicit user policy persists even when reviewer output is unavailable', async () => {
  const result = await main.__test.persistExplicitUserPolicy({
    instructions: '以后搜索优先使用 AnySearch，只有不可用时才回退内置浏览器。',
    scope: 'global',
    runId: 'run-reviewer-failed',
    sessionId: 'sess-reviewer-failed'
  });
  assert.equal(result.ok, true);
  const entry = harness.get('prompt', 'prompt-search-routing', { scope: 'global' });
  assert.ok(entry);
  assert.equal(entry.metadata.status, 'active');
  assert.equal(entry.metadata.enforcement, 'mandatory');
});

test('background-mined candidates stay observing until two verified runs', async () => {
  await main.__test.applyReviewedHarnessState(candidateReview({
    id: 'mined-policy',
    title: 'Mined policy',
    content: 'A policy the background review mined from this run without any user instruction.'
  }), {
    workspace: '',
    sessionId: 'sess-b',
    runId: 'run-b',
    harnessBaselines: { global: main.__test.continualHarness.load({ scope: 'global' }) },
    refineInstructions: '',
    verifiedSuccess: true
  });
  const entry = harness.get('prompt', 'prompt-mined-policy', { scope: 'global' });
  assert.ok(entry);
  assert.equal(entry.metadata.status, 'observing', 'single-run background evidence stays observing');
  assert.equal(entry.metadata.successfulRuns.length, 1);

  // Second independent verified run reinforces it to active.
  await main.__test.applyReviewedHarnessState(candidateReview({
    id: 'mined-policy',
    title: 'Mined policy',
    content: 'A policy the background review mined from this run without any user instruction.'
  }), {
    workspace: '',
    sessionId: 'sess-c',
    runId: 'run-c',
    harnessBaselines: { global: harness.load({ scope: 'global' }) },
    refineInstructions: '',
    verifiedSuccess: true
  });
  const promoted = harness.get('prompt', 'prompt-mined-policy', { scope: 'global' });
  assert.equal(promoted.metadata.status, 'active');
  assert.equal(promoted.metadata.successfulRuns.length, 2);
});

test('an agent-requested match promotes a stuck observing entry', async () => {
  // Seed a stuck entry through the background path.
  await main.__test.applyReviewedHarnessState(candidateReview({
    id: 'stuck-policy',
    title: 'Stuck policy',
    content: 'Prefer AnySearch whenever any search is requested in this workspace.'
  }), {
    workspace: '',
    sessionId: 'sess-d',
    runId: 'run-d',
    harnessBaselines: { global: harness.load({ scope: 'global' }) },
    refineInstructions: '',
    verifiedSuccess: true
  });
  assert.equal(harness.get('prompt', 'prompt-stuck-policy', { scope: 'global' }).metadata.status, 'observing');

  // The user repeats the instruction and the model relays it as a refinement.
  await main.__test.applyReviewedHarnessState(candidateReview({
    id: 'stuck-policy',
    title: 'Stuck policy',
    content: 'Prefer AnySearch whenever any search is requested in this workspace.'
  }), {
    workspace: '',
    sessionId: 'sess-e',
    runId: 'run-e',
    harnessBaselines: { global: harness.load({ scope: 'global' }) },
    refineInstructions: 'User repeated: always prefer AnySearch.',
    verifiedSuccess: true
  });
  assert.equal(harness.get('prompt', 'prompt-stuck-policy', { scope: 'global' }).metadata.status, 'active');

  // And the activated entry is exactly what promptContext injects for new runs.
  const context = harness.promptContext({ workspace: '', query: 'AnySearch 搜索', maxChars: 3_000 });
  assert.match(context, /stuck-policy|Prefer AnySearch/);
});

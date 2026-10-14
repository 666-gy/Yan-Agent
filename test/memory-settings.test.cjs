'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { evolutionEnabled, sessionModeMatches } = require('../lib/work-mode-isolation');
const { combineSystem, combineTurnPrompt, memorySystem } = require('../lib/opencode-sidecar');
const { registerMemorySettings } = require('../lib/main/memory-settings');
const { LongTermMemoryStore } = require('../lib/long-term-memory');
const { ContinualHarnessStore } = require('../lib/continual-harness');
test('memory switch independently controls every work mode and model context', () => {
  for (const workMode of ['normal', 'plan', 'goal', 'agi', 'evolution']) {
    assert.equal(evolutionEnabled({ workMode, memoryEnabled: true }), true);
    assert.equal(evolutionEnabled({ workMode, memoryEnabled: false }), false);
  }
  assert.equal(evolutionEnabled({ memoryEnabled: true, utility: true }), false);
  assert.equal(memorySystem({ memoryEnabled: false, memoryContext: '旧记忆' }), '');
  assert.match(combineSystem({ customInstructions: '回答时使用简体中文' }), /回答时使用简体中文/);
  assert.match(combineTurnPrompt({ memoryEnabled: true, workMode: 'normal', harnessContext: '优先执行验证' }, 'hi', false), /优先执行验证/);
  assert.doesNotMatch(combineTurnPrompt({ memoryEnabled: false, workMode: 'agi', harnessContext: '旧经验' }, 'hi', false), /旧经验/);
  assert.equal(sessionModeMatches({ metadata: { yanModeIsolation: 1, yanWorkMode: 'normal', yanMemoryEnabled: true } }, { workMode: 'normal', memoryEnabled: false }), false);
});
test('delete clears real global and project stores, rejects foreign callers and active runs', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-memory-delete-'));
  try {
    const workspace = path.join(dir, 'project'); fs.mkdirSync(workspace);
    const memory = new LongTermMemoryStore({ globalPath: path.join(dir, 'memory.json') });
    const harness = new ContinualHarnessStore({ globalPath: path.join(dir, 'harness.json') });
    assert.equal(memory.upsert({ content: 'The user prefers verified database backups before migrations.', type: 'preference', scope: 'global', confidence: 0.95 }).ok, true);
    assert.equal(memory.upsert({ content: 'Project uses verified database backups.', type: 'project', scope: 'workspace', confidence: 0.95 }, { workspace }).ok, true);
    assert.ok(memory.query({ workspace, query: 'database backups' }).total > 0);
    for (const options of [{}, { scope: 'workspace', workspace }]) {
      const state = harness.load(options);
      state.refinements.push({ id: 'old-refinement', status: 'rejected' });
      const target = harness.statePath(options);
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, JSON.stringify(state));
    }
    let clear;
    const webContents = { mainFrame: {} }, activeRuns = new Map();
    registerMemorySettings({ ipcMain: { handle: (_, fn) => { clear = fn; } }, getMainWindow: () => ({ isDestroyed: () => false, webContents }), configStore: { loadConfig: () => ({ workspace }) }, sessionStore: { listSessionSummaries: async () => [{ workspace }] }, longTermMemory: memory, continualHarness: harness, memoryRuntime: { isReviewing: () => false }, activeRuns, admissions: new Map() });
    const event = { sender: webContents, senderFrame: webContents.mainFrame };
    await assert.rejects(clear({}), /无权/);
    activeRuns.set('running', {}); await assert.rejects(clear(event), /等待/); activeRuns.clear();
    assert.equal((await clear(event)).ok, true);
    assert.equal(memory.query({ workspace, query: 'database backups' }).total, 0);
    assert.equal(harness.list({ workspace }).length, 0);
    assert.equal(harness.load().refinements.length, 0);
    assert.equal(harness.load({ scope: 'workspace', workspace }).refinements.length, 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

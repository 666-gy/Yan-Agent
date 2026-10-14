// Session-store integration: collecting kernel session IDs and calling deleteKernelSessions.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createSessionStore, collectKernelSessionIds } = require('../lib/session-store');

function fixture(t) {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-kernel-'));
  t.after(() => fs.rmSync(sessionsDir, { recursive: true, force: true }));
  const activeRuns = new Map();
  const deleted = [];
  const kernelCalls = [];
  const deps = {
    sessionsDir,
    ensureDirs() {},
    mainWindow: { get: () => null },
    yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} },
    activateWorkspace() {},
    activeRuns,
    runAdmissions: new Map(),
    deleteCoreThread(id) { deleted.push(id); return { ok: true }; },
    deleteKernelSessions: async ({ yanSessionId, sessionIds, directory }) => {
      kernelCalls.push({ yanSessionId, sessionIds, directory });
      return { deleted: sessionIds.length, failed: 0 };
    }
  };
  return { store: createSessionStore(deps), activeRuns, deleted, kernelCalls };
}

test('collectKernelSessionIds extracts the top-level ID and every message agentRun ID', () => {
  assert.deepEqual(collectKernelSessionIds({}), []);
  assert.deepEqual(collectKernelSessionIds({ openCodeSessionId: 'top' }), ['top']);
  assert.deepEqual(collectKernelSessionIds({ openCodeSessionId: 'top', messages: [] }), ['top']);
  assert.deepEqual(collectKernelSessionIds({
    openCodeSessionId: 'top',
    messages: [
      { agentRun: { openCodeSessionId: 'run1' } },
      { agentRun: { openCodeSessionId: 'run2' } },
      { agentRun: {} }
    ]
  }), ['top', 'run1', 'run2']);
  assert.deepEqual(collectKernelSessionIds({
    openCodeSessionId: 'A',
    messages: [{ agentRun: { openCodeSessionId: 'A' } }]
  }), ['A'], 'deduplicates');
});

test('deleteSessionRecord calls deleteKernelSessions with collected IDs', async (t) => {
  const { store, kernelCalls } = fixture(t);
  const session = await store.createFreshSessionRecord({ workspace: 'C:/project', title: 'Test' });
  session.openCodeSessionId = 'kernel-top';
  session.messages = [
    { role: 'user', content: 'hello' },
    { role: 'assistant', content: 'world', agentRun: { openCodeSessionId: 'kernel-run1' } }
  ];
  await store.saveSession(session);

  const result = await store.deleteSessionRecord(session.id, { confirmed: true });

  assert.equal(result.ok, true);
  assert.equal(result.kernelSessions, 2);
  assert.equal(result.kernelDeleted, 2);
  assert.equal(kernelCalls.length, 1);
  assert.deepEqual(kernelCalls[0].sessionIds, ['kernel-top', 'kernel-run1']);
  assert.equal(path.normalize(kernelCalls[0].directory), path.normalize('C:/project'));
  assert.equal(kernelCalls[0].yanSessionId, session.id);
});

test('deleteSessionRecord reports incomplete cleanup when deleteKernelSessions throws', async (t) => {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-kernel-'));
  t.after(() => fs.rmSync(sessionsDir, { recursive: true, force: true }));
  const deps = {
    sessionsDir,
    ensureDirs() {},
    mainWindow: { get: () => null },
    yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} },
    activateWorkspace() {},
    activeRuns: new Map(),
    runAdmissions: new Map(),
    deleteCoreThread() { return { ok: true }; },
    deleteKernelSessions: async () => { throw new Error('kernel unavailable'); }
  };
  const store = createSessionStore(deps);
  const session = await store.createFreshSessionRecord();
  session.openCodeSessionId = 'will-fail';
  await store.saveSession(session);

  const result = await store.deleteSessionRecord(session.id, { confirmed: true });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'deletion-pending');
  assert.equal(fs.existsSync(store.sessionPath(session.id)), true, 'record remains available only for cleanup retry');
});

test('deleteSessionRecord passes empty directory when workspace is missing', async (t) => {
  const { store, kernelCalls } = fixture(t);
  const session = await store.createFreshSessionRecord({ title: 'No workspace' });
  session.openCodeSessionId = 'kernel-no-ws';
  await store.saveSession(session);

  await store.deleteSessionRecord(session.id, { confirmed: true });

  assert.equal(kernelCalls.length, 1);
  assert.equal(kernelCalls[0].directory, '');
});

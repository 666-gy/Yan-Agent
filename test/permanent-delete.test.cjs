'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { createSessionStore } = require('../lib/session-store');
const { YanCore } = require('../lib/yan-core');
const { registerYanagentStore } = require('../lib/main/yanagent-store');
const { deleteKernelConversation } = require('../lib/kernel-session-deletion');
const { deleteKernelSessionsNow, databasePaths } = require('../lib/kernel-storage');
const { createDeletionFence } = require('../lib/deletion-fence');

async function fixture(t, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-permanent-delete-'));
  const sessionsDir = path.join(root, 'sessions'), filesDir = path.join(root, 'uploads'), workspace = path.join(root, 'workspace');
  for (const dir of [sessionsDir, filesDir, workspace]) fs.mkdirSync(dir);
  const core = new YanCore({ rootDir: path.join(root, 'core') });
  t.after(async () => { if (core.persistTimer) clearTimeout(core.persistTimer); await core.store.close(); fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); });
  const yanagent = registerYanagentStore({ yanagentDir: '.yanagent', sessionsDir, resourceLocks: { withLock: async (_key, _mode, _meta, fn) => fn() } });
  const deps = { sessionsDir, filesDir, ensureDirs() {}, mainWindow: { get: () => null }, yanagent, activateWorkspace() {}, activeRuns: new Map(), runAdmissions: new Map(), deleteCoreThread: id => core.deleteThread(id),
    deleteKernelSessions: args => deleteKernelConversation({ ...args, dataDir: root }), ...overrides };
  const store = createSessionStore(deps);
  const a = await store.createFreshSessionRecord({ workspace, title: 'A' });
  const b = await store.createFreshSessionRecord({ workspace, title: 'B' });
  a.messages = [{ role: 'user', content: 'DELETE_SECRET_A' }];
  b.messages = [{ role: 'user', content: 'PRESERVE_SECRET_B' }];
  await store.saveSession(a); await store.saveSession(b);
  for (const session of [a, b]) {
    core.startTurn({ threadId: session.id, turnId: session.id + '_run', intent: { prompt: session.messages[0].content } });
    core.completeTurn(session.id + '_run', { status: 'done', text: session.messages[0].content });
  }
  return { root, sessionsDir, filesDir, workspace, core, store, a, b, yanagent, reopen: () => createSessionStore(deps) };
}
function kernelFixture(root) {
  const runtimeRoot = path.join(root, 'opencode-runtime');
  const file = databasePaths(runtimeRoot).db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL; CREATE TABLE session(id TEXT PRIMARY KEY,parent_id TEXT,metadata TEXT); CREATE TABLE event_sequence(aggregate_id TEXT PRIMARY KEY,seq INTEGER NOT NULL); CREATE TABLE event(id TEXT PRIMARY KEY,aggregate_id TEXT NOT NULL,data TEXT,FOREIGN KEY(aggregate_id) REFERENCES event_sequence(aggregate_id) ON DELETE CASCADE);");
  for (const [id, parent] of [['ka', null], ['child', 'ka'], ['kb', null]]) {
    db.prepare('INSERT INTO session VALUES(?,?,?)').run(id, parent, '{}');
    db.prepare('INSERT INTO event_sequence VALUES(?,1)').run(id);
    db.prepare('INSERT INTO event VALUES(?,?,?)').run(id, id, id === 'kb' ? 'PRESERVE_SECRET_B' : 'DELETE_SECRET_A');
  }
  db.close(); return { file, runtimeRoot };
}

test('permanent deletion removes raw content, snapshots, unshared uploads and kernel events; restart and stale saves cannot revive it', async t => {
  const f = await fixture(t);
  const { file } = kernelFixture(f.root);
  const own = path.join(f.filesDir, 'own.txt'), shared = path.join(f.filesDir, 'shared.txt');
  fs.writeFileSync(own, 'DELETE_SECRET_A'); fs.writeFileSync(shared, 'SHARED');
  f.a.openCodeSessionId = 'ka';
  f.a.messages[0].attachments = [{ path: own }, { path: shared }];
  f.b.messages[0].attachments = [{ path: shared }];
  await f.store.saveSession(f.a); await f.store.saveSession(f.b);
  for (const record of [f.a, f.b]) await f.yanagent.writeRunRollbackSnapshot({ workspace: f.workspace, sessionId: record.id, runId: 'run', rollbackChanges: [{ path: path.join(f.workspace, 'source.txt'), before: record.messages[0].content }] });
  fs.writeFileSync(f.core.store.statePath + '.corrupt-old', 'DELETE_SECRET_A');
  f.store.setSessionArchivedRecord([f.a.id], true);
  assert.equal((await f.store.deleteSessionRecord(f.a.id, { confirmed: true, archivedOnly: true })).ok, true);
  assert.equal(fs.existsSync(f.store.sessionPath(f.a.id)), false);
  await f.yanagent.writeRunRollbackSnapshot({ workspace: f.workspace, sessionId: f.a.id, runId: 'late', rollbackChanges: [{path: path.join(f.workspace, 'source.txt'), before: 'DELETE_SECRET_A'}] });
  assert.equal(fs.existsSync(own), false); assert.equal(fs.existsSync(shared), true);
  assert.equal(fs.existsSync(path.join(f.workspace, '.yanagent', 'snapshots', f.a.id)), false);
  assert.equal(fs.existsSync(path.join(f.workspace, '.yanagent', 'snapshots', f.b.id, 'run.json')), true);
  for (const name of fs.readdirSync(f.core.store.rootDir)) {
    const file = path.join(f.core.store.rootDir, name);
    if (fs.statSync(file).isFile()) assert.equal(fs.readFileSync(file, 'utf8').includes('DELETE_SECRET_A'), false, name);
  }
  const db = new DatabaseSync(file, { readOnly: true });
  try { for (const table of ['session', 'event', 'event_sequence']) assert.equal(db.prepare('select count(*) n from ' + table).get().n, 1); } finally { db.close(); }
  assert.equal((await f.reopen().saveSession(f.a)).code, 'SESSION_DELETED');
  assert.equal(fs.existsSync(f.store.sessionPath(f.a.id)), false);
  const restarted = new YanCore({ rootDir: f.core.store.rootDir });
  assert.equal(restarted.getThread(f.a.id), null);
  assert.throws(() => restarted.startTurn({ threadId: f.a.id }), { code: 'YAN_THREAD_DELETED' });
  assert.ok(restarted.getThread(f.b.id)); await restarted.store.close();
});

test('a failed cleanup returns failure, locks stale saves across restart, and is retryable', async t => {
  let fail = true;
  const f = await fixture(t, { deleteKernelSessions: async () => { if (fail) throw new Error('kernel unavailable'); return { ok: true, deleted: 1 }; } });
  f.a.openCodeSessionId = 'ka'; await f.store.saveSession(f.a);
  const first = await f.store.deleteSessionRecord(f.a.id, { confirmed: true });
  assert.equal(first.ok, false); assert.equal(first.code, 'deletion-pending');
  assert.equal(fs.existsSync(f.store.sessionPath(f.a.id)), true);
  const reopened = f.reopen();
  assert.equal((await reopened.saveSession(f.a)).code, 'SESSION_DELETED');
  assert.equal((await reopened.listSessionSummaries({ archived: true })).find(s => s.id === f.a.id).deletionPending, true);
  fail = false;
  assert.equal((await reopened.deleteSessionRecord(f.a.id, { confirmed: true })).ok, true);
  assert.equal(fs.existsSync(f.store.sessionPath(f.a.id)), false);
});

test('an in-flight disk save cannot commit after a delete and deletion waits for temporary writes', async t => {
  const f = await fixture(t);
  const original = fs.promises.writeFile;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const writing = new Promise(resolve => { entered = resolve; });
  fs.promises.writeFile = async (...args) => {
    if (String(args[0]).includes(f.a.id + '.json.tmp-')) { entered(); await gate; }
    return original(...args);
  };
  try {
    const save = f.store.saveSession(f.a); await writing;
    let finished = false;
    const deletion = f.store.deleteSessionRecord(f.a.id, { confirmed: true }).then(result => { finished = true; return result; });
    while (!f.store.isSessionDeleted(f.a.id)) await new Promise(resolve => setImmediate(resolve));
    assert.equal(finished, false); release();
    assert.equal((await save).code, 'SESSION_DELETED');
    assert.equal((await deletion).ok, true);
    assert.equal(fs.readdirSync(f.sessionsDir).some(name => name.startsWith(f.a.id)), false);
  } finally { release(); fs.promises.writeFile = original; }
});

test('a persisted Core deletion fence prevents replaying old snapshots and events after a crash', async t => {
  const f = await fixture(t);
  createDeletionFence(f.core.store.rootDir).mark(f.a.id);
  assert.throws(() => f.core.startTurn({ threadId: f.a.id, turnId: f.a.id + '_run' }), { code: 'YAN_THREAD_DELETED' });
  const restarted = new YanCore({ rootDir: f.core.store.rootDir });
  assert.equal(restarted.getThread(f.a.id), null);
  assert.equal(restarted.store.readEvents().some(event => event.threadId === f.a.id), false);
  assert.throws(() => restarted.ensureThread({ id: f.a.id }), { code: 'YAN_THREAD_DELETED' });
  await restarted.deleteThread(f.a.id); await restarted.store.close();
  assert.equal(fs.readFileSync(f.core.store.eventsPath, 'utf8').includes('DELETE_SECRET_A'), false);
});

test('interrupted save references survive cleanup failure and a restarted retry without copying conversation text', async t => {
  let fail = true, core;
  const f = await fixture(t, { deleteCoreThread: async id => { if (fail) throw new Error('core busy'); return core.deleteThread(id); } });
  core = f.core;
  const { file } = kernelFixture(f.root);
  const attachment = path.join(f.filesDir, 'pending-upload.txt'); fs.writeFileSync(attachment, 'DELETE_SECRET_A');
  const pendingRecord = JSON.parse(JSON.stringify(f.a));
  pendingRecord.openCodeSessionId = 'ka'; pendingRecord.messages[0].attachments = [{ path: attachment }];
  const original = fs.promises.writeFile;
  let release, entered;
  const gate = new Promise(resolve => { release = resolve; });
  const writing = new Promise(resolve => { entered = resolve; });
  fs.promises.writeFile = async (...args) => {
    if (String(args[0]).includes(f.a.id + '.json.tmp-')) { entered(); await gate; }
    return original(...args);
  };
  try {
    const save = f.store.saveSession(pendingRecord); await writing;
    const deletion = f.store.deleteSessionRecord(f.a.id, { confirmed: true });
    while (!f.store.isSessionDeleted(f.a.id)) await new Promise(resolve => setImmediate(resolve));
    release();
    assert.equal((await save).code, 'SESSION_DELETED');
    assert.equal((await deletion).ok, false);
  } finally { release(); fs.promises.writeFile = original; }
  assert.equal(fs.readFileSync(f.store.sessionPath(f.a.id) + '.deleting', 'utf8').includes('DELETE_SECRET_A'), false);
  fail = false;
  assert.equal((await f.reopen().deleteSessionRecord(f.a.id, { confirmed: true })).ok, true);
  assert.equal(fs.existsSync(attachment), false);
  assert.equal(fs.readdirSync(f.sessionsDir).some(name => name.startsWith(f.a.id)), false);
  const db = new DatabaseSync(file, { readOnly: true });
  try { for (const table of ['session', 'event', 'event_sequence']) assert.equal(db.prepare('select count(*) n from ' + table).get().n, 1); } finally { db.close(); }
});

test('failed final unlink remains visibly pending and retryable after restart', async t => {
  const f = await fixture(t);
  f.store.setSessionArchivedRecord([f.a.id], true);
  const original = fs.unlinkSync;
  fs.unlinkSync = file => {
    if (file === f.store.sessionPath(f.a.id)) throw Object.assign(new Error('file busy'), { code: 'EBUSY' });
    return original(file);
  };
  try {
    const result = await f.store.deleteSessionRecord(f.a.id, { confirmed: true, archivedOnly: true });
    assert.equal(result.ok, false); assert.equal(result.deletionPending, true);
  } finally { fs.unlinkSync = original; }
  const restarted = f.reopen();
  assert.equal((await restarted.listSessionSummaries({ archived: true })).find(s => s.id === f.a.id).deletionPending, true);
  assert.equal((await restarted.deleteSessionRecord(f.a.id, { confirmed: true, archivedOnly: true })).ok, true);
  assert.equal(fs.existsSync(f.store.sessionPath(f.a.id)), false);
});

test('generated asset IDs remove owned copies and preserve shared assets and project files', async t => {
  const f = await fixture(t);
  const owned = 'a'.repeat(32), shared = 'b'.repeat(32);
  const directory = path.join(f.root, 'generated-images'); fs.mkdirSync(directory);
  const projectFile = path.join(f.workspace, 'source.txt'); fs.writeFileSync(projectFile, 'project');
  for (const id of [owned, shared]) {
    fs.writeFileSync(path.join(directory, id + '.png'), 'image');
    fs.writeFileSync(path.join(directory, id + '.json'), '{}');
  }
  f.a.messages[0].attachments = [{ assetId: owned }, { assetId: shared }, { path: projectFile }];
  f.b.messages[0].attachments = [{ generatedImageId: shared }];
  await f.store.saveSession(f.a); await f.store.saveSession(f.b);
  assert.equal((await f.store.deleteSessionRecord(f.a.id, { confirmed: true })).ok, true);
  assert.deepEqual(fs.readdirSync(directory).sort(), [shared + '.json', shared + '.png']);
  assert.equal(fs.readFileSync(projectFile, 'utf8'), 'project');
});

test('unreadable database shapes and orphan logs cannot masquerade as no database', async t => {
  const f = await fixture(t);
  const runtimeRoot = path.join(f.root, 'opencode-runtime'), file = databasePaths(runtimeRoot).db;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const remove = () => deleteKernelSessionsNow({ runtimeRoot, dataDir: f.root, sessionIds: ['ka'] });
  assert.equal((await remove()).ok, true);
  fs.writeFileSync(file + '-wal', 'orphan');
  assert.equal((await remove()).ok, false); fs.unlinkSync(file + '-wal');
  fs.writeFileSync(file, ''); assert.equal((await remove()).ok, false);
  fs.writeFileSync(file, 'not a database'); assert.equal((await remove()).ok, false);
});

test('a malformed online response retains retry state and never reports success', async t => {
  const f = await fixture(t); let finalized = false;
  const result = await deleteKernelConversation({ dataDir: f.root, yanSessionId: f.a.id, sessionIds: ['ka'],
    sidecar: { deleteKernelSessionTrees: async () => undefined },
    deleteNow: async () => { finalized = true; return { ok: true }; } });
  assert.equal(result.ok, false); assert.equal(finalized, false);
  assert.equal(fs.readdirSync(path.join(f.root, 'opencode-runtime', 'deleting')).length, 1);
});

test('online finalization refuses success while a kernel row remains', async t => {
  const f = await fixture(t); const { runtimeRoot } = kernelFixture(f.root);
  const result = await deleteKernelSessionsNow({ runtimeRoot, dataDir: f.root, sessionIds: ['ka'], purgeOnly: true });
  assert.equal(result.ok, false);
});

test('partial online deletion persists descendant IDs before deleting parents and retries after restart', async t => {
  const f = await fixture(t); let attempt = 0; let finalized;
  const sidecar = { async deleteKernelSessionTrees(ids, _directory, options) {
    if (++attempt === 1) { options.onDiscovered(['ka', 'child']); return { deleted: 1, failed: ['ka'] }; }
    assert.ok(ids.includes('child')); return { deleted: 1, failed: [] };
  } };
  const opts = { dataDir: f.root, yanSessionId: f.a.id, sessionIds: ['ka'], directory: f.workspace, sidecar, deleteNow: async job => { finalized = job; return { ok: true }; } };
  assert.equal((await deleteKernelConversation(opts)).ok, false);
  assert.equal((await deleteKernelConversation(opts)).ok, true);
  assert.deepEqual(finalized.sessionIds.sort(), ['child', 'ka']);
  assert.equal(finalized.purgeOnly, true);
  assert.deepEqual(fs.readdirSync(path.join(f.root, 'opencode-runtime', 'deleting')), []);
});

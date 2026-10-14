// Kernel session deletion: immediate and offline (flush at next start).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const storage = require('../lib/kernel-storage');
const { queuePendingKernelDeletes, readPendingKernelDeletes, ensureKernelDeletesFlushed, databasePaths, readState } = storage;
const childModule = require('../lib/kernel-storage-child');

const tempRoots = [];
test.after(() => {
  for (const root of tempRoots) {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch {}
  }
});

function tempRuntimeRoot() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-delete-'));
  tempRoots.push(dataDir);
  const runtimeRoot = path.join(dataDir, 'opencode-runtime');
  fs.mkdirSync(path.join(runtimeRoot, 'data', 'opencode'), { recursive: true });
  return { dataDir, runtimeRoot, paths: databasePaths(runtimeRoot) };
}

function scalar(file, sql) {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return Object.values(db.prepare(sql).get() || {})[0]; } finally { db.close(); }
}

const rowCount = (file, table) => Number(scalar(file, `select count(*) as value from ${table}`));

// Mirrors opencode's schema: session has children, message/part/todo cascade.
function createDeletionDatabase(file, { sessions = [] } = {}) {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');
  db.exec(`
    CREATE TABLE session (
      id TEXT PRIMARY KEY,
      parent_id TEXT,
      metadata TEXT
    )
  `);
  db.exec('CREATE INDEX session_parent_idx ON session(parent_id)');
  db.exec(`
    CREATE TABLE message (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      body TEXT,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX message_session_time_created_id_idx ON message(session_id)');
  db.exec(`
    CREATE TABLE part (
      id TEXT PRIMARY KEY,
      message_id TEXT NOT NULL,
      session_id TEXT,
      body TEXT,
      FOREIGN KEY (message_id) REFERENCES message(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX part_session_idx ON part(session_id)');
  db.exec(`
    CREATE TABLE todo (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL,
      body TEXT,
      FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
    )
  `);
  db.exec('CREATE INDEX todo_session_idx ON todo(session_id)');

  db.exec('BEGIN');
  const insertSession = db.prepare('INSERT INTO session (id, parent_id, metadata) VALUES (?, ?, ?)');
  const insertMessage = db.prepare('INSERT INTO message (id, session_id, body) VALUES (?, ?, ?)');
  const insertPart = db.prepare('INSERT INTO part (id, message_id, session_id, body) VALUES (?, ?, ?, ?)');
  const insertTodo = db.prepare('INSERT INTO todo (id, session_id, body) VALUES (?, ?, ?)');
  for (const session of sessions) {
    insertSession.run(session.id, session.parent_id || null, JSON.stringify(session.metadata || {}));
    if (session.messages) {
      for (const msg of session.messages) {
        insertMessage.run(msg.id, session.id, msg.body || '');
        if (msg.parts) {
          for (const part of msg.parts) {
            insertPart.run(part.id, msg.id, session.id, part.body || '');
          }
        }
      }
    }
    if (session.todos) {
      for (const todo of session.todos) {
        insertTodo.run(todo.id, session.id, todo.body || '');
      }
    }
  }
  db.exec('COMMIT');
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  db.close();
}

// --- deleteSessions (direct child-module call, no spawn) --------------------

test('deleteSessions removes a session tree and all cascading rows', async () => {
  const root = tempRuntimeRoot();
  createDeletionDatabase(root.paths.db, {
    sessions: [
      { id: 'parent', metadata: { yanSessionID: 'yan-1' }, messages: [{ id: 'm1', parts: [{ id: 'p1' }] }], todos: [{ id: 't1' }] },
      { id: 'child1', parent_id: 'parent', metadata: { yanSessionID: 'yan-1' }, messages: [{ id: 'm2' }] },
      { id: 'child2', parent_id: 'parent', metadata: { yanSessionID: 'yan-1' } },
      { id: 'grandchild', parent_id: 'child1', metadata: { yanSessionID: 'yan-1' } },
      { id: 'unrelated', metadata: { yanSessionID: 'yan-2' }, messages: [{ id: 'm3' }] }
    ]
  });

  const db = new DatabaseSync(root.paths.db);
  db.exec('PRAGMA foreign_keys = ON');
  const result = childModule.deleteSessions(db, { pendingIds: ['parent'], liveYanSessionIds: [] });
  db.close();

  assert.equal(result.roots, 1);
  assert.equal(result.descendants, 3);
  assert.equal(result.deleted, 4);
  assert.equal(rowCount(root.paths.db, 'session'), 1, 'only unrelated survives');
  assert.equal(scalar(root.paths.db, "SELECT id FROM session"), 'unrelated');
  assert.equal(rowCount(root.paths.db, 'message'), 1);
  assert.equal(rowCount(root.paths.db, 'part'), 0, 'cascaded from message');
  assert.equal(rowCount(root.paths.db, 'todo'), 0, 'cascaded from session');
  assert.equal(scalar(root.paths.db, 'PRAGMA integrity_check'), 'ok');
});

test('deleteSessions skips sessions owned by live Yan tasks', async () => {
  const root = tempRuntimeRoot();
  createDeletionDatabase(root.paths.db, {
    sessions: [
      { id: 'live-owned', metadata: { yanSessionID: 'yan-alive' } },
      { id: 'dead-owned', metadata: { yanSessionID: 'yan-gone' } },
      { id: 'no-owner', metadata: {} }
    ]
  });

  const db = new DatabaseSync(root.paths.db);
  db.exec('PRAGMA foreign_keys = ON');
  const result = childModule.deleteSessions(db, {
    pendingIds: ['live-owned', 'dead-owned', 'no-owner'],
    liveYanSessionIds: ['yan-alive']
  });
  db.close();

  assert.equal(result.keptLive, 1);
  assert.equal(result.deleted, 2);
  assert.equal(rowCount(root.paths.db, 'session'), 1);
  assert.equal(scalar(root.paths.db, "SELECT id FROM session"), 'live-owned');
});

test('deleteSessions sweeps orphans when liveYanSessionIds is provided', async () => {
  const root = tempRuntimeRoot();
  createDeletionDatabase(root.paths.db, {
    sessions: [
      { id: 'orphan1', metadata: { yanSessionID: 'yan-deleted' } },
      { id: 'orphan2', metadata: { yanSessionID: 'yan-deleted-too' } },
      { id: 'alive', metadata: { yanSessionID: 'yan-alive' } },
      { id: 'no-tag', metadata: {} }
    ]
  });

  const db = new DatabaseSync(root.paths.db);
  db.exec('PRAGMA foreign_keys = ON');
  const result = childModule.deleteSessions(db, { pendingIds: [], liveYanSessionIds: ['yan-alive'] });
  db.close();

  assert.equal(result.swept, 2);
  assert.equal(result.deleted, 2);
  assert.equal(rowCount(root.paths.db, 'session'), 2, 'alive and no-tag survive');
});

test('deleteSessions skips missing sessions without failing', async () => {
  const root = tempRuntimeRoot();
  createDeletionDatabase(root.paths.db, { sessions: [{ id: 'exists', metadata: {} }] });

  const db = new DatabaseSync(root.paths.db);
  db.exec('PRAGMA foreign_keys = ON');
  const result = childModule.deleteSessions(db, { pendingIds: ['missing', 'exists'], liveYanSessionIds: [] });
  db.close();

  assert.equal(result.deleted, 1);
  assert.equal(rowCount(root.paths.db, 'session'), 0);
});

// --- ensureKernelDeletesFlushed (spawns child, full integration) -------------

test('ensureKernelDeletesFlushed queues IDs when the kernel is running', async () => {
  const root = tempRuntimeRoot();
  fs.mkdirSync(path.join(root.dataDir, 'sessions'), { recursive: true });
  createDeletionDatabase(root.paths.db, { sessions: [{ id: 'busy', metadata: {} }] });

  const server = net.createServer(() => {});
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const endpoints = path.join(root.runtimeRoot, 'endpoints');
  fs.mkdirSync(endpoints, { recursive: true });
  fs.writeFileSync(path.join(endpoints, `${port}.json`), '{}');

  try {
    queuePendingKernelDeletes(root.runtimeRoot, ['busy']);
    const result = await ensureKernelDeletesFlushed({ runtimeRoot: root.runtimeRoot, dataDir: root.dataDir, sessionsDir: path.join(root.dataDir, 'sessions') });
    assert.equal(result.skipped, 'live-kernel');
    assert.equal(rowCount(root.paths.db, 'session'), 1, 'nothing deleted');
    const queued = readPendingKernelDeletes(root.runtimeRoot);
    assert.deepEqual(queued, ['busy'], 'still queued');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('ensureKernelDeletesFlushed removes queued sessions when no kernel is running', async () => {
  const root = tempRuntimeRoot();
  fs.mkdirSync(path.join(root.dataDir, 'sessions'), { recursive: true });
  createDeletionDatabase(root.paths.db, { sessions: [{ id: 'queued', metadata: {} }] });

  queuePendingKernelDeletes(root.runtimeRoot, ['queued']);
  const result = await ensureKernelDeletesFlushed({ runtimeRoot: root.runtimeRoot, dataDir: root.dataDir, sessionsDir: path.join(root.dataDir, 'sessions') });

  assert.equal(result.ok, true);
  assert.equal(rowCount(root.paths.db, 'session'), 0);
  const queued = readPendingKernelDeletes(root.runtimeRoot);
  assert.deepEqual(queued, [], 'queue cleared');
});

test('ensureKernelDeletesFlushed skips the orphan sweep when no tasks exist', async () => {
  const root = tempRuntimeRoot();
  const sessionsDir = path.join(root.dataDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  createDeletionDatabase(root.paths.db, { sessions: [{ id: 'orphan', metadata: { yanSessionID: 'yan-gone' } }] });

  const result = await ensureKernelDeletesFlushed({ runtimeRoot: root.runtimeRoot, dataDir: root.dataDir, sessionsDir });

  assert.equal(result.skipped, 'no-tasks');
  assert.equal(rowCount(root.paths.db, 'session'), 1, 'nothing deleted');
  const state = readState(root.runtimeRoot);
  assert.ok(state.orphanSweepAt > 0, 'sweep marked done');
  assert.equal(state.orphanSweepSkipped, 'no-tasks');
});

test('ensureKernelDeletesFlushed sweeps orphans when tasks exist', async () => {
  const root = tempRuntimeRoot();
  const sessionsDir = path.join(root.dataDir, 'sessions');
  fs.mkdirSync(sessionsDir, { recursive: true });
  fs.writeFileSync(path.join(sessionsDir, 'yan-alive.json'), '{}');
  createDeletionDatabase(root.paths.db, {
    sessions: [
      { id: 'orphan', metadata: { yanSessionID: 'yan-deleted' } },
      { id: 'alive', metadata: { yanSessionID: 'yan-alive' } }
    ]
  });

  const result = await ensureKernelDeletesFlushed({ runtimeRoot: root.runtimeRoot, dataDir: root.dataDir, sessionsDir });

  assert.equal(result.ok, true);
  assert.equal(result.deleted, 1);
  assert.equal(rowCount(root.paths.db, 'session'), 1);
  assert.equal(scalar(root.paths.db, "SELECT id FROM session"), 'alive');
});

test('ensureKernelDeletesFlushed returns the same promise for concurrent calls', async () => {
  const root = tempRuntimeRoot();
  fs.mkdirSync(path.join(root.dataDir, 'sessions'), { recursive: true });
  createDeletionDatabase(root.paths.db, {});

  const opts = { runtimeRoot: root.runtimeRoot, dataDir: root.dataDir, sessionsDir: path.join(root.dataDir, 'sessions') };
  const p1 = ensureKernelDeletesFlushed(opts);
  const p2 = ensureKernelDeletesFlushed(opts);
  assert.strictEqual(p1, p2, 'same in-flight promise');
  await p1;

  const p3 = ensureKernelDeletesFlushed(opts);
  assert.notStrictEqual(p1, p3, 'new promise after first completes');
  await p3;
});

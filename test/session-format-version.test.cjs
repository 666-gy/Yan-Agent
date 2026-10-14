'use strict';

// Session format versioning + interrupted-Turn closure.
//
// The contract these tests pin:
//   1. An unstamped (v1) record reads back stamped, without being written.
//   2. A read never mutates the file — migration is a read-time transform, so
//      updatedAt is untouched and the sidebar ordering cannot shift.
//   3. A Turn the previous process abandoned is closed on read, in the same
//      vocabulary the Yan Core recovery pass uses.
//   4. A Turn the user aborted on purpose is NOT reclassified as a restart
//      interruption.
//   5. Re-reading is idempotent: no second synthetic message, no drift.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');

const { createSessionStore, isSafeSessionId } = require('../lib/session-store.js');

function temporaryStore() {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-session-format-'));
  const warnings = [];
  const deps = {
    sessionsDir,
    ensureDirs: () => fs.mkdirSync(sessionsDir, { recursive: true }),
    mainWindow: { get: () => null },
    yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} },
    activateWorkspace() {},
    activeRuns: new Map(),
    runAdmissions: new Map(),
    deleteCoreThread: () => ({ ok: true })
  };
  const store = createSessionStore(deps);
  return { store, sessionsDir, warnings, deps };
}

async function writeRaw(sessionsDir, record) {
  const file = path.join(sessionsDir, `${record.id}.json`);
  await fsp.writeFile(file, JSON.stringify(record, null, 2));
  const stat = await fsp.stat(file);
  return { file, stat };
}

const V1_SESSION = {
  id: 'sess_v1record0001',
  title: '旧会话',
  pinned: false,
  workspace: 'C:\\work',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_500_000,
  messages: [
    { role: 'user', content: '做完了吗', ts: 1_700_000_000_000 },
    { role: 'assistant', content: '做完了。', ts: 1_700_000_500_000,
      agentRun: { runId: 'run_done', status: 'completed', startedAt: 1_700_000_000_000,
        completedAt: 1_700_000_500_000, textContent: '做完了。', timeline: [] } }
  ]
};

test('an unstamped v1 record reads back as the current format', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, V1_SESSION);
  const session = await store.readSessionRecord(V1_SESSION.id);
  assert.equal(session.schemaVersion, 2);
  assert.equal(session.id, V1_SESSION.id);
});

test('migration is read-time only: the file and updatedAt are untouched', async () => {
  const { store, sessionsDir } = temporaryStore();
  const { file, stat } = await writeRaw(sessionsDir, V1_SESSION);
  const before = await fsp.readFile(file, 'utf8');
  await store.readSessionRecord(V1_SESSION.id);
  const after = await fsp.readFile(file, 'utf8');
  const afterStat = await fsp.stat(file);
  // Byte-identical: a read must never rewrite the record it is reading.
  assert.equal(after, before);
  assert.equal(afterStat.mtimeMs, stat.mtimeMs);
  const summary = (await store.listSessionSummaries()).find(item => item.id === V1_SESSION.id);
  assert.equal(summary.updatedAt, V1_SESSION.updatedAt, 'updatedAt must not be bumped by a read');
});

test('the summary projection is not widened by the version field', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, V1_SESSION);
  const summary = (await store.listSessionSummaries())[0];
  assert.deepEqual(Object.keys(summary).sort(), [
    'archived', 'archivedAt', 'createdAt', 'hasHandoff', 'id', 'messageCount', 'parentSessionId',
    'pinned', 'title', 'updatedAt', 'workspace', 'workspaceMissing'
  ]);
  assert.equal(summary.schemaVersion, undefined);
});

test('a live Turn found on disk is closed as a restart interruption', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, {
    ...V1_SESSION,
    id: 'sess_live000001',
    messages: [
      { role: 'user', content: '继续', ts: 1_700_000_000_000 },
      { role: 'assistant', content: '正在处理', ts: 1_700_000_100_000,
        agentRun: { runId: 'run_live', status: 'working', startedAt: 1_700_000_000_000,
          textContent: '正在处理', timeline: [] } }
    ]
  });
  const session = await store.readSessionRecord('sess_live000001');
  const run = session.messages[1].agentRun;
  assert.equal(run.status, 'interrupted');
  // The renderer reads this at the run level to tell "app exit" from "user
  // pressed stop"; putting it only inside `interruption` would invert the badge.
  assert.equal(run.recoveredAfterRestart, true);
  assert.equal(run.interruption.previousStatus, 'working');
  assert.ok(run.interruption.detectedAt > 0);
});

test('a user-aborted Turn is left alone', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, {
    ...V1_SESSION,
    id: 'sess_abort00001',
    messages: [
      { role: 'user', content: '停一下', ts: 1_700_000_000_000 },
      { role: 'assistant', content: '已停止', ts: 1_700_000_100_000,
        agentRun: { runId: 'run_abort', status: 'interrupted', startedAt: 1_700_000_000_000,
          completedAt: 1_700_000_100_000, textContent: '已停止', timeline: [] } }
    ]
  });
  const session = await store.readSessionRecord('sess_abort00001');
  const run = session.messages[1].agentRun;
  assert.equal(run.status, 'interrupted');
  // No recoveredAfterRestart and no interruption record: this stays a user abort.
  assert.equal(run.recoveredAfterRestart, undefined);
  assert.equal(run.interruption, undefined);
});

test('a user message with no reply gets one closing message, exactly once', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, {
    ...V1_SESSION,
    id: 'sess_stall00001',
    messages: [{ role: 'user', content: '在吗', ts: 1_700_000_000_000 }]
  });
  const first = await store.readSessionRecord('sess_stall00001');
  assert.equal(first.messages.length, 2);
  assert.equal(first.messages[1].role, 'assistant');
  assert.equal(first.messages[1].yanSynthetic, true);
  assert.equal(first.messages[1].agentRun.status, 'interrupted');
  assert.equal(first.messages[1].agentRun.interruption.previousStatus, 'pending');

  // Re-reading must not append a second closing message. The parsed-record
  // cache is what normally prevents this; the test would catch a cache that
  // stored the pre-closure object.
  const second = await store.readSessionRecord('sess_stall00001');
  assert.equal(second.messages.length, 2);
  const third = await store.readSessionRecord('sess_stall00001');
  assert.equal(third.messages.length, 2);

  // And it must not have been written to disk behind the reader's back.
  const onDisk = JSON.parse(await fsp.readFile(path.join(sessionsDir, 'sess_stall00001.json'), 'utf8'));
  assert.equal(onDisk.messages.length, 1);
});

test('reading an old unanswered tail stays quiet across list/get, eviction and restart', async t => {
  const { store, sessionsDir, deps } = temporaryStore();
  t.after(() => fsp.rm(sessionsDir, { recursive: true, force: true }));
  const warn = t.mock.method(console, 'warn', () => {});
  const record = { ...V1_SESSION, id: 'sess_oldtail0001', messages: [
    ...V1_SESSION.messages, { role: 'user', content: '继续', ts: 1_700_000_600_000 }
  ] };
  const { file, stat } = await writeRaw(sessionsDir, record);
  const before = await fsp.readFile(file, 'utf8');
  assert.equal((await store.listSessionSummaries())[0].messageCount, 4);
  assert.equal((await store.readSessionRecord(record.id)).messages.length, 4);
  for (let i = 0; i < 7; i++) {
    const other = { ...V1_SESSION, id: `sess_cachefill000${i}` };
    await writeRaw(sessionsDir, other);
    await store.readSessionRecord(other.id);
  }
  assert.equal((await store.readSessionRecord(record.id)).messages.length, 4);
  const restarted = createSessionStore(deps);
  await restarted.listSessionSummaries();
  const recovered = await restarted.readSessionRecord(record.id);
  assert.equal(recovered.messages[3].agentRun.status, 'interrupted');
  assert.equal(recovered.messages[3].agentRun.recoveredAfterRestart, true);
  assert.equal(warn.mock.callCount(), 0, 'a read-time projection is not a new interruption');
  assert.equal(await fsp.readFile(file, 'utf8'), before);
  assert.equal((await fsp.stat(file)).mtimeMs, stat.mtimeMs);
});

test('active and admitted turns are not interrupted, including after a cache state change', async t => {
  const { store, sessionsDir, deps } = temporaryStore();
  t.after(() => fsp.rm(sessionsDir, { recursive: true, force: true }));
  const record = { ...V1_SESSION, id: 'sess_active0001', messages: [V1_SESSION.messages[0]] };
  await writeRaw(sessionsDir, record);
  assert.equal((await store.readSessionRecord(record.id)).messages.length, 2);
  assert.equal((await store.listSessionSummaries())[0].messageCount, 2);

  deps.runAdmissions.set('run_admitted', record.id);
  assert.equal((await store.readSessionRecord(record.id)).messages.length, 1, 'cached recovery must not leak into an admitted turn');
  assert.equal((await store.listSessionSummaries())[0].messageCount, 1);
  deps.activeRuns.set('run_active', { yanSessionId: record.id });
  deps.runAdmissions.clear();
  assert.equal((await store.readSessionRecord(record.id)).messages.length, 1);
  assert.equal((await store.listSessionSummaries())[0].messageCount, 1);

  // An unrelated active session must not prevent recovery of this record.
  deps.activeRuns.set('run_active', { yanSessionId: 'sess_someother01' });
  assert.equal((await store.readSessionRecord(record.id)).messages.length, 2);
  assert.equal((await store.listSessionSummaries())[0].messageCount, 2);
});

test('an assistant run owned by the current process retains its working status', async t => {
  const { store, sessionsDir, deps } = temporaryStore();
  t.after(() => fsp.rm(sessionsDir, { recursive: true, force: true }));
  const record = structuredClone(V1_SESSION);
  record.id = 'sess_working0001';
  record.messages[1].agentRun.status = 'working';
  await writeRaw(sessionsDir, record);
  deps.activeRuns.set('run_owned', { yanSessionId: record.id });
  const active = await store.readSessionRecord(record.id);
  assert.equal(active.messages[1].agentRun.status, 'working');
  assert.equal(active.messages[1].agentRun.recoveredAfterRestart, undefined);
  deps.activeRuns.clear();
  const abandoned = await store.readSessionRecord(record.id);
  assert.equal(abandoned.messages[1].agentRun.status, 'interrupted');
  assert.equal(active.messages[1].agentRun.status, 'working', 'state changes must not mutate an earlier caller’s record');
});

test('a completed Turn is untouched and only the last Turn is examined', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, {
    ...V1_SESSION,
    id: 'sess_two0000001',
    messages: [
      // An earlier Turn that also died mid-flight. Closing it would rewrite
      // history the user already scrolled past, so it must be left as found.
      { role: 'user', content: '第一轮', ts: 1_700_000_000_000 },
      { role: 'assistant', content: '', ts: 1_700_000_050_000,
        agentRun: { runId: 'run_old', status: 'working', startedAt: 1_700_000_000_000, timeline: [] } },
      { role: 'user', content: '第二轮', ts: 1_700_000_100_000 },
      { role: 'assistant', content: '好了', ts: 1_700_000_200_000,
        agentRun: { runId: 'run_new', status: 'completed', startedAt: 1_700_000_100_000,
          completedAt: 1_700_000_200_000, textContent: '好了', timeline: [] } }
    ]
  });
  const session = await store.readSessionRecord('sess_two0000001');
  assert.equal(session.messages.length, 4);
  assert.equal(session.messages[1].agentRun.status, 'working', 'earlier history is not rewritten');
  assert.equal(session.messages[3].agentRun.status, 'completed');
});

test('save stamps the current version so a migrated record stops re-migrating', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, V1_SESSION);
  const session = await store.readSessionRecord(V1_SESSION.id);
  assert.equal(session.schemaVersion, 2);
  // The renderer round-trips what it read; the save path must still stamp.
  await store.saveSession({ ...session, schemaVersion: undefined });
  const onDisk = JSON.parse(await fsp.readFile(path.join(sessionsDir, `${V1_SESSION.id}.json`), 'utf8'));
  assert.equal(onDisk.schemaVersion, 2);
});

test('a record from a newer build is left exactly as found', async () => {
  const { store, sessionsDir } = temporaryStore();
  await writeRaw(sessionsDir, {
    ...V1_SESSION,
    id: 'sess_future0001',
    schemaVersion: 99,
    futureField: { kept: true }
  });
  const session = await store.readSessionRecord('sess_future0001');
  assert.equal(session.schemaVersion, 99, 'a reader must never renumber what it cannot understand');
  assert.deepEqual(session.futureField, { kept: true });
});

test('a corrupt record does not throw', async () => {
  const { store, sessionsDir } = temporaryStore();
  await fsp.writeFile(path.join(sessionsDir, 'sess_corrupt001.json'), '{ not json');
  await assert.rejects(() => store.readSessionRecord('sess_corrupt001'));
  // The sidebar tolerates it, which is what keeps one bad file from blanking
  // the entire task list.
  const summaries = await store.listSessionSummaries();
  assert.deepEqual(summaries, []);
});

test('session ids are still validated', async () => {
  assert.equal(isSafeSessionId('sess_abc12345'), true);
  assert.equal(isSafeSessionId('sess_../../etc'), false);
});

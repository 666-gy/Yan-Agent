'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { collectStorageReview } = require('../lib/storage-stats');
const { createSessionStore } = require('../lib/session-store');
function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cleanup-'));
  const sessionsDir = path.join(dataDir, 'sessions'); fs.mkdirSync(sessionsDir);
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const activeRuns = new Map();
  const store = createSessionStore({ sessionsDir, ensureDirs() {}, activeRuns, runAdmissions: new Map(),
    mainWindow: { get: () => null }, yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} }, activateWorkspace() {}, deleteCoreThread: () => ({ ok: true }) });
  async function chat(age, title) {
    const record = await store.createFreshSessionRecord({ title });
    record.updatedAt = record.createdAt = Date.now() - age * 86400000;
    record.messages = [{ role: 'assistant', content: '中文', agentRun: { subagents: [{ id: 'child', subagents: [{ id: 'grandchild' }] }] } }];
    fs.writeFileSync(store.sessionPath(record.id), JSON.stringify(record, null, 2));
    return record;
  }
  return { dataDir, store, chat, activeRuns };
}
test('review applies date and archive filters, reports real sizes and counts nested subagents without sending content', async t => {
  const f = fixture(t);
  const archived = await f.chat(100, '旧归档'), active = await f.chat(200, '旧聊天'), recent = await f.chat(5, '新聊天');
  f.store.setSessionArchivedRecord([archived.id, recent.id], true);
  const result = await collectStorageReview({ dataDir: f.dataDir, options: { days: 30, scope: 'archived' } });
  assert.deepEqual(result.chats.map(x => x.id), [archived.id]);
  assert.equal(result.chats[0].subagents, 2);
  assert.equal(result.chats[0].bytes, fs.statSync(f.store.sessionPath(archived.id)).size);
  assert.equal(Object.hasOwn(result.chats[0], 'messages'), false);
  assert.deepEqual((await collectStorageReview({ dataDir: f.dataDir, options: { days: 180, scope: 'all' } })).chats.map(x => x.id), [active.id]);
  assert.equal((await collectStorageReview({ dataDir: f.dataDir, options: { days: 365, scope: 'all' } })).chats.length, 0);
  await assert.rejects(collectStorageReview({ dataDir: f.dataDir, options: { days: 1, scope: 'all' } }), /筛选条件无效/);
});
test('cleanup rechecks recency, archive membership and running status; successful deletion removes the real file', async t => {
  const f = fixture(t);
  const old = await f.chat(100, '旧聊天'), recent = await f.chat(1, '新聊天');
  f.store.setSessionArchivedRecord([old.id], true);
  assert.equal((await f.store.deleteSessionRecord(recent.id, { confirmed: true, cleanupDays: 30 })).code, 'cleanup-filter-changed');
  assert.equal((await f.store.deleteSessionRecord(old.id, { confirmed: true, cleanupDays: 365 })).code, 'cleanup-filter-changed');
  f.activeRuns.set('run', { yanSessionId: old.id });
  assert.equal((await f.store.deleteSessionRecord(old.id, { confirmed: true, cleanupDays: 30, archivedOnly: true })).ok, false);
  f.activeRuns.clear();
  f.store.setSessionArchivedRecord([old.id], false);
  assert.equal((await f.store.deleteSessionRecord(old.id, { confirmed: true, cleanupDays: 30, archivedOnly: true })).ok, false);
  f.store.setSessionArchivedRecord([old.id], true);
  // Simulate a chat updated after its review row was shown.
  const changed = { ...old, updatedAt: Date.now() }; fs.writeFileSync(f.store.sessionPath(old.id), JSON.stringify(changed));
  assert.equal((await f.store.deleteSessionRecord(old.id, { confirmed: true, cleanupDays: 30, archivedOnly: true })).ok, false);
  assert.equal(fs.existsSync(f.store.sessionPath(old.id)), true);
  fs.writeFileSync(f.store.sessionPath(old.id), JSON.stringify(old));
  assert.equal((await f.store.deleteSessionRecord(old.id, { confirmed: true, cleanupDays: 30, archivedOnly: true })).ok, true);
  assert.equal(fs.existsSync(f.store.sessionPath(old.id)), false);
  assert.equal(fs.existsSync(f.store.sessionPath(recent.id)), true);
});

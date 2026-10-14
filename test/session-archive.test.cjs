const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createSessionStore } = require('../lib/session-store');
function fixture(t) {
  const sessionsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-archive-'));
  t.after(() => fs.rmSync(sessionsDir, { recursive:true, force:true }));
  const activeRuns = new Map(), deleted = [];
  const deps = { sessionsDir, ensureDirs(){}, mainWindow:{get:()=>null}, yanagent:{migrateMemoryToWorkspace(){},ensureYanagent(){}}, activateWorkspace(){}, activeRuns, runAdmissions:new Map(), deleteCoreThread(id){deleted.push(id);return {ok:true};} };
  return { store:createSessionStore(deps), reopen:()=>createSessionStore(deps), activeRuns, deleted };
}
test('archive survives stale saves and restart, preserves full history, excludes blank reuse, restores original location', async t => {
  const {store,reopen} = fixture(t);
  const chat = await store.createFreshSessionRecord({ workspace:'C:/project', title:'保留消息' });
  chat.messages = [{role:'user',content:'keep me'}]; await store.saveSession(chat);
  const stale = JSON.parse(JSON.stringify(chat));
  assert.equal(store.setSessionArchivedRecord([chat.id],true).ok,true);
  stale.messages.push({role:'assistant',content:'completed while archived'}); await store.saveSession(stale);
  assert.equal((await store.listSessionSummaries()).length,0);
  assert.equal((await reopen().listSessionSummaries({archived:true}))[0].id,chat.id);
  assert.equal((await store.readSessionRecord(chat.id)).messages.length,2);
  const blank = await store.createFreshSessionRecord(); store.setSessionArchivedRecord([blank.id],true);
  assert.notEqual((await store.createOrReuseSessionRecord()).session.id,blank.id);
  store.setSessionArchivedRecord([chat.id],false);
  assert.equal((await store.listSessionSummaries()).find(s=>s.id===chat.id).workspace,path.normalize('C:/project'));
});
test('batch scope, running deletion protection, permanent disk deletion and restored-chat guard', async t => {
  const {store,activeRuns} = fixture(t);
  const a = await store.createFreshSessionRecord({title:'A'}), b = await store.createFreshSessionRecord({title:'B'}), c = await store.createFreshSessionRecord({title:'C'});
  store.setSessionArchivedRecord([a.id,b.id],true);
  assert.deepEqual((await store.listSessionSummaries()).map(s=>s.id),[c.id]);
  activeRuns.set('run',{yanSessionId:a.id});
  assert.equal((await store.deleteSessionRecord(a.id,{confirmed:true,archivedOnly:true})).ok,false);
  activeRuns.clear();
  assert.equal((await store.deleteSessionRecord(a.id,{confirmed:true,archivedOnly:true})).ok,true);
  assert.equal(fs.existsSync(store.sessionPath(a.id)),false);
  store.setSessionArchivedRecord([b.id],false);
  assert.equal((await store.deleteSessionRecord(b.id,{confirmed:true,archivedOnly:true})).ok,false);
  assert.equal(fs.existsSync(store.sessionPath(b.id)),true);
  assert.equal(fs.existsSync(store.sessionPath(c.id)),true);
});

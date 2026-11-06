'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');
const { aggregateUsage, tokenUsage, normalizeOptions, readUsageDatabase } = require('../lib/usage-stats');
const now = Date.parse('2026-10-01T15:40:00Z');
const row = (created, extra = {}) => ({ session_id: 'root', role: 'assistant', model: 'model', provider: 'provider', created: Date.parse(created), tokens: { input: 100, output: 20, reasoning: 5, cache: { read: 200, write: 30 }, total: 355 }, ...extra });

test('V2 statistics read native messages and ignore control events', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-usage-v2-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'v2.db');
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE session_v2(id TEXT, parent_id TEXT); CREATE TABLE session_message(session_id TEXT, time_created INTEGER, type TEXT, data TEXT)');
  db.exec("INSERT INTO session_v2 VALUES ('v2-root', NULL), ('v2-child', 'v2-root')");
  const insert = db.prepare('INSERT INTO session_message VALUES (?, ?, ?, ?)');
  insert.run('v2-child', now - 1, 'assistant', JSON.stringify({ model: { id: 'deepseek', providerID: 'ds' }, tokens: { input: 5, output: 2, reasoning: 3, cache: { read: 10, write: 1 } } }));
  insert.run('v2-root', now - 1, 'idle', '{}');
  db.close();
  const stats = readUsageDatabase([path.join(dir, 'absent.db'), file], {}, now);
  assert.equal(stats.overview.total, 21);
  assert.equal(stats.overview.messages, 1);
  assert.equal(stats.models[0].modelId, 'deepseek');
  assert.equal(stats.models[0].providerId, 'ds');
});

test('all token categories counted once; invalid counters never poison totals', () => {
  assert.equal(tokenUsage(row('2026-10-01').tokens).total, 355);
  assert.equal(tokenUsage({ input: -1, output: Infinity, reasoning: '20', cache: { read: NaN, write: 4 } }).total, 4);
});
test('root sessions deduplicate children; provider identities and model/day totals agree', () => {
  const data = aggregateUsage([
    row('2026-10-01T01:00Z', { role: 'user', tokens: null }),
    row('2026-10-01T02:00Z'),
    row('2026-10-01T03:00Z', { session_id: 'child' }),
    row('2026-10-01T04:00Z', { provider: 'other' }),
    row('2026-10-01T04:01Z', { tokens: null })
  ], new Map([['root', null], ['child', 'root']]), { timeZone: 'Asia/Shanghai' }, now);
  assert.equal(data.overview.sessions, 1);
  assert.equal(data.overview.messages, 5);
  assert.equal(data.overview.total, 1065);
  assert.equal(data.overview.unreportedMessages, 1);
  assert.equal(data.overview.peakHour, 12);
  assert.equal(data.models.length, 2);
  assert.equal(data.models[0].total, 710);
  assert.equal(data.days[0].total, data.overview.total);
  assert.equal(data.models.reduce((n, m) => n + m.share, 0), 1);
});
test('7d/30d use local calendar boundaries, excluding future timestamps', () => {
  const rows = [row('2026-09-24T15:59:59Z'), row('2026-09-24T16:00:00Z'), row('2026-09-01T16:00:00Z'), row('2026-10-02T00:00Z')];
  assert.equal(aggregateUsage(rows, new Map(), { range: '7d', timeZone: 'Asia/Shanghai' }, now).overview.messages, 1);
  assert.equal(aggregateUsage(rows, new Map(), { range: '30d', timeZone: 'Asia/Shanghai' }, now).overview.messages, 3);
  assert.equal(aggregateUsage(rows, new Map(), { range: '7d', timeZone: 'UTC' }, now).overview.messages, 0);
});
test('DST, empty history, malformed metadata and invalid IPC options', () => {
  const data = aggregateUsage([row('2026-03-08T06:59Z'), row('2026-03-08T07:01Z', { tokens: '{broken' })], new Map(), { range: '7d', timeZone: 'America/New_York' }, Date.parse('2026-03-08T18:00Z'));
  assert.equal(data.overview.activeDays, 1);
  assert.equal(data.overview.total, 355);
  assert.equal(data.overview.unreportedMessages, 1);
  const empty = aggregateUsage([], new Map(), {}, now);
  assert.equal(empty.overview.peakHour, null);
  assert.equal(empty.overview.favoriteModel, null);
  assert.equal(empty.overview.total, 0);
  assert.throws(() => normalizeOptions({ range: 'forever' }));
  assert.throws(() => normalizeOptions({ timeZone: 'not-a-zone' }));
});
test('read-only SQLite snapshot reflects message updates once and retained archived/subagent records', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-usage-unit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'opencode.db');
  assert.equal(readUsageDatabase(file, {}, now).overview.total, 0);
  assert.equal(fs.existsSync(file), false);
  const db = new DatabaseSync(file);
  db.exec('CREATE TABLE session(id TEXT PRIMARY KEY, parent_id TEXT, time_archived INTEGER); CREATE TABLE message(id TEXT PRIMARY KEY, session_id TEXT, time_created INTEGER, data TEXT)');
  db.exec("INSERT INTO session VALUES ('root', NULL, 1), ('child', 'root', NULL)");
  const insert = db.prepare('INSERT INTO message VALUES (?, ?, ?, ?)');
  insert.run('m1', 'child', now - 1000, JSON.stringify({ role: 'assistant', modelID: '<model>', providerID: 'p', tokens: { input: 10, output: 2 } }));
  insert.run('broken', 'root', now - 1000, '{');
  assert.equal(readUsageDatabase(file, {}, now).overview.total, 12);
  db.prepare('UPDATE message SET data = ? WHERE id = ?').run(JSON.stringify({ role: 'assistant', modelID: '<model>', providerID: 'p', tokens: { input: 10, output: 5 } }), 'm1');
  const result = readUsageDatabase(file, {}, now);
  assert.equal(result.overview.total, 15);
  assert.equal(result.overview.messages, 1);
  assert.equal(result.overview.sessions, 1);
  assert.equal(result.models[0].modelId, '<model>');
  assert.equal(db.prepare('SELECT count(*) n FROM message').get().n, 2);
  db.close();
});

 test('friend scope includes child runs, excludes other friends, supports 90 days and empty scope', () => {
  const rows = [row('2026-08-01'), row('2026-10-01', { session_id: 'child' }), row('2026-10-01', { session_id: 'other' }), row('2026-06-01')];
  const sessions = new Map([['child', 'root']]);
  const scoped = aggregateUsage(rows, sessions, { range: '90d', sessionIds: ['root'] }, now);
  assert.equal(scoped.overview.total, 710);
  assert.equal(aggregateUsage(rows, sessions, { range: '7d', sessionIds: ['root'] }, now).overview.total, 355);
  assert.equal(aggregateUsage(rows, sessions, { sessionIds: [] }, now).overview.total, 0);
});


test('isolated runtime databases count Bot usage once after migration', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-usage-pool-'));
  t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));
  const {usageDatabaseFiles} = require('../lib/usage-stats');
  for (const root of [dir,path.join(dir,'opencode-sessions-v2','a'.repeat(64))]) {
    const file=path.join(root,'opencode-runtime-v2','data','opencode','opencode.db');
    fs.mkdirSync(path.dirname(file),{recursive:true}); const db=new DatabaseSync(file);
    db.exec("CREATE TABLE session_v2(id TEXT, parent_id TEXT); CREATE TABLE session_message(session_id TEXT, time_created INTEGER, type TEXT, data TEXT); INSERT INTO session_v2 VALUES ('bot',NULL)");
    db.prepare('INSERT INTO session_message VALUES (?,?,?,?)').run('bot',now-1,'assistant',JSON.stringify({model:{id:'model',providerID:'provider'},tokens:{input:40,output:20,cache:{read:60}}})); db.close();
  }
  const stats=readUsageDatabase(usageDatabaseFiles(dir),{sessionIds:['bot']},now);
  assert.equal(stats.overview.total,120); assert.equal(stats.models[0].cacheRead,60);
  assert.equal(readUsageDatabase(usageDatabaseFiles(dir),{sessionIds:['other']},now).models.length,0);
});

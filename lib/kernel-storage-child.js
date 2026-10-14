'use strict';
// The process that touches the kernel database before a kernel starts.
//
// Not a worker thread: VACUUM and a large DELETE are single synchronous native
// calls that cannot be interrupted, so the only way to take the database back
// from a stalled cleanup is to kill the process doing it.
//
// Protocol: one JSON job in argv[2]. stdout carries one JSON line per step
// ({progress}) and a final report line ({report}). The parent owns the timeout
// and the cooldown file; this process only does the work and says what it did.
const net = require('node:net');
const fs = require('node:fs');
const { DatabaseSync } = require('node:sqlite');
const { LIMITS, V2_TABLES, measureFiles, planStorageMaintenance, compactPermissionRules } = require('./kernel-storage');

const line = value => { try { process.stdout.write(`${JSON.stringify(value)}\n`); } catch {} };
const progress = (step, fields = {}) => line({ progress: step, ...fields });

const portAlive = port => new Promise(resolve => {
  const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
  const done = ok => { try { socket.destroy(); } catch {} resolve(ok); };
  socket.setTimeout(400).once('connect', () => done(true)).once('timeout', () => done(false)).once('error', () => done(false));
});

function collectFacts(db, runtimeRoot, limits, tempFreeBytes) {
  const scalar = sql => {
    try { return Number(Object.values(db.prepare(sql).get() || {})[0]) || 0; } catch { return 0; }
  };
  const table = name => {
    const exists = !!db.prepare("select 1 from sqlite_master where type = 'table' and name = ?").get(name);
    // An unreadable projection must not be mistaken for an empty one.
    let rows = null;
    if (exists) {
      try { rows = Number(db.prepare(`select count(*) as count from "${name}"`).get().count); } catch {}
    }
    return { name, exists, rows };
  };
  const event = table('event');
  let sessions = [];
  try {
    // octet_length comes from the record header, so ranking sessions by rule
    // size never reads the rule text itself.
    sessions = db.prepare(
      'select id, octet_length(permission) as bytes from session where octet_length(permission) > ? order by bytes desc limit ?'
    ).all(limits.permissionBytes, limits.permissionSessions).map(row => ({ id: String(row.id), bytes: Number(row.bytes) || 0 }));
  } catch {}
  return {
    files: measureFiles(runtimeRoot),
    rows: { event: event.rows },
    // Reads record sizes without loading multi-megabyte JSON strings into JS.
    eventBytes: event.exists ? scalar('select coalesce(sum(octet_length(data)), 0) from event') : 0,
    projectionTables: V2_TABLES.map(table),
    sessions,
    pageSize: scalar('PRAGMA page_size'),
    pageCount: scalar('PRAGMA page_count'),
    freelistCount: scalar('PRAGMA freelist_count'),
    autoVacuum: scalar('PRAGMA auto_vacuum'),
    tempFreeBytes
  };
}

// Numbers only - no session contents ever leave this process.
const summarize = facts => ({
  dbBytes: facts.files.dbBytes,
  walBytes: facts.files.walBytes,
  freeDiskBytes: facts.files.freeBytes,
  eventRows: facts.rows.event,
  eventBytes: facts.eventBytes,
  permissionSessions: facts.sessions.length,
  pageSize: facts.pageSize,
  pageCount: facts.pageCount,
  freelistCount: facts.freelistCount,
  autoVacuum: facts.autoVacuum
});

function apply(db, action) {
  if (action.kind === 'clear-event-log') {
    // Nothing reads this log yet and its projections are empty; the kernel's
    // own migration resets it the same way.
    db.exec('BEGIN IMMEDIATE');
    try {
      db.exec('DELETE FROM event');
      if (db.prepare("select 1 from sqlite_master where type = 'table' and name = 'event_sequence'").get()) db.exec('DELETE FROM event_sequence');
      db.exec('COMMIT');
    } catch (error) {
      try { db.exec('ROLLBACK'); } catch {}
      throw error;
    }
    return { rows: action.rows };
  }
  if (action.kind === 'compact-permissions') {
    const row = db.prepare('select permission from session where id = ?').get(action.sessionID);
    const rules = JSON.parse(String(row?.permission ?? 'null'));
    if (!Array.isArray(rules)) return { skipped: 'not-an-array' };
    const compacted = compactPermissionRules(rules);
    if (compacted.length === rules.length) return { before: rules.length, after: rules.length };
    // Only this column of this row changes; the where clause re-checks the
    // value so a concurrent writer (there should be none) is never overwritten.
    db.prepare('update session set permission = ? where id = ? and permission = ?')
      .run(JSON.stringify(compacted), action.sessionID, row.permission);
    return { before: rules.length, after: compacted.length };
  }
  if (action.kind === 'checkpoint') {
    const result = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get() || {};
    return { busy: Number(result.busy) || 0 };
  }
  if (action.kind === 'vacuum' && action.mode === 'incremental') {
    db.exec(`PRAGMA incremental_vacuum(${Math.max(1, Math.floor(Number(action.pages) || 0))})`);
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    return { pages: action.pages };
  }
  if (action.kind === 'vacuum' && action.mode === 'full') {
    // Switching to incremental makes every later give-back a cheap page move
    // instead of another full rebuild; the switch itself only takes effect
    // through this VACUUM.
    db.exec('PRAGMA auto_vacuum = INCREMENTAL');
    db.exec('VACUUM');
    db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    return {};
  }
  return { skipped: 'unknown-action' };
}

// Kernel sessions of tasks the user permanently deleted. Deleting a session row
// cascades to its messages, parts and todos, but not to its child sessions:
// session.parent_id has no foreign key, so every descendant is found and
// deleted explicitly.
function deleteSessions(db, job) {
  const live = Array.isArray(job.liveYanSessionIds) ? new Set(job.liveYanSessionIds.map(String)) : null;
  const yanIdOf = db.prepare("select json_extract(metadata, '$.yanSessionID') as yan from session where id = ?");
  const exists = db.prepare('select 1 from session where id = ?');
  const childrenOf = db.prepare('select id from session where parent_id = ?');
  const remove = db.prepare('delete from session where id = ?');
  const ownerOf = id => { try { return String(yanIdOf.get(id)?.yan ?? ''); } catch { return ''; } };

  const roots = new Set();
  let keptLive = 0;
  for (const raw of Array.isArray(job.pendingIds) ? job.pendingIds : []) {
    const id = String(raw || '').trim();
    if (!id) continue;
    // A session still claimed by a task that exists is that task's history.
    const owner = ownerOf(id);
    if (live && owner && live.has(owner)) { keptLive += 1; continue; }
    roots.add(id);
  }
  let swept = 0;
  if (live && live.size) {
    // Only sessions tagged with a Yan task are candidates; observer, reviewer
    // and summary sessions carry no tag and are never touched here.
    let tagged = [];
    try {
      tagged = db.prepare("select id, json_extract(metadata, '$.yanSessionID') as yan from session where json_extract(metadata, '$.yanSessionID') is not null").all();
    } catch {}
    for (const row of tagged) {
      const owner = String(row.yan ?? '');
      if (!owner || live.has(owner) || roots.has(String(row.id))) continue;
      roots.add(String(row.id));
      swept += 1;
    }
  }

  const doomed = new Set();
  const queue = [...roots];
  while (queue.length) {
    const id = queue.shift();
    if (doomed.has(id)) continue;
    doomed.add(id);
    for (const child of childrenOf.all(id)) queue.push(String(child.id));
  }
  if (!doomed.size) return { roots: 0, descendants: 0, deleted: 0, swept, keptLive };

  db.exec('BEGIN IMMEDIATE');
  let deleted = 0;
  try {
    const tables = new Set(db.prepare("select name from sqlite_master where type = 'table'").all().map(row => row.name));
    const removeEvents = tables.has('event') ? db.prepare('DELETE FROM event WHERE aggregate_id = ?') : null;
    const removeSequence = tables.has('event_sequence') ? db.prepare('DELETE FROM event_sequence WHERE aggregate_id = ?') : null;
    for (const id of doomed) {
      if (job.purgeOnly && exists.get(id)) throw new Error('内核会话仍存在，清理尚未完成');
      removeEvents?.run(id);
      removeSequence?.run(id);
      if (!job.purgeOnly) deleted += Number(remove.run(id).changes) || 0;
    }
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch {}
    throw error;
  }
  return { roots: roots.size, descendants: doomed.size - roots.size, deleted, swept, keptLive };
}

async function deleteSessionsMain(job) {
  for (const port of Array.isArray(job.endpointPorts) ? job.endpointPorts : []) {
    // A running kernel owns the database; its own delete API is the way in.
    if (await portAlive(port) && !job.purgeOnly) return { ok: true, skipped: 'live-kernel', deleted: 0 };
  }
  const files = measureFiles(String(job.runtimeRoot || ''));
  // Only a genuinely missing database is an empty store. Inaccessible, empty
  // or invalid files must not turn a failed deletion into success.
  let databaseStat;
  try { databaseStat = fs.statSync(files.paths.db); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    for (const suffix of ['-wal', '-shm', '-journal']) {
      try {
        fs.statSync(files.paths.db + suffix);
        throw new Error('内核数据库缺失但日志仍存在，无法确认清理完成');
      } catch (sidecarError) { if (sidecarError.code !== 'ENOENT') throw sidecarError; }
    }
    return { ok: true, skipped: 'no-database', deleted: 0 };
  }
  if (!databaseStat.isFile() || databaseStat.size === 0) throw new Error('内核数据库异常，无法确认清理完成');
  const db = new DatabaseSync(files.paths.db, { timeout: 5000 });
  try {
    // Cascades to messages, parts and todos depend on this.
    db.exec('PRAGMA foreign_keys = ON');
    db.exec('PRAGMA secure_delete = ON');
    progress('action', { kind: 'delete-sessions' });
    const result = deleteSessions(db, job);
    const checkpoint = db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();
    if (Number(checkpoint?.busy)) throw new Error('内核日志仍被占用，无法确认清理完成');
    return { ok: true, ...result };
  } finally {
    try { db.close(); } catch {}
  }
}

async function main() {
  const job = JSON.parse(process.argv[2] || '{}');
  if (job.mode === 'delete-sessions') return deleteSessionsMain(job);
  const runtimeRoot = String(job.runtimeRoot || '');
  const limits = job.limits || {};
  const state = job.state || {};
  const report = { ok: true, actions: [], warnings: [] };

  let livePort = 0;
  for (const port of Array.isArray(job.endpointPorts) ? job.endpointPorts : []) {
    if (await portAlive(port)) { livePort = Number(port); break; }
  }

  const files = measureFiles(runtimeRoot);
  if (!files.exists) return { ...report, skipped: 'no-database' };
  const db = new DatabaseSync(files.paths.db, { readOnly: !!livePort, timeout: 5000 });
  try {
    const mergedLimits = { ...LIMITS, ...limits };
    let facts = collectFacts(db, runtimeRoot, mergedLimits, Number(job.tempFreeBytes) || 0);
    report.before = summarize(facts);
    const first = planStorageMaintenance(facts, { limits, state, liveKernel: !!livePort, liveKernelPort: livePort });
    report.warnings.push(...first.warnings);
    if (first.skipped) report.skipped = first.skipped;

    const run = action => {
      const started = Date.now();
      progress('action', { kind: action.kind, mode: action.mode });
      try {
        const result = apply(db, action);
        report.actions.push({ kind: action.kind, mode: action.mode, sessionID: action.sessionID, ok: true, ...result, ms: Date.now() - started });
      } catch (error) {
        report.ok = false;
        report.actions.push({ kind: action.kind, mode: action.mode, sessionID: action.sessionID, ok: false, ms: Date.now() - started, error: String(error?.message || error).slice(0, 300) });
      }
    };

    // Cleanup first; its freed pages are what the rebuild decision is about.
    for (const action of first.actions.filter(item => item.kind !== 'vacuum')) run(action);
    if (livePort) return report;

    facts = collectFacts(db, runtimeRoot, mergedLimits, Number(job.tempFreeBytes) || 0);
    const second = planStorageMaintenance(facts, { limits, state });
    for (const warning of second.warnings) {
      if (warning.kind.startsWith('vacuum-')) report.warnings.push(warning);
    }
    const vacuum = second.actions.find(item => item.kind === 'vacuum');
    if (vacuum) run(vacuum);
    report.after = summarize(collectFacts(db, runtimeRoot, mergedLimits, Number(job.tempFreeBytes) || 0));
    return report;
  } finally {
    try { db.close(); } catch {}
  }
}

const fail = error => ({ report: { ok: false, actions: [], warnings: [], error: String(error?.message || error).slice(0, 300) } });

if (require.main === module) {
  main().then(report => line({ report }), error => { line(fail(error)); process.exitCode = 1; });
}

module.exports = { deleteSessions };

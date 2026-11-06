'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { setTimeout: delay } = require('node:timers/promises');
const { execFile } = require('node:child_process');
const defaultLedger = path.join(os.homedir(), '.yanagent', 'locks.sqlite');
const busy = error => /locked|busy/i.test(error.message);
const shellSupervisor = path.join(__dirname, '../native/yan-shell-job.exe')
  .replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
async function processIdentity(pid) {
  if (process.platform !== 'win32') {
    try { return fs.readFileSync(`/proc/${pid}/stat`, 'utf8').split(') ')[1].split(' ')[19]; } catch { return ''; }
  }
  return new Promise(resolve => execFile(shellSupervisor, ['--process-start', String(pid)],
    { windowsHide: true, timeout: 2000 }, (error, output) => resolve(error ? '' : output.trim())));
}
let ownIdentity;
async function ownerAlive(row) {
  if (!alive(row.pid)) return false;
  if (!row.identity) return true; // Legacy rows cannot establish PID reuse.
  const identity = row.pid === process.pid ? await (ownIdentity ||= processIdentity(process.pid)) : await processIdentity(row.pid);
  return !identity || identity === row.identity;
}
async function openLedger(ledger, signal, deadline = Date.now() + 30000) {
  fs.mkdirSync(path.dirname(ledger), { recursive: true });
  const db = new (require('node:sqlite').DatabaseSync)(ledger);
  try {
    db.exec('PRAGMA busy_timeout=0');
    for (;;) {
      signal?.throwIfAborted();
      try {
        db.exec('CREATE TABLE IF NOT EXISTS claims (id TEXT PRIMARY KEY, pid INTEGER, owner TEXT, scopes TEXT); CREATE TABLE IF NOT EXISTS claim_identities (id TEXT PRIMARY KEY, identity TEXT)');
        // Keep the legacy four-column table compatible with an older desktop
        // still running during upgrade. Identity belongs in a companion table.
        if (db.prepare('PRAGMA table_info(claims)').all().some(column => column.name === 'identity')) {
          db.exec('BEGIN IMMEDIATE');
          try { db.exec('INSERT OR REPLACE INTO claim_identities SELECT id,identity FROM claims; ALTER TABLE claims DROP COLUMN identity; COMMIT'); }
          catch (error) { db.exec('ROLLBACK'); throw error; }
        }
        return db;
      } catch (error) {
        if (!busy(error) || Date.now() >= deadline) throw error;
        await delay(50, undefined, { signal });
      }
    }
  } catch (error) { db.close(); throw error; }
}

// One transactional ledger per OS user, shared by all kernel processes.
function canonical(file) {
  if (file === '*') return file;
  let current = path.resolve(file), suffix = [];
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current);
    if (parent === current) break;
    suffix.unshift(path.basename(current)); current = parent;
  }
  const resolved = path.join(fs.realpathSync.native(current), ...suffix);
  return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
}
function overlaps(a, b) {
  return a === '*' || b === '*' || a === b || a.startsWith(b + path.sep) || b.startsWith(a + path.sep);
}
function alive(pid) {
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}
async function supervisedJobStopped(name) {
  if (process.platform !== 'win32' || !/^Local\\YanShell-[a-f0-9-]+$/.test(name)) return false;
  return new Promise(resolve => execFile(shellSupervisor, ['--job-active', name],
    { windowsHide: true, timeout: 2000 }, error => resolve(!error)));
}
async function acquireFiles(files, { signal, owner = '', recoverOnExit = true, supervisorName, waitMs = 30000, onWait,
  ledger = defaultLedger } = {}) {
  signal?.throwIfAborted();
  const scopes = [...new Set(files.map(canonical))];
  if (!scopes.length) throw new Error('Mutation requires a lock scope');
  const id = randomUUID();
  const started = Date.now(), budget = Math.max(1, Math.min(120000, Number(waitMs) || 30000));
  const db = await openLedger(ledger, signal, started + budget);
  const identity = await (ownIdentity ||= processIdentity(process.pid));
  let lastReport = 0, holders = [];
  try {
    for (;;) {
      signal?.throwIfAborted();
      if (Date.now() - started >= budget) {
        const error = new Error(`File lock wait exceeded ${budget} ms; no write was started. Holders: ${JSON.stringify(holders)}. Inspect the owning task before retrying.`);
        error.code = 'YAN_LOCK_TIMEOUT'; error.holders = holders; throw error;
      }
      // Check the OS Job outside the transaction. A dead supervisor's named
      // Job proves its descendants stopped; a dead host PID alone does not.
      const recovered = new Set(), dead = new Set();
      for (const row of db.prepare('SELECT claims.*, claim_identities.identity FROM claims LEFT JOIN claim_identities USING(id)').all()) {
        if (await ownerAlive(row)) continue;
        dead.add(row.id);
        if (!row.owner.startsWith('supervised:')) continue;
        const name = row.owner.slice('supervised:'.length).split('|')[0];
        if (await supervisedJobStopped(name)) recovered.add(row.id);
      }
      try { db.exec('BEGIN IMMEDIATE'); }
      catch (error) {
        if (!/locked|busy/i.test(error.message)) throw error;
        await delay(50, undefined, { signal }); continue;
      }
      let granted = false;
      try {
        const active = db.prepare('SELECT * FROM claims').all().filter(row => {
          if (!dead.has(row.id)) return true;
          // Shell descendants can outlive the desktop. A dead host is not proof
          // that they stopped writing; do not steal their lease on a timer.
          if (row.owner.startsWith('uncertain:') || row.owner.startsWith('supervised:') && !recovered.has(row.id)) {
            if (!JSON.parse(row.scopes).some(a => scopes.some(b => overlaps(a, b)))) return true;
            throw new Error(`Uncertain shell lease ${row.id} from exited process ${row.pid}; inspect surviving processes before clearing this claim in ${ledger}`);
          }
          db.prepare('DELETE FROM claims WHERE id=?').run(row.id); return false;
        });
        holders = active.filter(row => JSON.parse(row.scopes).some(a => scopes.some(b => overlaps(a, b))))
          .map(row => ({ id: row.id, pid: row.pid, owner: row.owner, scopes: JSON.parse(row.scopes) }));
        if (!holders.length) {
          db.prepare('INSERT INTO claims (id,pid,owner,scopes) VALUES (?, ?, ?, ?)').run(id, process.pid,
            (supervisorName ? `supervised:${supervisorName}|` : recoverOnExit ? '' : 'uncertain:') + owner, JSON.stringify(scopes));
          db.prepare('DELETE FROM claim_identities WHERE id NOT IN (SELECT id FROM claims)').run();
          db.prepare('INSERT INTO claim_identities VALUES (?, ?)').run(id, identity);
          granted = true;
        }
        db.exec('COMMIT');
      } catch (error) { db.exec('ROLLBACK'); throw error; }
      if (granted) break;
      if (Date.now() - lastReport >= 1000) { lastReport = Date.now(); onWait?.(holders); }
      await delay(50, undefined, { signal });
    }
  } catch (error) { db.close(); throw error; }
  let releasing;
  // Cancellation releases only once the executing operation has actually unwound.
  return () => {
    if (releasing) return releasing;
    releasing = (async () => {
      const deadline = Date.now() + 30000;
      try {
        for (;;) {
          try { db.prepare('DELETE FROM claims WHERE id=?').run(id); return true; }
          catch (error) { if (!busy(error) || Date.now() >= deadline) throw error; await delay(50); }
        }
      } catch (error) { console.error('[file-lock] release failed; claim retained:', id, error.message); return false; }
      finally { db.close(); }
    })();
    return releasing;
  };
}
async function listClaims({ ledger = defaultLedger } = {}) {
  const db = await openLedger(ledger);
  try { return await Promise.all(db.prepare('SELECT claims.*, claim_identities.identity FROM claims LEFT JOIN claim_identities USING(id)').all().map(async row => ({ ...row, scopes: JSON.parse(row.scopes), ownerAlive: await ownerAlive(row) }))); }
  finally { db.close(); }
}
async function recoverClaim(id, { ledger = defaultLedger, confirmed = false } = {}) {
  if (!confirmed) throw new Error('恢复旧版写入锁需要用户确认已结束相关进程');
  const db = await openLedger(ledger);
  try {
    const row = db.prepare('SELECT claims.*, claim_identities.identity FROM claims LEFT JOIN claim_identities USING(id) WHERE claims.id=?').get(id);
    if (!row) return { recovered: false };
    if (await ownerAlive(row)) throw new Error('持锁进程仍在运行，不能清除');
    if (row.owner.startsWith('supervised:') && !await supervisedJobStopped(row.owner.slice(11).split('|')[0])) throw new Error('命令进程组尚未确认结束');
    // Archive the exact claim before removing it; never kill processes or rerun commands.
    fs.appendFileSync(ledger + '.recovery.jsonl', JSON.stringify({ at: new Date().toISOString(), ...row }) + '\n');
    db.prepare('DELETE FROM claims WHERE id=? AND owner=? AND pid=?').run(row.id, row.owner, row.pid);
    return { recovered: true };
  } finally { db.close(); }
}
module.exports = { acquireFiles, canonical, overlaps, supervisedJobStopped, listClaims, recoverClaim };

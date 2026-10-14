'use strict';
// Storage budget for the opencode kernel database.
//
// The kernel file grows with nothing to stop it: the v2 event log is
// append-only and currently unread, and a session's permission array used to
// double on every sync. 14 GB of database is what the freeze looked like from
// the disk side.
//
// Two cheap mechanisms keep it bounded:
//   - Before a kernel starts, and only when the file is already large, a
//     short-lived child process clears the unused event log, compacts
//     oversized permission arrays, truncates the WAL and - rarely - rebuilds
//     the file so free pages go back to the disk. A child, not a worker:
//     VACUUM is one synchronous native call, so only killing a process can
//     actually stop it.
//   - While the app runs, a 30 minute stat of two files reports a database or
//     a disk that is over budget.
//
// Messages, parts and sessions are never deleted. Over budget is a log line,
// not a delete.
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { childReadablePath } = require('./provider-staging');

const MiB = 1024 * 1024;
const GiB = 1024 * MiB;

const LIMITS = {
  inspectBytes: 512 * MiB,        // inspect before large payloads accumulate gigabytes
  inspectWalBytes: 256 * MiB,     // a WAL this big means checkpoints stopped keeping up
  warnBytes: 4 * GiB,             // reported, never acted on
  eventRows: 50_000,              // unread v2 log rows tolerated before clearing
  eventBytes: 256 * MiB,          // a small row count can still contain huge payloads
  permissionBytes: MiB,           // a session's rule array this big gets compacted
  permissionParseCapBytes: 256 * MiB, // beyond this, report it instead of parsing it
  permissionSessions: 200,        // most bloated sessions handled per pass
  vacuumBytes: 256 * MiB,         // reclaimable space that justifies a rebuild
  vacuumRatio: 0.2,               // ... or this share of the file
  vacuumLiveCapBytes: 4 * GiB,    // live data past this makes a rebuild too slow to block a start
  vacuumHeadroomBytes: GiB,       // free disk kept spare on top of the 2x rebuild copy
  incrementalPages: 65_536,       // bounded give-back once auto_vacuum is on (256 MB)
  diskLowBytes: 2 * GiB,
  cooldownMs: 7 * 24 * 60 * 60 * 1000, // after a failed or killed rebuild
  childTimeoutMs: 300_000,
  monitorIntervalMs: 30 * 60 * 1000,
  monitorRepeatMs: 6 * 60 * 60 * 1000
};

const STATE_NAME = 'storage-maintenance.json';
const PENDING_NAME = 'pending-kernel-deletes.json';
const V2_TABLES = ['session_message', 'session_input', 'session_context_epoch'];

function databasePaths(runtimeRoot) {
  const db = path.join(path.resolve(String(runtimeRoot || '')), 'data', 'opencode', 'opencode.db');
  return { db, wal: `${db}-wal`, shm: `${db}-shm` };
}

function fileBytes(file) {
  try { return fs.statSync(file).size; } catch { return 0; }
}

function freeDiskBytes(anyPath) {
  try {
    const stat = fs.statfsSync(path.resolve(String(anyPath || '')));
    return Number(stat.bavail) * Number(stat.bsize);
  } catch { return 0; }
}

// Every number the plan needs, read from two stats. Opening the database costs
// far more than this, so the decision to open it is made from here.
function measureFiles(runtimeRoot) {
  const paths = databasePaths(runtimeRoot);
  const dbBytes = fileBytes(paths.db);
  const walBytes = fileBytes(paths.wal);
  return {
    paths,
    exists: dbBytes > 0,
    dbBytes,
    walBytes,
    totalBytes: dbBytes + walBytes,
    freeBytes: dbBytes > 0 ? freeDiskBytes(path.dirname(paths.db)) : 0
  };
}

function shouldInspect(files, limits = LIMITS) {
  if (!files?.exists) return false;
  return files.totalBytes >= limits.inspectBytes || files.walBytes >= limits.inspectWalBytes;
}

// Warnings that need no database at all, so they are reported even when
// inspection is skipped or the child fails.
function fileWarnings(files, limits = LIMITS) {
  const warnings = [];
  if (!files?.exists) return warnings;
  if (files.totalBytes >= limits.warnBytes) warnings.push({ kind: 'database-large', bytes: files.totalBytes });
  if (files.freeBytes > 0 && files.freeBytes < limits.diskLowBytes) warnings.push({ kind: 'disk-low', freeBytes: files.freeBytes });
  return warnings;
}
// The environment's temporary files are a second copy during a rebuild and may
// live on another volume, so a rebuild needs room on both.
function tempDiskBytes(tempDir) {
  const candidates = [tempDir, process.env.TEMP, process.env.TMP, os.tmpdir()]
    .map(value => String(value || '').trim())
    .filter(Boolean);
  let smallest = 0;
  for (const candidate of candidates) {
    const free = freeDiskBytes(candidate);
    if (free > 0 && (smallest === 0 || free < smallest)) smallest = free;
  }
  return smallest;
}

// Permission rules resolve as "the last rule matching this permission/pattern
// pair wins", so keeping only each pair's last rule cannot change a single
// decision - it drops the dead copies an append-only sync left behind. Same
// rule as lib/plugins/sessions.js, restated here so the child stays dependency
// free.
function compactPermissionRules(rules) {
  const list = Array.isArray(rules) ? rules : [];
  const last = new Map();
  list.forEach((rule, index) => last.set(`${String(rule?.permission)}\u0000${String(rule?.pattern)}`, index));
  return list.filter((rule, index) => last.get(`${String(rule?.permission)}\u0000${String(rule?.pattern)}`) === index);
}

// Pure decision: what should happen to this database, given what is known about
// it. It answers both questions - what to clean, and whether the freed space can
// be given back - so a caller runs it, applies the result, and runs it again on
// fresher numbers to reach the rebuild decision.
//
// `liveKernel` means another process holds this database open: nothing is
// written. `state.vacuumFailedAt` keeps a database that cannot be rebuilt from
// spending startup time on it at every launch.
function planStorageMaintenance(facts = {}, options = {}) {
  const limits = { ...LIMITS, ...(options.limits || {}) };
  const state = options.state || {};
  const files = facts.files || {};
  const rows = facts.rows || {};
  const sessions = Array.isArray(facts.sessions) ? facts.sessions : [];
  const now = Number(options.now) || Date.now();
  const actions = [];
  const warnings = fileWarnings(files, limits);

  if (!files.exists) return { actions, warnings, skipped: 'no-database' };
  if (options.liveKernel) {
    warnings.push({ kind: 'kernel-running', port: Number(options.liveKernelPort) || 0 });
    return { actions, warnings, skipped: 'kernel-running' };
  }

  // The v2 event log is written but nothing reads it yet. Once the projections
  // it feeds hold rows of their own, those rows are the durable record and the
  // log must be left alone.
  const eventRows = Number(rows.event) || 0;
  const eventBytes = Number(facts.eventBytes) || 0;
  const projections = Array.isArray(facts.projectionTables) ? facts.projectionTables : [];
  const projectionsEmpty = V2_TABLES.every(name => projections.some(table => table?.name === name && table.exists && table.rows === 0));
  if (eventRows > limits.eventRows || eventBytes > limits.eventBytes) {
    if (projectionsEmpty) actions.push({ kind: 'clear-event-log', rows: eventRows, bytes: eventBytes });
    else warnings.push({ kind: 'event-log-in-use', rows: eventRows, bytes: eventBytes });
  }

  for (const session of sessions.filter(item => (Number(item?.bytes) || 0) > limits.permissionBytes)
    .sort((a, b) => b.bytes - a.bytes)
    .slice(0, limits.permissionSessions)) {
    // A blob too large to parse is reported, never rewritten blind: these rules
    // decide what the kernel may do, and only rules that can still be read count.
    if (session.bytes > limits.permissionParseCapBytes) {
      warnings.push({ kind: 'permission-unparseable', sessionID: String(session.id || ''), bytes: session.bytes });
      continue;
    }
    actions.push({ kind: 'compact-permissions', sessionID: String(session.id || ''), bytes: session.bytes });
  }

  // A WAL this size means checkpoints stopped keeping up with writes. Folding it
  // back is cheap and always safe.
  if (actions.length || Number(files.walBytes) >= limits.inspectWalBytes) actions.push({ kind: 'checkpoint' });

  const pageSize = Number(facts.pageSize) || 0;
  const freeBytes = (Number(facts.freelistCount) || 0) * pageSize;
  const dbBytes = Number(files.dbBytes) || 0;
  const liveBytes = Math.max(0, dbBytes - freeBytes);
  const threshold = Math.max(limits.vacuumBytes, dbBytes * limits.vacuumRatio);
  if (freeBytes >= threshold && freeBytes > 0) {
    const cooling = Number(state.vacuumFailedAt) > 0 && now - Number(state.vacuumFailedAt) < limits.cooldownMs;
    if (Number(facts.autoVacuum) === 2) {
      // Already incremental: hand the pages back without rewriting the file.
      actions.push({ kind: 'vacuum', mode: 'incremental', freeBytes, pages: Math.min(Number(facts.freelistCount) || 0, limits.incrementalPages) });
    } else if (cooling) warnings.push({ kind: 'vacuum-cooling', freeBytes });
    else if (liveBytes > limits.vacuumLiveCapBytes) warnings.push({ kind: 'vacuum-too-slow', liveBytes });
    else {
      // A rebuild writes the live data twice (temp copy, then WAL) before the
      // checkpoint truncates it away.
      const required = liveBytes * 2 + limits.vacuumHeadroomBytes;
      const free = Math.min(Number(files.freeBytes) || 0, Number(facts.tempFreeBytes) || Number(files.freeBytes) || 0);
      if (free >= required) actions.push({ kind: 'vacuum', mode: 'full', freeBytes, liveBytes, required });
      else warnings.push({ kind: 'vacuum-no-space', required, freeBytes: free });
    }
  }

  if (actions.length || warnings.length) return { actions, warnings };
  return { actions, warnings, skipped: 'within-limits' };
}
// --- parent side -----------------------------------------------------------

function statePath(runtimeRoot) {
  return path.join(path.resolve(String(runtimeRoot || '')), STATE_NAME);
}

function readState(runtimeRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(runtimeRoot), 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch { return {}; }
}

function writeState(runtimeRoot, patch) {
  try {
    const next = { ...readState(runtimeRoot), ...patch };
    fs.mkdirSync(path.dirname(statePath(runtimeRoot)), { recursive: true });
    fs.writeFileSync(statePath(runtimeRoot), JSON.stringify(next), 'utf8');
    return next;
  } catch { return null; }
}

// Ports of kernels that published an endpoint. A kernel that exited uncleanly
// leaves its file behind, so the child probes each one before trusting it.
function publishedKernelPorts(dataDir) {
  try {
    return fs.readdirSync(path.join(path.resolve(String(dataDir || '')), 'opencode-runtime', 'endpoints'))
      .map(name => (name.endsWith('.json') ? name.slice(0, -5) : ''))
      .filter(port => /^\d+$/.test(port))
      .map(Number);
  } catch { return []; }
}

// Wall-clock budget per step. A rebuild of a multi-gigabyte file is minutes of
// synchronous work; everything else is seconds. The budget is re-armed when the
// child announces its next step, so a slow machine is not cut off mid-step while
// a wedged one still cannot hold the start forever.
const STEP_BUDGET_MS = { inspect: 60_000, 'clear-event-log': 180_000, 'vacuum-full': 300_000, default: 30_000 };
const HARD_BUDGET_MS = 480_000;
// Deleting a few hundred session trees is index lookups and row deletes.
const DELETE_BUDGET_MS = { inspect: 60_000, default: 120_000 };

function stepBudget(kind, mode, budgets = STEP_BUDGET_MS) {
  if (kind === 'vacuum') return mode === 'full' ? budgets['vacuum-full'] : budgets.default;
  return budgets[kind] || budgets.default;
}

function runMaintenanceChild(job, { childScript, onProgress, log, budgets = STEP_BUDGET_MS } = {}) {
  return new Promise(resolve => {
    let child;
    try {
      child = spawn(process.execPath, [childScript, JSON.stringify(job)], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe']
      });
    } catch (error) {
      resolve({ ok: false, error: String(error?.message || error), timedOut: false, step: null });
      return;
    }

    let report = null;
    let step = null;
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let timer = null;
    const hardStop = Date.now() + HARD_BUDGET_MS;

    const arm = ms => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timedOut = true;
        try { child.kill(); } catch {}
        // A rebuild holds the database until the process is gone; SIGKILL is the
        // only thing that ends a synchronous native call.
        setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, 2000).unref?.();
      }, Math.max(1000, Math.min(ms, hardStop - Date.now())));
      timer.unref?.();
    };
    arm(budgets.inspect);

    child.stdout?.on('data', chunk => {
      stdout += String(chunk);
      let index = stdout.indexOf('\n');
      while (index >= 0) {
        const raw = stdout.slice(0, index);
        stdout = stdout.slice(index + 1);
        index = stdout.indexOf('\n');
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch {}
        if (!parsed) continue;
        if (parsed.report) report = parsed.report;
        else if (parsed.progress === 'action') {
          step = { kind: String(parsed.kind || ''), mode: parsed.mode ? String(parsed.mode) : '' };
          arm(stepBudget(step.kind, step.mode, budgets));
          try { onProgress?.(step); } catch {}
        }
      }
    });
    child.stderr?.on('data', chunk => { stderr = `${stderr}${String(chunk)}`.slice(-2048); });

    const finish = error => {
      if (timer) clearTimeout(timer);
      if (report) resolve({ ...report, timedOut, step });
      else resolve({ ok: false, actions: [], warnings: [], error: error || (timedOut ? 'timeout' : stderr.trim() || 'no-report'), timedOut, step });
    };
    child.once('error', error => { log?.warn?.(`[storage] maintenance child failed to start: ${error?.message || error}`); finish(String(error?.message || error)); });
    child.once('close', () => finish(null));
  });
}

// --- pending kernel session deletion ---------------------------------------
//
// The kernel's copy of a permanently deleted task is removed right away when a
// kernel is running (see lib/session-store.js). When it is not, the session IDs
// land in this queue and go away before the next kernel start instead.
//
// Only sessions a Yan task actually used are ever listed here, and only their
// own database rows are touched - never a task the user did not delete.

function pendingDeletesFile(runtimeRoot) {
  return path.join(path.resolve(String(runtimeRoot || '')), PENDING_NAME);
}

function readPendingKernelDeletes(runtimeRoot) {
  try {
    const parsed = JSON.parse(fs.readFileSync(pendingDeletesFile(runtimeRoot), 'utf8'));
    return (Array.isArray(parsed?.ids) ? parsed.ids : []).map(id => String(id || '').trim()).filter(Boolean);
  } catch { return []; }
}

function writePendingKernelDeletes(runtimeRoot, ids) {
  try {
    const file = pendingDeletesFile(runtimeRoot);
    if (!ids.length) { fs.rmSync(file, { force: true }); return; }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(`${file}.tmp`, JSON.stringify({ ids }), 'utf8');
    fs.renameSync(`${file}.tmp`, file);
  } catch {}
}

function queuePendingKernelDeletes(runtimeRoot, ids) {
  const merged = [...new Set([...readPendingKernelDeletes(runtimeRoot), ...(Array.isArray(ids) ? ids : [])].map(id => String(id || '').trim()).filter(Boolean))];
  writePendingKernelDeletes(runtimeRoot, merged);
  return merged;
}

// Stale kernel sessions that no Yan task file backs any more - the ones deleted
// before this queue existed. Swept once per runtime root, not per start.
// Returns the IDs plus whether the directory was readable at all: "no tasks"
// and "cannot tell" must never look the same to the sweep.
function liveYanSessionIds(sessionsDir) {
  const dir = String(sessionsDir || '');
  if (!dir) return { ids: [], readable: false };
  try {
    return { ids: fs.readdirSync(dir).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5)), readable: true };
  } catch { return { ids: [], readable: false }; }
}

const deleteFlushes = new Map();
function ensureKernelDeletesFlushed(options = {}) {
  const key = path.resolve(String(options.runtimeRoot || ''));
  const existing = deleteFlushes.get(key);
  if (existing) return existing;
  const started = flushKernelDeletes(options).finally(() => deleteFlushes.delete(key));
  deleteFlushes.set(key, started);
  return started;
}

async function deleteKernelSessionsNow({ runtimeRoot, dataDir, sessionIds, purgeOnly = false }) {
  const result = await runMaintenanceChild({
    runtimeRoot, mode: 'delete-sessions', pendingIds: sessionIds, purgeOnly,
    endpointPorts: publishedKernelPorts(dataDir)
  }, { childScript: childReadablePath(path.join(__dirname, 'kernel-storage-child.js')), budgets: DELETE_BUDGET_MS });
  if (result.skipped === 'live-kernel') return { ...result, ok: false, error: '内核仍在运行，请重试删除' };
  return result;
}

async function flushKernelDeletes(options = {}) {
  const runtimeRoot = path.resolve(String(options.runtimeRoot || ''));
  const dataDir = String(options.dataDir || '');
  const log = options.log || null;
  const state = readState(runtimeRoot);
  const queued = readPendingKernelDeletes(runtimeRoot);
  const sweeping = state.orphanSweepAt === undefined && !(state.orphanSweepFailedAt && Date.now() - Number(state.orphanSweepFailedAt) < 7 * 24 * 60 * 60 * 1000);
  // The common case is a stat and a return: an empty queue that has already been
  // swept never opens the database.
  if (!queued.length && !sweeping) return { ok: true, skipped: 'nothing-to-do' };

  const files = measureFiles(runtimeRoot);
  if (!files.exists) return { ok: true, skipped: 'no-database' };

  let live = [];
  if (sweeping) {
    const listing = liveYanSessionIds(options.sessionsDir);
    live = listing.ids;
    // An unreadable or empty sessions directory makes every task look deleted
    // (a moved data folder, a failed disk). Sweep only against a non-empty list.
    if (!listing.readable) {
      log?.warn?.('[storage] session list unreadable; skipping the orphan sweep, deleting only queued sessions');
    } else if (!live.length) {
      // No tasks at all: nothing to compare against, so the sweep is settled as
      // "not needed" instead of retried on every start.
      writeState(runtimeRoot, { orphanSweepAt: Date.now(), orphanSweepSkipped: 'no-tasks' });
      if (!queued.length) return { ok: true, skipped: 'no-tasks' };
    }
  }

  const job = {
    runtimeRoot,
    mode: 'delete-sessions',
    limits: options.limits || {},
    state,
    pendingIds: queued,
    liveYanSessionIds: live.length ? live : null,
    endpointPorts: publishedKernelPorts(dataDir || runtimeRoot.replace(/[/\\]opencode-runtime$/, '')),
    tempFreeBytes: tempDiskBytes(path.dirname(files.paths.db))
  };
  const childScript = options.childScript || childReadablePath(path.join(__dirname, 'kernel-storage-child.js'));
  const started = Date.now();
  const result = await runMaintenanceChild(job, { childScript, log, budgets: DELETE_BUDGET_MS });
  const deleted = Number(result.deleted) || 0;

  if (result.skipped === 'live-kernel') {
    // Another process opened the database first; try again at the next start.
    return { ok: true, skipped: 'live-kernel' };
  }
  if (!result.ok) {
    log?.warn?.(`[storage] kernel session cleanup failed: ${result.error || 'unknown error'}`);
    if (sweeping) writeState(runtimeRoot, { orphanSweepFailedAt: Date.now() });
    try { options.stabilityLog?.record('kernel-delete-sessions', result); } catch {}
    return result;
  }

  // Only clear the IDs that were actually processed, not new ones added during the flush.
  const processed = new Set(queued);
  const remaining = readPendingKernelDeletes(runtimeRoot).filter(id => !processed.has(id));
  writePendingKernelDeletes(runtimeRoot, remaining);
  if (sweeping && live.length) writeState(runtimeRoot, { orphanSweepAt: Date.now() });
  const report = { ok: true, deleted, queued: queued.length, sweptLive: live.length, ms: Date.now() - started };
  if (deleted > 0) log?.info?.(`[storage] removed ${deleted} kernel session(s) of deleted tasks in ${report.ms} ms`);
  if (sweeping || queued.length) {
    try { options.stabilityLog?.record('kernel-delete-sessions', report); } catch {}
  }
  return report;
}

// One pass over the kernel database, before any kernel is started. Cheap when
// there is nothing to do: two stats and a return.
async function maintainRuntimeStorage(options = {}) {
  const runtimeRoot = path.resolve(String(options.runtimeRoot || ''));
  const dataDir = String(options.dataDir || '');
  const log = options.log || null;
  const limits = { ...LIMITS, ...(options.limits || {}) };
  const files = measureFiles(runtimeRoot);
  const warnings = fileWarnings(files, limits);

  const record = result => {
    for (const warning of result.warnings || []) {
      log?.warn?.(`[storage] ${warning.kind} ${JSON.stringify(warning)}`);
    }
    if ((result.warnings || []).length || (result.actions || []).length || result.error) {
      try { options.stabilityLog?.record('storage-maintenance', result); } catch {}
    }
    return result;
  };

  if (!shouldInspect(files, limits)) {
    return record({ ok: true, skipped: files.exists ? 'within-limits' : 'no-database', warnings, actions: [], dbBytes: files.dbBytes, walBytes: files.walBytes });
  }

  const state = readState(runtimeRoot);
  const job = {
    runtimeRoot,
    limits: options.limits || {},
    state,
    endpointPorts: publishedKernelPorts(dataDir || runtimeRoot.replace(/[/\\]opencode-runtime$/, '')),
    tempFreeBytes: tempDiskBytes(path.dirname(files.paths.db))
  };
  const childScript = options.childScript || childReadablePath(path.join(__dirname, 'kernel-storage-child.js'));
  log?.info?.(`[storage] kernel database ${(files.dbBytes / MiB).toFixed(0)} MB + WAL ${(files.walBytes / MiB).toFixed(0)} MB: checking before start`);

  const started = Date.now();
  const result = await runMaintenanceChild(job, {
    childScript,
    log,
    // A rebuild is marked as failed the moment it starts and cleared only when it
    // reports success, so a process killed or a machine lost in the middle of one
    // leaves the cooldown behind instead of stalling the next start too.
    onProgress: step => {
      if (step.kind === 'vacuum' && step.mode === 'full') writeState(runtimeRoot, { vacuumAttemptAt: Date.now(), vacuumFailedAt: Date.now() });
    }
  });

  const vacuumed = (result.actions || []).find(action => action.kind === 'vacuum' && action.mode === 'full');
  if (vacuumed?.ok) writeState(runtimeRoot, { vacuumFailedAt: 0, vacuumOkAt: Date.now() });
  writeState(runtimeRoot, { lastRunAt: Date.now(), lastMs: Date.now() - started, lastOk: !!result.ok });

  const merged = {
    ...result,
    ms: Date.now() - started,
    warnings: [...warnings, ...(result.warnings || [])],
    dbBytes: result.after?.dbBytes ?? files.dbBytes,
    walBytes: result.after?.walBytes ?? files.walBytes
  };
  if (result.error) log?.warn?.(`[storage] maintenance ended with ${result.error} after ${merged.ms} ms`);
  else if ((result.actions || []).length) {
    const freed = (result.before?.dbBytes || 0) - (result.after?.dbBytes || 0);
    log?.info?.(`[storage] maintenance ran ${result.actions.length} action(s) in ${merged.ms} ms${freed > 0 ? `, freed ${(freed / MiB).toFixed(0)} MB` : ''}`);
  }
  return record(merged);
}

// One pass per runtime root per process. Kernels in a pool share this promise,
// so the rebuild cannot start while another kernel of the same pool is opening
// the same database.
const maintenanceRuns = new Map();
function ensureRuntimeStorage(options = {}) {
  const key = path.resolve(String(options.runtimeRoot || ''));
  if (!maintenanceRuns.has(key)) {
    maintenanceRuns.set(key, maintainRuntimeStorage(options).catch(error => ({ ok: false, error: String(error?.message || error), actions: [], warnings: [] })));
  }
  return maintenanceRuns.get(key);
}

// Runtime watch: two stats every half hour. It never writes to the database and
// never deletes anything - a database over budget is a log line, because the
// rows in it are the user's sessions.
function startStorageMonitor(options = {}) {
  const runtimeRoot = path.resolve(String(options.runtimeRoot || ''));
  const limits = { ...LIMITS, ...(options.limits || {}) };
  const log = options.log || null;
  const reported = new Map();

  const checkNow = () => {
    const files = measureFiles(runtimeRoot);
    const warnings = fileWarnings(files, limits);
    const now = Date.now();
    const fresh = warnings.filter(warning => now - (reported.get(warning.kind) || 0) >= limits.monitorRepeatMs);
    for (const warning of fresh) {
      reported.set(warning.kind, now);
      log?.warn?.(`[storage] ${warning.kind} ${JSON.stringify(warning)}`);
    }
    if (fresh.length) {
      try { options.stabilityLog?.record('storage-budget', { dbBytes: files.dbBytes, walBytes: files.walBytes, freeDiskBytes: files.freeBytes, warnings: fresh }); } catch {}
    }
    return { files, warnings: fresh };
  };

  const timer = setInterval(checkNow, limits.monitorIntervalMs);
  timer.unref?.();
  return { checkNow, stop: () => clearInterval(timer) };
}

// One monitor per runtime root, however many kernels share it.
const monitors = new Map();
function ensureStorageMonitor(options = {}) {
  const key = path.resolve(String(options.runtimeRoot || ''));
  if (!monitors.has(key)) monitors.set(key, startStorageMonitor(options));
  return monitors.get(key);
}

module.exports = {
  LIMITS,
  STATE_NAME,
  V2_TABLES,
  databasePaths,
  fileBytes,
  freeDiskBytes,
  tempDiskBytes,
  measureFiles,
  shouldInspect,
  fileWarnings,
  planStorageMaintenance,
  compactPermissionRules,
  statePath,
  readState,
  writeState,
  publishedKernelPorts,
  queuePendingKernelDeletes,
  readPendingKernelDeletes,
  ensureKernelDeletesFlushed,
  deleteKernelSessionsNow,
  STEP_BUDGET_MS,
  stepBudget,
  runMaintenanceChild,
  maintainRuntimeStorage,
  ensureRuntimeStorage,
  startStorageMonitor,
  ensureStorageMonitor
};

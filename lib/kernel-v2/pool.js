'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { OpenCodeV2Adapter } = require('./adapter');
const { ownerProcessAlive, processIdentity } = require('./ownership');

// Runtime configuration contains task-specific MCP credentials and model policy.
// Never merge it or replace another live session's configuration. Each desktop
// session owns a durable database and a lazily started, idle-released process.
class OpenCodeV2Pool {
  constructor(options) {
    this.options = options;
    this.limit = options.maxKernels || 10;
    this.entries = new Map();
    this.active = new Map();
    this.finished = new Map();
    this.defaultConfig = {};
    this.closed = false;
    this.indexPath = path.join(options.dataDir, 'opencode-runtime-v2', 'session-routes.json');
    this.routes = Object.create(null);
    this.updateRoutes();
  }
  // A writer that dies mid-recovery leaves both the lock and its recovery guard
  // behind. Without this the guard would block every later startup forever, which
  // is the same unrecoverable fail-fast the index validation used to cause.
  staleWriterGuard(file) {
    let stat;
    try { stat = fs.statSync(file); } catch (error) { return error.code === 'ENOENT'; }
    let owner;
    try { owner = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { owner = null; }
    if (Number.isInteger(owner?.pid) && owner.pid > 0) {
      try { process.kill(owner.pid, 0); return false; }
      catch (error) { return error.code === 'ESRCH'; }
    }
    // Recovery work is synchronous and the guard records its pid immediately, so an
    // empty or unparseable guard is only left by a writer that never came back.
    return Date.now() - stat.mtimeMs > 10000;
  }
  recoverWriterLock(lock) {
    const recovery = `${lock}.recovery`;
    for (let attempt = 0; attempt < 2; attempt++) {
      let recoveryGuard;
      try {
        recoveryGuard = fs.openSync(recovery, 'wx');
      } catch (error) {
        if (error.code !== 'EEXIST') throw error;
        if (!this.staleWriterGuard(recovery)) throw new Error(`V2 session routing index is being updated; retry (${lock})`);
        try { fs.unlinkSync(recovery); } catch (unlinkError) { if (unlinkError.code !== 'ENOENT') throw unlinkError; }
        continue;
      }
      try {
        fs.writeFileSync(recoveryGuard, JSON.stringify({ pid: process.pid }));
        let owner;
        try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); }
        catch (readError) { if (readError.code !== 'ENOENT') throw new Error(`V2 session routing lock is invalid; inspect ${lock}`); }
        if (owner) {
          let dead = false;
          if (Number.isInteger(owner.pid) && owner.pid > 0) {
            try { process.kill(owner.pid, 0); } catch (probeError) { dead = probeError.code === 'ESRCH'; }
          }
          if (!dead) throw new Error(`V2 session routing index is being updated; retry (${lock})`);
          fs.unlinkSync(lock);
        }
        return fs.openSync(lock, 'wx');
      } finally {
        fs.closeSync(recoveryGuard);
        try { fs.unlinkSync(recovery); } catch {}
      }
    }
    throw new Error(`V2 session routing index is being updated; retry (${lock})`);
  }
  updateRoutes(sessionID, key) {
    fs.mkdirSync(path.dirname(this.indexPath), { recursive: true });
    const lock = `${this.indexPath}.lock`;
    let guard;
    try { guard = fs.openSync(lock, 'wx'); }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      guard = this.recoverWriterLock(lock);
    }
    const temporary = `${this.indexPath}.${process.pid}.${crypto.randomUUID()}.tmp`;
    try {
      fs.writeFileSync(guard, JSON.stringify({ pid: process.pid }));
      let raw, index;
      try { raw = fs.readFileSync(this.indexPath, 'utf8'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (raw !== undefined) {
        try { index = JSON.parse(raw); }
        catch (parseError) {
          // The raw error carries no path, so the user cannot find the file to repair.
          throw new Error(`V2 session routing index is not valid JSON (${this.indexPath}); restore a .bak copy or delete the file: ${parseError.message}`);
        }
        if (!index || index.version !== 1 || !index.sessions || typeof index.sessions !== 'object' || Array.isArray(index.sessions)) {
          throw new Error(`Invalid V2 session routing index (${this.indexPath}; expected version 1 with a sessions object, found version ${String(index?.version)} and ${Array.isArray(index?.sessions) ? 'an array' : typeof index?.sessions})`);
        }
      }
      const next = Object.create(null);
      const invalid = [];
      for (const [id, value] of Object.entries(index?.sessions || {})) {
        if (typeof value === 'string' && /^[a-f0-9]{64}$/.test(value)) next[id] = value;
        else invalid.push(id);
      }
      for (const [id, value] of Object.entries(this.routes)) {
        if (next[id] && next[id] !== value) throw new Error(`V2 session ownership conflict (${id})`);
        next[id] = value;
      }
      if (sessionID) {
        if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) throw new Error(`Invalid V2 session storage key (${sessionID})`);
        if (next[sessionID] && next[sessionID] !== key) throw new Error(`V2 session ownership conflict (${sessionID})`);
        next[sessionID] = key;
      }
      if (invalid.length) {
        const backup = `${this.indexPath}.${Date.now()}.${crypto.randomUUID()}.bak`;
        fs.writeFileSync(backup, raw, { flag: 'wx' });
        console.warn(`[opencode] Invalid V2 session storage key: quarantined ${invalid.join(', ')}; original index: ${backup}`);
      }
      if (invalid.length || sessionID) {
        fs.writeFileSync(temporary, JSON.stringify({ version: 1, sessions: next }), { flag: 'wx' });
        fs.renameSync(temporary, this.indexPath);
      }
      this.routes = next;
    } finally {
      try { fs.rmSync(temporary, { force: true }); }
      finally { fs.closeSync(guard); fs.unlinkSync(lock); }
    }
  }
  entry(key) {
    if (this.closed) throw new Error('V2 pool is closing');
    if (!this.entries.has(key)) {
      this.entries.set(key, new OpenCodeV2Adapter({ ...this.options,
        storageDir: key === 'legacy' ? this.options.dataDir : path.join(this.options.dataDir, 'opencode-sessions-v2', key) }));
    }
    return this.entries.get(key);
  }
  remember(sessionID, key) {
    if (!sessionID || key === 'legacy' || this.routes[sessionID] === key) return;
    this.updateRoutes(sessionID, key);
  }
  // Routing is a cache, not the source of truth: run() derives the same key
  // deterministically, so a concurrent writer must never abort a live turn.
  persistRoute(sessionID, key) {
    try { this.remember(sessionID, key); }
    catch (error) { console.warn(`[opencode] could not persist V2 session route for ${sessionID}: ${error.message}`); }
  }
  status() {
    const kernels = [...this.entries.values()].map(entry => entry.status()).filter(status => status.ok);
    return { ...kernels[0], ok: kernels.length > 0, backend: 'opencode-v2', runtime: 'node',
      activeRuns: this.active.size, kernels: kernels.length, maxKernels: this.limit };
  }
  hasRun(id) { return this.active.has(id); }
  hasPendingRun(id) { return this.active.has(id); }
  async hasBackgroundWork() {
    if (this.active.size) return true;
    for (const entry of this.entries.values()) {
      if (entry.resources.active) return true;
      if (entry.client && Object.keys(await entry.client.session.active()).length) return true;
    }
    return false;
  }
  // Generic UI prewarm has no task configuration and must not launch a second
  // configuration or restart a live runtime. Actual run admission starts its owner.
  async start(config = {}) { this.defaultConfig = config; return this.status(); }
  async prewarm(config = {}, directory, target = {}) {
    // A generic warmup has no owner and must never create or replace a runtime.
    if (!target.yanSessionId || !directory) return { ...this.status(), ok: true, skipped: 'no-session' };
    if (this.closed || this.active.size) return { ...this.status(), ok: true, skipped: 'active-runs' };
    // Existing unrouted histories need migration at admission, not a speculative
    // new database that would bypass migration or own a different session.
    if (target.openCodeSessionId && !this.routes[target.openCodeSessionId]) return { ...this.status(), ok: true, skipped: 'migration-required' };
    const key = this.routes[target.openCodeSessionId] || crypto.createHash('sha256').update(String(target.yanSessionId)).digest('hex');
    if (!this.entries.get(key)?.client && this.status().kernels >= this.limit) return { ...this.status(), ok: true, skipped: 'capacity' };
    const entry = this.entry(key);
    // Keep the last admitted policy for an existing owner. Configuration changes
    // are applied by the next real turn, never by speculative UI activity.
    return entry.prewarm(entry.lastStartConfig || config, directory);
  }
  invalidate() { for (const entry of this.entries.values()) if (!entry.runs.size) entry.invalidate(); }

  async migrate(sessionID, key, target, config) {
    if (!sessionID || this.routes[sessionID]) return;
    // Upgrade existing single-runtime histories through the native transfer API.
    // Keep the original intact; only publish routing after a successful import.
    const source = this.entry('legacy');
    await source.resources.use(async () => {
      if (!source.client) await source.start({});
      let exported;
      try { exported = await source.client.session.export({ sessionID, sanitize: false }); }
      catch (error) { if (/not.?found|404/i.test(error.message || '')) return; throw error; }
      await target.start(config);
      const imported = [];
      const transfer = async data => {
        try { await target.client.session.get({ sessionID: data.info.id }); }
        catch (error) {
          if (!/not.?found|404/i.test(error.message || '')) throw error;
          await target.client.session.import({ ...data, location: data.info.location });
        }
        const instructions = await source.client.session.instructions.entry.list({ sessionID: data.info.id });
        for (const instruction of instructions) {
          await target.client.session.instructions.entry.put({ sessionID: data.info.id, key: instruction.key, value: instruction.value });
        }
        imported.push(data.info.id);
        let cursor;
        do {
          const page = await source.client.session.list({ parentID: data.info.id, limit: 100, ...(cursor ? { cursor } : {}) });
          for (const child of page.data) await transfer(await source.client.session.export({ sessionID: child.id, sanitize: false }));
          cursor = page.cursor?.next;
        } while (cursor);
      };
      await transfer(exported);
      for (const id of imported.reverse()) this.persistRoute(id, key);
    });
  }
  async run(request, emit = () => {}) {
    if (this.closed) throw new Error('V2 pool is closing');
    const id = request.runId || crypto.randomUUID();
    const suggestion = request.utility === true && request.utilityKind === 'prompt-suggestion';
    const laneRuns = [...this.active.values()].filter(run => !!run.suggestion === suggestion).length;
    if (laneRuns >= (suggestion ? 1 : this.limit)) throw new Error(suggestion ? '建议正在生成' : `最多同时运行 ${this.limit} 个任务`);
    if (this.active.has(id)) throw new Error('任务已在运行');
    // Suggestions belong to the desktop task for authorization, but must not
    // replace its warm model/MCP runtime with their no-tools configuration.
    const utilityKey = request.utility === true ? crypto.createHash('sha256')
      .update(JSON.stringify(['utility', request.utilityKind || 'default', request.yanSessionId || id])).digest('hex') : '';
    if (utilityKey && this.routes[request.openCodeSessionId] !== utilityKey) {
      request = { ...request, openCodeSessionId: undefined };
    }
    const key = utilityKey || this.routes[request.openCodeSessionId] || crypto.createHash('sha256')
      .update(String(request.yanSessionId || request.openCodeSessionId || id)).digest('hex');
    if ([...this.active.values()].some(run => run.key === key)) throw new Error('该会话已有任务运行');
    const entry = this.entry(key);
    const run = { key, entry, cancelled: false, suggestion };
    this.active.set(id, run);
    try {
      return await entry.resources.use(async () => {
        await this.migrate(request.openCodeSessionId, key, entry, request.openCodeConfig || {});
        if (run.cancelled) return entry.result({ sessionID: request.openCodeSessionId, interruptionReason: this.closed ? 'app_shutdown' : 'user_cancel' }, [], 'interrupted');
        return entry.run({ ...request, runId: id }, event => {
          const data = event.data || event.properties || {};
          this.persistRoute(data.sessionID || data.info?.sessionID || data.part?.sessionID, key);
          emit(event);
        });
      });
    } finally {
      this.active.delete(id);
      this.finished.set(id, entry);
      if (this.finished.size > 100) this.finished.delete(this.finished.keys().next().value);
    }
  }
  async cancel(id) {
    const run = this.active.get(id);
    if (!run) return { ok: false, error: '任务不存在' };
    run.cancelled = true;
    return run.entry.hasRun(id) ? run.entry.cancel(id) : { ok: true };
  }
  owner(id) { return this.active.get(id)?.entry || this.finished.get(id); }
  replyPermission(payload) { return this.owner(payload.runId)?.replyPermission(payload) || { ok: false, code: 'RUN_GONE', error: '任务不存在' }; }
  replyQuestion(payload) { return this.owner(payload.runId)?.replyQuestion(payload) || { ok: false, error: '任务不存在' }; }
  deliverInterjection(id, analysis) { return this.owner(id)?.deliverInterjection(id, analysis) || { ok: false, error: '任务不存在' }; }
  runChanges(id) { return this.owner(id)?.runChanges(id) || []; }
  async sessionOperation(sessionID, config, operation) {
    const entry = this.entry(this.routes[sessionID] || 'legacy');
    return entry.resources.use(async () => {
      // Reads must use the owner's configuration while another turn is running.
      if (!entry.client || !entry.runs.size) await entry.start(config || entry.lastStartConfig || this.defaultConfig);
      return operation(entry);
    });
  }
  sessionChanges(payload) {
    return this.sessionOperation(payload.openCodeSessionId || payload.sessionId, null, entry => entry.sessionChanges(payload));
  }
  compressSession(request) {
    return this.sessionOperation(request.openCodeSessionId, request.openCodeConfig, entry => entry.compressSession(request));
  }
  // A routed session owns one exclusive storage directory named after
  // sha256(yanSessionId). Starting that kernel just to delete one session tree
  // is the slowest part of permanent deletion. Remove the directory directly
  // only after proving the route is exclusive and no live process or legacy
  // copy still needs it; otherwise fall back to the normal kernel cleanup.
  async deleteIdleSessionStorage(ids, yanSessionId) {
    if (!yanSessionId || !Array.isArray(ids) || !ids.length) return null;
    const key = crypto.createHash('sha256').update(String(yanSessionId)).digest('hex');
    const routed = ids.filter(id => this.routes[id]);
    if (!routed.length || routed.some(id => this.routes[id] !== key)) return null;
    // A warm or starting entry may still hold files; let the adapter cancel and
    // delete instead of racing a directory removal against its process.
    if (this.entries.has(key)) return null;
    const storageDir = path.join(this.options.dataDir, 'opencode-sessions-v2', key);
    let stat;
    try { stat = fs.lstatSync(storageDir); }
    catch (error) {
      if (error.code !== 'ENOENT') return null;
      return this.legacyContainsAny(ids) ? null : { ok: true, deleted: 0, failed: [] };
    }
    if (!stat.isDirectory() || stat.isSymbolicLink()) return null;
    const runtimeDir = path.join(storageDir, 'opencode-runtime-v2');
    try { if (fs.lstatSync(runtimeDir).isSymbolicLink()) return null; }
    catch (error) { if (error.code !== 'ENOENT') return null; }
    const lock = path.join(runtimeDir, 'owner.json');
    if (fs.existsSync(lock)) {
      let owner, lockStat;
      try { owner = JSON.parse(fs.readFileSync(lock, 'utf8')); lockStat = fs.statSync(lock); }
      catch { return null; }
      const hostAlive = await ownerProcessAlive({ pid: owner?.hostPID, identity: owner?.hostIdentity,
        lockMtimeMs: lockStat.mtimeMs, identityOf: processIdentity });
      const childAlive = await ownerProcessAlive({ pid: owner?.childPID, identity: owner?.childIdentity,
        lockMtimeMs: lockStat.mtimeMs, identityOf: processIdentity });
      if (hostAlive || childAlive) return null;
    }
    if (this.legacyContainsAny(ids)) return null;
    await fsp.rm(storageDir, { recursive: true, force: true });
    return { ok: true, deleted: routed.length, failed: [] };
  }

  legacyContainsAny(ids) {
    const file = path.join(this.options.dataDir, 'opencode-runtime-v2', 'data', 'opencode', 'opencode.db');
    if (!fs.existsSync(file)) return false;
    let DatabaseSync;
    try { ({ DatabaseSync } = require('node:sqlite')); } catch { return true; }
    let db;
    try {
      db = new DatabaseSync(file, { readOnly: true });
      const statement = db.prepare('SELECT 1 FROM session_v2 WHERE id = ? LIMIT 1');
      return ids.some(id => !!statement.get(id));
    } catch { return true; }
    finally { try { db?.close(); } catch {} }
  }

  async deleteKernelSessionTrees(ids, directory, options = {}) {
    const fast = await this.deleteIdleSessionStorage(ids, options.yanSessionId);
    if (fast) return fast;
    const groups = new Map();
    for (const id of ids) {
      const key = this.routes[id] || 'legacy';
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(id);
    }
    const results = await Promise.all([...groups.values()].map(group => this.sessionOperation(group[0], null,
      entry => entry.deleteKernelSessionTrees(group, directory, options))));
    // Migration retains its source for recovery. A permanent delete must remove
    // that copy too, otherwise the old database keeps the user's deleted history.
    const copied = ids.filter(id => this.routes[id]);
    if (copied.length && results.every(result => result.ok)
      && fs.existsSync(path.join(this.options.dataDir, 'opencode-runtime-v2', 'data', 'opencode', 'opencode.db'))) {
      const legacy = this.entry('legacy');
      const cleanup = await legacy.resources.use(async () => {
        if (!legacy.client) await legacy.start({});
        return legacy.deleteKernelSessionTrees(copied, directory, options);
      });
      if (!cleanup.ok) results.push({ ...cleanup, deleted: 0 });
    }
    return { ok: results.every(result => result.ok), deleted: results.reduce((sum, result) => sum + result.deleted, 0),
      failed: results.flatMap(result => result.failed || []) };
  }
  async reviewMemory(payload) {
    const entry = this.owner(payload.runId);
    if (!entry) return { memories: [], skillCandidate: null, harnessCandidates: [], refinementOutcomes: [] };
    return entry.reviewMemory(payload);
  }
  // Quit path only: the process exits as soon as before-quit returns, so the
  // asynchronous close() above would never finish and its kernels would outlive
  // the app still holding owner.json. Returns false when a kernel is still alive.
  killNow() {
    this.closed = true;
    for (const run of this.active.values()) run.cancelled = true;
    let ok = true;
    for (const entry of this.entries.values()) {
      try { if (!entry.killNow()) ok = false; }
      catch { ok = false; }
    }
    return ok;
  }
  async close() {
    this.closed = true;
    for (const run of this.active.values()) run.cancelled = true;
    const results = await Promise.allSettled([...this.entries.values()].map(entry => entry.close()));
    const failure = results.find(result => result.status === 'rejected');
    if (failure) throw failure.reason;
  }
}
module.exports = { OpenCodeV2Pool };

'use strict';

const fs = require('node:fs');
const crypto = require('node:crypto');
const net = require('node:net');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { childReadablePath } = require('../provider-staging');
const { spawn, execFile, execFileSync } = require('node:child_process');
const { setTimeout: delay } = require('node:timers/promises');
const { runtimePaths, validateStorage, verifyRuntime, environment, ensureRipgrep, VERSION, NODE_VERSION, NODE_ARGS } = require('./runtime');
const { watchProcess } = require('./diagnostics');
const { ownerProcessAlive, processIdentity } = require('./ownership');

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(error => error ? reject(error) : resolve(port));
    });
  });
}

function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try { process.kill(pid, 0); return true; } catch (error) { return error.code !== 'ESRCH'; }
}

// A cancelled startup is a control signal, not a crash. Callers retry a stop
// that overlapped admission, and treat a released runtime as an interruption
// instead of reporting a kernel failure to the user.
function cancelledStart(sidecar) {
  return Object.assign(new Error('V2 startup cancelled'), {
    code: 'V2_START_CANCELLED',
    reason: sidecar.closed ? (sidecar.closeReason || 'app_shutdown') : 'requested_stop'
  });
}

async function terminate(child) {
  if (!child?.pid || child.exitCode !== null || child.signalCode !== null) return;
  const running = () => child.exitCode === null && child.signalCode === null && alive(child.pid);
  const diagnostics = [];
  for (let attempt = 0; attempt < 2 && running(); attempt++) {
    if (process.platform === 'win32') {
      const args = ['/PID', String(child.pid), ...(attempt === 0 ? ['/T'] : []), '/F'];
      await new Promise(resolve => execFile('taskkill.exe', args, { windowsHide: true, timeout: 5000 }, (error, stdout, stderr) => {
        if (error) diagnostics.push(`taskkill ${args.join(' ')}: ${error.code ?? error.message}; ${String(stderr || stdout || '').trim().slice(0, 1000)}`);
        resolve();
      }));
    } else {
      try { child.kill(attempt === 0 ? 'SIGTERM' : 'SIGKILL'); }
      catch (error) { diagnostics.push(error.message); }
    }
    const deadline = Date.now() + 5000;
    while (running() && Date.now() < deadline) await delay(25);
  }
  if (running()) throw new Error(`V2 process did not exit; ownership retained (pid ${child.pid}${diagnostics.length ? `; ${diagnostics.join(' | ')}` : ''})`);
}

// Owns only the V2 transport/process. It deliberately does not implement the V1
// run() interface: selecting an incomplete backend in the desktop must be impossible.
class OpenCodeV2Sidecar {
  constructor({ appRoot, dataDir, storageDir = dataDir, startupTimeoutMs = 30000, mcpIdleMs = 300000 }) {
    this.appRoot = appRoot;
    this.dataDir = dataDir;
    this.paths = runtimePaths(appRoot, storageDir);
    this.startupTimeoutMs = startupTimeoutMs;
    this.mcpIdleMs = Number(mcpIdleMs) > 0 ? Number(mcpIdleMs) : 300000;
    this.queue = Promise.resolve();
    this.child = null;
    this.client = null;
    this.closed = false;
    this.closeReason = '';
    this.stopRequested = false;
    this.owner = crypto.randomUUID();
    this.hostIdentity = '';
    this.signature = '';
    this.url = '';
    this.configCache = new WeakMap();
  }

  serialize(operation) {
    const result = this.queue.then(operation);
    this.queue = result.catch(() => {});
    return result;
  }

  status() {
    return { ok: !!this.client, backend: 'opencode-v2', runtime: 'node', nodeVersion: NODE_VERSION, version: VERSION, pid: this.child?.pid ?? null, url: this.url, runtimeRoot: this.paths.root, lastExit: this.lastExit || null };
  }

  async acquire() {
    validateStorage(this.paths);
    for (const key of ['root', 'home', 'data', 'config', 'cache', 'state']) fs.mkdirSync(this.paths[key], { recursive: true });
    try { ensureRipgrep(this.paths, process.env, this.dataDir); } catch { /* Native tools can still download it. */ }
    this.hostIdentity ||= await processIdentity(process.pid);
    const ownRecord = () => ({ owner: this.owner, hostPID: process.pid,
      ...(this.hostIdentity ? { hostIdentity: this.hostIdentity } : {}) });
    try {
      fs.writeFileSync(this.paths.lock, JSON.stringify(ownRecord()), { flag: 'wx' });
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      // Never start a second process on a shared DB, including an orphan whose host died.
      const recovery = `${this.paths.lock}.recovery`;
      let guard;
      try {
        if (fs.existsSync(recovery)) {
          const guardStat = fs.statSync(recovery);
          const age = Date.now() - guardStat.mtimeMs;
          let previous;
          try { previous = JSON.parse(fs.readFileSync(recovery, 'utf8')); } catch {}
          const guardAlive = await ownerProcessAlive({ pid: previous?.hostPID, identity: previous?.hostIdentity,
            lockMtimeMs: guardStat.mtimeMs, identityOf: processIdentity });
          if (guardAlive || age < 30000) {
            throw new Error('V2 ownership acquisition is in progress; retry startup');
          }
          // A launcher can crash while holding its recovery guard. Only an old,
          // dead-owner guard is removed; a live launcher is never displaced.
          fs.unlinkSync(recovery);
        }
        // Serialize stale-file inspection/removal across competing launchers.
        // Normal acquisition still uses wx, so only one replacement can win.
        guard = fs.openSync(recovery, 'wx');
        fs.writeFileSync(guard, JSON.stringify({ hostPID: process.pid, hostIdentity: this.hostIdentity, owner: this.owner }));
        if (fs.existsSync(this.paths.lock)) {
          const lockStat = fs.statSync(this.paths.lock);
          let previous;
          try { previous = JSON.parse(fs.readFileSync(this.paths.lock, 'utf8')); }
          catch { throw new Error(`V2 ownership file is invalid; inspect ${this.paths.lock} before recovery`); }
          if (!previous || typeof previous !== 'object'
            || !Number.isInteger(previous.hostPID) || previous.hostPID <= 0
            || (previous.childPID !== undefined && (!Number.isInteger(previous.childPID) || previous.childPID <= 0))) {
            throw new Error(`V2 ownership file is invalid; inspect ${this.paths.lock} before recovery`);
          }
          const hostAlive = await ownerProcessAlive({ pid: previous.hostPID, identity: previous.hostIdentity,
            lockMtimeMs: lockStat.mtimeMs, identityOf: processIdentity });
          const kernelAlive = await ownerProcessAlive({ pid: previous.childPID, identity: previous.childIdentity,
            lockMtimeMs: lockStat.mtimeMs, identityOf: processIdentity });
          // A lock written by this very process can only be left behind by an
          // earlier sidecar that failed to release it. Once its kernel is gone
          // the directory is free; keeping the lock would block every later
          // start in this app until it is restarted.
          if (previous.hostPID === process.pid && !kernelAlive) {
            console.warn(`[opencode] reclaiming V2 ownership left by this process (${this.paths.lock})`);
          } else if (hostAlive || kernelAlive) {
            const owners = [hostAlive ? `host ${previous.hostPID}` : '', kernelAlive ? `kernel ${previous.childPID}` : '']
              .filter(Boolean).join(', ');
            throw new Error(`V2 runtime directory is already owned by a live process (${owners}; ${this.paths.lock})`
              + (kernelAlive ? `; stop it with: taskkill /PID ${previous.childPID} /T /F` : ''));
          }
          fs.unlinkSync(this.paths.lock);
        }
        fs.writeFileSync(this.paths.lock, JSON.stringify(ownRecord()), { flag: 'wx' });
      } catch (recoveryError) {
        if (recoveryError.code === 'EEXIST') throw new Error('V2 ownership acquisition is in progress; retry startup');
        throw recoveryError;
      } finally {
        if (guard !== undefined) { fs.closeSync(guard); fs.unlinkSync(recovery); }
      }
    }
  }

  release() {
    // This runs from the child 'exit' handler and from startup failure paths. A
    // half-written owner.json must never become an uncaught main-process exception
    // or replace the real startup error.
    try {
      if (!fs.existsSync(this.paths.lock)) return;
      const current = JSON.parse(fs.readFileSync(this.paths.lock, 'utf8'));
      if (current.owner === this.owner) fs.unlinkSync(this.paths.lock);
    } catch (error) {
      console.warn(`[opencode] could not release V2 ownership (${this.paths.lock}): ${error.message}`);
    }
  }

  start(config = {}) {
    // Copy before enqueueing so callers cannot mutate a queued startup's policy.
    // The adapter reuses one translated config object per parent tree; cache the
    // copy/signature so child admissions do not re-serialize the same policy.
    const cacheKey = config && typeof config === 'object' ? config : null;
    let cached = cacheKey ? this.configCache.get(cacheKey) : null;
    if (!cached) {
      const effective = JSON.parse(JSON.stringify(config));
      effective.update = 'disable';
      effective.share = 'disabled';
      cached = { effective, signature: JSON.stringify(effective) };
      if (cacheKey) this.configCache.set(cacheKey, cached);
    }
    const { effective, signature } = cached;
    return this.serialize(async () => {
      if (this.closed || this.stopRequested) throw cancelledStart(this);
      if (this.client) {
        if (signature !== this.signature) throw new Error('Stop V2 before changing its runtime configuration');
        return this.status();
      }
      const OpenCode = await verifyRuntime(this.paths);
      if (this.closed || this.stopRequested) throw cancelledStart(this);
      await this.acquire();
      let child;
      try {
        const port = await freePort();
        const password = crypto.randomBytes(32).toString('base64url');
        const url = `http://127.0.0.1:${port}`;
        child = spawn(this.paths.executable, [...NODE_ARGS, this.paths.entrypoint, 'serve', '--hostname', '127.0.0.1', '--port', String(port), '--log-level', 'warn'], {
          cwd: this.paths.home,
          env: { ...environment(this.paths, password, effective),
            ...this.mediaEnvironment,
            ...this.delegationEnvironment,
            YAN_V2_URL: url, YAN_V2_PASSWORD: password,
            YAN_V2_CLIENT: pathToFileURL(this.paths.client).href,
            YAN_MCP_IDLE_MS: String(this.mcpIdleMs),
            YAN_KERNEL_SHELL_PREFERENCE: this.shellPreference || '',
            YAN_PLUGIN_DATA_DIR: this.dataDir,
            YAN_PLUGIN_NODE: this.paths.executable,
            YAN_PLUGIN_GATEWAY_ENTRY: childReadablePath(path.join(this.appRoot, 'lib', 'plugins', 'gateway.js')) },
          windowsHide: true,
          stdio: ['ignore', 'pipe', 'pipe']
        });
        this.child = child;
        child.once('exit', () => {
          if (this.child !== child) return;
          this.client = null;
          this.child = null;
          this.url = '';
          this.signature = '';
          this.release();
        });
        let processError;
        child.on('error', error => { processError = error; });
        this.lastExit = null;
        watchProcess(child, path.join(this.dataDir, 'opencode-runtime', 'diagnostics'), {
          secrets: [password, process.env.YAN_BASH_BRIDGE_TOKEN],
          requestedStop: () => this.closed ? 'app_shutdown' : this.stopRequested ? 'requested_stop' : '',
          onExit: record => { this.lastExit = record; }
        });
        // The child can exit while the lock is being written; its exit handler
        // already released ownership, so never re-create a lock for a dead
        // kernel that a later start would mistake for a live one.
        const childIdentity = await processIdentity(child.pid);
        if (this.child === child) {
          fs.writeFileSync(this.paths.lock, JSON.stringify({ owner: this.owner, hostPID: process.pid,
            ...(this.hostIdentity ? { hostIdentity: this.hostIdentity } : {}),
            childPID: child.pid, ...(childIdentity ? { childIdentity } : {}) }));
        }
        const headers = { authorization: `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}` };
        const client = OpenCode.make({ baseUrl: url, headers });
        const deadline = Date.now() + this.startupTimeoutMs;
        let info;
        while (Date.now() < deadline) {
          if (this.closed || this.stopRequested) throw cancelledStart(this);
          if (processError) throw processError;
          if (child.exitCode !== null || child.signalCode !== null) throw new Error(`V2 exited during startup (${child.exitCode ?? child.signalCode})`);
          try { info = await client.server.info({ signal: AbortSignal.timeout(Math.min(1000, Math.max(1, deadline - Date.now()))) }); } catch {}
          if (info) break;
          await delay(75);
        }
        if (!info) throw new Error('Timed out starting OpenCode V2');
        if (this.closed || this.stopRequested) throw cancelledStart(this);
        if (info.version !== VERSION || info.pid !== child.pid) throw new Error('V2 server identity mismatch');
        // Public success is not sufficient: prove this endpoint enforces its private credential.
        const rejected = await fetch(`${url}/api/info`, { signal: AbortSignal.timeout(1500) });
        if (rejected.status !== 401) throw new Error('V2 server did not reject unauthenticated access');
        this.client = client;
        this.url = url;
        this.signature = signature;
        return this.status();
      } catch (error) {
        try { await terminate(child); }
        catch (terminationError) {
          throw new AggregateError([error, terminationError], `${error.message}; cleanup failed: ${terminationError.message}`, { cause: error });
        }
        this.child = null;
        this.client = null;
        this.url = '';
        this.release();
        throw error;
      }
    });
  }

  stop() {
    this.stopRequested = true;
    return this.serialize(async () => {
      try {
        await terminate(this.child);
        this.child = null;
        this.client = null;
        this.url = '';
        this.signature = '';
        this.release();
        return this.status();
      } finally {
        this.stopRequested = false;
      }
    });
  }

  // Quit path only. before-quit cannot await, so issue the kill synchronously;
  // otherwise the kernel survives the app and its owner.json blocks the next launch.
  killNow() {
    this.closeReason = 'app_shutdown';
    this.closed = true;
    this.stopRequested = true;
    const child = this.child;
    if (!child?.pid) return true;
    if (child.exitCode === null && child.signalCode === null && alive(child.pid)) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill.exe', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true, timeout: 3000, stdio: 'ignore' });
        } else process.kill(child.pid, 'SIGKILL');
      } catch { /* The liveness check below decides whether ownership may be released. */ }
    }
    if (alive(child.pid)) return false;
    this.child = null;
    this.client = null;
    this.url = '';
    this.signature = '';
    this.release();
    return true;
  }

  close() {
    this.closeReason = 'runtime_released';
    this.closed = true;
    return this.stop();
  }
}

module.exports = { OpenCodeV2Sidecar };

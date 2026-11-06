'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { EventEmitter } = require('node:events');
const { createRequire } = require('node:module');
const { OpenCodeV2Pool } = require('../lib/kernel-v2/pool');
const { startupCancellationAction, OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');

function fixture(t) {
  const parent = path.resolve(__dirname, '../.yanagent');
  fs.mkdirSync(parent, { recursive: true });
  const root = fs.mkdtempSync(path.join(parent, 'v2-recovery-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}

test('invalid routing entries are backed up and removed without losing healthy routes', t => {
  const root = fixture(t);
  const dir = path.join(root, 'opencode-runtime-v2');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'session-routes.json');
  const good = 'a'.repeat(64);
  const raw = JSON.stringify({ version: 1, sessions: { good, bad: 'legacy', array: [good], number: 42 } });
  fs.writeFileSync(file, raw);
  const pool = new OpenCodeV2Pool({ dataDir: root });
  assert.deepEqual(Object.entries(pool.routes), [['good', good]]);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)).sessions, { good });
  const backup = fs.readdirSync(dir).find(name => name.endsWith('.bak'));
  assert.equal(fs.readFileSync(path.join(dir, backup), 'utf8'), raw);
  pool.remember('new', 'b'.repeat(64));
  assert.equal(new OpenCodeV2Pool({ dataDir: root }).routes.new, 'b'.repeat(64));
  assert.equal(fs.readdirSync(dir).some(name => /\.(tmp|lock)$/.test(name)), false);
});

test('separate pools merge disk routes and reject conflicting ownership', t => {
  const root = fixture(t);
  const a = new OpenCodeV2Pool({ dataDir: root });
  const b = new OpenCodeV2Pool({ dataDir: root });
  a.remember('one', 'a'.repeat(64));
  b.remember('two', 'b'.repeat(64));
  a.remember('three', 'c'.repeat(64));
  assert.deepEqual(Object.keys(new OpenCodeV2Pool({ dataDir: root }).routes).sort(), ['one', 'three', 'two']);
  assert.throws(() => b.remember('one', 'd'.repeat(64)), /ownership conflict/);
  assert.throws(() => a.remember('invalid', ['a'.repeat(64)]), /storage key/);
  assert.equal(fs.existsSync(`${a.indexPath}.lock`), false);
  const lockOwner = JSON.stringify({ pid: process.pid });
  fs.writeFileSync(`${a.indexPath}.lock`, lockOwner);
  assert.throws(() => b.remember('blocked', 'e'.repeat(64)), /being updated/);
  assert.equal(fs.readFileSync(`${a.indexPath}.lock`, 'utf8'), lockOwner);
});

test('routing writer lock recovers after its process exits', async t => {
  const root = fixture(t);
  const pool = new OpenCodeV2Pool({ dataDir: root });
  const child = require('node:child_process').spawn(process.execPath, ['-e', ''], { windowsHide: true });
  await require('node:events').once(child, 'exit');
  fs.writeFileSync(`${pool.indexPath}.lock`, JSON.stringify({ pid: child.pid }));
  pool.remember('recovered', 'f'.repeat(64));
  assert.equal(new OpenCodeV2Pool({ dataDir: root }).routes.recovered, 'f'.repeat(64));
  assert.equal(fs.existsSync(`${pool.indexPath}.lock.recovery`), false);
});

test('structurally invalid or truncated indexes remain intact and release writer guard', t => {
  const root = fixture(t);
  const dir = path.join(root, 'opencode-runtime-v2');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'session-routes.json');
  for (const raw of ['null', '{', '{"version":1,"sessions":[]}', '{"version":2,"sessions":{}}']) {
    fs.writeFileSync(file, raw);
    assert.throws(() => new OpenCodeV2Pool({ dataDir: root }));
    assert.equal(fs.readFileSync(file, 'utf8'), raw);
    assert.deepEqual(fs.readdirSync(dir), ['session-routes.json']);
  }
});

function sidecarFixture(t) {
  const root = fixture(t);
  const filename = path.resolve(__dirname, '../lib/kernel-v2/sidecar.js');
  const nativeRequire = createRequire(filename);
  const child = new EventEmitter();
  Object.assign(child, { pid: 12345, exitCode: null, signalCode: null });
  let live = true, finishOnKill = false, syncKill = false, clock = 0;
  const calls = [];
  const paths = { root, home: root, data: root, config: root, cache: root, state: root,
    lock: path.join(root, 'owner.json'), executable: 'fixture', entrypoint: 'fixture', client: filename };
  const module = { exports: {} };
  const deadPids = new Set();
  const fakeProcess = { platform: 'win32', pid: process.pid, env: {}, kill(pid) {
    if (!live || deadPids.has(pid)) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
  } };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), {
    module, exports: module.exports, Buffer, AbortSignal, console,
    Date: { now: () => (clock += 6000) }, process: fakeProcess,
    require(id) {
      if (id === 'node:child_process') return { spawn: () => child, execFile(_file, args, _options, callback) {
        calls.push(args);
        if (finishOnKill) { live = false; child.exitCode = 1; child.emit('exit', 1); callback(null, '', ''); }
        else callback(Object.assign(new Error('denied'), { code: 5 }), '', 'Access denied');
      }, execFileSync(_file, args) {
        calls.push(args);
        if (!live) throw Object.assign(new Error('gone'), { code: 'ESRCH' });
        if (syncKill) { live = false; child.exitCode = 1; }
        return '';
      } };
      if (id === 'node:timers/promises') return { setTimeout: async () => {} };
      if (id === './diagnostics') return { watchProcess() {} };
      if (id === './runtime') return { runtimePaths: () => paths, validateStorage() {}, ensureRipgrep() {},
        verifyRuntime: async () => ({ make: () => ({}) }), environment: () => ({}), NODE_ARGS: [] };
      return nativeRequire(id);
    }
  }, { filename });
  const sidecar = new module.exports.OpenCodeV2Sidecar({ appRoot: root, dataDir: root, startupTimeoutMs: 1 });
  return { sidecar, child, calls, deadPids, finish() { live = false; child.exitCode = 1; child.emit('exit', 1); },
    allowKill() { finishOnKill = true; }, allowSyncKill() { syncKill = true; } };
}

test('failed stop retains ownership, reports taskkill diagnostics and permits retry', async t => {
  const f = sidecarFixture(t);
  f.sidecar.acquire();
  f.sidecar.child = f.child;
  await assert.rejects(f.sidecar.stop(), /ownership retained.*pid 12345.*Access denied/);
  assert.equal(f.sidecar.stopRequested, false);
  assert.equal(f.sidecar.child, f.child);
  assert.equal(fs.existsSync(f.sidecar.paths.lock), true);
  assert.equal(f.calls.length, 2);
  assert.equal(f.calls[0].includes('/T'), true);
  assert.equal(f.calls[1].includes('/T'), false);
  f.allowKill();
  await f.sidecar.stop();
  assert.equal(f.sidecar.child, null);
  assert.equal(fs.existsSync(f.sidecar.paths.lock), false);
});

test('startup cleanup preserves original error and late exit releases retained ownership', async t => {
  const f = sidecarFixture(t);
  await assert.rejects(f.sidecar.start(), error => {
    assert.match(error.message, /Timed out.*cleanup failed.*ownership retained/);
    assert.match(error.cause.message, /Timed out/);
    assert.equal(error.errors.length, 2);
    return true;
  });
  assert.equal(fs.existsSync(f.sidecar.paths.lock), true);
  f.finish();
  assert.equal(f.sidecar.child, null);
  assert.equal(fs.existsSync(f.sidecar.paths.lock), false);
});

test('a crashed routing recovery guard cannot block the index forever', t => {
  const root = fixture(t);
  const dir = path.join(root, 'opencode-runtime-v2');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'session-routes.json');
  const good = 'a'.repeat(64);
  fs.writeFileSync(file, JSON.stringify({ version: 1, sessions: { good } }));
  // A writer that dies between the two opens leaves BOTH files behind.
  const dead = require('node:child_process').spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: dead }));
  fs.writeFileSync(`${file}.lock.recovery`, JSON.stringify({ pid: dead }));
  const pool = new OpenCodeV2Pool({ dataDir: root });
  assert.equal(pool.routes.good, good);
  assert.deepEqual(fs.readdirSync(dir), ['session-routes.json']);
  // A guard still held by a live writer stays respected and is never deleted.
  fs.writeFileSync(`${file}.lock`, JSON.stringify({ pid: dead }));
  fs.writeFileSync(`${file}.lock.recovery`, JSON.stringify({ pid: process.pid }));
  assert.throws(() => pool.remember('next', 'b'.repeat(64)), /being updated/);
  assert.equal(fs.existsSync(`${file}.lock.recovery`), true);
});

test('a truncated index error names the file so the user can repair it', t => {
  const root = fixture(t);
  const dir = path.join(root, 'opencode-runtime-v2');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'session-routes.json');
  const raw = '{"version":1,"sess';
  fs.writeFileSync(file, raw);
  assert.throws(() => new OpenCodeV2Pool({ dataDir: root }), error => {
    assert.match(error.message, /not valid JSON/);
    assert.ok(error.message.includes(file), error.message);
    return true;
  });
  assert.equal(fs.readFileSync(file, 'utf8'), raw);
});

test('a half-written ownership file never throws from release or acquire', t => {
  const f = sidecarFixture(t);
  fs.writeFileSync(f.sidecar.paths.lock, '');
  f.sidecar.release();
  assert.equal(fs.existsSync(f.sidecar.paths.lock), true, 'an unattributable lock must not be deleted');
  assert.throws(() => f.sidecar.acquire(), error => {
    assert.match(error.message, /ownership file is invalid/);
    assert.ok(error.message.includes(f.sidecar.paths.lock), error.message);
    return true;
  });
});

test('quit-time kill is synchronous and only releases ownership once the kernel is gone', t => {
  const f = sidecarFixture(t);
  f.sidecar.acquire();
  f.sidecar.child = f.child;
  assert.equal(f.sidecar.killNow(), false);
  assert.equal(f.sidecar.child, f.child);
  assert.equal(fs.existsSync(f.sidecar.paths.lock), true);
  f.allowSyncKill();
  assert.equal(f.sidecar.killNow(), true);
  assert.equal(f.sidecar.child, null);
  assert.equal(fs.existsSync(f.sidecar.paths.lock), false);
  assert.equal(f.calls.at(-1).includes('/T'), true);
});

test('a busy routing index never aborts a running task', async t => {
  const root = fixture(t);
  const pool = new OpenCodeV2Pool({ dataDir: root });
  const key = 'a'.repeat(64);
  pool.routes.ses_1 = key;
  // Another live writer holds the index while the first event arrives.
  fs.writeFileSync(`${pool.indexPath}.lock`, JSON.stringify({ pid: process.pid }));
  pool.entry = () => ({ key, resources: { use: fn => fn() }, migrate: async () => {},
    run: async (request, emit) => {
      emit({ type: 'yan.opencode.started', data: { sessionID: 'ses_2' } });
      return { status: 'done', openCodeSessionId: 'ses_1' };
    } });
  const result = await pool.run({ runId: 'run-1', yanSessionId: 'chat-1', openCodeSessionId: 'ses_1' });
  assert.equal(result.status, 'done');
  assert.equal(pool.routes.ses_2, undefined, 'a failed write must not claim the route');
  fs.rmSync(`${pool.indexPath}.lock`, { force: true });
  pool.persistRoute('ses_2', key);
  assert.equal(pool.routes.ses_2, key);
});

test('a cancelled startup reports why it was cancelled', async t => {
  const f = sidecarFixture(t);
  const cancel = async () => {
    try { await f.sidecar.start(); }
    catch (error) { return error; }
    assert.fail('startup should have been cancelled');
  };
  f.sidecar.closed = true;
  const shutdown = await cancel();
  assert.equal(shutdown.message, 'V2 startup cancelled');
  assert.equal(shutdown.code, 'V2_START_CANCELLED');
  assert.equal(shutdown.reason, 'app_shutdown');

  f.sidecar.closed = false;
  f.sidecar.stopRequested = true;
  assert.equal((await cancel()).reason, 'requested_stop');

  f.sidecar.stopRequested = false;
  f.sidecar.closed = true;
  f.sidecar.closeReason = 'runtime_released';
  assert.equal((await cancel()).reason, 'runtime_released');
});

test('a cancelled startup is retried once; a released runtime interrupts instead', () => {
  const cancelled = reason => Object.assign(new Error('V2 startup cancelled'), { code: 'V2_START_CANCELLED', reason });
  assert.equal(startupCancellationAction(cancelled('requested_stop'), { cancelled: false, closed: false }), 'retry');
  assert.equal(startupCancellationAction(cancelled('requested_stop'), { cancelled: true, closed: false }), 'fail');
  assert.equal(startupCancellationAction(cancelled('requested_stop'), { cancelled: false, closed: true }), 'interrupted');
  assert.equal(startupCancellationAction(cancelled('app_shutdown'), { cancelled: false, closed: true }), 'interrupted');
  assert.equal(startupCancellationAction(cancelled('runtime_released'), { cancelled: false, closed: false }), 'interrupted');
  assert.equal(startupCancellationAction(new Error('Timed out starting OpenCode V2'), {}), 'fail');
  assert.equal(startupCancellationAction(undefined, {}), 'fail');
});

test('adapter recovers one cancelled startup and interrupts a released runtime', async () => {
  const cancelled = reason => Object.assign(new Error('V2 startup cancelled'), { code: 'V2_START_CANCELLED', reason });
  const adapterWith = (errors, closed = false) => {
    const adapter = Object.create(OpenCodeV2Adapter.prototype);
    let call = 0;
    adapter.transport = { closed };
    adapter.delegation = { context: () => null };
    adapter.start = async () => {
      const error = errors[call];
      call += 1;
      if (error) throw error;
      return { ok: true };
    };
    return { adapter, calls: () => call };
  };

  // A stop that overlapped admission is retried once on the same session.
  const retried = adapterWith([cancelled('requested_stop')]);
  const run = { cancelled: false };
  assert.equal(await retried.adapter.startForRun({}, run), false);
  assert.equal(retried.calls(), 2);
  assert.equal(run.interruptionReason, undefined);

  // A user cancel must not resurrect the startup.
  const userCancel = adapterWith([cancelled('requested_stop')]);
  await assert.rejects(userCancel.adapter.startForRun({}, { cancelled: true }), /startup cancelled/);
  assert.equal(userCancel.calls(), 1);

  // A released runtime interrupts the turn instead of reporting a failure.
  const released = adapterWith([cancelled('runtime_released')], true);
  const interrupted = { cancelled: false };
  assert.equal(await released.adapter.startForRun({}, interrupted), true);
  assert.equal(released.calls(), 1);
  assert.equal(interrupted.interruptionReason, 'runtime_released');

  // A real startup error still surfaces unchanged.
  const failed = adapterWith([new Error('Timed out starting OpenCode V2')]);
  await assert.rejects(failed.adapter.startForRun({}, { cancelled: false }), /Timed out/);
  assert.equal(failed.calls(), 1);
});

test('ownership left by this process is reclaimed once its kernel is gone', t => {
  const f = sidecarFixture(t);
  fs.writeFileSync(f.sidecar.paths.lock, JSON.stringify({ owner: 'previous', hostPID: process.pid, childPID: 4242 }));
  f.deadPids.add(4242);
  f.sidecar.acquire();
  const lock = JSON.parse(fs.readFileSync(f.sidecar.paths.lock, 'utf8'));
  assert.notEqual(lock.owner, 'previous');
  assert.equal(lock.hostPID, process.pid);
  assert.equal(lock.childPID, undefined);
});

test('a live kernel keeps this process from reclaiming its own lock', t => {
  const f = sidecarFixture(t);
  fs.writeFileSync(f.sidecar.paths.lock, JSON.stringify({ owner: 'previous', hostPID: process.pid, childPID: 4242 }));
  assert.throws(() => f.sidecar.acquire(), error => {
    assert.match(error.message, /already owned/);
    assert.match(error.message, /kernel 4242/);
    assert.match(error.message, /taskkill \/PID 4242 \/T \/F/);
    return true;
  });
  assert.equal(JSON.parse(fs.readFileSync(f.sidecar.paths.lock, 'utf8')).owner, 'previous');
});

test('a lock from another live host is never displaced', t => {
  const f = sidecarFixture(t);
  fs.writeFileSync(f.sidecar.paths.lock, JSON.stringify({ owner: 'other', hostPID: 777, childPID: 888 }));
  assert.throws(() => f.sidecar.acquire(), /already owned.*host 777/);
  assert.equal(JSON.parse(fs.readFileSync(f.sidecar.paths.lock, 'utf8')).owner, 'other');
});

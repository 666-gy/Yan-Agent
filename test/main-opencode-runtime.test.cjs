'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createOpenCodeRuntime } = require('../lib/main/opencode-runtime');
const { stateCell } = require('../lib/main/context');

function cell(value) { return stateCell(() => value, next => { value = next; }); }

function fixture(t, start = async () => {}) {
  const calls = { starts: [], closed: 0, throttling: [] };
  const cfg = { api: {} };
  const fullConfig = { provider: { test: {} } };
  const deps = {
    appRoot: '', dataDir: '', MAX_CONCURRENT_AGENT_RUNS: 3, OPENCODE_IDLE_RELEASE_MS: 10000,
    openCodeSidecar: cell(null), openCodeProviderAdapter: cell(null),
    openCodeIdleReleaseTimer: cell(null), openCodePrewarmPromise: cell(null), openCodeBackgroundLeases: cell(0),
    openCodeActiveRuns: new Map(),
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { setBackgroundThrottling: value => calls.throttling.push(value) } }),
    isQuitting: () => false,
    configStore: { loadConfig: () => cfg },
    mcpRuntimeConfig: {
      getOpenCodeMcpServers: config => { assert.equal(config, cfg); return ['server']; },
      getOpenCodeRuntimeConfig: (config, options) => {
        assert.equal(config, cfg);
        assert.deepEqual(options, { mcpServers: ['server'] });
        return fullConfig;
      }
    },
    Sidecar: class {
      constructor(options) { calls.options = options; }
      async prewarm(config, directory, target) { (calls.prewarms ||= []).push({ config, directory, target }); }
      async start(config) { calls.starts.push(config); await start(); }
      status() { return { ok: true }; }
      close() { calls.closed++; }
    },
    createProviderAdapter: sidecar => ({ sidecar })
  };
  t.after(() => clearTimeout(deps.openCodeIdleReleaseTimer.get()));
  return { deps, calls, fullConfig, runtime: createOpenCodeRuntime(deps) };
}

test('concurrent prewarms share one startup and pass full runtime config', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { deps, calls, fullConfig, runtime } = fixture(t, () => gate);
  const first = runtime.prewarmOpenCodeSidecar();
  const second = runtime.prewarmOpenCodeSidecar();
  assert.ok(deps.openCodePrewarmPromise.get());
  assert.equal(calls.starts.length, 1);
  assert.equal(calls.options.instanceIdleMs, deps.OPENCODE_IDLE_RELEASE_MS,
    'per-session kernels must not expire earlier than the desktop idle policy');
  release();
  assert.deepEqual(await first, { ok: true });
  assert.deepEqual(await second, { ok: true });
  assert.deepEqual(calls.starts, [fullConfig]);
  assert.equal(deps.openCodePrewarmPromise.get(), null);
  assert.ok(deps.openCodeIdleReleaseTimer.get());
  assert.equal(runtime.getOpenCodeProviderAdapter(), runtime.getOpenCodeProviderAdapter());
});

test('prewarm failures release the shared promise so later startup can retry', async t => {
  let fail = true;
  const { deps, runtime } = fixture(t, async () => { if (fail) throw new Error('startup failed'); });
  await assert.rejects(runtime.prewarmOpenCodeSidecar(), /startup failed/);
  assert.equal(deps.openCodePrewarmPromise.get(), null);
  fail = false;
  assert.deepEqual(await runtime.prewarmOpenCodeSidecar(), { ok: true });
});

test('switching prewarm targets keeps both session owners and directories', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const { runtime, calls } = fixture(t, () => gate);
  const a = runtime.prewarmOpenCodeSidecar({ directory: 'workspace-a', yanSessionId: 'task-a' });
  const b = runtime.prewarmOpenCodeSidecar({ directory: 'workspace-b', yanSessionId: 'task-b', openCodeSessionId: 'native-b' });
  release();
  await Promise.all([a, b]);
  assert.deepEqual(calls.prewarms.map(item => [item.directory, item.target.yanSessionId, item.target.openCodeSessionId]),
    [['workspace-a', 'task-a', undefined], ['workspace-b', 'task-b', 'native-b']]);
});

test('prewarm during an active task never builds or starts a competing runtime config', async t => {
  const { deps, calls, runtime } = fixture(t);
  deps.openCodeActiveRuns.set('running', {});
  for (let i = 0; i < 12; i++) assert.deepEqual(await runtime.prewarmOpenCodeSidecar(), { ok: true, skipped: 'active-runs' });
  assert.equal(calls.starts.length, 0);
});

test('active runs and leases cancel idle release and always release lease counts', async t => {
  const { deps, runtime, calls } = fixture(t);
  await runtime.prewarmOpenCodeSidecar();
  deps.openCodeActiveRuns.set('run', {});
  runtime.refreshAgentRuntimeActivity();
  assert.equal(deps.openCodeIdleReleaseTimer.get(), null);
  assert.equal(calls.throttling.at(-1), false);
  deps.openCodeActiveRuns.clear();
  await assert.rejects(runtime.withOpenCodeBackgroundLease(async () => {
    assert.equal(deps.openCodeBackgroundLeases.get(), 1);
    runtime.scheduleOpenCodeIdleRelease();
    assert.equal(deps.openCodeIdleReleaseTimer.get(), null);
    throw new Error('background failure');
  }), /background failure/);
  assert.equal(deps.openCodeBackgroundLeases.get(), 0);
  assert.ok(deps.openCodeIdleReleaseTimer.get());
});

test('new startup waits until the previous idle process has finished closing', async t => {
  const { deps, runtime, calls } = fixture(t);
  await runtime.ensureOpenCodeSidecar();
  let release, entered;
  const closing = new Promise(resolve => { release = resolve; });
  const started = new Promise(resolve => { entered = resolve; });
  deps.openCodeSidecar.get().close = () => { entered(); return closing; };
  const oldTimeout = global.setTimeout;
  // Tighten only the idle timeout, keeping the normal dependency wiring.
  t.mock.method(global, 'setTimeout', (fn, ms, ...args) => oldTimeout(fn, ms === 10000 ? 10 : ms, ...args));
  runtime.scheduleOpenCodeIdleRelease();
  await Promise.all([started, new Promise(resolve => oldTimeout(resolve, 30))]);
  const next = runtime.ensureOpenCodeSidecar();
  await new Promise(resolve => oldTimeout(resolve, 20));
  assert.equal(calls.starts.length, 1);
  release(); await next;
  assert.equal(calls.starts.length, 2);
});

test('idle release preserves native background work and rechecks admissions after awaiting activity', async t => {
  const { deps, runtime, calls } = fixture(t);
  await runtime.ensureOpenCodeSidecar();
  let tick;
  t.mock.method(global, 'setTimeout', callback => { tick = callback; return { unref() {} }; });
  t.mock.method(global, 'clearTimeout', () => {});
  const sidecar = deps.openCodeSidecar.get();
  sidecar.hasBackgroundWork = async () => true;
  runtime.scheduleOpenCodeIdleRelease();
  await tick();
  assert.equal(calls.closed, 0);
  let release;
  sidecar.hasBackgroundWork = () => new Promise(resolve => { release = resolve; });
  const pending = tick();
  deps.openCodeActiveRuns.set('new-run', {});
  release(false);
  await pending;
  assert.equal(calls.closed, 0);
  assert.equal(deps.openCodeSidecar.get(), sidecar);
});

test('a failed idle release does not block the next startup', async t => {
  const { deps, runtime, calls } = fixture(t);
  await runtime.ensureOpenCodeSidecar();
  let tick;
  t.mock.method(global, 'setTimeout', callback => { tick = callback; return { unref() {} }; });
  t.mock.method(global, 'clearTimeout', () => {});
  const sidecar = deps.openCodeSidecar.get();
  let rejectClose;
  sidecar.close = () => new Promise((resolve, reject) => { rejectClose = reject; });
  runtime.scheduleOpenCodeIdleRelease();
  await tick();
  assert.equal(deps.openCodeSidecar.get(), null);
  // A turn admitted while the release is still in flight must not inherit its error.
  const next = runtime.ensureOpenCodeSidecar();
  rejectClose(new Error('V2 process did not exit; ownership retained'));
  const started = await next;
  assert.notEqual(started, sidecar);
  assert.equal(calls.starts.length, 2);
});

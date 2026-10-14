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

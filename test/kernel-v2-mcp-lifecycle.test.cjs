'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createMcpLifecycle } = require('../lib/kernel-v2/mcp-lifecycle');
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
async function until(check) {
  const deadline = Date.now() + 2000;
  while (!check() && Date.now() < deadline) await delay(10);
  assert.ok(check());
}

test('single-flight connect tolerates one cancelled waiter; active tasks and calls prevent release', async t => {
  const ready = gate();
  let starts = 0, stops = 0, busy = true;
  const runtime = createMcpLifecycle({ idleMs: 40, pollMs: 10,
    connect: async () => { starts++; await ready.promise; return ['tool']; },
    disconnect: async () => { stops++; }, isBusy: async () => busy });
  t.after(() => runtime.close());
  const abort = new AbortController();
  const first = runtime.connect('one', abort.signal);
  const second = runtime.connect('one');
  abort.abort(new Error('cancel first'));
  await assert.rejects(first, /cancel first/);
  ready.resolve(); await second;
  assert.equal(starts, 1);
  await delay(100); assert.equal(stops, 0);
  const work = gate();
  const call = runtime.use('one', undefined, () => work.promise);
  busy = false;
  await delay(100); assert.equal(stops, 0);
  work.resolve(); await call;
  await until(() => stops === 1);
  assert.equal(runtime.isConnected('one'), false);
  await runtime.connect('one');
  assert.equal(starts, 2);
});

test('last cancelled waiter cleans partial startup; later retry works', async t => {
  let starts = 0, stops = 0;
  const runtime = createMcpLifecycle({ idleMs: 1000,
    connect: async (_name, signal) => {
      if (++starts > 1) return ['tool'];
      await delay(10000, undefined, { signal });
    }, disconnect: async () => { stops++; }, isBusy: async () => false });
  t.after(() => runtime.close());
  const abort = new AbortController();
  const pending = runtime.connect('one', abort.signal);
  abort.abort(new Error('cancel startup'));
  await assert.rejects(pending, /cancel startup/);
  await until(() => stops === 1);
  await runtime.connect('one');
  assert.equal(runtime.isConnected('one'), true);
});

test('activity-check errors retain services and reconnect waits for ongoing teardown', async t => {
  let fail = true, stops = 0, starts = 0;
  const stopped = gate();
  const runtime = createMcpLifecycle({ idleMs: 30, pollMs: 10, log: { warn() {} },
    connect: async () => { starts++; },
    disconnect: async () => { stops++; await stopped.promise; },
    isBusy: async () => { if (fail) throw new Error('transport unavailable'); return false; } });
  t.after(() => { stopped.resolve(); runtime.close(); });
  await runtime.connect('one');
  await delay(100); assert.equal(stops, 0);
  fail = false;
  await until(() => stops === 1);
  const next = runtime.connect('one');
  await delay(30); assert.equal(starts, 1);
  stopped.resolve(); await next;
  assert.equal(starts, 2);
});

test('cancelling a sibling connection check never tears down an already connected service', async t => {
  let checks = 0, stops = 0;
  const runtime = createMcpLifecycle({ idleMs: 1000,
    connect: async (_name, signal) => {
      if (++checks > 1) await delay(10000, undefined, { signal });
      return ['tool'];
    }, disconnect: async () => { stops++; }, isBusy: async () => true });
  t.after(() => runtime.close());
  await runtime.connect('one');
  const call = gate();
  const working = runtime.use('one', undefined, () => call.promise);
  const abort = new AbortController();
  const sibling = runtime.connect('one', abort.signal);
  abort.abort(new Error('cancel sibling'));
  await assert.rejects(sibling, /cancel sibling/);
  await delay(30);
  assert.equal(stops, 0);
  assert.equal(runtime.isConnected('one'), true);
  call.resolve(); await working;
});

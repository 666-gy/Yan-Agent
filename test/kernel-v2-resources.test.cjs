'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { setTimeout: delay } = require('node:timers/promises');
const { createResources } = require('../lib/kernel-v2/resources');
const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('idle shutdown waits for all leases and next admission waits for shutdown', async t => {
  const stopping = gate(), started = gate();
  let stops = 0;
  const resources = createResources({ idleMs: 15, stop: async () => { stops++; started.resolve(); await stopping.promise; } });
  t.after(() => { stopping.resolve(); return resources.close(); });
  const a = gate(), b = gate();
  const first = resources.use(() => a.promise), second = resources.use(() => b.promise);
  await delay(45);
  assert.equal(stops, 0);
  a.resolve(); await first; await delay(45);
  assert.equal(stops, 0);
  b.resolve(); await second; await Promise.all([started.promise, delay(30)]);
  let admitted = false;
  const next = resources.use(() => { admitted = true; });
  await delay(20); assert.equal(admitted, false);
  stopping.resolve(); await next;
  assert.equal(admitted, true);
});

test('background child prevents idle shutdown; failed operations release their lease', async t => {
  let busy = true, stops = 0;
  const resources = createResources({ idleMs: 15, isBusy: async () => busy, stop: async () => { stops++; } });
  t.after(() => resources.close());
  await assert.rejects(resources.use(async () => { throw new Error('failed'); }), /failed/);
  await delay(60); assert.equal(stops, 0); assert.equal(resources.active, 0);
  busy = false;
  await delay(50); assert.equal(stops, 1);
});

test('close rejects operations queued behind maintenance', async () => {
  const stopping = gate(), started = gate();
  const resources = createResources({ idleMs: 10, stop: async () => { started.resolve(); await stopping.promise; } });
  await resources.use(async () => {});
  // Keep the event loop alive while the unref'ed idle timer runs.
  await Promise.all([started.promise, delay(30)]);
  const next = resources.use(() => assert.fail('closed operation entered'));
  const rejected = assert.rejects(next, /closing/);
  const closing = resources.close();
  stopping.resolve(); await closing; await rejected;
});

'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { createHangGuard } = require('../lib/main/hang-guard');

// 同步阻塞主线程,模拟 UI 线程卡在 GPU 通道上。
const blockFor = ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function readEvents(logPath) {
  try {
    return fs.readFileSync(logPath, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line));
  } catch { return []; }
}

async function waitFor(logPath, predicate, timeoutMs = 5000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const events = readEvents(logPath);
    if (predicate(events)) return events;
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  return readEvents(logPath);
}

function setup(t, { gpuPid = 0, killGpu = true } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-hang-guard-'));
  const app = { getAppMetrics: () => [{ type: 'Browser', pid: process.pid }, { type: 'GPU', pid: gpuPid }] };
  const guard = createHangGuard({ app, dataDir, softMs: 600, hardMs: 1200, pollMs: 200, tickMs: 100, killCooldownMs: 0, killGpu });
  t.after(() => { guard.stop(); fs.rmSync(dataDir, { recursive: true, force: true }); });
  return guard;
}

test('hang guard logs a main-thread stall with its phase and kills the GPU process past the hard threshold', async t => {
  const gpu = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  const exited = new Promise(resolve => gpu.once('exit', resolve));
  t.after(() => { try { gpu.kill(); } catch {} });

  const guard = setup(t, { gpuPid: gpu.pid });
  guard.start();
  assert.ok((await waitFor(guard.logPath, events => events.some(e => e.event === 'guard-start'))).length);
  guard.mark('window:restore');
  blockFor(2500);

  const events = await waitFor(guard.logPath, list => list.some(e => e.event === 'stall-end'));
  const start = events.find(e => e.event === 'stall-start');
  assert.ok(start, 'stall-start recorded');
  assert.equal(start.phase, 'window:restore');
  assert.equal(start.blocking, false);
  assert.equal(start.gpuPid, gpu.pid);
  const kill = events.find(e => e.event === 'gpu-kill');
  assert.ok(kill, 'gpu-kill recorded');
  assert.equal(kill.pid, gpu.pid);
  assert.ok(events.some(e => e.event === 'stall-end' && e.durationMs >= 600));
  await exited;
});

test('hang guard never kills the GPU process during an expected blocking call', async t => {
  const gpu = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { try { gpu.kill(); } catch {} });

  const guard = setup(t, { gpuPid: gpu.pid });
  guard.start();
  await waitFor(guard.logPath, events => events.some(e => e.event === 'guard-start'));
  guard.whileBlocking('native-dialog', () => blockFor(2000));

  const events = await waitFor(guard.logPath, list => list.some(e => e.event === 'stall-end'));
  const start = events.find(e => e.event === 'stall-start');
  assert.ok(start, 'stall still recorded for diagnosis');
  assert.equal(start.blocking, true);
  assert.equal(start.phase, 'blocking:native-dialog');
  assert.ok(!events.some(e => e.event === 'gpu-kill' || e.event === 'gpu-kill-failed'));
  assert.equal(gpu.exitCode, null);
});

test('hang guard only watches by default and leaves the GPU process alone', async t => {
  const gpu = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => { try { gpu.kill(); } catch {} });

  const guard = setup(t, { gpuPid: gpu.pid, killGpu: false });
  guard.start();
  const start = (await waitFor(guard.logPath, events => events.some(e => e.event === 'guard-start')))[0];
  assert.equal(start.killGpu, false);
  blockFor(2500);

  const events = await waitFor(guard.logPath, list => list.some(e => e.event === 'stall-end'));
  assert.ok(events.some(e => e.event === 'stall-start'), 'the stall is still recorded for diagnosis');
  assert.ok(!events.some(e => e.event === 'gpu-kill' || e.event === 'gpu-kill-failed'));
  assert.equal(gpu.exitCode, null);
});

test('hang guard is inert when disabled', t => {
  const guard = createHangGuard({ app: {}, dataDir: fs.mkdtempSync(path.join(os.tmpdir(), 'yan-hang-guard-')), enabled: false });
  t.after(() => fs.rmSync(path.dirname(guard.logPath), { recursive: true, force: true }));
  guard.start();
  guard.note('ignored');
  assert.equal(guard.whileBlocking('x', () => 42), 42);
  guard.stop();
  assert.equal(fs.existsSync(guard.logPath), false);
});

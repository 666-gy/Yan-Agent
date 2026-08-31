'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { OpenCodeSidecar } = require('../lib/opencode-sidecar');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

class FakeKernel {
  constructor(id) {
    this.id = id;
    this.activeRuns = new Map();
    this.pendingRuns = new Map();
    this.runGates = new Map();
    this.startedConfigs = [];
    this.cancelledRuns = [];
    this.closed = false;
  }

  async start(config) {
    this.startedConfigs.push(config);
    return this.status();
  }

  status() {
    return {
      ok: !this.closed,
      url: `fake://${this.id}`,
      executable: 'fake-opencode',
      activeRuns: this.activeRuns.size,
      pendingRuns: this.pendingRuns.size
    };
  }

  hasRun(runId) {
    return this.activeRuns.has(String(runId)) || this.pendingRuns.has(String(runId));
  }

  async run(request) {
    const runId = String(request.runId);
    const gate = deferred();
    this.runGates.set(runId, gate);
    this.activeRuns.set(runId, request);
    try {
      await gate.promise;
      return { status: 'done', runId };
    } finally {
      this.activeRuns.delete(runId);
      this.runGates.delete(runId);
    }
  }

  finish(runId) {
    this.runGates.get(String(runId))?.resolve();
  }

  async cancel(runId) {
    this.cancelledRuns.push(String(runId));
    this.finish(runId);
    return { ok: true };
  }

  invalidate() {}

  close() {
    this.closed = true;
    for (const gate of this.runGates.values()) gate.resolve();
  }
}

async function waitFor(predicate, timeoutMs = 1_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for fake kernel state');
    await new Promise(resolve => setImmediate(resolve));
  }
}

function createPool(maxKernels = 3) {
  const kernels = [];
  const pool = new OpenCodeSidecar({
    maxKernels,
    kernelFactory: () => {
      const kernel = new FakeKernel(`kernel-${kernels.length + 1}`);
      kernels.push(kernel);
      return kernel;
    }
  });
  return { pool, kernels };
}

test('different OpenCode configurations run concurrently in isolated kernels', async t => {
  const { pool, kernels } = createPool();
  t.after(() => pool.close());

  const first = pool.run({ runId: 'run-a', openCodeConfig: { model: 'vendor/model-a' } });
  await waitFor(() => pool.hasRun('run-a'));
  const second = pool.run({ runId: 'run-b', openCodeConfig: { model: 'vendor/model-b' } });
  await waitFor(() => pool.hasRun('run-b'));

  assert.equal(kernels.length, 2);
  assert.equal(pool.status().activeRuns, 2);
  assert.equal(pool.hasRun('run-a'), true);
  assert.equal(pool.hasRun('run-b'), true);

  kernels[0].finish('run-a');
  kernels[1].finish('run-b');
  await Promise.all([first, second]);
  assert.equal(pool.status().activeRuns, 0);
});

test('matching configurations share one kernel and cancellation routes by run', async t => {
  const { pool, kernels } = createPool();
  t.after(() => pool.close());
  const config = { model: 'vendor/shared-model' };

  const first = pool.run({ runId: 'run-a', openCodeConfig: config });
  const second = pool.run({ runId: 'run-b', openCodeConfig: config });
  await waitFor(() => pool.hasRun('run-a') && pool.hasRun('run-b'));

  assert.equal(kernels.length, 1);
  assert.equal(pool.status().activeRuns, 2);
  assert.deepEqual(await pool.cancel('run-b'), { ok: true });
  assert.deepEqual(kernels[0].cancelledRuns, ['run-b']);

  kernels[0].finish('run-a');
  await Promise.all([first, second]);
});

test('pool enforces a hard ceiling of three simultaneous configurations', async t => {
  const { pool, kernels } = createPool(3);
  t.after(() => pool.close());
  const active = ['a', 'b', 'c'].map(id => pool.run({
    runId: `run-${id}`,
    openCodeConfig: { model: `vendor/model-${id}` }
  }));
  await waitFor(() => pool.status().activeRuns === 3);

  await assert.rejects(
    pool.run({ runId: 'run-d', openCodeConfig: { model: 'vendor/model-d' } }),
    /at most 3 concurrent Agent tasks/
  );

  kernels.forEach((kernel, index) => kernel.finish(`run-${String.fromCharCode(97 + index)}`));
  await Promise.all(active);
});

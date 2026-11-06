'use strict';

// A permission reply is retried by the renderer. When the run is gone the pool
// must say so with a machine-readable code; otherwise the dialog can only loop.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { OpenCodeV2Pool } = require('../lib/kernel-v2/pool');

function makePool() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pool-permission-'));
  return { pool: new OpenCodeV2Pool({ dataDir, maxKernels: 1 }), dataDir };
}

test('replyPermission reports RUN_GONE when the pool no longer owns the run', async () => {
  const { pool, dataDir } = makePool();
  try {
    const result = await pool.replyPermission({ runId: 'missing-run', requestId: 'per_1', reply: 'once' });
    assert.equal(result.ok, false);
    assert.equal(result.code, 'RUN_GONE');
    assert.equal(result.error, '任务不存在');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('replyQuestion keeps its own error contract', async () => {
  const { pool, dataDir } = makePool();
  try {
    const result = await pool.replyQuestion({ runId: 'missing-run', requestId: 'form_1', answers: [] });
    assert.equal(result.ok, false);
    assert.equal(result.error, '任务不存在');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

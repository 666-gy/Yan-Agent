'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { OpenCodeV2Pool } = require('../lib/kernel-v2/pool');
const { processIdentity } = require('../lib/kernel-v2/ownership');

const appRoot = path.resolve(__dirname, '..');
const yanSessionId = 'sess_idledelete0001';
const kernelId = 'ses_idledeletekernel0001';
const storageKey = crypto.createHash('sha256').update(yanSessionId).digest('hex');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pool-idle-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const storageDir = path.join(root, 'opencode-sessions-v2', storageKey);
  const runtimeDir = path.join(storageDir, 'opencode-runtime-v2');
  fs.mkdirSync(path.join(runtimeDir, 'data', 'opencode'), { recursive: true });
  fs.writeFileSync(path.join(runtimeDir, 'data', 'opencode', 'opencode.db'), 'kernel database');
  fs.mkdirSync(path.join(root, 'opencode-runtime-v2'), { recursive: true });
  fs.writeFileSync(path.join(root, 'opencode-runtime-v2', 'session-routes.json'),
    JSON.stringify({ version: 1, sessions: { [kernelId]: storageKey } }));
  const pool = new OpenCodeV2Pool({ appRoot, dataDir: root, maxKernels: 4, instanceIdleMs: 1000 });
  return { root, storageDir, runtimeDir, pool };
}

test('an idle routed session is deleted by removing its exclusive runtime directory', async (t) => {
  const { root, storageDir, pool } = fixture(t);
  const result = await pool.deleteKernelSessionTrees([kernelId], root, { yanSessionId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.deleted, 1);
  assert.equal(fs.existsSync(storageDir), false);
  assert.equal(pool.status().kernels, 0, 'no kernel should be started for an idle delete');
});

test('a reused PID recorded in the lock does not block the idle delete', async (t) => {
  const { root, storageDir, runtimeDir, pool } = fixture(t);
  fs.writeFileSync(path.join(runtimeDir, 'owner.json'),
    JSON.stringify({ owner: 'stale', hostPID: process.pid, hostIdentity: 'a-different-process' }));
  const result = await pool.deleteKernelSessionTrees([kernelId], root, { yanSessionId });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(fs.existsSync(storageDir), false);
});

test('a live owner falls back instead of deleting files under a running kernel', async (t) => {
  const { root, storageDir, runtimeDir, pool } = fixture(t);
  fs.writeFileSync(path.join(runtimeDir, 'owner.json'),
    JSON.stringify({ owner: 'live', hostPID: process.pid, hostIdentity: await processIdentity(process.pid) }));
  const result = await pool.deleteIdleSessionStorage([kernelId], yanSessionId);
  assert.equal(result, null);
  assert.equal(fs.existsSync(storageDir), true);
});

test('a legacy copy prevents direct directory removal', async (t) => {
  const { root, storageDir, pool } = fixture(t);
  let DatabaseSync;
  try { ({ DatabaseSync } = require('node:sqlite')); } catch { t.skip('node:sqlite unavailable'); return; }
  const legacyDir = path.join(root, 'opencode-runtime-v2', 'data', 'opencode');
  fs.mkdirSync(legacyDir, { recursive: true });
  const db = new DatabaseSync(path.join(legacyDir, 'opencode.db'));
  try {
    db.exec('CREATE TABLE session_v2 (id TEXT PRIMARY KEY)');
    db.prepare('INSERT INTO session_v2 (id) VALUES (?)').run(kernelId);
  } finally { db.close(); }
  const result = await pool.deleteIdleSessionStorage([kernelId], yanSessionId);
  assert.equal(result, null);
  assert.equal(fs.existsSync(storageDir), true);
});

test('a route owned by another session is never removed directly', async (t) => {
  const { root, storageDir, pool } = fixture(t);
  const result = await pool.deleteIdleSessionStorage([kernelId], 'sess_someoneelse0001');
  assert.equal(result, null);
  assert.equal(fs.existsSync(storageDir), true);
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ownerProcessAlive, processIdentity, processStartMs } = require('../lib/kernel-v2/ownership');
const { OpenCodeV2Sidecar } = require('../lib/kernel-v2/sidecar');

const DOTNET_EPOCH_OFFSET_MS = 62135596800000;
const toTicks = ms => String((ms + DOTNET_EPOCH_OFFSET_MS) * 10000);

test('a matching process identity keeps a live owner', async () => {
  const alive = await ownerProcessAlive({ pid: 42, identity: 'start-1', lockMtimeMs: 0,
    aliveOf: () => true, identityOf: async () => 'start-1' });
  assert.equal(alive, true);
});

test('a reused PID with a different start identity is not the owner', async () => {
  const alive = await ownerProcessAlive({ pid: 42, identity: 'start-1', lockMtimeMs: 0,
    aliveOf: () => true, identityOf: async () => 'start-2' });
  assert.equal(alive, false);
});

test('an unreadable identity never steals a live owner', async () => {
  const alive = await ownerProcessAlive({ pid: 42, identity: 'start-1', lockMtimeMs: 0,
    aliveOf: () => true, identityOf: async () => '' });
  assert.equal(alive, true);
});

test('a dead PID is never the owner', async () => {
  const alive = await ownerProcessAlive({ pid: 42, identity: 'start-1', lockMtimeMs: 0,
    aliveOf: () => false, identityOf: async () => 'start-1' });
  assert.equal(alive, false);
});

test('legacy owner files treat a process started after the lock as a reused PID', async () => {
  const lockMtimeMs = Date.parse('2026-10-31T13:52:47Z');
  const startedAt = Date.parse('2026-11-02T11:01:06Z');
  const alive = await ownerProcessAlive({ pid: 3820, lockMtimeMs,
    aliveOf: () => true, identityOf: async () => toTicks(startedAt) });
  assert.equal(alive, false);
});

test('legacy owner files keep a process that started before the lock', async () => {
  const lockMtimeMs = Date.parse('2026-10-31T13:52:47Z');
  const startedAt = Date.parse('2026-10-31T13:00:00Z');
  const alive = await ownerProcessAlive({ pid: 3820, lockMtimeMs,
    aliveOf: () => true, identityOf: async () => toTicks(startedAt) });
  assert.equal(alive, true);
});

test('legacy owner files stay conservative when the start time is unavailable', async () => {
  const alive = await ownerProcessAlive({ pid: 3820, lockMtimeMs: Date.now(),
    aliveOf: () => true, identityOf: async () => '' });
  assert.equal(alive, true);
});

test('processStartMs converts .NET process start ticks', () => {
  const ms = Date.parse('2026-11-02T11:01:06Z');
  assert.equal(processStartMs(toTicks(ms)), ms);
});

function fixture(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-owner-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sidecar = new OpenCodeV2Sidecar({ appRoot: path.resolve(__dirname, '..'), dataDir: dir, storageDir: dir });
  fs.mkdirSync(path.dirname(sidecar.paths.lock), { recursive: true });
  return { dir, sidecar, lock: sidecar.paths.lock };
}

test('acquire reclaims a legacy lock whose recorded PID was reused', async (t) => {
  const { sidecar, lock } = fixture(t);
  fs.writeFileSync(lock, JSON.stringify({ owner: 'old-owner', hostPID: process.ppid }));
  const old = new Date(Date.now() - 3600000);
  fs.utimesSync(lock, old, old);

  await sidecar.acquire();
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).owner, sidecar.owner);
  sidecar.release();
  assert.equal(fs.existsSync(lock), false);
});

test('acquire keeps a live legacy owner when the process started before the lock', async (t) => {
  const { sidecar, lock } = fixture(t);
  fs.writeFileSync(lock, JSON.stringify({ owner: 'old-owner', hostPID: process.ppid }));
  const future = new Date(Date.now() + 10000);
  fs.utimesSync(lock, future, future);

  await assert.rejects(sidecar.acquire(), /already owned by a live process/);
  assert.equal(JSON.parse(fs.readFileSync(lock, 'utf8')).owner, 'old-owner');
});

test('acquire records the current process identity for later reuse checks', async (t) => {
  const { sidecar, lock } = fixture(t);
  await sidecar.acquire();
  const record = JSON.parse(fs.readFileSync(lock, 'utf8'));
  assert.equal(record.hostPID, process.pid);
  assert.equal(record.hostIdentity, await processIdentity(process.pid));
  sidecar.release();
});

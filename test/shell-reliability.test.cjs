'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { EventEmitter } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { DatabaseSync } = require('node:sqlite');
const { acquireFiles, listClaims, recoverClaim, supervisedJobStopped } = require('../lib/workspace/file-locks');
const { createBashStore } = require('../lib/background-bash-store');
const { BackgroundBash } = require('../lib/background-bash');
function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-shell-reliability-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  return root;
}
test('lock contention is bounded and exposes the actual holder without blocking timers', async t => {
  const root = fixture(t), ledger = path.join(root, 'locks.sqlite');
  const release = await acquireFiles([root], { ledger, owner: 'holder' });
  let ticks = 0, holders;
  const timer = setInterval(() => ticks++, 10);
  try {
    await assert.rejects(acquireFiles([root], { ledger, waitMs: 150, onWait: value => holders = value }), { code: 'YAN_LOCK_TIMEOUT' });
    assert.equal(holders[0].owner, 'holder'); assert.ok(ticks >= 3);
  } finally { clearInterval(timer); await release(); }
});
test('SQLite busy admission and release retry asynchronously and leave no orphan', async t => {
  const root = fixture(t), ledger = path.join(root, 'locks.sqlite');
  const release = await acquireFiles([root], { ledger });
  const db = new DatabaseSync(ledger); db.exec('BEGIN IMMEDIATE');
  const released = release();
  let responsive = false;
  const timer = setTimeout(() => { responsive = true; db.exec('COMMIT'); }, 80);
  assert.equal(await released, true); clearTimeout(timer); assert.equal(responsive, true);
  assert.equal(db.prepare('SELECT count(*) AS n FROM claims').get().n, 0);
  db.exec('BEGIN EXCLUSIVE');
  const pending = acquireFiles([root], { ledger, waitMs: 500 });
  setTimeout(() => db.exec('COMMIT'), 80);
  await (await pending)(); db.close();
});
test('legacy uncertain locks require confirmation, preserve an audit and do not block unrelated scopes', async t => {
  const root = fixture(t), ledger = path.join(root, 'locks.sqlite');
  await (await acquireFiles([root], { ledger }))();
  const db = new DatabaseSync(ledger);
  db.prepare('INSERT INTO claims (id,pid,owner,scopes) VALUES (?,?,?,?)').run('legacy', 2147483647, 'uncertain:old', JSON.stringify([require('../lib/workspace/file-locks').canonical(path.join(root, 'a'))]));
  db.close();
  await (await acquireFiles([path.join(root, 'b')], { ledger }))();
  await assert.rejects(acquireFiles([path.join(root, 'a')], { ledger }), /Uncertain shell lease/);
  await assert.rejects(recoverClaim('legacy', { ledger }), /确认/);
  assert.equal((await recoverClaim('legacy', { ledger, confirmed: true })).recovered, true);
  assert.match(fs.readFileSync(ledger + '.recovery.jsonl', 'utf8'), /uncertain:old/);
  const release = await acquireFiles([root], { ledger });
  await assert.rejects(recoverClaim((await listClaims({ ledger }))[0].id, { ledger, confirmed: true }), /仍在运行/);
  await release();
});
test('PID reuse and a stopped named Job allow safe supervised recovery', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t), ledger = path.join(root, 'locks.sqlite');
  await (await acquireFiles([root], { ledger }))();
  const db = new DatabaseSync(ledger), name = 'Local\\YanShell-' + require('node:crypto').randomUUID();
  db.prepare('INSERT INTO claims VALUES (?,?,?,?)').run('reused', process.pid, `supervised:${name}|old`, JSON.stringify([root.toLowerCase()]));
  db.prepare('INSERT INTO claim_identities VALUES (?,?)').run('reused', 'different-process-start');
  db.close();
  assert.equal((await listClaims({ ledger }))[0].ownerAlive, false);
  await (await acquireFiles([root], { ledger }))();
  assert.deepEqual(await listClaims({ ledger }), []);
});
test('named Windows Job remains detectable while the shell is running', { skip: process.platform !== 'win32' }, async t => {
  const root = fixture(t), name = 'Local\\YanShell-' + require('node:crypto').randomUUID();
  fs.writeFileSync(path.join(root, 'wait.cjs'), 'console.log("READY");setInterval(()=>{},1000)');
  const { runBashCommand } = await import('../lib/kernel-bash-tool.mjs');
  const abort = new AbortController(); let finished;
  const completion = new Promise(resolve => finished = resolve);
  try {
    await runBashCommand({ command: 'node wait.cjs', cwd: root, supervisorName: name, signal: abort.signal, timeout: 300, backgroundOnTimeout: true, onBackgroundComplete: finished });
    assert.equal(await supervisedJobStopped(name), false);
  } finally { abort.abort(); await completion; }
  assert.equal(await supervisedJobStopped(name), true);
});
test('restart preserves bounded output and never re-executes or wakes a restored command', async t => {
  const root = fixture(t), store = createBashStore(root);
  store.save({ id: 'one', sessionId: 's', status: 'running', output: 'x'.repeat(17000), wakeStatus: 'pending' }); store.flush();
  const second = createBashStore(root);
  const service = new BackgroundBash({ execute() { assert.fail('must not replay'); }, wake() { assert.fail('must not wake'); } });
  t.after(() => service.close()); service.restore(second.load()); await service.flush();
  const job = service.public(service.get('one'), true);
  assert.equal(job.status, 'interrupted'); assert.equal(job.output.length, 16000); assert.equal(job.truncated, true);
  second.save(null, 's'); second.flush(); assert.deepEqual(createBashStore(root).load(), []);
});
test('synchronous executor failure settles the job without crashing the manager', async t => {
  const service = new BackgroundBash({ execute() { throw new Error('spawn failed'); } });
  t.after(() => service.close());
  await assert.rejects(service.start({ runId: 'r', yanSessionId: 's' }, { command: 'x' }), /spawn failed/);
  assert.equal(service.list('s')[0].status, 'failed');
});
test('wake retries stop at twelve attempts and never combine different parent turns', async t => {
  const calls = [];
  const service = new BackgroundBash({ execute() {}, wake: async (owner, jobs) => {
    calls.push({ run: owner.runId, jobs }); return { error: 'not saved yet' };
  } });
  t.after(() => service.close());
  for (const run of ['a', 'b']) {
    service.register(run, { yanSessionId: 's-' + run }); service.runs.get(run).settled = true;
    service.jobs.set(run, { id: run, runId: run, sessionId: 's-' + run, status: 'succeeded', result: { output: run, exit: 0 } }); service.pending.add(run);
  }
  await service.flush(); assert.equal(calls.length, 2);
  assert.ok(calls.every(call => call.jobs.length === 1 && call.jobs[0].runId === call.run));
  assert.ok(service.get('a').nextWakeAt > Date.now());
  await service.flush(); assert.equal(calls.length, 2);
  for (let i = 1; i < 12; i++) { for (const job of service.jobs.values()) job.nextWakeAt = 0; await service.flush(); }
  assert.equal(calls.length, 24); assert.equal(service.pending.size, 0); assert.equal(service.get('a').wakeStatus, 'failed');
});
test('diagnostics preserve exit cause, redact chunk-split secrets and bound file retention', async t => {
  const root = fixture(t), child = new EventEmitter(); child.pid = 123; child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
  for (let i = 0; i < 30; i++) fs.writeFileSync(path.join(root, `kernel-${1000 + i}.jsonl`), 'old');
  let exit;
  require('../lib/kernel-v2/diagnostics').watchProcess(child, root, { secrets: ['custom-secret'], onExit: value => exit = value });
  child.stderr.emit('data', Buffer.from('password="cus')); await delay(550);
  child.stderr.emit('data', Buffer.from('tom-secret"\nBearer sk-split')); await delay(550);
  child.stderr.emit('data', Buffer.from('token\n' + 'q'.repeat(20000)));
  child.stderr.emit('data', Buffer.from('secret-tail\nlast failure\n')); child.emit('exit', 7, null);
  const output = fs.readFileSync(path.join(root, 'kernel-123.jsonl'), 'utf8');
  assert.doesNotMatch(output, /custom-secret|sk-split|secret-tail/);
  assert.match(output, /last failure/); assert.equal(exit.code, 7); assert.equal(exit.reason, 'unexpected_exit');
  assert.ok(fs.readdirSync(root).length <= 20);
});
test('UI attribution requires evidence of a user cancel and preserves failed/completed outcomes', () => {
  const outcome = require('../renderer/run-outcome');
  assert.equal(outcome.reconcile({ status: 'completed' }).status, 'done');
  assert.equal(outcome.reconcile({ status: 'failed', result: { error: 'kernel exit 7' } }).error, 'kernel exit 7');
  assert.equal(outcome.userAbort(outcome.reconcile({ status: 'aborted', cancelReason: 'user_cancelled' })), false);
  assert.equal(outcome.userAbort(outcome.reconcile({ status: 'aborted', cancelReason: 'user_cancelled', telemetry: { cancelRequestedAt: 1 } })), true);
  assert.doesNotMatch(outcome.message({ status: 'interrupted' }), /用户手动/);
  assert.match(outcome.message({ status: 'interrupted', interruptionReason: 'app_shutdown' }), /应用退出/);
  assert.doesNotMatch(outcome.message({ status: 'interrupted', interruptionReason: 'response_timeout' }), /用户手动/);
  assert.match(outcome.message({ status: 'interrupted', interruptionReason: 'response_timeout', responseTimeoutMinutes: 2 }), /模型在 2 分钟内未成功回包/);
  assert.equal(outcome.message({ status: 'interrupted', interruptionReason: 'response_timeout', error: '自定义超时' }), '自定义超时');
});

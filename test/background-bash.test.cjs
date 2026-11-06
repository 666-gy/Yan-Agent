'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const { PassThrough } = require('node:stream');
const { BackgroundBash } = require('../lib/background-bash');
const tick = () => new Promise(resolve => setImmediate(resolve));

test('lock admission yields within budget, inspection bypasses it, cancellation never executes queued work', async t => {
  let grant;
  const { service, owner, children } = await setup(t, { acquireLock: (_files, { signal }) => new Promise((resolve, reject) => {
    grant = () => resolve(() => {});
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }) });
  const queued = await service.start(owner, { command: 'npm install', mutationPaths: ['package-lock.json'], callID: 'queued', timeout: 20 });
  assert.equal(queued.background, true);
  assert.equal(service.get(queued.jobId).phase, 'queued');
  assert.equal(children.length, 0);
  const read = service.start(owner, { command: 'cat package.json', shell: { kind: 'posix' }, callID: 'read', timeout: 1000 });
  await tick(); assert.equal(children.length, 1);
  children[0].emit('close', 0, null); await read;
  service.cancel(queued.jobId, owner.yanSessionId); await tick();
  assert.equal(service.get(queued.jobId).status, 'cancelled');
  grant(); await tick(); assert.equal(children.length, 1);
});

test('background shell retains mutation lease through foreground yield until process exit', async t => {
  const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
  const { acquireFiles } = require('../lib/workspace/file-locks');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-bash-lock-'));
  const ledger = path.join(root, 'locks.sqlite');
  const { service, owner, children } = await setup(t, { acquireLock: (files, options) => acquireFiles(files, { ...options, ledger }) });
  const result = await service.start(owner, { command: 'long', mutationPaths: [root], callID: 'lease-test', timeout: 10 });
  assert.equal(result.background, true);
  let acquired = false;
  const pending = acquireFiles([path.join(root, 'file')], { ledger }).then(release => { acquired = true; return release; });
  await new Promise(r => setTimeout(r, 100)); assert.equal(acquired, false);
  children[0].emit('exit', 0, null); children[0].emit('close', 0, null);
  const release = await pending; release();
  fs.rmSync(root, { recursive: true, force: true });
});

async function setup(t, options = {}) {
  const { runBashCommand } = await import('../lib/kernel-bash-tool.mjs');
  const children = [], wakes = [], changes = [];
  const execute = args => runBashCommand({ ...args, shell: { command: 'test', kind: 'posix' }, spawnImpl() {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    children.push(child); return child;
  }});
  const service = new BackgroundBash({ execute, changed: job => changes.push(job),
    wake: async (owner, jobs) => { wakes.push({ owner, jobs }); return { ok: true }; }, quietMs: 0, ...options });
  t.after(() => service.close());
  service.register('run-1', { yanSessionId: 'session-1' });
  service.observe('run-1', { type: 'yan.opencode.started', data: { sessionID: 'kernel-1' } });
  return { service, children, wakes, changes, owner: service.owner('kernel-1') };
}

test('delivered subagent reports are removed from queued and later-arriving continuations', async t => {
  const { service, wakes } = await setup(t);
  service.continueTask('run-1', [{ activationId: 'old' }, { activationId: 'new' }]);
  service.observe('run-1', { type: 'yan.subagent.delivered', data: { activationIds: ['old'] } });
  assert.deepEqual(service.continuations.get('run-1').reports, [{ activationId: 'new' }]);
  service.observe('run-1', { type: 'yan.subagent.delivered', data: { activationIds: ['new'] } });
  assert.equal(service.continuations.size, 0);
  service.continueTask('run-1', [{ activationId: 'old' }, { activationId: 'new' }]);
  service.settled('run-1');
  await service.flush();
  assert.equal(wakes.length, 0);
  assert.equal(service.continuations.size, 0);
});

test('background wake resets settled state and ignores retired child events', async t => {
  const { service, owner } = await setup(t);
  service.settled(owner.runId);
  service.register('wake', { ...owner, sessions: undefined });
  service.observe('wake', { type: 'yan.opencode.started', data: { sessionID: 'kernel-1' } });
  assert.equal(service.owner('kernel-1').runId, 'wake');
  service.observe('wake', { type: 'yan.subagent.event', data: { sessionID: 'foreign', childSessionID: 'bad' } });
  assert.equal(service.owner('bad'), undefined);
  service.observe('wake', { type: 'yan.subagent.event', data: { sessionID: 'kernel-1', childSessionID: 'tester' } });
  assert.equal(service.owner('tester'), undefined);
  service.settled('wake');
  assert.equal(service.owner('tester'), undefined);
});

test('soft wait yields, keeps pipes alive, and success wakes once after parent settles', async t => {
  const { service, owner, children, wakes } = await setup(t);
  const result = await service.start(owner, { command: 'long', callID: 'call-1', timeout: 10, onComplete: 'resume' });
  assert.equal(result.background, true); assert.equal(result.timedOut, false);
  children[0].stdout.write('still running');
  assert.equal(children[0].stdout.destroyed, false);
  children[0].emit('exit', 0, null); children[0].emit('close', 0, null);
  await tick(); assert.equal(wakes.length, 0);
  service.settled('run-1'); await tick(); await service.flush();
  assert.equal(wakes.length, 1); assert.equal(wakes[0].jobs[0].output, 'still running');
  assert.equal(service.get(result.jobId).status, 'succeeded');
  assert.equal(service.get(result.jobId).wakeStatus, 'delivered');
});

test('nonzero exit and spawn error both wake; close after exit never duplicates', async t => {
  for (const error of [false, true]) {
    const { service, owner, children, wakes } = await setup(t);
    const result = await service.start(owner, { command: 'fail', background: true, onComplete: 'resume' });
    service.settled('run-1');
    if (error) children[0].emit('error', new Error('ENOENT'));
    else children[0].emit('exit', 7, null);
    children[0].emit('close', 7, null);
    await tick(); await service.flush();
    assert.equal(wakes.length, 1); assert.equal(service.get(result.jobId).status, 'failed');
  }
});

test('a pipe held by a grandchild cannot prevent a background completion', async t => {
  const { service, owner, children, wakes } = await setup(t);
  await service.start(owner, { command: 'grandchild', background: true, onComplete: 'resume' }); service.settled('run-1');
  children[0].emit('exit', 0, null); children[0].stdout.write('trailing');
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(wakes.length, 1); assert.equal(wakes[0].jobs[0].output, 'trailing');
  assert.equal(children[0].stdout.destroyed, true);
});

test('manual job cancellation and whole-turn cancellation stay silent', async t => {
  for (const wholeSession of [false, true]) {
    const { service, owner, children, wakes } = await setup(t);
    const result = await service.start(owner, { command: 'long', background: true });
    if (wholeSession) service.cancelRun('run-1'); else service.cancel(result.jobId, 'session-1');
    children[0].emit('close', 0, null); service.settled('run-1'); await tick();
    assert.equal(wakes.length, 0); assert.equal(service.get(result.jobId).status, 'cancelled');
  }
});

test('busy session queues completion; capacity retry and simultaneous flush cannot double wake', async t => {
  let busy = true, calls = 0, finish;
  const { service, owner, children } = await setup(t, {
    wakeRetryMs: 0, busy: () => busy, wake: async () => { calls++; if (calls === 1) return { ok: false }; return new Promise(resolve => { finish = resolve; }); }
  });
  const result = await service.start(owner, { command: 'long', background: true, onComplete: 'resume' });
  children[0].emit('close', 0, null); service.settled('run-1'); await tick();
  assert.equal(calls, 0); busy = false;
  await service.flush(); assert.equal(calls, 1);
  const pending = service.flush(); await service.flush(); assert.equal(calls, 2);
  finish({ ok: true }); await pending; await service.flush();
  assert.equal(calls, 2); assert.equal(service.get(result.jobId).wakeStatus, 'delivered');
});

test('duplicate request does not rerun; foreign sessions cannot read or cancel; Agent background releases wait', async t => {
  const { service, owner, children } = await setup(t);
  const pending = service.start(owner, { command: 'long', callID: 'same', background: true });
  const id = service.list('session-1')[0].id;
  assert.throws(() => service.cancel(id, 'session-2'), /不存在/);
  assert.throws(() => service.get(id, 'session-2'), /不存在/);
  assert.equal(service.list('session-2').length, 0);
  assert.equal(service.background, undefined);
  assert.equal((await pending).background, true);
  assert.equal((await service.start(owner, { command: 'long', callID: 'same', background: true })).jobId, id);
  assert.equal(children.length, 1);
});

test('completion queued before user stops the Agent cannot resurrect it', async t => {
  const { service, owner, children, wakes } = await setup(t);
  await service.start(owner, { command: 'long', background: true });
  children[0].emit('close', 0, null);
  service.cancelSession('session-1'); service.settled('run-1'); await service.flush();
  assert.equal(wakes.length, 0); assert.equal(service.pending.size, 0);
});

test('a completion without a resume declaration never opens another turn', async t => {
  const { service, owner, children, wakes } = await setup(t);
  const result = await service.start(owner, { command: 'long', background: true });
  children[0].emit('close', 0, null); service.settled('run-1'); await tick(); await service.flush();
  assert.equal(wakes.length, 0); assert.equal(service.pending.size, 0);
  assert.equal(service.get(result.jobId).wakeStatus, 'detached');
});

test('a burst of completions waits for the quiet window and resumes once', async t => {
  const { service, owner, children, wakes } = await setup(t, { quietMs: 120 });
  await service.start(owner, { command: 'one', background: true, onComplete: 'resume' });
  await service.start(owner, { command: 'two', background: true, onComplete: 'resume' });
  for (const child of children) child.emit('close', 0, null);
  service.settled('run-1');
  await service.flush(); assert.equal(wakes.length, 0);
  await new Promise(resolve => setTimeout(resolve, 160));
  await service.flush();
  assert.equal(wakes.length, 1); assert.equal(wakes[0].jobs.length, 2);
});

test('one automatic continuation per idle period, then a user turn folds the rest', async t => {
  const { service, owner, children, wakes } = await setup(t);
  await service.start(owner, { command: 'one', background: true, onComplete: 'resume' });
  await service.start(owner, { command: 'two', background: true, onComplete: 'resume' });
  children[0].emit('close', 0, null);
  service.settled('run-1'); await tick(); await service.flush();
  assert.equal(wakes.length, 1);
  children[1].emit('close', 0, null); await tick(); await service.flush();
  assert.equal(wakes.length, 1, 'a second completion in the same idle period stays silent');
  const second = service.list('session-1').find(job => job.command === 'two');
  service.register('run-2', { yanSessionId: 'session-1' });
  assert.equal(service.get(second.id).wakeStatus, 'folded');
  await service.flush(); assert.equal(wakes.length, 1);
});

test('a completion folded by a new user turn does not open a turn', async t => {
  const { service, owner, children, wakes } = await setup(t);
  const result = await service.start(owner, { command: 'long', background: true, onComplete: 'resume' });
  children[0].emit('close', 0, null); await tick();
  assert.equal(service.pending.size, 1);
  service.register('run-2', { yanSessionId: 'session-1' });
  assert.equal(service.get(result.jobId).wakeStatus, 'folded');
  service.settled('run-1'); await service.flush();
  assert.equal(wakes.length, 0); assert.equal(service.pending.size, 0);
});

test('background output cannot masquerade as a completed verification', () => {
  const { verificationRecord } = require('../lib/verification-state');
  const record = verificationRecord({ tool: 'bash', state: { status: 'completed', input: { command: 'npm test' },
    metadata: { background: true, exit: null }, output: 'Command exited with code 0.' } });
  assert.equal(record.status, 'unknown'); assert.equal(record.exit, null);
});

test('permanent deletion purges background state and ignores late completion', async t => {
  const { service, owner, children, wakes, changes } = await setup(t);
  const result = await service.start(owner, { command: 'long', background: true });
  service.purgeSession('session-1');
  const count = changes.length;
  children[0].emit('close', 0, null); service.settled('run-1'); await tick(); await service.flush();
  assert.deepEqual(service.list('session-1'), []);
  assert.throws(() => service.get(result.jobId), /不存在/);
  assert.equal(service.runs.size, 0); assert.equal(service.pending.size, 0);
  assert.equal(wakes.length, 0); assert.equal(changes.length, count);
});

test('a failed wake arriving after permanent deletion cannot republish a removed job', async t => {
  let rejectWake;
  const { service, owner, children, changes } = await setup(t, { wake: () => new Promise((_resolve, reject) => { rejectWake = reject; }) });
  await service.start(owner, { command: 'long', background: true, onComplete: 'resume' });
  children[0].emit('close', 0, null); service.settled('run-1'); await tick();
  service.purgeSession('session-1'); const count = changes.length;
  rejectWake(new Error('late failure')); await tick();
  assert.equal(changes.length, count); assert.deepEqual(service.list('session-1'), []);
});

test('a cancelled completion remains suppressed when an in-flight wake returns', async t => {
  let finish;
  const { service, owner, children } = await setup(t, { wake: () => new Promise(resolve => { finish = resolve; }) });
  const result = await service.start(owner, { command: 'long', background: true, onComplete: 'resume' });
  children[0].emit('close', 0, null); service.settled('run-1');
  service.cancel(result.jobId, 'session-1'); finish({ ok: true }); await tick();
  assert.equal(service.get(result.jobId).wakeStatus, 'suppressed');
  assert.equal(service.pending.size, 0);
});

test('Agent background during executor initialization releases the pending call', async t => {
  let launch;
  const { service, owner } = await setup(t, { execute: args => new Promise(resolve => {
    launch = () => args.onControl({ background: () => { resolve({ background: true }); return true; }, snapshot: () => ({}) });
  }) });
  const result = service.start(owner, { command: 'long', background: true });
  await result; launch();
  assert.equal((await result).background, true);
});


test('restoring jobs preserves their background classification', t => {
  const { BackgroundBash } = require('../lib/background-bash');
  const service = new BackgroundBash({ execute() {} });
  t.after(() => service.close());
  service.restore([
    { id:'foreground', sessionId:'s', status:'succeeded', background:false },
    { id:'background', sessionId:'s', status:'running', background:true }
  ]);
  assert.equal(service.get('foreground').background, false);
  assert.equal(service.get('background').background, true);
  assert.equal(service.get('background').status, 'interrupted');
});

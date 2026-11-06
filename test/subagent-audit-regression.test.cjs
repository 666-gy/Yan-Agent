'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DelegationManager } = require('../lib/kernel-v2/delegation');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const W = require('../renderer/subagent-workflow');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };

test('stop cancels a settling child before its queued follow-up finishes', { timeout: 1000 }, async () => {
  const done = deferred(), parent = { id: 'root' };
  let cancelled = 0;
  const manager = new DelegationManager({ cancel: async () => { cancelled++; done.resolve(); } });
  manager.executions.set('child', { runID: 'child', parentRunID: 'root', control: done.promise, done });
  await manager.stop(parent);
  assert.equal(cancelled, 1);
});

test('close drains an in-flight bridge startup and prevents reopening', async () => {
  const manager = new DelegationManager({});
  const starting = manager.bridge();
  await manager.close(); await starting;
  assert.equal(manager.server, null);
  assert.equal(manager.environment, null);
  await assert.rejects(manager.bridge(), /closed/);
  await assert.rejects(manager.dispatch({}, 'list_agents', {}), /closed/);
});

test('streaming event envelopes do not amplify a long assignment', () => {
  const events = [];
  const manager = new DelegationManager({ runs: new Map([['root', { emit: e => events.push(e) }]]) });
  const record = { rootRunID: 'root', runID: 'child', agentID: 'agent', name: 'probe', prompt: 'x'.repeat(60000) };
  for (let i = 0; i < 1000; i++) manager.emit(record, { type: 'message.part.delta', data: { delta: 'x' } });
  assert.ok(JSON.stringify(events).length < 300000);
  assert.ok(events.every(event => !Object.hasOwn(event.data, 'prompt')));
});

test('receipt persistence failure does not fail a delivered report; invalid ids are explicit', async () => {
  const manager = new DelegationManager({ client: { session: { get: async () => { throw new Error('session gone'); } } } });
  await manager.markReported([{ sessionID: 'deleted' }]);
  await assert.rejects(manager.dispatch({ id: 'root' }, 'wait_agents', { ids: 'bad' }), /ids must be an array/);
});

test('cancellation visits each native session once across manager and native tree paths', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: process.cwd(), dataDir: require('node:os').tmpdir() });
  const counts = new Map(), lists = new Map();
  const descendants = { root: ['child'], child: ['grandchild'], grandchild: [] };
  adapter.transport.client = { session: {
    interrupt: async ({ sessionID }) => counts.set(sessionID, (counts.get(sessionID) || 0) + 1),
    list: async ({ parentID }) => { lists.set(parentID, (lists.get(parentID) || 0) + 1); return { data: descendants[parentID].map(id => ({ id })) }; }
  } };
  for (const id of Object.keys(descendants)) adapter.runs.set(id, { id, sessionID: id });
  for (const [id, parent] of [['child', 'root'], ['grandchild', 'child']]) adapter.delegation.executions.set(id,
    { runID: id, rootRunID: 'root', parentRunID: parent, done: { promise: Promise.resolve() } });
  await adapter.cancel('root');
  assert.deepEqual([...counts.values()], [1, 1, 1]);
  assert.deepEqual([...lists.values()], [1, 1, 1]);
});

test('500 large tool results stay bounded, resume keeps one row, and terminal ignores late content', () => {
  const run = { runId: 'root', timeline: [] };
  const announce = (activationID, status) => W.consume(run, { type: 'message.part.updated', properties: { part: {
    type: 'tool', tool: 'task', callID: activationID, state: { status, input: { description: 'probe' }, metadata: { agentID: 'agent', activationID, sessionID: 'child' } }
  } } });
  announce('one', 'running');
  const event = i => ({ type: 'yan.subagent.event', data: { agentID: 'agent', activationID: 'one', callId: 'one', childSessionID: 'child', event: {
    id: String(i), type: 'message.part.updated', properties: { part: { id: String(i), callID: String(i), type: 'tool', tool: 'read', state: { status: 'completed', output: 'x'.repeat(20480) } } }
  } } });
  for (let i = 0; i < 500; i++) W.consume(run, event(i));
  const record = run.subagents[0];
  assert.ok(JSON.stringify(record).length < 600000);
  assert.ok(JSON.stringify(record.milestones).length < 20000);
  assert.ok(record.historyTruncated);
  assert.equal(W.nativeRun(record), W.nativeRun(record), 'unchanged revisions reuse projection');
  announce('one', 'completed');
  const before = JSON.stringify(record);
  W.consume(run, event(999));
  assert.equal(JSON.stringify(record), before);
  announce('two', 'running');
  assert.equal(run.subagents.length, 1);
  assert.equal(record.status, 'running');
  W.consume(run, event(1000));
  assert.equal(record.activationID, 'two');
});

test('recovery scans descendants even when their parent has already reported', async () => {
  const stopped = [];
  const manager = new DelegationManager({ client: { session: {
    list: async ({ parentID }) => ({ data: parentID === 'root' ? [{ id: 'parent', metadata: { yanDelegation: { reported: true } } }]
      : parentID === 'parent' ? [{ id: 'orphan', metadata: { yanDelegation: { status: 'running' } } }] : [] }),
    interrupt: async ({ sessionID }) => stopped.push(sessionID), update: async () => {}
  } } });
  const reports = await manager.recover({ id: 'run', sessionID: 'root' });
  assert.deepEqual(stopped, ['orphan']);
  assert.equal(reports[0].status, 'interrupted');
});

test('report admission retries reuse one message ID and persistence failure is nonfatal', async () => {
  const ids = [], record = { parentRunID: 'root', runID: 'child', agentID: 'agent', sessionID: 'child-session', settled: true, status: 'completed', result: 'report' };
  const manager = new DelegationManager({ client: { session: {
    prompt: async ({ id }) => { ids.push(id); if (ids.length === 1) throw new Error('transient transport'); },
    get: async () => { throw new Error('metadata unavailable'); }
  } } });
  manager.executions.set('child', record);
  const run = { id: 'root', request: {}, idle: { outcome: 'succeeded' }, view: { list: [] }, consumedIdle: new Set(), emit() {} };
  assert.equal(await manager.settle(run), true);
  assert.ok(run.idle);
  assert.equal(await manager.settle(run), true);
  assert.equal(ids[0], ids[1]);
  assert.equal(record.reported, true);
});

test('shutdown closes transport and delegation even when resource disposal rejects', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: process.cwd(), dataDir: require('node:os').tmpdir() });
  const calls = [];
  adapter.resources.close = async () => { calls.push('resources'); throw new Error('dispose failed'); };
  adapter.transport.close = async () => calls.push('transport');
  adapter.delegation.close = async () => calls.push('delegation');
  await assert.rejects(adapter.close(), /dispose failed/);
  assert.deepEqual(calls, ['resources', 'transport', 'delegation']);
});

test('Bash owners omit large contexts and child quotas preserve main capacity', async t => {
  const { BackgroundBash } = require('../lib/background-bash');
  const service = new BackgroundBash({ execute: async () => ({ exit: 0, output: 'ok' }) });
  t.after(() => service.close());
  service.register('root', { yanSessionId: 'chat', history: ['x'.repeat(100000)], openCodeConfig: { large: 'config' }, prompt: 'long' });
  const owner = service.runs.get('root'); owner.openCodeSessionId = 'main';
  assert.equal(owner.history, undefined); assert.equal(owner.prompt, undefined); assert.equal(owner.openCodeConfig, undefined);
  for (let i = 0; i < 96; i++) service.jobs.set(String(i), { id: String(i), status: 'running', childSessionID: `child-${i}`, controller: new AbortController() });
  await assert.rejects(service.start(owner, { command: 'echo child', sessionID: 'child-new' }), /配额/);
  const result = await service.start(owner, { command: 'echo main', sessionID: 'main' });
  assert.equal(result.exit, 0);
});

test('long performance histories keep a bounded sample and declare truncation', () => {
  const { createRunPerformance, beginPerformanceRequest, finishPerformanceRequest, summarizeRunPerformance } = require('../lib/open-code-stream');
  const performance = createRunPerformance(1);
  for (let i = 0; i < 2000; i++) {
    beginPerformanceRequest(performance, 10 + i * 10, `message-${i}`);
    finishPerformanceRequest(performance, { input: 1, output: 1 }, 15 + i * 10);
  }
  assert.equal(performance.requests.length, 512);
  assert.ok(performance.requestsByMessageID.size <= 512);
  assert.equal(summarizeRunPerformance(performance).performanceSampleTruncated, true);
});

test('child Bash calls with the same tool callID stay isolated', async t => {
  const { BackgroundBash } = require('../lib/background-bash');
  const executed = [];
  const service = new BackgroundBash({ execute: async args => {
    executed.push(args.command);
    return { exit: 0, output: `ok:${args.command}` };
  } });
  t.after(() => service.close());
  service.register('root', { yanSessionId: 'chat', openCodeSessionId: 'main' });
  const owner = service.runs.get('root');
  const first = await service.start(owner, { command: 'child-a', sessionID: 'child-a', callID: 'call_0' });
  const second = await service.start(owner, { command: 'child-b', sessionID: 'child-b', callID: 'call_0' });
  assert.notEqual(first.jobId, second.jobId);
  assert.deepEqual(executed, ['child-a', 'child-b']);
  assert.match(second.output, /child-b/);
});

test('stop cancels all children within one shared budget', async () => {
  const cancelled = [];
  const manager = new DelegationManager({ cancel: async id => { cancelled.push(id); } });
  const records = [];
  for (let i = 0; i < 16; i++) {
    const done = deferred();
    const record = { runID: `child-${i}`, parentRunID: 'root', done, control: Promise.resolve(), settled: false };
    manager.executions.set(record.runID, record);
    records.push({ record, done });
  }
  manager.adapter.cancel = async id => {
    cancelled.push(id);
    const item = records.find(record => record.record.runID === id);
    item.done.resolve({});
  };
  const started = Date.now();
  await manager.stop({ id: 'root' }, 2000);
  assert.equal(cancelled.length, 16);
  assert.ok(Date.now() - started < 2000);
});

test('terminal subagent timelines are compacted on hydrate and save', () => {
  const { pruneSessionRuntimeBookkeeping } = require('../lib/session-store');
  const timeline = Array.from({ length: 500 }, (_, index) => ({
    type: 'tool_result', openCodeKey: `tool:${index}`, output: 'x'.repeat(20480)
  }));
  const session = { messages: [{ agentRun: { subagents: [{
    status: 'completed', timeline, milestones: { one: 'x'.repeat(30000) }
  }] } }] };
  pruneSessionRuntimeBookkeeping(session);
  const record = session.messages[0].agentRun.subagents[0];
  assert.ok(record.timeline.length <= 240);
  assert.ok(JSON.stringify(record.timeline).length < 500000);
  assert.equal(record.milestones, undefined);
});

test('a failed cancellation can be retried', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: process.cwd(), dataDir: require('node:os').tmpdir() });
  const run = { id: 'root', sessionID: '', cancelled: false };
  adapter.runs.set('root', run);
  let calls = 0;
  adapter.cancelRunTree = async () => { calls++; return calls === 1 ? { ok: false, error: 'partial' } : { ok: true }; };
  const first = await OpenCodeV2Adapter.prototype.cancel.call(adapter, 'root');
  const second = await OpenCodeV2Adapter.prototype.cancel.call(adapter, 'root');
  assert.equal(first.ok, false);
  assert.equal(second.ok, true);
  assert.equal(calls, 2);
});

test('a child Bash call can reclaim finished jobs from the main session', async t => {
  const { BackgroundBash } = require('../lib/background-bash');
  const service = new BackgroundBash({ execute: async () => ({ exit: 0, output: 'ok' }) });
  t.after(() => service.close());
  service.register('root', { yanSessionId: 'chat', openCodeSessionId: 'main' });
  const owner = service.runs.get('root');
  for (let i = 0; i < 128; i++) service.jobs.set(String(i), {
    id: String(i), status: 'succeeded', childSessionID: '', controller: new AbortController()
  });
  const result = await service.start(owner, { command: 'echo child', sessionID: 'child-a', callID: 'call_0' });
  assert.equal(result.exit, 0);
  assert.ok([...service.jobs.values()].some(job => job.command === 'echo child'));
});

test('a subagent cannot spawn a grandchild', async () => {
  const manager = new DelegationManager({ runs: new Map(), client: {} });
  manager.executions.set('child-run', { runID: 'child-run', depth: 1 });
  await assert.rejects(
    manager.spawn({ id: 'child-run', sessionID: 'child-session', request: {} }, { name: 'grand', prompt: 'work' }, 'call-grand'),
    /only the root agent/
  );
});

function queueFixture(limit = 1) {
  const gate = deferred();
  const started = [];
  const parent = { id: 'parent', sessionID: 'parent-session', request: { delegationConcurrency: limit },
    view: { list: [] }, consumedIdle: new Set(), emit() {} };
  const adapter = { runs: new Map([['parent', parent]]), client: { session: {
    get: async () => ({ permissions: [], metadata: {} }),
    update: async () => {}
  } } };
  const manager = new DelegationManager(adapter);
  adapter.run = async request => {
    const child = { id: request.runId, sessionID: `session-${request.runId}` };
    adapter.runs.set(child.id, child);
    manager.admitted(child);
    started.push(child.id);
    await gate.promise;
    adapter.runs.delete(child.id);
    return { status: child.cancelled ? 'interrupted' : 'done', text: 'child report' };
  };
  adapter.cancel = async id => {
    const child = adapter.runs.get(id);
    if (child) child.cancelled = true;
    gate.resolve();
    return { ok: true };
  };
  return { manager, parent, gate, started };
}

test('a full capacity spawn waits for a slot and reports queued', async () => {
  const { manager, parent, gate } = queueFixture(1);
  const first = await manager.spawn(parent, { name: 'one', prompt: 'work' }, 'call-1');
  const second = manager.spawn(parent, { name: 'two', prompt: 'work' }, 'call-2');
  const third = manager.spawn(parent, { name: 'three', prompt: 'work' }, 'call-3');
  await new Promise(resolve => setTimeout(resolve, 50));
  assert.equal(manager.children(parent).length, 1, 'queued spawns do not occupy capacity');
  gate.resolve();
  const [a, b] = await Promise.all([second, third]);
  assert.equal(a.queued, true);
  assert.equal(b.queued, true);
  assert.ok(a.waitedMs >= 40);
  assert.deepEqual(manager.children(parent).map(item => item.name), ['one', 'two', 'three']);
  await manager.owned(parent, first.id).done.promise;
  await manager.owned(parent, a.id).done.promise;
  await manager.owned(parent, b.id).done.promise;
});

test('a queued spawn times out with an explicit capacity error', async t => {
  const { manager, parent, gate } = queueFixture(1);
  t.after(() => gate.resolve());
  manager.queueTimeoutMs = 80;
  await manager.spawn(parent, { name: 'one', prompt: 'work' }, 'call-1');
  await assert.rejects(manager.spawn(parent, { name: 'two', prompt: 'work' }, 'call-2'), /capacity still full/);
  assert.equal(manager.children(parent).length, 1);
});

test('stopping the parent rejects queued spawns', async () => {
  const { manager, parent } = queueFixture(1);
  await manager.spawn(parent, { name: 'one', prompt: 'work' }, 'call-1');
  const second = manager.spawn(parent, { name: 'two', prompt: 'work' }, 'call-2');
  await new Promise(resolve => setTimeout(resolve, 50));
  await manager.stop(parent);
  await assert.rejects(second, /stopping/);
  assert.equal(manager.children(parent).length, 1);
});

test('queued spawn retries with the same callID are deduplicated', async () => {
  const { manager, parent, gate } = queueFixture(1);
  await manager.spawn(parent, { name: 'one', prompt: 'work' }, 'call-1');
  const second = manager.spawn(parent, { name: 'two', prompt: 'work' }, 'call-2');
  const retry = manager.spawn(parent, { name: 'two', prompt: 'work' }, 'call-2');
  await new Promise(resolve => setTimeout(resolve, 50));
  gate.resolve();
  const [a, b] = await Promise.all([second, retry]);
  assert.equal(a.id, b.id);
  assert.equal(manager.children(parent).length, 2);
});

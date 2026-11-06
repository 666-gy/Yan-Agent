'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DelegationManager } = require('../lib/kernel-v2/delegation');
const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
const readMessages = (name, output, followed = true, status = 'completed') => [
  { type: 'assistant', content: [{ type: 'tool', id: 'read-result', name, state: { status, content: [{ type: 'text', text: JSON.stringify(output) }] } }] },
  ...(followed ? [{ type: 'assistant', content: [{ type: 'text', text: 'Integrated and verified.' }] }] : [])
];

for (const operation of ['list_agents', 'wait_agents']) {
  test(`${operation}: delivered final result does not schedule another desktop run`, async () => {
    const { manager, parent, gate } = fixture({ delegationReturn: true });
    const receipt = await manager.spawn(parent, { name: 'reader', prompt: 'work' }, 'spawn');
    const record = manager.owned(parent, receipt.id);
    gate.resolve(); await record.done.promise;
    const output = await manager.dispatch(parent, operation, {});
    await manager.observeDeliveries(parent, readMessages(operation, output, false));
    assert.equal(record.reported, false, 'tool return without a subsequent model step is not acknowledged');
    await manager.observeDeliveries(parent, readMessages(operation, output));
    assert.equal(record.reported, true);
    parent.idle = { outcome: 'succeeded' };
    assert.equal(await manager.settle(parent), false);
    assert.equal(parent.delegationReports, undefined);
  });
}

test('reading progress does not acknowledge a later final result; failed reads do not acknowledge it either', async () => {
  const { manager, parent, gate } = fixture({ delegationReturn: true });
  const receipt = await manager.spawn(parent, { name: 'reader', prompt: 'work' }, 'spawn');
  const progress = await manager.dispatch(parent, 'list_agents', {});
  const record = manager.owned(parent, receipt.id);
  gate.resolve(); await record.done.promise;
  await manager.observeDeliveries(parent, readMessages('list_agents', progress));
  assert.equal(record.reported, false);
  parent.delegationReadCalls.clear();
  await manager.observeDeliveries(parent, readMessages('list_agents', { agents: [manager.public(record)] }, true, 'error'));
  assert.equal(record.reported, false);
  parent.idle = { outcome: 'succeeded' };
  await manager.settle(parent);
  assert.equal(parent.delegationReports.length, 1);
});

test('an old delivery cannot consume a resumed child activation', async () => {
  const { manager, parent, gate } = fixture({ delegationReturn: true });
  const first = await manager.spawn(parent, { name: 'reader', prompt: 'work' }, 'spawn');
  const old = manager.owned(parent, first.id);
  gate.resolve(); await old.done.promise;
  const output = await manager.dispatch(parent, 'list_agents', {});
  await manager.dispatch(parent, 'send_agent_message', { id: first.id, message: 'new work' }, 'resume');
  const current = manager.owned(parent, first.id);
  await current.done.promise;
  await manager.observeDeliveries(parent, readMessages('list_agents', output));
  assert.equal(old.reported, true);
  assert.equal(current.reported, false);
  parent.idle = { outcome: 'succeeded' };
  await manager.settle(parent);
  assert.deepEqual(parent.delegationReports.map(r => r.activationId), [current.runID]);
});

function fixture(options = {}) {
  const gate = deferred();
  const parent = { id: 'parent', sessionID: 'parent-session', request: { delegationConcurrency: 1, ...options },
    view: { list: [] }, consumedIdle: new Set(), emit() {} };
  const writes = [], starts = [];
  const adapter = { runs: new Map([[parent.id, parent]]), client: { session: {
    get: async () => ({ permissions: [{ action: '*', resource: '*', effect: 'ask' }, { action: 'read', resource: '*', effect: 'allow' }], metadata: {} }),
    update: async input => { writes.push(input); }
  } } };
  const manager = new DelegationManager(adapter);
  adapter.run = async request => {
    starts.push(request);
    const child = { id: request.runId, sessionID: `session-${request.runId}` };
    adapter.runs.set(child.id, child);
    manager.admitted(child);
    await gate.promise;
    adapter.runs.delete(child.id);
    return { status: child.cancelled ? 'interrupted' : 'done', text: 'child report' };
  };
  adapter.cancel = async id => { const child = adapter.runs.get(id); if (child) child.cancelled = true; gate.resolve(); return { ok: true }; };
  return { manager, adapter, parent, gate, starts, writes };
}

test('capacity is atomically reserved before startup and a retry reuses the original execution', async () => {
  const { manager, parent, gate, starts } = fixture();
  const first = manager.spawn(parent, { name: 'one', prompt: 'work' }, 'call-1');
  await assert.rejects(manager.spawn(parent, { name: 'two', prompt: 'work' }, 'call-2'), /capacity/);
  const receipt = await first;
  assert.equal((await manager.spawn(parent, { name: 'one', prompt: 'work' }, 'call-1')).id, receipt.id);
  assert.equal(starts.length, 1);
  const record = manager.owned(parent, receipt.id);
  assert.equal(record.permissions.find(item => item.action === '*').effect, 'ask');
  assert.equal(record.permissions.find(item => item.action === 'read').effect, 'allow');
  gate.resolve(); await record.done.promise;
  assert.equal(record.settled, true);
});

test('cancellation during preflight never starts a child and releases the reserved activation', async () => {
  const { manager, adapter, parent, starts } = fixture();
  const preflight = deferred();
  adapter.client.session.get = async () => { await preflight.promise; return { permissions: [] }; };
  const spawn = manager.spawn(parent, { name: 'pending', prompt: 'work' }, 'pending');
  const rejected = assert.rejects(spawn, /stopped/);
  parent.cancelled = true;
  const stop = manager.stop(parent);
  preflight.resolve();
  await stop; await rejected;
  assert.equal(starts.length, 0);
  assert.equal(manager.children(parent)[0].status, 'interrupted');
  assert.equal(manager.children(parent)[0].settled, true);
  await assert.rejects(manager.spawn(parent, { name: 'late', prompt: 'work' }, 'late'), /stopping/);
});

test('only the actual parent can message or stop a child', async () => {
  const { manager, parent, gate } = fixture();
  const receipt = await manager.spawn(parent, { name: 'owned', prompt: 'work' }, 'owned');
  for (const operation of ['send_agent_message', 'interrupt_agent', 'close_agent']) {
    await assert.rejects(manager.dispatch({ id: 'unrelated' }, operation, { id: receipt.id, message: 'override' }), /not owned/);
  }
  gate.resolve(); await manager.owned(parent, receipt.id).done.promise;
});

test('child permissions and approval requests retain parent policy and route through the root', async () => {
  const { manager, adapter, parent, gate } = fixture();
  const policy = [{ action: '*', resource: '*', effect: 'ask' }, { action: 'shell', resource: '*', effect: 'allow' },
    { action: 'edit', resource: '*', effect: 'deny' }];
  adapter.client.session.get = async () => ({ permissions: policy, metadata: {} });
  parent.approvalSessions = new Map(); parent.permissions = new Set();
  const events = []; parent.emit = event => events.push(event);
  const receipt = await manager.spawn(parent, { name: 'policy', prompt: 'work' }, 'policy');
  const record = manager.owned(parent, receipt.id);
  assert.deepEqual(record.permissions, policy);
  const event = { type: 'permission.asked', properties: { id: 'approval', requestID: 'approval', sessionID: record.sessionID } };
  manager.emit(record, event); manager.emit(record, event);
  assert.equal(parent.approvalSessions.get('approval'), record.sessionID);
  assert.equal(events.filter(item => item.type === 'permission.asked').length, 1);
  gate.resolve(); await record.work;
});

test('a failed completion event cannot strand a finished child', async () => {
  const { manager, parent, gate } = fixture();
  const receipt = await manager.spawn(parent, { name: 'work', prompt: 'work' }, 'event-failure');
  const record = manager.owned(parent, receipt.id);
  let woke = false;
  parent.wake = () => { woke = true; };
  parent.emit = () => { throw new Error('renderer disconnected'); };
  gate.resolve();
  await record.work;
  assert.equal((await record.done.promise).status, 'completed');
  assert.match(record.error, /Status delivery: renderer disconnected/);
  assert.equal(woke, true);
});

test('failed follow-up admission wakes the child with an error after consuming idle', async () => {
  const { manager, adapter, parent, gate } = fixture();
  const receipt = await manager.spawn(parent, { name: 'work', prompt: 'work' }, 'follow-up-failure');
  const record = manager.owned(parent, receipt.id);
  const child = adapter.runs.get(record.runID);
  let woke = false;
  Object.assign(child, { view: { list: [{ type: 'idle', id: 'old' }] }, consumedIdle: new Set(), idle: { id: 'old' }, wake: () => { woke = true; } });
  adapter.client.session.prompt = async () => { throw new Error('admission failed'); };
  await assert.rejects(manager.dispatch(parent, 'send_agent_message', { id: receipt.id, message: 'continue' }), /admission failed/);
  assert.equal(child.idle, null);
  assert.match(child.streamError.message, /admission failed/);
  assert.equal(woke, true);
  gate.resolve();
  await record.work;
});

test('a startup failure is reported and does not leak capacity', async () => {
  const { manager, adapter, parent, gate } = fixture();
  const start = adapter.run;
  adapter.run = async () => { throw new Error('startup failed'); };
  await assert.rejects(manager.spawn(parent, { name: 'bad', prompt: 'work' }, 'bad'), /startup failed/);
  const failed = manager.children(parent)[0];
  await failed.done.promise;
  assert.equal(failed.status, 'error');
  adapter.run = start;
  const receipt = await manager.spawn(parent, { name: 'next', prompt: 'work' }, 'next');
  gate.resolve(); await manager.owned(parent, receipt.id).done.promise;
});

test('close preserves history but prevents revival', async () => {
  const { manager, parent } = fixture();
  const receipt = await manager.spawn(parent, { name: 'owned', prompt: 'work' }, 'owned');
  const closed = await manager.dispatch(parent, 'close_agent', { id: receipt.id });
  assert.equal(closed.status, 'interrupted');
  await assert.rejects(manager.dispatch(parent, 'send_agent_message', { id: receipt.id, message: 'again' }), /closed/);
  assert.equal(manager.children(parent).length, 1);
});

test('recovery interrupts orphan trees and reports saved results without replaying work', async () => {
  const { manager, adapter, parent, starts } = fixture();
  const stopped = [], updates = [];
  adapter.client.session.list = async ({ parentID }) => ({ data: parentID === parent.sessionID ? [
    { id: 'orphan', metadata: { yanDelegation: { status: 'running', activationID: 'old' } } },
    { id: 'finished', metadata: { yanDelegation: { status: 'completed', result: 'saved result' } } }
  ] : parentID === 'orphan' ? [{ id: 'grandchild' }] : [] });
  adapter.client.session.interrupt = async ({ sessionID }) => { stopped.push(sessionID); };
  adapter.client.session.update = async input => { updates.push(input); };
  const reports = await manager.recover(parent);
  assert.deepEqual(stopped, ['orphan', 'grandchild']);
  assert.equal(reports[0].status, 'interrupted');
  assert.equal(reports[1].result, 'saved result');
  assert.equal(starts.length, 0);
  assert.equal(updates.length, 2);
});

test('a late completion receipt cannot mark a newer activation as reported', async () => {
  const { manager, adapter, writes } = fixture();
  adapter.client.session.get = async () => ({ metadata: { yanDelegation: { activationID: 'new', reported: false } } });
  await manager.markReported([{ sessionID: 'child', runID: 'old' }]);
  assert.equal(writes.length, 0);
  await manager.markReported([{ sessionID: 'child', runID: 'new' }]);
  assert.equal(writes[0].metadata.yanDelegation.reported, true);
});

test('parallel follow-ups cannot create two live activations for one child session', async () => {
  const { manager, parent, gate, starts } = fixture({ delegationConcurrency: 8 });
  const first = await manager.spawn(parent, { name: 'reusable', prompt: 'work' }, 'first');
  gate.resolve(); await manager.owned(parent, first.id).done.promise;
  const results = await Promise.allSettled([
    manager.dispatch(parent, 'send_agent_message', { id: first.id, message: 'next' }, 'next-1'),
    manager.dispatch(parent, 'send_agent_message', { id: first.id, message: 'next' }, 'next-2')
  ]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(starts.length, 2);
  await manager.owned(parent, first.id).done.promise;
  assert.equal((await manager.dispatch(parent, 'list_agents', {})).agents.length, 1);
});

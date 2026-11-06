'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { DelegationManager } = require('../lib/kernel-v2/delegation');
const { definition } = require('../lib/kernel-v2/workflow');
const projection = require('../renderer/subagent-workflow');
const deferred = () => { let resolve; const promise = new Promise(r => resolve = r); return { resolve, promise }; };
const plan = () => ({ goal: 'Build and review a page', members: [{ id: 'builder', name: 'Builder' }, { id: 'reviewer', name: 'Reviewer' }], stages: [{ id: 'build', title: '编写' }, { id: 'review', title: '验收' }], tasks: [
  { id: 'hero', stageId: 'build', memberId: 'builder', title: '编写 hero', prompt: 'Build hero', acceptance: 'Responsive hero', dependsOn: [], writeScopes: ['src/hero'] },
  { id: 'review', stageId: 'review', memberId: 'reviewer', title: '验收 hero', prompt: 'Review hero', acceptance: 'Independent review evidence', dependsOn: ['hero'], writeScopes: [] }
] });
function fixture() {
  const sessions = new Map([['parent-session', { id: 'parent-session', metadata: {}, permissions: [{ action: '*', effect: 'allow' }] }]]);
  const events = [], starts = [], gates = new Map();
  const parent = { id: 'parent', sessionID: 'parent-session', request: { delegationConcurrency: 2 }, view: { list: [] }, consumedIdle: new Set(), emit: event => events.push(event) };
  const adapter = { runs: new Map([[parent.id, parent]]), client: { session: {
    get: async ({ sessionID }) => { if (!sessions.has(sessionID)) throw new Error('Unknown session'); return structuredClone(sessions.get(sessionID)); },
    update: async ({ sessionID, ...patch }) => Object.assign(sessions.get(sessionID), structuredClone(patch))
  } } };
  const manager = new DelegationManager(adapter);
  adapter.run = async request => {
    starts.push(request);
    const record = manager.context(request.runId);
    const sessionID = request.openCodeSessionId || `child-${request.runId}`;
    sessions.set(sessionID, { id: sessionID, parentID: parent.sessionID, permissions: [], metadata: { yanDelegation: manager.metadata(record) } });
    const child = { id: request.runId, sessionID };
    adapter.runs.set(child.id, child);
    const gate = deferred(); gates.set(child.id, gate);
    manager.admitted(child);
    const result = await gate.promise;
    adapter.runs.delete(child.id);
    return result;
  };
  adapter.cancel = async id => gates.get(id)?.resolve({ status: 'interrupted', text: '' });
  const call = (name, args = {}, callID = undefined) => manager.dispatch(parent, name, { revision: parent.workflow?.revision, ...args }, callID);
  const finish = async (taskID, status = 'done') => {
    const record = manager.children(parent).findLast(r => r.workflow?.taskId === taskID);
    gates.get(record.runID).resolve({ status, text: `Evidence for ${taskID}` });
    await record.work;
  };
  return { manager, adapter, parent, sessions, events, starts, gates, call, finish };
}

test('dependency cycle, dangling IDs, duplicate IDs and escaping paths are rejected', () => {
  for (const change of [p => p.tasks[0].dependsOn.push('review'), p => p.tasks[0].dependsOn.push('missing'), p => p.tasks[1].id = 'hero', p => p.tasks[0].writeScopes = ['../secret']]) {
    const input = plan(); change(input); assert.throws(() => definition(input));
  }
});

test('workflow inspection delivers exact finished attempts only after the parent continues', async () => {
  const f = fixture();
  f.parent.request.delegationReturn = true;
  await f.call('workflow_plan', plan());
  await f.call('workflow_run');
  await f.finish('hero');
  const record = f.manager.children(f.parent)[0];
  const output = await f.call('workflow_inspect');
  assert.equal(record.reported, false, 'UI snapshots and calling the manager alone do not acknowledge delivery');
  const read = { type: 'assistant', content: [{ type: 'tool', id: 'inspect', name: 'workflow_inspect',
    state: { status: 'completed', content: [{ type: 'text', text: JSON.stringify(output) }] } }] };
  await f.manager.observeDeliveries(f.parent, [read, { type: 'assistant', content: [] }]);
  assert.equal(record.reported, true);
  assert.equal(f.parent.workflow.tasks[0].status, 'awaiting_review', 'delivery is not acceptance');
  assert.equal(f.sessions.get(record.sessionID).metadata.yanDelegation.reported, true);
  f.parent.idle = { outcome: 'succeeded' };
  assert.equal(await f.manager.settle(f.parent), false);
  assert.equal(f.parent.delegationReports, undefined);
});

test('durable plan is inert; accepted dependency unlocks work, execution completion alone does not', async () => {
  const f = fixture();
  const state = await f.call('workflow_plan', plan(), 'plan');
  assert.equal(f.starts.length, 0);
  assert.equal(f.sessions.get(f.parent.sessionID).metadata.yanWorkflow.id, state.id);
  await f.call('workflow_run', {}, 'run');
  assert.equal(f.starts.length, 1);
  await f.finish('hero');
  assert.equal(f.parent.workflow.tasks[0].status, 'awaiting_review');
  assert.equal(f.starts.length, 1);
  await assert.rejects(f.call('workflow_review', { taskId: 'hero', attempt: 2, decision: 'accept', evidence: 'wrong attempt' }), /Stale/);
  await f.call('workflow_review', { taskId: 'hero', attempt: 1, decision: 'accept', evidence: 'Responsive layout verified' }, 'accept');
  assert.equal(f.starts.length, 2);
  assert.match(f.starts[1].prompt, /Evidence for hero/);
  await f.finish('review');
  await f.call('workflow_review', { taskId: 'review', attempt: 1, decision: 'accept', evidence: 'Independent checks passed' });
  assert.equal((await f.call('workflow_inspect')).status, 'completed');
  assert.ok(f.events.some(e => e.type === 'yan.workflow.updated'));
});

test('parallel duplicate calls reuse durable receipts, stale revisions reject changes', async () => {
  const f = fixture();
  await Promise.all([f.call('workflow_plan', plan(), 'same'), f.call('workflow_plan', plan(), 'same')]);
  const revision = f.parent.workflow.revision;
  await Promise.all([f.call('workflow_run', { revision }, 'start'), f.call('workflow_run', { revision }, 'start')]);
  assert.equal(f.starts.length, 1);
  await assert.rejects(f.call('workflow_pause', { revision }), /revision/);
  await f.finish('hero');
});

test('rework preserves member identity and session with a new attempt; direct continuation is refused', async () => {
  const f = fixture(); await f.call('workflow_plan', plan()); await f.call('workflow_run'); await f.finish('hero');
  const before = structuredClone(f.parent.workflow.members[0]);
  await assert.rejects(f.manager.dispatch(f.parent, 'send_agent_message', { id: before.agentID, message: 'bypass' }), /workflow_review/);
  await f.call('workflow_review', { taskId: 'hero', attempt: 1, decision: 'rework', evidence: 'Fix mobile overflow' });
  assert.equal(f.starts.length, 2);
  assert.equal(f.starts[1].openCodeSessionId, before.sessionID);
  assert.equal(f.parent.workflow.members[0].agentID, before.agentID);
  assert.match(f.starts[1].prompt, /Fix mobile overflow/);
  await f.finish('hero');
  assert.equal(f.parent.workflow.tasks[0].attempts.length, 2);
});

test('independent tasks run concurrently; overlapping write scopes serialize and release', async () => {
  for (const overlap of [false, true]) {
    const f = fixture(), input = plan();
    input.tasks[1].dependsOn = []; input.tasks[1].writeScopes = [overlap ? 'src/hero/styles.css' : 'src/body'];
    await f.call('workflow_plan', input); await f.call('workflow_run');
    assert.equal(f.starts.length, overlap ? 1 : 2);
    await f.finish('hero');
    assert.equal(f.starts.length, 2);
    await f.finish('review');
  }
});

test('pause cancels active work without deadlock or starting dependents; resume needs explicit rework', async () => {
  const f = fixture(); await f.call('workflow_plan', plan()); await f.call('workflow_run');
  await f.call('workflow_pause');
  assert.equal(f.parent.workflow.active, false);
  assert.equal(f.parent.workflow.tasks[0].status, 'interrupted');
  await f.call('workflow_run');
  assert.equal(f.starts.length, 1);
  await f.call('workflow_review', { taskId: 'hero', attempt: 1, decision: 'rework', evidence: 'Inspected partial changes, resume' });
  await f.finish('hero');
});

test('dynamic revisions change only unstarted tasks; accepted work with active dependents cannot be silently invalidated', async () => {
  const f = fixture(); const input = plan(); await f.call('workflow_plan', input); await f.call('workflow_run');
  input.tasks[1].prompt = 'Review hero and accessibility';
  await f.call('workflow_plan', input);
  assert.equal(f.parent.workflow.tasks[1].prompt, input.tasks[1].prompt);
  input.tasks[0].prompt = 'Rewrite assignment while running';
  await assert.rejects(f.call('workflow_plan', input), /immutable/);
  await f.finish('hero');
  await f.call('workflow_review', { taskId: 'hero', attempt: 1, decision: 'accept', evidence: 'Checked' });
  await assert.rejects(f.call('workflow_review', { taskId: 'hero', attempt: 1, decision: 'rework', evidence: 'Invalidate' }), /Downstream/);
  await f.finish('review');
});

test('recovery restores results and receipts without running children; interrupted attempts stay interrupted', async () => {
  const f = fixture(); await f.call('workflow_plan', plan(), 'plan'); await f.call('workflow_run');
  const saved = structuredClone(f.sessions.get(f.parent.sessionID));
  await f.finish('hero');
  // Simulate crash after child metadata settled but before workflow result persistence.
  f.sessions.set(f.parent.sessionID, structuredClone(saved));
  const restored = { ...f.parent, id: 'restored', workflow: undefined, workflowLoaded: false };
  const manager = new DelegationManager(f.adapter);
  await manager.workflows.restore(restored);
  assert.equal(restored.workflow.tasks[0].status, 'awaiting_review');
  assert.equal(restored.workflow.active, false);
  assert.equal(f.starts.length, 1);
  const childID = restored.workflow.members[0].sessionID;
  f.sessions.get(childID).metadata.yanDelegation.status = 'running';
  f.sessions.set(f.parent.sessionID, structuredClone(saved));
  const interrupted = { ...restored, workflow: undefined, workflowLoaded: false };
  await manager.workflows.restore(interrupted);
  assert.equal(interrupted.workflow.tasks[0].status, 'interrupted');
  assert.equal(f.starts.length, 1);
});

test('failed persistence prevents dispatch; children cannot manage their parent workflow', async () => {
  const f = fixture();
  f.adapter.client.session.update = async () => { throw new Error('disk unavailable'); };
  await assert.rejects(f.call('workflow_plan', plan()), /disk unavailable/);
  assert.equal(f.starts.length, 0);
  assert.equal(f.parent.workflow, undefined);
  f.manager.executions.set('child', { rootRunID: f.parent.id });
  await assert.rejects(f.manager.dispatch({ id: 'child' }, 'workflow_inspect', {}), /root agent/);
});

test('workflow events survive serialization, ignore old revisions and replace one timeline row', () => {
  let run = { timeline: [], subagents: [] };
  const event = revision => ({ type: 'yan.workflow.updated', data: { workflow: { id: 'w', revision, ...plan() } } });
  assert.equal(projection.consume(run, event(1)).timelineChanged, true);
  run = JSON.parse(JSON.stringify(run));
  projection.consume(run, event(3)); projection.consume(run, event(2));
  assert.equal(run.timeline.length, 1);
  assert.equal(run.timeline[0].workflow.revision, 3);
});

test('capacity shared with ordinary children releases into workflow scheduling', async () => {
  const f = fixture(); f.parent.request.delegationConcurrency = 1;
  const ordinary = await f.manager.spawn(f.parent, { name: 'ordinary', prompt: 'ordinary work' }, 'ordinary');
  await f.call('workflow_plan', plan()); await f.call('workflow_run');
  assert.equal(f.starts.length, 1);
  const record = f.manager.owned(f.parent, ordinary.id);
  f.gates.get(record.runID).resolve({ status: 'done', text: 'done' }); await record.work;
  assert.equal(f.starts.length, 2);
  await f.finish('hero');
});

test('failed admission persists an error and allows explicit retry', async () => {
  const f = fixture(), original = f.adapter.run;
  f.adapter.run = async () => { throw new Error('provider unavailable'); };
  await f.call('workflow_plan', plan()); await f.call('workflow_run');
  await Promise.all(f.manager.children(f.parent).map(r => r.work));
  assert.equal(f.parent.workflow.tasks[0].status, 'error');
  assert.match(f.parent.workflow.tasks[0].attempts[0].error, /provider unavailable/);
  f.adapter.run = original;
  await f.call('workflow_review', { taskId: 'hero', attempt: 1, decision: 'rework', evidence: 'Provider is back' });
  await f.finish('hero');
});

test('new parent execution reuses the persisted member session only after ownership verification', async () => {
  const f = fixture(); await f.call('workflow_plan', plan()); await f.call('workflow_run'); await f.finish('hero');
  const member = structuredClone(f.parent.workflow.members[0]);
  f.manager.release(f.parent); f.parent.workflowLoaded = false; f.parent.workflow = undefined;
  await f.manager.workflows.restore(f.parent);
  await f.call('workflow_review', { taskId: 'hero', attempt: 1, decision: 'rework', evidence: 'Continue in another parent execution' });
  await f.call('workflow_run');
  assert.equal(f.starts[1].openCodeSessionId, member.sessionID);
  await f.finish('hero');
  f.manager.release(f.parent); f.parent.workflowLoaded = false; f.parent.workflow = undefined;
  await f.manager.workflows.restore(f.parent);
  f.sessions.get(member.sessionID).parentID = 'another-parent';
  await f.call('workflow_review', { taskId: 'hero', attempt: 2, decision: 'rework', evidence: 'Inspect ownership' });
  await f.call('workflow_run');
  assert.equal(f.starts.length, 2);
  assert.match(f.parent.workflow.tasks[0].attempts.at(-1).error, /ownership/);
});

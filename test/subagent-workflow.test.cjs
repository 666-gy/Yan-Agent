'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../lib/subagent/workflow-state');
const { SubagentEventBridge } = require('../lib/subagent/event-bridge');
const run = id => ({ runId: id || 'parent', status: 'working', timeline: [] });
const task = (callId, status = 'running', output = '', sessionID = '') => ({ type: 'message.part.updated', data: { part: {
  type: 'tool', tool: 'task', id: `part-${callId}`, callID: callId,
  state: { status, input: { subagent_type: 'explorer', description: `Explore ${callId}`, prompt: 'Read taste skill' },
    metadata: { sessionId: sessionID }, output }
} } });
const child = (callId, event, childSessionID = '') => ({ type: 'yan.subagent.event', data: { callId, childSessionID, subagentType: 'explorer', event } });
const textPart = (id, text, end = false) => ({ type: 'message.part.updated', properties: { part: { id, messageID: 'm', type: 'text', text, time: end ? { end: 200 } : {} } } });
const toolPart = (id, status) => ({ type: 'message.part.updated', properties: { part: { id, callID: id, type: 'tool', tool: 'read', state: { status, input: { filePath: 'SKILL.md' }, output: status === 'completed' ? 'Taste guidance' : '' } } } });

test('foreground: token deltas are silent; tool completion updates a line without completing the child', () => {
  const r = run();
  W.consume(r, task('a'), 100);
  assert.equal(r.timeline[0].content, 'Explore子代理已开始工作');
  W.consume(r, child('a', textPart('text', 'Reading')), 110);
  assert.equal(r.timeline.length, 1);
  assert.equal(r.timeline[0].status, 'started');
  W.consume(r, child('a', toolPart('read', 'running')), 120);
  assert.equal(r.timeline[0].status, 'started');
  W.consume(r, child('a', toolPart('read', 'completed')), 130);
  assert.equal(r.timeline.length, 1);
  assert.equal(r.timeline[0].content, 'Explore子代理有了更新');
  assert.equal(r.subagents[0].status, 'running');
  W.consume(r, task('a', 'completed', 'Done'), 140);
  assert.equal(r.timeline.length, 1);
  assert.equal(r.timeline[0].content, 'Explore子代理已完成工作');
});

test('consume separates parent-row changes from child-session activity', () => {
  const r = run();
  const created = W.consume(r, task('a'), 100);
  assert.equal(created.handled, true);
  assert.equal(created.timelineChanged, true);
  assert.match(created.timelineKey, /^subagent:/);

  const delta = W.consume(r, child('a', textPart('t', 'Reading')), 110);
  assert.equal(delta.handled, true);
  assert.equal(delta.timelineChanged, false, 'token deltas must not invalidate the parent projection');

  const running = W.consume(r, child('a', toolPart('read', 'running')), 120);
  assert.equal(running.timelineChanged, false);

  const completedTool = W.consume(r, child('a', toolPart('read', 'completed')), 130);
  assert.equal(completedTool.timelineChanged, true, 'a milestone notice updates the parent row once');

  const replayed = W.consume(r, child('a', toolPart('read', 'completed')), 140);
  assert.equal(replayed.timelineChanged, false, 'replaying the same milestone must not re-notify');
});

test('parallel: preserve started and append updates after actual parent work', () => {
  const r = run();
  W.consume(r, task('a'), 100);
  const work = { type: 'text', content: 'Meanwhile I will read the implementation.' };
  W.noteParentWork(r, null, work); r.timeline.push(work);
  W.consume(r, child('a', textPart('t', 'Found the skill', true)), 200);
  assert.deepEqual(r.timeline.map(item => item.status || item.type), ['started', 'text', 'updated']);
  W.noteParentWork(r, work, work);
  W.consume(r, child('a', textPart('t', 'Found the skill', true)), 210);
  assert.equal(r.timeline.length, 3, 'replay must not add a notification');
  const tool = { type: 'tool_call', name: 'read', callId: 'parent-read', args: { path: 'index.js' } };
  W.noteParentWork(r, null, tool); r.timeline.push(tool);
  W.consume(r, task('a', 'completed', 'Found the skill'), 300);
  assert.deepEqual(r.timeline.map(item => item.status || item.type), ['started', 'text', 'updated', 'tool_call', 'completed']);
  W.consume(r, child('a', toolPart('late', 'completed')), 310);
  assert.equal(r.timeline.length, 5);
  assert.equal(r.subagents[0].status, 'completed');
});

test('same-role concurrent calls and different parent tasks stay independent after JSON persistence', () => {
  const a = run('one'), b = run('two');
  W.consume(a, task('x', 'running', '', 'ses-x'));
  W.consume(a, task('y', 'running', '', 'ses-y'));
  W.consume(b, task('x', 'running', '', 'ses-x'));
  W.consume(a, child('y', toolPart('r', 'completed'), 'ses-y'));
  const restored = JSON.parse(JSON.stringify(a));
  assert.equal(restored.subagents.length, 2);
  assert.equal(restored.subagents[0].timeline.length, 0);
  assert.equal(restored.subagents[1].timeline.length, 2);
  assert.notEqual(restored.subagents[0].id, b.subagents[0].id);
  W.consume(restored, task('y', 'completed', 'done', 'ses-y'));
  assert.equal(restored.subagents[0].status, 'running');
  assert.equal(restored.subagents[1].status, 'completed');
});

test('out-of-order session registration merges by explicit session/call IDs, never by role', () => {
  const r = run();
  W.consume(r, task('a'));
  W.consume(r, child('', textPart('p', 'Found it', true), 'child-session'));
  W.consume(r, task('b'));
  W.consume(r, task('a', 'running', '', 'child-session'));
  assert.equal(r.subagents.length, 2);
  assert.equal(r.subagents.find(record => record.callId === 'a').timeline[0].content, 'Found it');
  assert.equal(r.subagents.find(record => record.callId === 'b').timeline.length, 0);
  assert.equal(r.timeline.filter(item => item.type === 'subagent_status').length, 2);
});

test('message completion is not task completion; running task wrappers remain running', () => {
  const r = run();
  W.consume(r, task('a'));
  W.consume(r, child('a', textPart('p', 'Read next file')));
  W.consume(r, child('a', { type: 'message.updated', data: { info: { id: 'm', role: 'assistant', time: { completed: 123 } } } }));
  assert.equal(r.subagents[0].status, 'running');
  assert.equal(r.timeline[0].status, 'updated');
  W.consume(r, task('a', 'completed', '<task id="ses-1" state="running">Running in background</task>'));
  assert.equal(r.subagents[0].status, 'running');
});

test('empty/error/interrupted results are honest; terminal events do not reopen a child', () => {
  const r = run();
  W.consume(r, task('empty', 'completed', '<task id="ses-empty" state="completed"><task_result>  </task_result></task>'));
  const view = W.nativeRun(r.subagents[0]);
  assert.equal(view.timeline.find(item => item.openCodeKey === 'child:empty-result').content, '子代理未返回文字结果');
  W.consume(r, task('error', 'error'));
  W.consume(r, task('error', 'running'));
  assert.equal(r.subagents[1].status, 'error');
  W.consume(r, task('unfinished'));
  W.finalize(r, 'done', 500);
  assert.equal(r.subagents[2].status, 'incomplete');
  assert.equal(r.subagents[0].status, 'completed');
});

test('legacy task panels migrate once to clickable status records', () => {
  const r = { runId: 'legacy', status: 'done', startedAt: 100, completedAt: 200, timeline: [
    { type: 'tool_call', name: 'task', callId: 'old', args: { subagent_type: 'explorer', description: 'Find skill' } },
    { type: 'tool_result', name: 'task', callId: 'old', output: '<task id="ses-old" state="completed"><task_result>Found it</task_result></task>', ok: true }
  ] };
  W.migrate(r);
  const once = JSON.stringify(r);
  W.migrate(r);
  assert.equal(JSON.stringify(r), once);
  assert.equal(r.timeline.length, 1);
  assert.equal(r.timeline[0].type, 'subagent_status');
  assert.equal(r.subagents[0].result, 'Found it');
});

test('installed SDK next-stream ended events and typed tool content produce native output once', () => {
  const r = run();
  W.consume(r, { id: 'task-call', type: 'session.next.tool.called', data: { callID: 'a', tool: 'task', input: { subagent_type: 'explorer' } } });
  const delta = child('a', { id: 'delta-1', type: 'session.next.text.delta', data: { textID: 'text', assistantMessageID: 'm', delta: 'Partial' } });
  W.consume(r, delta); W.consume(r, delta);
  assert.equal(r.subagents[0].timeline[0].content, 'Partial');
  W.consume(r, child('a', { id: 'end-1', type: 'session.next.text.ended', data: { textID: 'text', assistantMessageID: 'm', text: 'Authoritative final text' } }));
  assert.equal(r.subagents[0].timeline[0].content, 'Authoritative final text');
  assert.equal(r.subagents[0].timeline[0].streaming, false);
  assert.equal(r.timeline[0].status, 'updated');
  W.consume(r, { type: 'session.next.tool.success', data: { callID: 'a', structured: { sessionId: 'child-a' },
    content: [{ type: 'text', text: '<task id="child-a" state="completed"><task_result>Final result</task_result></task>' }] } });
  assert.equal(r.subagents[0].status, 'completed');
  assert.equal(r.subagents[0].result, 'Final result');
  assert.equal(r.subagents[0].childSessionID, 'child-a');
});

test('bridge forwards all direct child roles and hydrates assistant workflow without prompts or model calls', async () => {
  const events = [], calls = [];
  const bridge = new SubagentEventBridge({ runId: 'parent', sessionID: 'parent-session', directory: '.', childSessions: new Map(), onEvent: e => events.push(e) });
  bridge.observe(task('a', 'running', '', 'ses-a'));
  const build = bridge.register('ses-b', { callId: 'b', role: 'builder' });
  bridge.forward(build, toolPart('read', 'completed'));
  const client = { session: { messages: async args => {
    calls.push(args.sessionID);
    return { data: [
      { info: { id: 'user', role: 'user' }, parts: [{ id: 'prompt', type: 'text', text: 'Private delegated prompt' }] },
      { info: { id: 'assistant', role: 'assistant' }, parts: [{ id: 'answer', type: 'text', text: 'Read taste skill', time: { end: 200 } }] }
    ] };
  } } };
  const records = await bridge.catchUp(client);
  assert.deepEqual(calls.sort(), ['ses-a', 'ses-b']);
  assert.equal(records.length, 2);
  assert.ok(records.every(record => record.timeline.some(item => item.content === 'Read taste skill')));
  assert.ok(records.every(record => !record.timeline.some(item => item.content === 'Private delegated prompt')));
  assert.equal(events.filter(e => e.type === 'yan.subagent.history').length, 2);
  assert.equal(bridge.state.timeline.some(item => item.type === 'tool_call'), false);
});

test('subagent status notices stay inside the work process after the summary starts', () => {
  const r = run();
  W.consume(r, task('a'), 100);
  r.summaryStarted = true;
  W.consume(r, task('a', 'completed', 'Done'), 200);
  const notice = r.timeline.find(item => item.type === 'subagent_status' && item.status === 'completed');
  assert.ok(notice, 'the completed notice exists');
  assert.equal(notice.stage, 'work');
  assert.equal(
    r.timeline.filter(item => item.type === 'subagent_status').every(item => item.stage === 'work'),
    true
  );
});

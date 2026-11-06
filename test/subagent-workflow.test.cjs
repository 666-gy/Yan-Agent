'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('../renderer/subagent-workflow');

test('text-only and multipart child answers are summary content exactly once', () => {
  for (const parts of [['B：结果 55。'], ['B：结果 55。', '\n计算依据：1 + 4 + 9 + 16 + 25 = 55。']]) {
    const record = { id: 'answer', status: 'completed', startedAt: 1, completedAt: 100,
      result: parts.join(''), timeline: parts.map((content, index) => ({ type: 'text', content, stage: 'work', openCodeKey: `text:${index}` })) };
    const view = W.nativeRun(record);
    assert.equal(view.timeline.filter(item => item.type === 'text').map(item => item.content).join(''), record.result);
    assert.ok(view.timeline.filter(item => item.type === 'text').every(item => item.stage === 'summary'));
    assert.equal(view.summaryStarted, true);
    assert.ok(record.timeline.every(item => item.stage === 'work'), 'projection does not mutate stored events');
  }
});

test('settled report replaces trailing partial answer but preserves actual work narration', () => {
  const record = { id: 'partial', status: 'completed', startedAt: 1, completedAt: 100, result: 'Final answer', timeline: [
    { type: 'text', content: 'I will inspect the file', stage: 'work' },
    { type: 'tool_call', name: 'read', callId: 'read' },
    { type: 'text', content: 'Final ans', stage: 'work' }
  ] };
  const view = W.nativeRun(record);
  assert.deepEqual(view.timeline.filter(item => item.type === 'text').map(item => [item.content, item.stage]), [['I will inspect the file', 'work'], ['Final answer', 'summary']]);
});

test('child request and reasoning activity survive native rendering before正文', () => {
  const state = { runId: 'parent', timeline: [] };
  const event = event => ({ type: 'yan.subagent.event', data: { callId: 'child', childSessionID: 'child-session', event } });
  W.consume(state, event({ type: 'yan.model.request.started', data: {} }), 100);
  assert.equal(W.nativeRun(state.subagents[0]).executionStartedAt, 100);
  W.consume(state, event({ type: 'message.part.delta', data: { partID: 'reason', field: 'reasoning', delta: 'Thinking' } }), 110);
  assert.equal(W.nativeRun(state.subagents[0]).responseStartedAt, 110);
  assert.equal(W.nativeRun(state.subagents[0]).textContent, '');
});
const run = id => ({ runId: id || 'parent', status: 'working', timeline: [] });
const task = (callId, status = 'running', output = '', sessionID = '') => ({ type: 'message.part.updated', data: { part: {
  type: 'tool', tool: 'task', id: `part-${callId}`, callID: callId,
  state: { status, input: { subagent_type: 'explorer', description: `Explore ${callId}`, prompt: 'Read taste skill' },
    metadata: { sessionId: sessionID }, output }
} } });
const child = (callId, event, childSessionID = '') => ({ type: 'yan.subagent.event', data: { callId, childSessionID, subagentType: 'explorer', event } });
const textPart = (id, text, end = false) => ({ type: 'message.part.updated', properties: { part: { id, messageID: 'm', type: 'text', text, time: end ? { end: 200 } : {} } } });
const toolPart = (id, status) => ({ type: 'message.part.updated', properties: { part: { id, callID: id, type: 'tool', tool: 'read', state: { status, input: { filePath: 'SKILL.md' }, output: status === 'completed' ? 'Taste guidance' : '' } } } });

test('parent avatar identity follows late metadata and restores old saved milestones', () => {
  const r = run();
  W.consume(r, task('a'), 100);
  const started = r.timeline.find(item => item.type === 'subagent_status');
  const registered = task('a', 'running', '', 'child-a');
  registered.data.part.state.metadata.agentID = 'stable-agent-a';
  W.consume(r, registered, 110);
  assert.equal(started.agentID, 'stable-agent-a');
  assert.equal(started.childSessionID, 'child-a');
  const saved = JSON.parse(JSON.stringify(r));
  for (const item of saved.timeline) {
    delete item.agentID;
    delete item.childSessionID;
  }
  W.migrate(saved);
  const restored = saved.timeline.find(item => item.type === 'subagent_status');
  assert.equal(restored.agentID, saved.subagents[0].agentID);
  assert.equal(restored.childSessionID, saved.subagents[0].childSessionID);
});

test('live child session binds to its pending record before call metadata arrives', () => {
  const r = run();
  W.consume(r, task('a'), 100);
  assert.equal(r.subagents[0].childSessionID, '');
  // The kernel announces the child session before the parent tool part carries
  // metadata.sessionID; its live output must land on the existing row.
  W.consume(r, { type: 'yan.subagent.event', data: { callId: '', childSessionID: 'child-live',
    subagentType: 'explorer', title: 'Explore a', event: textPart('live', 'LIVE_TEXT', true) } }, 120);
  assert.equal(r.subagents.length, 1, 'live discovery must not create a duplicate row');
  assert.equal(r.subagents[0].childSessionID, 'child-live');
  assert.ok(r.subagents[0].timeline.some(item => item.type === 'text' && item.content === 'LIVE_TEXT'));
  // The later authoritative tool result keeps the same row.
  W.consume(r, task('a', 'completed', 'Done', 'child-live'), 200);
  assert.equal(r.subagents.length, 1);
  assert.equal(r.subagents[0].status, 'completed');
  assert.equal(r.subagents[0].callId, 'a');
});

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

test('interrupted parent marks children interrupted without unconfirmed wording', () => {
  const r = run();
  W.consume(r, task('a'));
  W.finalize(r, 'interrupted', 500);
  assert.equal(r.subagents[0].status, 'interrupted');
  assert.doesNotMatch(r.subagents[0].error, /未确认完成/);
  assert.match(r.subagents[0].error, /中止/);
});

test('reconcile repairs an incomplete child from authoritative delegation records', () => {
  const r = run();
  W.consume(r, task('a', 'completed', '<task id="ses-a" state="running">Running in background</task>'));
  W.finalize(r, 'done', 500);
  assert.equal(r.subagents[0].status, 'incomplete');
  W.reconcile(r, [{ callId: 'a', childID: 'ses-a', status: 'completed', result: 'Background child finished' }]);
  assert.equal(r.subagents[0].status, 'completed');
  assert.equal(r.subagents[0].result, 'Background child finished');
  assert.equal(r.subagents[0].error, '');
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

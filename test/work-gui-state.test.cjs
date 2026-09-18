'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { test } = require('node:test');
const source = fs.readFileSync(path.join(__dirname, '../renderer/work-gui/work-gui.js'), 'utf8');
const panelSource = fs.readFileSync(path.join(__dirname, '../renderer/subagent-panel.js'), 'utf8');

function world() {
  const window = { addEventListener() {}, YanSubagentWorkflow: require('../lib/subagent/workflow-state') };
  // Only the inline icon template is needed to load the renderer's reducer.
  const document = { createElement: () => ({
    content: { querySelector: () => ({ setAttribute() {}, outerHTML: '<svg></svg>' }) }
  }) };
  const context = vm.createContext({ window, document, console });
  vm.runInContext(panelSource, context);
  vm.runInContext(source, context);
  return window.YanWorkGui;
}

test('resident identities use the same role names as the subagent panel', () => {
  const gui = world();
  const data = snapshot(10);
  data.agents.push({ id: 'sub:read', role: 'researcher', name: 'A task description', state: 'working' });
  gui.applySnapshot(data);
  assert.equal(gui.getState().actors.find(a => a.id === 'main').name, 'Yan Agent');
  assert.equal(gui.getState().actors.find(a => a.id === 'sub:read').name, 'Research Agent');
  gui.ingest({ events: [{ seq: 11, kind: 'agent.updated', agentId: 'sub:read', payload: { role: 'reviewer', name: 'Another assignment' } }] });
  assert.equal(gui.getState().actors.find(a => a.id === 'sub:read').name, 'Review Agent');
});

function snapshot(seq, agentState = 'working') {
  return {
    seq, activeRunId: 'r1', sessions: [{ id: 's1', title: 'Task' }],
    runs: [{ runId: 'r1', sessionId: 's1', title: 'Task', status: 'running', toolCalls: 2 }],
    agents: [{ id: 'main', runId: 'r1', name: '主代理', state: agentState, zone: 'workshop', text: 'Current activity' }]
  };
}

test('reopening applies completion even when a resident still has recent text', () => {
  const gui = world();
  gui.applySnapshot(snapshot(10));
  const completed = snapshot(11, 'done');
  completed.runs[0].finishedAt = Date.now();
  completed.runs[0].status = 'completed';
  gui.applySnapshot(completed);
  assert.equal(gui.getState().actors[0].state, 'done');
  assert.equal(gui.getState().runs[0].status, 'completed');
  gui.applySnapshot({ seq: 12, runs: [], agents: [] });
  assert.equal(gui.getState().actors.length, 0);
  assert.equal(gui.getState().runs.length, 0);
  assert.equal(gui.getState().focusRunId, '');
});

test('cached snapshots preserve newer events while restoring unrelated residents', () => {
  const gui = world();
  gui.applySnapshot(snapshot(10));
  gui.ingest({ events: [{ seq: 12, kind: 'run.finished', runId: 'r1', agentId: 'main', payload: { status: 'failed' } }] });
  const cached = snapshot(11);
  cached.agents.push({ id: 'sub:reader', runId: 'r1', name: 'Reader', state: 'working', zone: 'library' });
  gui.applySnapshot(cached);
  assert.equal(gui.getState().actors.find(a => a.id === 'main').state, 'error');
  assert.equal(gui.getState().runs[0].status, 'failed');
  assert.equal(gui.getState().actors.length, 2);
  gui.applySnapshot({ seq: 11, runs: [], agents: [] });
  assert.equal(gui.getState().actors.length, 1, 'a newer event cannot be pruned by an older snapshot');
  assert.equal(gui.getState().runs.length, 1);
});

test('out-of-order snapshots cannot resurrect retired residents', () => {
  const gui = world();
  gui.applySnapshot(snapshot(10));
  gui.applySnapshot({ seq: 15, runs: [], agents: [] });
  gui.applySnapshot(snapshot(12));
  assert.equal(gui.getState().actors.length, 0);
});

test('queued events already represented by the snapshot do not double-count tools', () => {
  const gui = world();
  gui.applySnapshot(snapshot(10));
  gui.ingest({ events: [{ seq: 10, kind: 'tool.started', runId: 'r1', agentId: 'main', payload: { zone: 'workshop', tool: 'edit' } }] });
  assert.equal(gui.getState().runs[0].toolCalls, 2);
});

test('snapshot sequencing still delivers transient task-board events', () => {
  const gui = world();
  gui.applySnapshot(snapshot(10));
  gui.ingest({ events: [{ seq: 9, kind: 'todo.updated', runId: 'r1', payload: { todos: [{ text: 'Verify', status: 'pending' }] } }] });
  assert.equal(gui.getState().todos, 1);
});

test('walking does not turn completed or idle residents back into workers', () => {
  const gui = world();
  gui.ingest({ events: [{ kind: 'agent.spawned', agentId: 'sub:done', runId: 'r1', payload: { state: 'done' } }] });
  assert.equal(gui.getState().actors[0].state, 'done');
  gui.ingest({ events: [{ kind: 'agent.updated', agentId: 'sub:done', runId: 'r1', payload: { state: 'idle', zone: 'library' } }] });
  assert.equal(gui.getState().actors[0].state, 'idle');
});

test('a new task becomes the current activity after the previous task finished', () => {
  const gui = world();
  gui.applySnapshot(snapshot(10, 'done'));
  gui.ingest({ events: [
    { seq: 11, kind: 'run.started', runId: 'r2', sessionId: 's2', payload: { title: 'Next task' } },
    { seq: 12, kind: 'tool.started', runId: 'r2', sessionId: 's2', payload: { tool: 'read', zone: 'library' } }
  ] });
  assert.equal(gui.getState().focusRunId, 'r2');
  assert.equal(gui.getState().actors[0].zone, 'library');
  assert.equal(gui.getState().actors[0].runId, 'r2');
});

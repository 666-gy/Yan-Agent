'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { normalizeTodos, latestTodos, readSessionTodos, resumableTodos } = require('../lib/kernel-v2/todos');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const path = require('node:path'), os = require('node:os');
const item = (id = 'a', status = 'pending') => ({ id, content: `Task ${id}`, status });
const call = (id, todos, status = 'completed') => ({ type: 'tool', name: 'todowrite', id,
  state: { status, metadata: { yanTodos: { version: 1, todos } } } });
const message = (id, content) => ({ id, type: 'assistant', content });

test('user turn boundaries retire old plans while automatic continuations retain them', () => {
  const snapshot = { callID: 'old-plan', todos: [item('a', 'completed'), item('b', 'completed'), item('c', 'completed')] };
  assert.deepEqual(resumableTodos(snapshot, 'old-plan').todos, []);
  assert.equal(resumableTodos(snapshot), snapshot);
  assert.equal(snapshot.todos.length, 3);
  const unfinished = { callID: 'unfinished', todos: [item('a', 'completed'), item('b', 'in_progress')] };
  assert.equal(resumableTodos(unfinished), unfinished);
  assert.deepEqual(resumableTodos(unfinished, 'unfinished').todos, []);
  assert.equal(resumableTodos(snapshot, 'different-plan'), snapshot);
  assert.equal(resumableTodos(null), null);
  assert.deepEqual(resumableTodos({ todos: [] }).todos, []);
});

test('todo validation preserves IDs and parallel progress, rejecting ambiguous snapshots', () => {
  assert.deepEqual(normalizeTodos([item('a', 'in_progress'), item('b', 'in_progress')]), [item('a', 'in_progress'), item('b', 'in_progress')]);
  assert.deepEqual(normalizeTodos([]), []);
  for (const input of [null, [item(), item()], [{ ...item(), content: ' ' }], [{ ...item(), status: 'done' }], Array.from({ length: 101 }, (_, i) => item(String(i)))]) {
    assert.throws(() => normalizeTodos(input));
  }
});

test('only successful metadata replaces a plan; clear, failure, and call order are distinct', () => {
  const first = message('1', [call('a', [item()])]);
  const later = message('2', [call('b', [item('b')], 'error'), call('c', [], 'running')]);
  assert.deepEqual(latestTodos([first, later]).todos, [item()]);
  later.content[1].state.status = 'completed';
  assert.deepEqual(latestTodos([first, later]).todos, []);
  later.content[0].state.status = 'completed';
  assert.deepEqual(latestTodos([first, later]).todos, [], 'late earlier call must not roll back the clear');
  later.content[1].state.metadata.yanTodos.todos = [item(), item()];
  assert.deepEqual(latestTodos([first, later]).todos, [item('b')]);
  later.content[0].state.metadata = {};
  later.content[0].state.input = { todos: [] };
  assert.deepEqual(latestTodos([first, later]).todos, [item()], 'arguments are not persisted state');
});

test('history recovery paginates newest first and stops on an explicit empty snapshot', async () => {
  const requests = [];
  const client = { message: { list: async input => {
    requests.push(input);
    return input.cursor ? { data: [message('old', [call('clear', [])])], cursor: { next: 'older' } }
      : { data: [message('new', [call('failed', [item()], 'error')])], cursor: { next: 'page2' } };
  } } };
  assert.deepEqual((await readSessionTodos(client, 'session')).todos, []);
  assert.equal(requests.length, 2);
  assert.equal(requests[0].order, 'desc');
  assert.equal(requests[1].cursor, 'page2');
  assert.ok(requests.every(request => request.sessionID === 'session'));
});

test('adapter keeps main-task snapshots isolated and preserves them in interrupted results', () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  const events = [];
  const a = { sessionID: 'a', emit: e => events.push(e) }, b = { sessionID: 'b', emit: e => events.push(e) };
  const snapshot = { todos: [item('a')] };
  adapter.emitTodos(a, snapshot); adapter.emitTodos(a, snapshot);
  adapter.emitTodos(b, { todos: [item('b')] });
  assert.equal(events.length, 2);
  assert.deepEqual(adapter.result(a, [], 'interrupted').todos, [item('a')]);
  assert.deepEqual(adapter.result(b, [], 'done').todos, [item('b')]);
  adapter.emitTodos(a, { todos: [] });
  assert.deepEqual(adapter.result(a, [], 'done').todos, []);
});

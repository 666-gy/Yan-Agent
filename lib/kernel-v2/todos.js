'use strict';

const TODO_VERSION = 1;
const MAX_TODOS = 100;
const isTodoTool = name => /^(?:opencode[._])?todowrite$/.test(String(name || ''));

function normalizeTodos(todos) {
  if (!Array.isArray(todos) || todos.length > MAX_TODOS) throw new Error('todos must be an array of at most 100 items');
  const ids = new Set();
  return todos.map(item => {
    if (!item || typeof item !== 'object') throw new Error('Invalid todo item');
    const id = typeof item.id === 'string' ? item.id.trim() : '';
    const content = typeof item.content === 'string' ? item.content.trim() : '';
    if (!id || id.length > 100 || ids.has(id)) throw new Error('Todo IDs must be nonempty, unique, and at most 100 characters');
    if (!content || content.length > 1000) throw new Error('Todo content must contain 1–1000 characters');
    if (!['pending', 'in_progress', 'completed'].includes(item.status)) throw new Error('Invalid todo status');
    ids.add(id);
    return { id, content, status: item.status };
  });
}

// Read only successful, versioned results, never model arguments or text.
// Message order then tool-call order defines replacement order, independent of
// SSE delivery and parallel tool completion. An empty snapshot is a real clear.
function latestTodos(messages, { descending = false } = {}) {
  const ordered = descending ? messages : [...messages].reverse();
  for (const message of ordered) {
    if (message.type !== 'assistant') continue;
    for (const call of [...(message.content || [])].reverse()) {
      const snapshot = call.state?.metadata?.yanTodos;
      if (call.type !== 'tool' || !isTodoTool(call.name) || call.state?.status !== 'completed'
        || snapshot?.version !== TODO_VERSION) continue;
      try { return { todos: normalizeTodos(snapshot.todos), messageID: message.id, callID: call.id }; }
      catch { /* Invalid persisted metadata cannot erase a previous valid plan. */ }
    }
  }
  return null;
}

async function readSessionTodos(client, sessionID) {
  let cursor;
  const seen = new Set();
  do {
    const page = await client.message.list({ sessionID, limit: 100, ...(cursor ? { cursor } : { order: 'desc' }) });
    const snapshot = latestTodos(page.data, { descending: true });
    if (snapshot) return snapshot;
    cursor = page.cursor?.next;
    if (cursor && seen.has(cursor)) throw new Error('Todo history cursor did not advance');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return null;
}

// A user turn retires the previous snapshot. Automatic continuations retain
// the current plan, including 3/3. Keep historical tool results untouched.
function resumableTodos(snapshot, retiredCallID = '') {
  if (!snapshot) return null;
  return retiredCallID && snapshot.callID === retiredCallID
    ? { ...snapshot, todos: [] } : snapshot;
}

module.exports = { TODO_VERSION, MAX_TODOS, isTodoTool, normalizeTodos, latestTodos, readSessionTodos, resumableTodos };

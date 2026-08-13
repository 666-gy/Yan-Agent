'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  OpenCodeSidecar,
  sessionDirectoryMatches,
  runNeedsFinalSummary,
  collectRunResult
} = require('../lib/opencode-sidecar');

function assistant(id, parts, parentID = 'user') {
  const now = Date.now();
  return {
    info: {
      id,
      parentID,
      role: 'assistant',
      time: { created: now, completed: now },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
    },
    parts
  };
}

function fakeClient(directory, promptHandler, existingSession = null, options = {}) {
  const messages = [];
  const calls = { create: [], get: [], update: [], promptAsync: [] };
  const client = {
    session: {
      get: async payload => {
        calls.get.push(payload);
        return { data: existingSession };
      },
      create: async payload => {
        calls.create.push(payload);
        return { data: { id: 'workspace-session', directory: payload.directory } };
      },
      update: async payload => {
        calls.update.push(payload);
        return { data: { ...existingSession, permission: payload.permission } };
      },
      messages: async () => ({ data: messages }),
      status: async () => ({ data: { 'workspace-session': { type: 'idle' } } }),
      promptAsync: async payload => {
        calls.promptAsync.push(payload);
        const next = promptHandler(payload, calls.promptAsync.length, messages);
        if (next) messages.push(next);
        return { data: true };
      },
      todo: async () => ({ data: typeof options.todos === 'function' ? options.todos() : (options.todos || []) }),
      diff: async () => ({ data: [] })
    },
    event: {
      subscribe: async () => ({
        stream: (async function* eventStream() {
          for (const event of options.events || []) yield event;
        })()
      })
    }
  };
  return { client, calls, messages, directory };
}

test('matches OpenCode sessions to their creation directory', () => {
  const workspace = path.resolve('workspace-a');
  assert.equal(sessionDirectoryMatches({ directory: workspace }, workspace), true);
  assert.equal(sessionDirectoryMatches({ directory: path.resolve('blank') }, workspace), false);
  assert.equal(sessionDirectoryMatches({}, workspace), false);
});

test('requires a summary after tools or an empty work response, but not after a direct answer', () => {
  assert.equal(runNeedsFinalSummary({ usedTools: true, lastAssistant: assistant('tool', []) }), true);
  assert.equal(runNeedsFinalSummary({ lastAssistant: assistant('empty', []) }), true);
  assert.equal(runNeedsFinalSummary({ lastAssistant: assistant('answer', [{ type: 'text', text: '完成' }]) }), false);
});

test('collects the explicitly settled summary assistant instead of an adjacent empty message', () => {
  const messages = [
    assistant('summary', [{ type: 'text', text: '已完成并验收。' }]),
    assistant('late-empty', [])
  ];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session', {
    started: true,
    finalAssistantID: 'summary'
  });
  assert.equal(result.status, 'done');
  assert.equal(result.text, '已完成并验收。');
});

test('discloses skipped Skills without failing an otherwise successful run', () => {
  const messages = [assistant('answer', [{ type: 'text', text: '主任务已完成。' }])];
  const result = collectRunResult(messages, new Set(), [[]], [], {
    workMode: 'normal',
    skippedSkills: [{ id: 'broken-skill', name: 'Broken Skill', attempts: 3, error: 'parse failed' }]
  }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.skippedSkills.length, 1);
  assert.match(result.text, /Skill 加载说明/);
  assert.match(result.text, /Broken Skill/);
  assert.match(result.text, /尝试 3 次/);
});

test('discovers a skipped Skill from the completed Yan Skills tool result', () => {
  const messages = [assistant('answer', [
    {
      type: 'tool',
      tool: 'yan_skills_read_skill',
      callID: 'skill-call',
      state: {
        status: 'completed',
        input: { id: 'runtime-broken', task_id: 'run-1' },
        output: JSON.stringify({
          ok: false,
          skipped: true,
          id: 'runtime-broken',
          name: 'Runtime Broken',
          attempts: 3,
          error: 'temporary parse failure'
        })
      }
    },
    { type: 'text', text: '已使用其他能力完成任务。' }
  ])];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.skippedSkills.length, 1);
  assert.equal(result.skippedSkills[0].id, 'runtime-broken');
  assert.match(result.text, /Runtime Broken/);
});

test('a skipped Skill disclosure cannot turn an empty assistant response into success', () => {
  const messages = [assistant('empty', [{
    type: 'tool',
    tool: 'yan_skills_read_skill',
    state: {
      status: 'completed',
      output: JSON.stringify({ skipped: true, id: 'broken', attempts: 3, error: 'parse failed' })
    }
  }])];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'error');
  assert.match(result.error, /without a final user-facing answer/);
  assert.match(result.text, /Skill 加载说明/);
});

test('creates a workspace-bound session when a Yan task leaves Blank', async () => {
  const directory = path.resolve('workspace-target');
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('direct-answer', [{ type: 'text', text: '已进入工作区。' }]) : null
  ), { id: 'blank-session', directory: path.resolve('blank-runtime') });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    finalTextSettleTimeoutMs: 5
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'workspace-switch',
    openCodeSessionId: 'blank-session',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '继续',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal',
    history: [{ role: 'user', content: '此前任务上下文' }]
  });

  assert.equal(fixture.calls.update.length, 0);
  assert.equal(fixture.calls.create.length, 1);
  assert.equal(fixture.calls.create[0].directory, directory);
  assert.equal(result.openCodeSessionId, 'workspace-session');
  assert.equal(result.text, '已进入工作区。');
});

test('does not carry stale todos from a reused OpenCode session into a new turn', async () => {
  const directory = path.resolve('todo-session-workspace');
  const staleTodos = [{ content: '上一轮任务', status: 'completed', priority: 'medium' }];
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('direct-answer', [{ type: 'text', text: '当前问题已回答。' }]) : null
  ), { id: 'workspace-session', directory }, { todos: staleTodos });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    finalTextSettleTimeoutMs: 5
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'stale-todo-turn',
    openCodeSessionId: 'workspace-session',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '回答当前问题',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.deepEqual(result.todos, []);
  assert.match(fixture.calls.promptAsync[0].system, /Use todowrite for work that has at least three distinct/);
  assert.match(fixture.calls.promptAsync[0].system, /Skip todos for greetings/);
});

test('keeps todos that were updated during the current OpenCode turn', async () => {
  const directory = path.resolve('current-todo-workspace');
  const currentTodos = [
    { content: '读取项目', status: 'completed', priority: 'high' },
    { content: '修复问题', status: 'in_progress', priority: 'high' }
  ];
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('direct-answer', [{ type: 'text', text: '正在处理。' }]) : null
  ), { id: 'workspace-session', directory }, {
    todos: currentTodos,
    events: [{ type: 'todo.updated', properties: { sessionID: 'workspace-session', todos: currentTodos } }]
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    finalTextSettleTimeoutMs: 5
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'current-todo-turn',
    openCodeSessionId: 'workspace-session',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '完成两步任务',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.deepEqual(result.todos.map(todo => ({ text: todo.text, done: todo.done, inProgress: todo.inProgress })), [
    { text: '读取项目', done: true, inProgress: false },
    { text: '修复问题', done: false, inProgress: true }
  ]);
});

test('disables tools in finalization and retries one empty summary response', async () => {
  const directory = path.resolve('summary-workspace');
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      return assistant('work-tool', [{
        type: 'tool',
        tool: 'bash',
        callID: 'call-1',
        state: { status: 'completed', input: { command: 'Get-Location' }, output: directory }
      }]);
    }
    if (call === 2) return assistant('empty-summary', []);
    if (call === 3) return assistant('final-summary', [{ type: 'text', text: '环境检查完成。' }]);
    return null;
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    finalTextSettleTimeoutMs: 5
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'summary-retry',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '检查环境',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 3);
  assert.deepEqual(fixture.calls.promptAsync[1].tools, { '*': false });
  assert.deepEqual(fixture.calls.promptAsync[2].tools, { '*': false });
  assert.equal(result.summaryStarted, true);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '环境检查完成。');
});

'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  OpenCodeSidecar,
  sessionDirectoryMatches,
  sessionHasCurrentPermissions,
  startsVisibleModelResponse,
  collectRunResult,
  openCodeErrorDetail
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

test('does not treat whitespace-only provider chunks as a visible model response', () => {
  assert.equal(startsVisibleModelResponse({
    type: 'message.part.delta',
    properties: { field: 'text', delta: '\n\n' }
  }), false);
  assert.equal(startsVisibleModelResponse({
    type: 'message.part.updated',
    properties: { part: { type: 'text', text: '   ' } }
  }), false);
  assert.equal(startsVisibleModelResponse({
    type: 'session.next.reasoning.delta',
    data: { delta: '\t' }
  }), false);
  assert.equal(startsVisibleModelResponse({
    type: 'message.part.updated',
    properties: { part: { type: 'reasoning', text: 'Working' } }
  }), true);
  assert.equal(startsVisibleModelResponse({
    type: 'session.next.tool.called',
    data: { tool: 'write' }
  }), true);
});

function fakeClient(directory, promptHandler, existingSession = null, options = {}) {
  const messages = [...(Array.isArray(options.initialMessages) ? options.initialMessages : [])];
  const calls = { create: [], get: [], update: [], delete: [], prompt: [], promptAsync: [], abort: [] };
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
      delete: async payload => {
        calls.delete.push(payload);
        return { data: true };
      },
      messages: async () => ({ data: messages }),
      status: async () => ({
        data: typeof options.status === 'function'
          ? { 'workspace-session': options.status() }
          : { 'workspace-session': { type: 'idle' } }
      }),
      abort: async payload => {
        calls.abort.push(payload);
        if (typeof options.abort === 'function') options.abort(payload);
        if (options.abortMessage) messages.push(options.abortMessage);
        return { data: true };
      },
      prompt: async payload => {
        calls.prompt.push(payload);
        const routed = assistant(`skill-routing-${calls.prompt.length}`, [{
          type: 'text',
          text: JSON.stringify({ needsSkill: true, query: 'workspace task' })
        }]);
        return { data: routed };
      },
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

test('does not append an unchanged permission block to a reused session', () => {
  const expected = [
    { permission: 'read', pattern: '*', action: 'allow' },
    { permission: 'bash', pattern: '*', action: 'ask' }
  ];
  const session = {
    permission: [
      ...expected,
      { permission: 'doom_loop', pattern: '*', action: 'ask' },
      ...expected,
      { permission: 'doom_loop', pattern: '*', action: 'ask' }
    ]
  };
  assert.equal(sessionHasCurrentPermissions(session, expected), true);
  assert.equal(sessionHasCurrentPermissions(session, [
    expected[0],
    { permission: 'bash', pattern: '*', action: 'allow' }
  ]), false);
});

test('collects the explicitly settled assistant instead of an adjacent empty message', () => {
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

test('moves GPT thinking tags out of the final user-facing answer', () => {
  const messages = [assistant('tagged-summary', [
    { type: 'reasoning', text: 'Native reasoning' },
    { type: 'text', text: '<thinking>Reviewing implementation</thinking>\n任务已完成。' }
  ])];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.text, '任务已完成。');
  assert.match(result.reasoning, /Native reasoning/);
  assert.match(result.reasoning, /Reviewing implementation/);
  assert.doesNotMatch(result.text, /<\/?thinking>/i);
});

test('does not treat a thinking-only GPT text part as a final answer', () => {
  const messages = [assistant('thinking-only', [
    { type: 'text', text: '<thinking>Still working</thinking>' }
  ])];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'error');
  assert.equal(result.text, '');
  assert.equal(result.reasoning, 'Still working');
  assert.match(result.error, /without a final user-facing answer/);
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

test('recovers the real answer when the final assistant message is a trailing empty wrapper', () => {
  const messages = [
    assistant('answer', [{ type: 'text', text: '任务已完成，共修改 3 个文件。' }]),
    assistant('trailing-empty', [])
  ];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.text, '任务已完成，共修改 3 个文件。');
  assert.equal(result.error, '');
});

test('recovers the real answer past a tool-call-only final message', () => {
  const messages = [
    assistant('answer', [{ type: 'text', text: '修复完成。' }]),
    assistant('tool-only', [{
      type: 'tool',
      tool: 'todo_write',
      callID: 'todo-final',
      state: { status: 'completed', input: {}, output: '' }
    }])
  ];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.text, '修复完成。');
});

test('keeps the no-answer error when no fresh assistant produced user-facing text', () => {
  const messages = [
    assistant('thinking', [{ type: 'text', text: '<thinking>Still working</thinking>' }]),
    assistant('tool-only', [{
      type: 'tool',
      tool: 'bash',
      callID: 'call-last',
      state: { status: 'completed', input: {}, output: '' }
    }])
  ];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'error');
  assert.equal(result.text, '');
  assert.match(result.error, /without a final user-facing answer/);
});

test('keeps the leaked-protocol error even when an earlier assistant has text', () => {
  const messages = [
    assistant('answer', [{ type: 'text', text: '任务已完成。' }]),
    assistant('leaked', [{ type: 'text', text: '<||dsml||tool_calls> <invoke name="bash">' }])
  ];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'error');
  assert.match(result.error, /DSML Tool Call markup/);
});

test('settles on the text-bearing assistant when a trailing empty message ends the session', async () => {
  const directory = path.resolve('trailing-empty-workspace');
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call !== 1) return null;
    messages.push(assistant('final-answer', [{ type: 'text', text: '完成。' }]));
    messages.push(assistant('trailing-empty', []));
    return null;
  }, { id: 'workspace-session', directory }, {
    status: () => ({ type: 'idle' })
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'trailing-empty-settle',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '完成工作',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(result.status, 'done');
  assert.equal(result.text, '完成。');
  assert.equal(result.error, '');
});

test('creates a workspace-bound session when a Yan task leaves Blank', async () => {
  const directory = path.resolve('workspace-target');
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('direct-answer', [{ type: 'text', text: '已进入工作区。' }]) : null
  ), { id: 'blank-session', directory: path.resolve('blank-runtime') });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
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
    availableSkills: [{ id: 'demo-skill', name: 'Demo Skill', description: 'demo' }],
    history: [{ role: 'user', content: '此前任务上下文' }]
  });

  assert.equal(fixture.calls.update.length, 0);
  assert.equal(fixture.calls.create.length, 1);
  assert.equal(fixture.calls.create[0].directory, directory);
  assert.equal(fixture.calls.delete.length, 0);
  assert.equal(fixture.calls.prompt.length, 0);
  assert.match(fixture.calls.promptAsync[0].system, /Yan installed Skill catalog/);
  assert.match(fixture.calls.promptAsync[0].system, /demo-skill/);
  assert.equal(Object.hasOwn(fixture.calls.promptAsync[0], 'tools'), false);
  assert.equal(result.openCodeSessionId, 'workspace-session');
  assert.equal(result.text, '已进入工作区。');
  assert.equal(result.usage.input, 1);
  assert.equal(result.usage.output, 1);
});

test('does not carry stale todos from a reused OpenCode session into a new turn', async () => {
  const directory = path.resolve('todo-session-workspace');
  const staleTodos = [{ content: '上一轮任务', status: 'completed', priority: 'medium' }];
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('direct-answer', [{ type: 'text', text: '当前问题已回答。' }]) : null
  ), { id: 'workspace-session', directory }, { todos: staleTodos });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
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
    dataDir: process.cwd()
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

test('uses the model final response without issuing a second summary prompt', async () => {
  const directory = path.resolve('native-final-response-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      return assistant('work-and-final', [{
        type: 'tool',
        tool: 'bash',
        callID: 'call-1',
        state: { status: 'completed', input: { command: 'Get-Location' }, output: directory }
      }, { type: 'text', text: '环境检查完成。' }]);
    }
    return null;
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'native-final-response',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '检查环境',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(events.filter(event => event.type === 'yan.model.request.started').length, 1);
  assert.equal(Object.hasOwn(fixture.calls.promptAsync[0], 'tools'), false);
  assert.equal(result.summaryStarted, true);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '环境检查完成。');
});

test('stops a busy stop-loop while preserving the completed assistant response', async () => {
  let aborted = false;
  const directory = path.resolve('stop-loop-workspace');
  const abortedAssistant = assistant('guard-aborted', []);
  abortedAssistant.info.error = { name: 'MessageAbortedError' };
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call !== 1) return null;
    const settled = assistant('settled-stop', [{ type: 'text', text: '任务已完成。' }]);
    settled.info.finish = 'stop';
    return settled;
  }, null, {
    status: () => (aborted ? { type: 'idle' } : { type: 'busy' }),
    abort: () => { aborted = true; },
    abortMessage: abortedAssistant
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'stop-loop-guard',
    workspace: directory,
    prompt: '完成任务',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.abort.length, 1);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '任务已完成。');
});

test('does not let an adjacent previous assistant stop the current prompt', async () => {
  let statusPolls = 0;
  const directory = path.resolve('prompt-ownership-workspace');
  const previous = assistant('previous-finished', [{ type: 'text', text: '上一轮已经结束。' }]);
  previous.info.finish = 'stop';
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('current-answer', [{ type: 'text', text: '当前轮继续完成。' }]) : null
  ), { id: 'workspace-session', directory }, {
    initialMessages: [previous],
    status: () => (++statusPolls >= 8 ? { type: 'idle' } : { type: 'busy' })
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'prompt-ownership',
    openCodeSessionId: 'workspace-session',
    workspace: directory,
    prompt: '继续当前轮',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.abort.length, 0);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '当前轮继续完成。');
});

test('retries a transiently interrupted prompt when nothing executed', async () => {
  const directory = path.resolve('transient-retry-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call === 1) {
      const failed = assistant('interrupted-1', []);
      failed.info.error = { message: 'upstream response stream was interrupted' };
      messages.push(failed);
      return null;
    }
    if (call === 2) return assistant('retried-answer', [{ type: 'text', text: '重试后完成。' }]);
    return null;
  }, { id: 'workspace-session', directory }, {
    status: () => ({ type: 'idle' })
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'transient-retry',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '完成任务',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '重试后完成。');
  assert.equal(result.error, '');
  assert.ok(events.some(event => event.type === 'yan.model.retrying'), 'emits a retry event');
});

test('does not retry a prompt whose failed attempt executed a tool', async () => {
  const directory = path.resolve('executed-tool-workspace');
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call === 1) {
      const failed = assistant('failed-tool', [{
        type: 'tool',
        tool: 'bash',
        callID: 'call-1',
        state: { status: 'completed', input: {}, output: '' }
      }]);
      failed.info.error = { message: 'upstream response stream was interrupted' };
      messages.push(failed);
      return null;
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    status: () => ({ type: 'idle' })
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'executed-tool-no-retry',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '执行命令',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }).catch(error => ({ status: 'error', error: error?.message || JSON.stringify(error) }));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.status, 'error');
  assert.match(result.error, /upstream response stream was interrupted/);
});

test('does not retry a non-transient prompt failure', async () => {
  const directory = path.resolve('non-transient-workspace');
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call === 1) {
      const failed = assistant('config-failed', []);
      failed.info.error = { message: "Expected 'id' to be a string." };
      messages.push(failed);
      return null;
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    status: () => ({ type: 'idle' })
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'non-transient',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '回答',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }).catch(error => ({ status: 'error', error: error?.message || JSON.stringify(error) }));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.status, 'error');
  assert.match(result.error, /Expected 'id' to be a string/);
});

test('keeps the main result when a goal acceptance request fails', async () => {
  const directory = path.resolve('goal-degrade-workspace');
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call === 1) return assistant('main-answer', [{ type: 'text', text: '主任务完成。' }]);
    if (call === 2) {
      const failed = assistant('goal-failed', []);
      failed.info.error = { message: "Expected 'id' to be a string." };
      messages.push(failed);
      return null;
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    status: () => ({ type: 'idle' }),
    todos: []
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'goal-degrade',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '达成目标',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'goal'
  });

  assert.equal(result.status, 'error');
  assert.match(result.error, /Goal 第 1 轮验收请求失败/);
  assert.equal(result.text, '主任务完成。');
});

test('survives a transient status-poll failure', async () => {
  let statusCalls = 0;
  const directory = path.resolve('poll-resilience-workspace');
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('poll-answer', [{ type: 'text', text: '轮询自愈完成。' }]) : null
  ), { id: 'workspace-session', directory }, {
    status: () => {
      statusCalls += 1;
      if (statusCalls === 1) throw new Error('fetch failed');
      return { type: 'idle' };
    }
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'poll-resilience',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '继续',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(result.status, 'done');
  assert.equal(result.text, '轮询自愈完成。');
  assert.ok(statusCalls >= 2, `status was polled ${statusCalls} times`);
});

test('fails active runs with a clear message when the kernel dies', async () => {
  const directory = path.resolve('kernel-death-workspace');
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('late-answer', [{ type: 'text', text: '本不该完成。' }]) : null
  ), { id: 'workspace-session', directory }, {
    status: () => ({ type: 'busy' })
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const runPromise = sidecar.run({
    runId: 'kernel-death',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '长时间任务',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });
  await new Promise(resolve => setTimeout(resolve, 50));
  const run = sidecar.activeRuns.get('kernel-death');
  assert.ok(run, 'run is active before the kernel dies');
  run.kernelDied = true;
  const reason = new Error('OpenCode 内核进程意外退出，任务已中止。');
  reason.name = 'AbortError';
  run.abortController.abort(reason);
  run.eventController.abort();

  await assert.rejects(runPromise, /内核进程意外退出/);
});

test('retries when an earlier round executed tools but the failed response did not', async () => {
  const directory = path.resolve('slow-cot-workspace');
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call === 1) {
      // Round 1: executed a tool (result already in session history).
      messages.push(assistant('round-1', [{
        type: 'tool',
        tool: 'todowrite',
        callID: 'todo-1',
        state: { status: 'completed', input: {}, output: '' }
      }]));
      // Round 2: stalled for the whole budget, then timed out with no tools.
      const failed = assistant('timed-out', []);
      failed.info.error = { name: 'UnknownError', data: { message: 'The operation timed out.' } };
      messages.push(failed);
      return null;
    }
    if (call === 2) return assistant('recovered-answer', [{ type: 'text', text: '超时后自动重试成功。' }]);
    return null;
  }, { id: 'workspace-session', directory }, {
    status: () => ({ type: 'idle' })
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'slow-cot-retry',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '写一个3D赛车游戏',
    providerId: 'deepseek',
    modelId: 'gpt-5.6-sol',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '超时后自动重试成功。');
});

test('openCodeErrorDetail extracts deep provider error messages', () => {
  const detail = openCodeErrorDetail({
    name: 'UnknownError',
    data: { message: 'The operation timed out.' }
  });
  assert.match(detail, /The operation timed out/);
  assert.equal(openCodeErrorDetail({ message: 'plain' }), 'plain');
});

test('stall watchdog aborts a drip-stream turn and retries safely', async () => {
  const directory = path.resolve('stall-watchdog-workspace');
  const events = [];
  // Drip semantics: a few tiny deltas keep trickling in (so the silent-chunk
  // timeout never fires), then the stream goes quiet forever — round 2 runs
  // against silence and completes normally.
  const deltaEvent = {
    type: 'message.part.delta',
    properties: { messageID: 'drip-1', partID: 'p1', field: 'text', delta: '滴' }
  };
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call === 1) {
      const failed = assistant('dripped-out', []);
      failed.info.error = { name: 'UnknownError', data: { message: 'generation stalled: test fixture' } };
      messages.push(failed);
      return null;
    }
    if (call === 2) return assistant('stall-recovered', [{ type: 'text', text: '停滞重试成功。' }]);
    return null;
  }, { id: 'workspace-session', directory }, {
    // Busy while the stalled turn runs; idle once the retried prompt lands.
    status: () => (fixture.calls.promptAsync.length >= 2 ? { type: 'idle' } : { type: 'busy' }),
    abort: () => {}
  });
  fixture.client.event.subscribe = async (_payload, opts) => {
    const signal = opts?.signal;
    return {
      stream: (async function* dripStream() {
        for (let index = 0; index < 6; index++) {
          yield deltaEvent;
          // Real SSE streams unblock on abort; emulate that so the fake
          // generator never wedges the run's event pump.
          await new Promise(resolve => {
            const timer = setTimeout(resolve, 60);
            signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
          });
          if (signal?.aborted) return;
        }
        await new Promise(resolve => {
          const timer = setTimeout(resolve, 5_000);
          signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
        });
      })()
    };
  };
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    // Tighten wall-clock knobs: probe every poll, fire past the grace window.
    stallProbeOptions: { intervalMs: 0, graceMs: 30, minChars: Number.MAX_SAFE_INTEGER, windowMs: 60_000 }
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'stall-watchdog',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '完成任务',
    providerId: 'deepseek',
    modelId: 'gpt-5.6-sol',
    workMode: 'normal'
  }, event => events.push(event));

  assert.ok(fixture.calls.abort.length >= 1, 'watchdog aborted the stalled session');
  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '停滞重试成功。');
  assert.ok(events.some(event => event.type === 'yan.model.retrying'), 'retry event emitted');
});

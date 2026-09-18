'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  OpenCodeSidecar,
  sessionDirectoryMatches,
  sessionHasCurrentPermissions,
  startsVisibleModelResponse,
  collectRunResult,
  assistantFinishedByLength,
  assistantCompletedWithoutVisibleOutput,
  turnNeedsEmptyOutputContinuation,
  truncatedOutputError,
  emptyCompletedOutputError,
  openCodeErrorDetail,
  lastToolOutputIndicatesFailure,
  combineSystem,
  combineTurnPrompt,
} = require('../lib/opencode-sidecar');

test('high measured input throughput stays distinct from the Skills tool budget', () => {
  const request = { providerId: 'deepseek', modelId: 'deepseek-v4.1-flash', measuredInputTokensPerSecond: 233458 };
  const turn = combineTurnPrompt(request, 'Read the Skill.');
  assert.match(turn, /effective input throughput[^\n]*200000 tokens\/s/);
  assert.match(turn, /input_tokens_per_second=100000/);
  assert.doesNotMatch(turn, /input_tokens_per_second=200000/);
  assert.doesNotMatch(combineSystem(request), /Recent effective input throughput|input_tokens_per_second=100000/);
});

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

function waitForSignal(signal) {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => signal?.addEventListener('abort', resolve, { once: true }));
}

test('normal coding preserves its final body without followups for missing, failed or stale checks and builders', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-check-pass-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const outcome of ['passed', 'waived', 'failed', 'unavailable', 'stale', 'builder']) {
    const body = '完整交付正文：实现说明、代码示例与使用方法。';
    const write = { type: 'tool', tool: 'write', callID: 'write', state: { status: 'completed', input: {}, output: 'written', metadata: { yanEnvironment: { mutation: true } } } };
    const check = { type: 'tool', tool: 'bash', callID: 'check', state: { status: 'completed', input: { command: 'node --check code.js' }, metadata: { exit: outcome === 'failed' ? 1 : 0 }, output: '' } };
    const parts = outcome === 'stale' ? [check, write] : [write, ...(['passed', 'failed'].includes(outcome) ? [check] : [])];
    const builder = { type: 'tool', tool: 'task', callID: 'builder', state: { status: 'completed', input: { subagent_type: 'builder', description: 'Implement module', prompt: 'Implement module and check it.' }, output: 'Implemented.' } };
    if (outcome === 'builder') parts.push(builder);
    parts.push({ type: 'text', text: body });
    const events = outcome === 'builder' ? [{ type: 'message.part.updated', properties: { part: builder } }] : [];
    const fixture = fakeClient(directory, (_payload, call) => {
      assert.equal(call, 1, 'normal completion must never request verification or regenerated prose');
      return assistant('main-body', parts);
    }, { id: 'workspace-session', directory }, { events });
    const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: directory });
    sidecar.client = fixture.client;
    sidecar.start = async () => ({ ok: true });
    const emitted = [];
    const result = await sidecar.run({ runId: 'verify-' + outcome, workspace: directory, hasUserWorkspace: true,
      prompt: outcome === 'waived' ? '修改代码，跳过测试' : '修改代码', workMode: 'normal', providerId: 'test', modelId: 'test' }, event => emitted.push(event));
    assert.equal(result.status, 'done');
    assert.equal(fixture.calls.promptAsync.length, 1);
    assert.equal(result.text, body);
    assert.equal(result.delivery.verification.status, ['unavailable', 'builder'].includes(outcome) ? 'unchecked' : outcome);
    assert.equal(emitted.some(event => ['yan.verification.required', 'yan.subagent.acceptance.started'].includes(event.type)), false);
    if (outcome === 'builder') assert.ok(result.subagents.some(agent => agent.role === 'builder' || agent.subagentType === 'builder' || agent.type === 'builder'));
  }
});

test('direct explorer and builder streams stay out of the parent and persist their native workflow', async () => {
  const directory = path.resolve('subagent-stream-workspace');
  const emitted = [];
  const childPart = (sessionID, id, type, fields) => ({ type: 'message.part.updated', properties: {
    part: { sessionID, messageID: `msg-${sessionID}`, id, type, ...fields }
  } });
  const taskPart = (id, agent, status = 'running') => childPart('workspace-session', `task-${id}`, 'tool', {
    callID: id, tool: 'task', state: { status, input: { subagent_type: agent, description: `Read ${agent}` },
      metadata: { sessionId: `child-${id}` }, output: status === 'completed' ? 'read done' : '' }
  });
  const events = [
    taskPart('a', 'explorer'), taskPart('b', 'builder'),
    { type: 'session.created', properties: { info: { id: 'child-a', parentID: 'workspace-session', directory } } },
    { type: 'session.created', properties: { info: { id: 'child-b', parentID: 'workspace-session', directory } } },
    { type: 'message.updated', properties: { info: { id: 'msg-child-a', sessionID: 'child-a', role: 'assistant', tokens: { input: 99999, output: 99999 } } } },
    childPart('child-a', 'child-text', 'text', { text: 'Taste skill read', time: { end: 100 } }),
    childPart('child-b', 'child-tool', 'tool', { callID: 'child-read', tool: 'read', state: { status: 'completed', input: { filePath: 'SKILL.md' }, output: 'skill body' } }),
    // A grandchild must not be imported into this parent's workflow.
    { type: 'session.created', properties: { info: { id: 'grandchild', parentID: 'child-a', directory } } },
    childPart('grandchild', 'unrelated', 'text', { text: 'Must not be forwarded' }),
    taskPart('a', 'explorer', 'completed'), taskPart('b', 'builder', 'completed')
  ];
  const fixture = fakeClient(directory, () => assistant('main-final', [{ type: 'text', text: 'Parent done' }]), null, { events });
  const parentMessages = fixture.client.session.messages;
  fixture.client.session.messages = async payload => {
    if (payload.sessionID.startsWith('child-')) return { data: [assistant('child-history', [
      { id: 'history-tool', type: 'tool', callID: 'history-read', tool: 'read', state: { status: 'completed', input: { filePath: 'SKILL.md' }, output: 'history skill body' } },
      { id: 'history-text', type: 'text', text: 'Recovered child result', time: { end: 200 } }
    ])] };
    return parentMessages(payload);
  };
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });
  const result = await sidecar.run({ runId: 'child-stream', workspace: directory, hasUserWorkspace: true,
    enableSubagents: true, providerId: 'deepseek', modelId: 'model', prompt: 'Read skill', workMode: 'normal' }, event => emitted.push(event));
  assert.equal(result.text, 'Parent done');
  assert.equal(result.usage.input, 1);
  assert.equal(result.subagents.length, 2);
  assert.ok(result.subagents.every(record => record.status === 'completed'));
  assert.ok(result.subagents.every(record => record.timeline.some(item => item.content === 'Recovered child result')));
  assert.ok(emitted.some(event => event.type === 'yan.subagent.event' && event.data.subagentType === 'explorer' && event.data.event?.properties?.part?.text === 'Taste skill read'));
  assert.ok(emitted.some(event => event.type === 'yan.subagent.event' && event.data.subagentType === 'builder'));
  assert.ok(!emitted.some(event => event.properties?.part?.sessionID?.startsWith('child-')));
  assert.ok(!JSON.stringify(emitted).includes('Must not be forwarded'));
  assert.ok(fixture.calls.update.some(payload => payload.sessionID === 'child-b'));
});

test('reconnects an interrupted event stream five times and reports recovery', async () => {
  const directory = path.resolve('event-stream-reconnect-workspace');
  const events = [];
  let subscribeCalls = 0;
  let fixture;
  fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('reconnect-assistant', [{ type: 'text', text: '重连后继续完成。' }]) : null
  ), { id: 'workspace-session', directory }, {
    status: () => (subscribeCalls >= 6 ? { type: 'idle' } : { type: 'busy' })
  });
  fixture.client.event.subscribe = async (_payload, options) => {
    subscribeCalls += 1;
    if (subscribeCalls === 1) {
      return { stream: (async function* emptyStream() {})() };
    }
    if (subscribeCalls <= 5) throw new Error(`重连失败 ${subscribeCalls}`);
    return {
      stream: (async function* stableStream() {
        await waitForSignal(options?.signal);
      })()
    };
  };
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    eventStreamRetryBaseMs: 0,
    eventStreamRetryCapMs: 0
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'event-stream-reconnect',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '继续完成任务',
    providerId: 'deepseek',
    modelId: 'gpt-5.6-sol',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(result.status, 'done');
  assert.equal(result.text, '重连后继续完成。');
  assert.equal(subscribeCalls, 6);
  assert.deepEqual(
    events.filter(event => event.type === 'yan.opencode.reconnecting')
      .map(event => event.data.attempt),
    [1, 2, 3, 4, 5]
  );
  assert.equal(events.filter(event => event.type === 'yan.opencode.reconnected').length, 1);
  assert.equal(events.find(event => event.type === 'yan.opencode.reconnected')?.data.attempt, 5);
  assert.equal(events.some(event => event.type === 'yan.opencode.event-stream-lost'), false);
});

test('stops after five failed event stream reconnects', async () => {
  const directory = path.resolve('event-stream-reconnect-exhausted-workspace');
  const events = [];
  let subscribeCalls = 0;
  let aborted = false;
  let fixture;
  fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('reconnect-exhausted-assistant', [{ type: 'text', text: '不应完成。' }]) : null
  ), { id: 'workspace-session', directory }, {
    status: () => (aborted ? { type: 'idle' } : { type: 'busy' }),
    abort: () => { aborted = true; }
  });
  fixture.client.event.subscribe = async () => {
    subscribeCalls += 1;
    if (subscribeCalls === 1) return { stream: (async function* emptyStream() {})() };
    throw new Error(`服务端仍不可用 ${subscribeCalls}`);
  };
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    eventStreamRetryBaseMs: 0,
    eventStreamRetryCapMs: 0
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  await assert.rejects(
    sidecar.run({
      runId: 'event-stream-reconnect-exhausted',
      workspace: directory,
      hasUserWorkspace: true,
      prompt: '等待连接恢复',
      providerId: 'deepseek',
      modelId: 'gpt-5.6-sol',
      workMode: 'normal'
    }, event => events.push(event)),
    /stream disconnected before completion: 服务端仍不可用 6/
  );

  assert.equal(subscribeCalls, 6);
  assert.deepEqual(
    events.filter(event => event.type === 'yan.opencode.reconnecting')
      .map(event => event.data.attempt),
    [1, 2, 3, 4, 5]
  );
  const exhausted = events.find(event => event.type === 'yan.opencode.event-stream-lost');
  assert.equal(exhausted?.data.exhausted, true);
  assert.equal(exhausted?.data.attempt, 5);
  assert.match(exhausted?.data.message || '', /服务端仍不可用 6/);
});

test('repeated successful subscriptions followed by EOF exhaust the stream budget', async () => {
  const directory = path.resolve('event-stream-flapping-workspace');
  let subscriptions = 0;
  let aborted = false;
  const fixture = fakeClient(directory, (_payload, call) => call === 1
    ? assistant('flapping-assistant', [{ type: 'text', text: 'partial' }]) : null,
  { id: 'workspace-session', directory }, {
    status: () => ({ type: aborted ? 'idle' : 'busy' }),
    abort: () => { aborted = true; }
  });
  fixture.client.event.subscribe = async () => {
    subscriptions++;
    if (subscriptions > 8) throw new Error('test runaway guard');
    return { stream: (async function* () {})() };
  };
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd(), eventStreamRetryBaseMs: 0, eventStreamRetryCapMs: 0 });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });
  await assert.rejects(sidecar.run({ runId: 'flapping', workspace: directory, hasUserWorkspace: true,
    prompt: 'continue', providerId: 'test', modelId: 'test', workMode: 'normal' }), /stream disconnected before completion/);
  assert.equal(subscriptions, 6);
  assert.equal(aborted, true);
});

test('task permission recovers a missed input event and rejects unfinished dependencies before dispatch', async () => {
  const directory = path.resolve('dependency-admission-workspace');
  const events = [];
  const replies = [];
  const part = { type: 'tool', tool: 'task', callID: 'child-call', state: { status: 'running', input: {
    subagent_type: 'builder', prompt: 'yan-plan: {"id":"feature","dependsOn":["schema"]}\nImplement feature.'
  } } };
  const fixture = fakeClient(directory, () => assistant('final', [{ type: 'text', text: 'Dependency not ready.' }]),
    { id: 'workspace-session', directory }, { initialMessages: [assistant('delegation', [part])] });
  fixture.client.permission = { reply: async payload => { replies.push(payload); return { data: true }; } };
  fixture.client.event.subscribe = async (_payload, options) => ({ stream: (async function* () {
    yield { type: 'permission.asked', properties: { id: 'permission-1', sessionID: 'workspace-session',
      permission: 'task', patterns: ['builder'], metadata: { subagent_type: 'builder', description: 'feature' },
      tool: { messageID: 'delegation', callID: 'child-call' } } };
    await waitForSignal(options.signal);
  })() });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });
  await sidecar.run({ runId: 'dependency-admission', workspace: directory, hasUserWorkspace: true,
    prompt: 'Implement', providerId: 'test', modelId: 'test', workMode: 'normal' }, event => events.push(event));
  assert.equal(replies[0]?.reply, 'reject');
  assert.equal(sidecar.subBuildPool.status().activeSlots, 0);
});

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

test('reports max_output_tokens truncation instead of a generic empty-answer error', () => {
  const truncated = assistant('length-truncated', [{ type: 'text', text: ' ' }]);
  truncated.info.finish = { unified: 'length', raw: 'max_output_tokens' };
  truncated.info.tokens = { input: 0, output: 1, reasoning: 0, cache: { read: 29964, write: 0 } };
  const result = collectRunResult([truncated], new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(assistantFinishedByLength(truncated), true);
  assert.equal(result.status, 'error');
  assert.equal(result.text, '');
  assert.match(result.error, /truncated by max_output_tokens/);
  assert.match(truncatedOutputError(truncated), /output 1/);
  assert.doesNotMatch(result.error, /without a final user-facing answer/);
});

test('does not fail a truncated turn that still produced a user-facing answer', () => {
  const truncated = assistant('length-with-text', [{ type: 'text', text: '已写入介绍文件。' }]);
  truncated.info.finish = 'length';
  const result = collectRunResult([truncated], new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.text, '已写入介绍文件。');
  assert.equal(result.error, '');
});

test('names a stop+whitespace empty completion instead of a generic empty-answer error', () => {
  const emptyStop = assistant('terra-stop-empty', [{ type: 'text', text: ' ' }]);
  emptyStop.info.finish = 'stop';
  emptyStop.info.tokens = { input: 62418, output: 2, reasoning: 0, cache: { read: 0, write: 0 } };
  const result = collectRunResult([emptyStop], new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(assistantCompletedWithoutVisibleOutput(emptyStop), true);
  assert.equal(assistantFinishedByLength(emptyStop), false);
  assert.equal(result.status, 'error');
  assert.equal(result.text, '');
  assert.match(result.error, /without a final user-facing answer \(finish stop, output 2\)/);
  assert.match(emptyCompletedOutputError(emptyStop), /finish stop/);
});

test('treats Responses finish=other empty completions as missing user-facing text', () => {
  const emptyOther = assistant('terra-other-empty', [{ type: 'text', text: ' ' }]);
  emptyOther.info.finish = { unified: 'other', raw: 'completed' };
  emptyOther.info.tokens = { input: 12, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  assert.equal(assistantCompletedWithoutVisibleOutput(emptyOther), true);
  const result = collectRunResult([emptyOther], new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'error');
  assert.match(result.error, /without a final user-facing answer \(finish other, output 1\)/);
});

test('treats a completed turn with no finish reason and only whitespace as empty output', () => {
  const empty = assistant('no-finish-empty', [{ type: 'text', text: '\n' }]);
  assert.equal(assistantCompletedWithoutVisibleOutput(empty), true);
  const result = collectRunResult([empty], new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.match(result.error, /without a final user-facing answer \(finish none, output 1\)/);
});

test('reads max_output_tokens from finish.raw even when unified is other', () => {
  const truncated = assistant('raw-length', [{ type: 'text', text: ' ' }]);
  truncated.info.finish = { unified: 'other', raw: 'max_output_tokens' };
  truncated.info.tokens = { input: 0, output: 1, reasoning: 0, cache: { read: 0, write: 0 } };
  assert.equal(assistantFinishedByLength(truncated), true);
  const result = collectRunResult([truncated], new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.match(result.error, /truncated by max_output_tokens/);
});

test('does not auto-continue a content-filter empty completion', () => {
  const filtered = assistant('filtered', [{ type: 'text', text: ' ' }]);
  filtered.info.finish = 'content-filter';
  assert.equal(assistantCompletedWithoutVisibleOutput(filtered), false);
  assert.equal(turnNeedsEmptyOutputContinuation([filtered], Date.now() - 10, new Set(), filtered), false);
});

test('does not treat a trailing empty wrapper after a real answer as an empty turn', () => {
  const now = Date.now();
  const answer = assistant('answer', [{ type: 'text', text: '已写好介绍。' }]);
  const trailing = assistant('trailing-empty', [{ type: 'text', text: ' ' }]);
  trailing.info.finish = 'stop';
  answer.info.time.created = now;
  trailing.info.time.created = now + 1;
  assert.equal(turnNeedsEmptyOutputContinuation([answer, trailing], now, new Set(), trailing), false);
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

test('completes a mutating tool-only run with a disclosure instead of failing it', () => {
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
  assert.equal(result.status, 'done');
  assert.equal(result.emptyFinalText, true);
  assert.match(result.text, /本轮任务已完成/);
  assert.match(result.text, /工具调用已执行/);
  assert.equal(result.error, '');
});

test('file-only side effects also complete an otherwise silent run', () => {
  const messages = [assistant('silent-editor', [{
    type: 'tool',
    tool: 'yan_skills_read_skill',
    callID: 'skill-call',
    state: { status: 'completed', input: {}, output: 'ok' }
  }])];
  const diffs = [[{ file: 'src/app.js', additions: 12, deletions: 3, status: 'modified' }]];
  const result = collectRunResult(messages, new Set(), diffs, [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.emptyFinalText, true);
});

test('keeps the no-answer error when nothing but read-only work happened', () => {
  const messages = [
    assistant('thinking', [{ type: 'text', text: '<thinking>Still working</thinking>' }]),
    assistant('read-only', [{
      type: 'tool',
      tool: 'yan_skills_read_skill',
      callID: 'skill-call',
      state: { status: 'completed', input: {}, output: 'ok' }
    }])
  ];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session');
  assert.equal(result.status, 'error');
  assert.match(result.error, /without a final user-facing answer/);
});

test('prefers the live usage ledger when compaction removed assistants from the session', () => {
  const messages = [assistant('survivor', [{ type: 'text', text: '已完成。' }])];
  const usageByMessageId = new Map([
    ['compacted-away', {
      tokens: { input: 50_000, output: 4_000, reasoning: 800, cache: { read: 12_000, write: 2_000 } },
      cost: 0.42
    }],
    ['survivor', { tokens: { input: 10, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }, cost: 0.01 }]
  ]);
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal', usageByMessageId }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.usage.input, 50_010);
  assert.equal(result.usage.output, 4_001);
  assert.equal(result.usage.reasoning, 800);
  assert.equal(result.usage.cacheRead, 12_000);
  assert.equal(result.usage.cacheWrite, 2_000);
  assert.ok(Math.abs(result.usage.cost - 0.43) < 1e-9);
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

test('a later provider failure cannot be hidden by a previously selected tool step', () => {
  const toolStep = assistant('tool-step', [{ type: 'tool', tool: 'bash', callID: 'call-list',
    state: { status: 'completed', input: { command: 'Get-ChildItem' }, output: 'files' } }]);
  const failed = assistant('failed', [{ type: 'reasoning', text: 'Recovers DSML format `' }]);
  failed.info.error = { name: 'UnknownError', data: { message: 'DeepSeek DSML compatibility failed: DeepSeek returned an incomplete Tool Call block.' } };
  failed.info.time.created += 100;
  failed.info.time.completed += 100;
  for (const messages of [[toolStep, failed], [failed, toolStep]]) {
    const result = collectRunResult(messages, new Set(), [], [], { workMode: 'plan' }, 'session', { settledAssistantID: 'tool-step' });
    assert.equal(result.status, 'error');
    assert.match(result.error, /incomplete Tool Call/);
    assert.doesNotMatch(result.text, /本轮任务已完成/);
    assert.equal(result.toolCalls.length, 1, 'preserve completed tool evidence');
  }
});

test('quoted DSML in an explanation remains visible final text', () => {
  const text = '适配器处理 `<｜｜DSML｜｜tool_calls>`；示例只是协议说明。';
  const result = collectRunResult([assistant('explanation', [{ type: 'text', text }])], new Set(), [], [], { workMode: 'plan' }, 'session');
  assert.equal(result.status, 'done');
  assert.equal(result.text, text);
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
  assert.deepEqual(fixture.calls.promptAsync[0].tools, { task: true });
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
  assert.deepEqual(fixture.calls.promptAsync[0].tools, { task: true });
  assert.equal(result.summaryStarted, true);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '环境检查完成。');
});

test('a policy-carrying run finishes without a policy acceptance step', async () => {
  const directory = path.resolve('native-policy-acceptance-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('researched-answer', [{
      type: 'tool',
      tool: 'bash',
      callID: 'anysearch-1',
      state: {
        status: 'completed',
        input: { command: 'node anysearch_cli.js search fable5.1' },
        output: JSON.stringify({ ok: true, results: [{ title: 'Fable 5.1' }] })
      }
    }, { type: 'text', text: '已通过 AnySearch 查到 Fable 5.1 的官方资料。' }]) : null
  ), { id: 'workspace-session', directory });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'native-policy-acceptance',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '搜索介绍模型 fable5.1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal',
    behaviorPolicies: [{
      id: 'prompt-search-routing',
      kind: 'prompt',
      scope: 'global',
      content: '以后搜索优先使用 AnySearch，只有不可用时才回退内置浏览器。',
      metadata: { enforcement: 'mandatory' }
    }]
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.text, '已通过 AnySearch 查到 Fable 5.1 的官方资料。');
  assert.equal(result.status, 'done');
  assert.equal(result.policy, undefined);
  assert.equal(events.filter(event => String(event.type || '').startsWith('yan.policy.')).length, 0);
});

test('an unmet search policy no longer turns the run into an error', async () => {
  const directory = path.resolve('native-policy-acceptance-failure-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('researched-answer', [{ type: 'text', text: '未执行检索。' }]) : null
  ));
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'native-policy-acceptance-failure',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '搜索介绍模型 fable5.1',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal',
    behaviorPolicies: [{
      id: 'prompt-search-routing',
      kind: 'prompt',
      scope: 'global',
      content: '以后搜索优先使用 AnySearch，只有不可用时才回退内置浏览器。',
      metadata: { enforcement: 'mandatory' }
    }]
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.text, '未执行检索。');
  assert.equal(result.status, 'done');
  assert.equal(events.filter(event => String(event.type || '').startsWith('yan.policy.')).length, 0);
});

test('preserves the main body after a normal mutation without acceptance or summary requests', async () => {
  const directory = path.resolve('delivery-acceptance-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      return assistant('delivery-work', [{
        type: 'tool',
        tool: 'write',
        callID: 'write-1',
        state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
      }, { type: 'text', text: '网页已实现。' }]);
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    events: [{
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          tool: 'write',
          callID: 'write-1',
          state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
        }
      }
    }]
  });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'delivery-acceptance',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '写一个网页，确保可交付',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.delivery.verified, false);
  assert.equal(result.delivery.acceptanceRounds, 0);
  assert.equal(events.filter(event => event.type === 'yan.delivery.acceptance.started').length, 0);
  assert.equal(events.filter(event => event.type === 'yan.delivery.acceptance.passed').length, 0);
  assert.equal(result.text, '网页已实现。');
  assert.equal(result.summaryStarted, true);
  assert.equal(result.delivery.passive, true);
  assert.equal(events.filter(event => /^yan\.delivery\.(acceptance|summary)\./.test(event.type)).length, 0);
});

test('does not trigger delivery acceptance from a previous turn mutation', async () => {
  const directory = path.resolve('delivery-acceptance-history-workspace');
  const previous = assistant('previous-edit', [{
    type: 'tool',
    tool: 'write',
    callID: 'old-write',
    state: { status: 'completed', input: { filePath: 'old.html' }, output: 'ok' }
  }]);
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('current-answer', [{ type: 'text', text: '当前问题已回答。' }]) : null
  ), { id: 'workspace-session', directory }, {
    initialMessages: [previous]
  });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'delivery-acceptance-history',
    openCodeSessionId: 'workspace-session',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '回答当前问题',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.delivery.skipped, true);
});

test('reuses verification already performed in the main turn without an extra acceptance call', async () => {
  const directory = path.resolve('delivery-prechecked-workspace');
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('prechecked-work', [
      {
        type: 'tool',
        tool: 'write',
        callID: 'write-1',
        state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
      },
      { type: 'tool', tool: 'browser_screenshot', callID: 'shot-1', state: { status: 'completed', input: {}, output: 'captured' } },
      { type: 'tool', tool: 'browser_click', callID: 'click-1', state: { status: 'completed', input: {}, output: 'clicked' } },
      { type: 'text', text: '页面已实现并完成预览。' }
    ]) : null
  ), { id: 'workspace-session', directory });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'delivery-prechecked',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '写一个网页并确保可交付',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.delivery.verified, true);
  assert.equal(result.delivery.acceptanceRounds, 0);
  assert.equal(result.delivery.prechecked, true);
});

test('leaves missing verification unverified without a forced repair or summary', async () => {
  const directory = path.resolve('delivery-acceptance-unverified-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      return assistant('delivery-work', [{
        type: 'tool',
        tool: 'write',
        callID: 'write-1',
        state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
      }, { type: 'text', text: '网页已实现。' }]);
    }
    if (call === 2) {
      return assistant('delivery-check', [{ type: 'text', text: '已人工核对，页面正常。' }]);
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    events: [{
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          tool: 'write',
          callID: 'write-1',
          state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
        }
      }
    }]
  });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'delivery-acceptance-unverified',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '写一个网页，确保可交付',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.status, 'done');
  assert.equal(result.error, '');
  assert.equal(result.delivery.verified, false);
  assert.equal(result.delivery.failure, '');
  assert.equal(result.text, '网页已实现。');
  assert.equal(events.filter(event => event.type === 'yan.delivery.acceptance.failed').length, 0);
});

test('flags only shell command failures in the last completed tool output', () => {
  const readOutput = [{
    parts: [{ type: 'tool', tool: 'read', state: { status: 'completed', output: 'Uncaught TypeError at line 3\nexit code 1' } }]
  }];
  assert.equal(lastToolOutputIndicatesFailure(readOutput), false);
  const cleanBash = [{
    parts: [{ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'node build.js' }, output: 'error code path handled correctly' } }]
  }];
  assert.equal(lastToolOutputIndicatesFailure(cleanBash), false);
  const failedBash = [{
    parts: [{ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'npm test' }, output: 'npm err! missing script: test' } }]
  }];
  assert.equal(lastToolOutputIndicatesFailure(failedBash), true);
  const exitCode = [{
    parts: [{ type: 'tool', tool: 'bash', state: { status: 'completed', input: { command: 'node build.js' }, output: 'Build completed\nExit code: 1' } }]
  }];
  assert.equal(lastToolOutputIndicatesFailure(exitCode), true);
  const erroredTool = [{
    parts: [{ type: 'tool', tool: 'bash', state: { status: 'error', output: 'Exit code: 1' } }]
  }];
  assert.equal(lastToolOutputIndicatesFailure(erroredTool), false);
});



test('records a model delivery contract without letting it schedule acceptance', async () => {
  const directory = path.resolve('delivery-contract-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      return assistant('contract-work', [
        { type: 'text', text: '<yan-delivery-contract>\nintent: delivery\nartifact: backend\nscope: 只改价格模块\nacceptance: node test/pricing.test.js 全部通过\n</yan-delivery-contract>' },
        {
          type: 'tool',
          tool: 'write',
          callID: 'write-1',
          state: { status: 'completed', input: { filePath: 'pricing.js' }, output: 'ok' }
        },
        { type: 'text', text: '价格计算已重写。' }
      ]);
    }
    if (call === 2) {
      return assistant('contract-check', [
        {
          type: 'tool',
          tool: 'bash',
          callID: 'bash-1',
          state: { status: 'completed', input: { command: 'npm test' }, output: 'all tests passed' }
        },
        { type: 'text', text: '契约验收标准全部满足。' }
      ]);
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    events: [{
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          tool: 'write',
          callID: 'write-1',
          state: { status: 'completed', input: { filePath: 'pricing.js' }, output: 'ok' }
        }
      }
    }]
  });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'delivery-contract',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '调整价格计算逻辑，可交付',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.delivery.contract.acceptance, 'node test/pricing.test.js 全部通过');
  assert.equal(result.delivery.contract.scope, '只改价格模块');
  assert.equal(result.delivery.artifact, 'backend');
  assert.equal(result.delivery.verified, false);
  assert.equal(result.delivery.acceptanceRounds, 0);
});

test('publishes creative direction during streaming and preserves its unverified state without a review', async () => {
  const { deliveryContractId } = require('../lib/delivery-policy');
  const directory = path.resolve('creative-delivery-workspace');
  const emitted = [];
  const contract = { intent: 'presentable', artifact: 'frontend', scope: '2D 鹈鹕骑自行车 HTML',
    direction: '海边悠闲骑行', decisions: '近景移动更快，踏板与腿部协调', acceptance: '观察骑行与空间关系' };
  const contractText = `<yan-delivery-contract>\n${Object.entries(contract).map(([key, value]) => `${key}: ${value}`).join('\n')}\n</yan-delivery-contract>`;
  const userContract = contractText.replace('海边悠闲骑行', '不应记录的用户引用');
  const events = [
    { type: 'message.updated', properties: { info: { id: 'quoted-user', sessionID: 'workspace-session', role: 'user' } } },
    { type: 'message.part.updated', properties: { part: { id: 'quoted-text', messageID: 'quoted-user', sessionID: 'workspace-session', type: 'text', text: userContract } } },
    { type: 'message.updated', properties: { info: { id: 'creative-main', sessionID: 'workspace-session', role: 'assistant' } } },
    { type: 'message.part.updated', properties: { part: { id: 'creative-text', messageID: 'creative-main', sessionID: 'workspace-session', type: 'text', text: contractText.slice(0, -4) } } },
    { type: 'message.part.delta', properties: { partID: 'creative-text', messageID: 'creative-main', sessionID: 'workspace-session', field: 'text', delta: contractText.slice(-4) } },
    { type: 'message.part.updated', properties: { part: { id: 'creative-image', messageID: 'creative-main', sessionID: 'workspace-session', type: 'tool', tool: 'browser_screenshot', state: { status: 'running' } } } }
  ];
  const fake = fakeClient(directory, (payload, call) => {
    if (call === 1) return assistant('creative-main', [
      { type: 'text', text: contractText },
      { type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: path.join(directory, 'index.html') }, output: 'written' } },
      { type: 'tool', tool: 'browser_status', state: { status: 'completed', output: 'loaded' } },
      { type: 'tool', tool: 'browser_screenshot', state: { status: 'completed', output: '视觉结论：合格' } },
      { type: 'text', text: '页面已生成。' }
    ]);
    throw new Error('Unexpected delivery follow-up');
  }, null, { events });
  const sidecar = new OpenCodeSidecar({ log: { info() {}, warn() {}, error() {} } });
  sidecar.client = fake.client;
  sidecar.start = async () => ({ ok: true });
  const result = await sidecar.run({ runId: 'creative-delivery', workspace: directory,
    hasUserWorkspace: true, prompt: '写一个2D的鹈鹕骑自行车html', providerId: 'test', modelId: 'test',
    workMode: 'normal', selectedSkills: [], availableSkills: [] }, event => emitted.push(event));
  const update = emitted.findIndex(event => event.type === 'yan.delivery.contract.updated');
  const screenshot = emitted.findIndex(event => event.properties?.part?.id === 'creative-image');
  assert.ok(update >= 0 && screenshot > update, 'contract must reach the host before the screenshot event');
  assert.equal(emitted[update].data.contract.direction, contract.direction);
  assert.equal(emitted.filter(event => event.type === 'yan.delivery.contract.updated').length, 1);
  assert.equal(fake.calls.promptAsync.length, 1, 'missing review must not create a follow-up');
  assert.equal(result.delivery.verified, false);
  assert.equal(result.delivery.contract.direction, contract.direction);
  assert.notEqual(result.delivery.review?.verdict, 'pass');
  assert.match(result.text, /页面已生成。$/);
  assert.equal(result.delivery.contractId, deliveryContractId(contract));
});

test('collects a complete main-turn review and invalidates it after a later mutation', async () => {
  const { deliveryContractId } = require('../lib/delivery-policy');
  const contract = { artifact: 'frontend', direction: '沿用现有页面层级', acceptance: '主操作可用' };
  const review = { contractId: deliveryContractId(contract), criteria: {
    direction: { status: 'pass', evidence: '截图显示原有标题和表单层级' },
    acceptance: { status: 'pass', evidence: '点击主操作后显示成功状态' }
  } };
  for (const lateMutation of [false, true]) {
    const directory = path.resolve('main-turn-review-workspace');
    const mutation = { type: 'tool', tool: 'write', state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' } };
    const fixture = fakeClient(directory, (_payload, call) => {
      assert.equal(call, 1, 'passive evidence must not request another response');
      return assistant('main-final', [
        { type: 'text', text: `<yan-delivery-contract>${JSON.stringify(contract)}</yan-delivery-contract>` },
        mutation,
        { type: 'tool', tool: 'browser_screenshot', state: { status: 'completed', output: '视觉结论：合格' } },
        { type: 'tool', tool: 'browser_click', state: { status: 'completed', output: 'success' } },
        { type: 'text', text: `<yan-delivery-review>${JSON.stringify(review)}</yan-delivery-review>` },
        ...(lateMutation ? [mutation] : []),
        { type: 'text', text: '结果与限制已说明。' }
      ]);
    });
    const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
    sidecar.client = fixture.client;
    sidecar.start = async () => ({ ok: true });
    const result = await sidecar.run({ workspace: directory, hasUserWorkspace: true,
      prompt: '修改网页', workMode: 'normal', providerId: 'test', modelId: 'gpt-5.3' });
    assert.equal(result.status, 'done');
    assert.equal(result.delivery.verified, !lateMutation);
    assert.equal(result.delivery.acceptanceRounds, 0);
    assert.equal(result.delivery.passive, true);
    assert.match(result.text, /结果与限制已说明。$/);
  }
});

test('discloses a negative visual verdict without starting a repair or replacing the main response', async () => {
  const directory = path.resolve('delivery-verdict-workspace');
  const events = [];
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      return assistant('verdict-work', [{
        type: 'tool',
        tool: 'write',
        callID: 'write-1',
        state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
      }, { type: 'tool', tool: 'browser_screenshot', state: { status: 'completed', output: '视觉结论：不合格（问题：主 CTA 不可见）' } }, { type: 'text', text: '网页已实现，但主 CTA 仍不可见。' }]);
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    events: [{
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          tool: 'write',
          callID: 'write-1',
          state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
        }
      }
    }]
  });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'delivery-verdict',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '写一个网页，确保可交付',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '网页已实现，但主 CTA 仍不可见。');
  assert.equal(result.delivery.verified, false);
  assert.match(result.delivery.failure, /尚未解决/);
  assert.equal(result.delivery.repairRounds, 0);
  assert.equal(result.delivery.acceptanceRounds, 0);
  assert.equal(events.filter(event => /^yan\.delivery\.(acceptance|summary)\./.test(event.type)).length, 0);
});

test('skips the acceptance round for a trivial measured diff', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-trivial-run-'));
  try {
    const configFile = path.join(directory, 'config.txt');
    fs.writeFileSync(configFile, 'alpha\nbeta\ngamma\n');
    const fixture = fakeClient(directory, (_payload, call) => (
      call === 1 ? assistant('trivial-work', [{ type: 'text', text: '配置说明已更新。' }]) : null
    ), { id: 'workspace-session', directory }, {
      events: [
        {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              tool: 'write',
              callID: 'write-1',
              state: { status: 'running', input: { filePath: 'config.txt' } }
            }
          }
        },
        {
          type: 'message.part.updated',
          properties: {
            part: {
              type: 'tool',
              tool: 'write',
              callID: 'write-1',
              state: { status: 'completed', input: { filePath: 'config.txt' }, output: 'ok' }
            }
          }
        }
      ]
    });
    const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
    sidecar.client = fixture.client;
    sidecar.start = async () => ({ ok: true });

    const result = await sidecar.run({
      runId: 'delivery-trivial',
      workspace: directory,
      hasUserWorkspace: true,
      prompt: '调整配置文件说明，可交付',
      providerId: 'deepseek',
      modelId: 'deepseek-v4-flash',
      workMode: 'normal'
    });

    assert.equal(fixture.calls.promptAsync.length, 1);
    assert.equal(result.delivery.skipped, true);
    assert.equal(result.delivery.skipReason, 'no-followup');
    assert.equal(result.status, 'done');
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});











test('skips the acceptance turn when the user opted out of browser acceptance', async () => {
  const directory = path.resolve('delivery-optout-workspace');
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('optout-work', [
      {
        type: 'tool',
        tool: 'write',
        callID: 'write-1',
        state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
      },
      {
        type: 'tool',
        tool: 'bash',
        callID: 'node-1',
        state: { status: 'completed', input: { command: 'node --check index.js' }, metadata: { exit: 0 }, output: 'syntax ok' }
      },
      { type: 'text', text: '页面已完成并通过 node 检查。' }
    ]) : null
  ), { id: 'workspace-session', directory }, {
    events: [{
      type: 'message.part.updated',
      properties: {
        part: {
          type: 'tool',
          tool: 'write',
          callID: 'write-1',
          state: { status: 'completed', input: { filePath: 'index.html' }, output: 'ok' }
        }
      }
    }]
  });
  const sidecar = new OpenCodeSidecar({ appRoot: process.cwd(), dataDir: process.cwd() });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'delivery-optout',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '不使用内置浏览器验收，写一个优美的前端网页',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.status, 'done');
  assert.equal(result.delivery.verified, true);
  assert.equal(result.delivery.prechecked, true);
  assert.equal(result.delivery.visualOptOut, true);
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

test('continues once when a reasoning model hits max_output_tokens with no visible answer', async () => {
  const directory = path.resolve('truncated-continue-workspace');
  const events = [];
  const fixture = fakeClient(directory, (payload, call) => {
    if (call === 1) {
      const truncated = assistant('terra-truncated', [{ type: 'text', text: ' ' }]);
      truncated.info.finish = { unified: 'length', raw: 'max_output_tokens' };
      truncated.info.tokens = { input: 0, output: 1, reasoning: 0, cache: { read: 29964, write: 0 } };
      return truncated;
    }
    if (call === 2) {
      assert.match(String(payload?.parts?.[0]?.text || ''), /YAN OUTPUT CONTINUATION/);
      return assistant('terra-continued', [{ type: 'text', text: 'Yan Agent，桌面工作区助手。' }]);
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
    runId: 'truncated-continue',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '介绍你自己',
    providerId: 'conn-mu7c5rfa-cd72',
    modelId: 'gpt-5.6-terra',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.text, 'Yan Agent，桌面工作区助手。');
  assert.equal(result.error, '');
  assert.ok(events.some(event => event.type === 'yan.model.truncated'));
});

test('continues once when a stop turn has only whitespace and no tool calls', async () => {
  const directory = path.resolve('empty-stop-continue-workspace');
  const events = [];
  const fixture = fakeClient(directory, (payload, call) => {
    if (call === 1) {
      const emptyStop = assistant('terra-stop-empty', [{ type: 'text', text: ' ' }]);
      emptyStop.info.finish = 'stop';
      emptyStop.info.tokens = { input: 62418, output: 2, reasoning: 0, cache: { read: 0, write: 0 } };
      return emptyStop;
    }
    if (call === 2) {
      assert.match(String(payload?.parts?.[0]?.text || ''), /YAN OUTPUT CONTINUATION/);
      assert.match(String(payload?.parts?.[0]?.text || ''), /empty or whitespace-only/);
      return assistant('terra-stop-continued', [{ type: 'text', text: 'Yan Agent，桌面工作区助手。' }]);
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
    runId: 'empty-stop-continue',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '继续',
    providerId: 'conn-mu7c5rfa-cd72',
    modelId: 'gpt-5.6-terra',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.text, 'Yan Agent，桌面工作区助手。');
  assert.equal(result.error, '');
  assert.ok(events.some(event => event.type === 'yan.model.empty-output'));
  assert.equal(events.some(event => event.type === 'yan.model.truncated'), false);
});

test('continues once when Responses maps an empty completion to finish=other', async () => {
  const directory = path.resolve('empty-other-continue-workspace');
  const events = [];
  const fixture = fakeClient(directory, (payload, call) => {
    if (call === 1) {
      const emptyOther = assistant('terra-other-empty', [{ type: 'text', text: ' ' }]);
      emptyOther.info.finish = { unified: 'other', raw: 'completed' };
      emptyOther.info.tokens = { input: 62418, output: 2, reasoning: 0, cache: { read: 0, write: 0 } };
      return emptyOther;
    }
    if (call === 2) {
      assert.match(String(payload?.parts?.[0]?.text || ''), /YAN OUTPUT CONTINUATION/);
      return assistant('terra-other-continued', [{ type: 'text', text: 'Yan Agent，桌面工作区助手。' }]);
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
    runId: 'empty-other-continue',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '继续',
    providerId: 'conn-mu7c5rfa-cd72',
    modelId: 'gpt-5.6-terra',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.text, 'Yan Agent，桌面工作区助手。');
  assert.ok(events.some(event => event.type === 'yan.model.empty-output'));
});

test('continues once when a completed turn has only thinking tags', async () => {
  const directory = path.resolve('thinking-only-continue-workspace');
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      const thinkingOnly = assistant('thinking-only', [{
        type: 'text',
        text: '<thinking>Need to write the intro file.</thinking>'
      }]);
      thinkingOnly.info.finish = 'stop';
      return thinkingOnly;
    }
    return assistant('thinking-continued', [{ type: 'text', text: '介绍已写好。' }]);
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
    runId: 'thinking-only-continue',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '介绍你自己',
    providerId: 'openai',
    modelId: 'gpt-5.6-terra',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '介绍已写好。');
});

test('does not continue a trailing empty wrapper after a real answer', async () => {
  const directory = path.resolve('trailing-empty-no-continue-workspace');
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call !== 1) return null;
    const answer = assistant('final-answer', [{ type: 'text', text: '介绍已写好。' }]);
    answer.info.finish = 'stop';
    const trailing = assistant('trailing-empty', [{ type: 'text', text: ' ' }]);
    trailing.info.finish = 'stop';
    messages.push(answer, trailing);
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
    runId: 'trailing-empty-no-continue',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '介绍你自己',
    providerId: 'openai',
    modelId: 'gpt-5.6-terra',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 1);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '介绍已写好。');
});

test('reports truncation when the continuation is still empty', async () => {
  const directory = path.resolve('truncated-empty-workspace');
  const fixture = fakeClient(directory, (_payload, call) => {
    const truncated = assistant(`terra-empty-${call}`, [{ type: 'text', text: ' ' }]);
    truncated.info.finish = { unified: 'length', raw: 'max_output_tokens' };
    truncated.info.tokens = { input: 0, output: 1, reasoning: 0, cache: { read: 12, write: 0 } };
    return truncated;
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
    runId: 'truncated-empty',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '介绍你自己',
    providerId: 'openai',
    modelId: 'gpt-5.6-terra',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'error');
  assert.match(result.error, /truncated by max_output_tokens/);
  assert.doesNotMatch(result.error, /without a final user-facing answer/);
});

test('reports a named empty-completion error when stop continuation is still empty', async () => {
  const directory = path.resolve('empty-stop-still-empty-workspace');
  const fixture = fakeClient(directory, (_payload, call) => {
    const emptyStop = assistant(`terra-stop-empty-${call}`, [{ type: 'text', text: ' ' }]);
    emptyStop.info.finish = 'stop';
    emptyStop.info.tokens = { input: 10, output: 2, reasoning: 0, cache: { read: 0, write: 0 } };
    return emptyStop;
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
    runId: 'empty-stop-still-empty',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '继续',
    providerId: 'openai',
    modelId: 'gpt-5.6-terra',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 2);
  assert.equal(result.status, 'error');
  assert.match(result.error, /without a final user-facing answer \(finish stop, output 2\)/);
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

test('session-only stream failures override a prior tool completion even with recorded diffs', () => {
  const earlier = assistant('completed-tool', [{ type: 'tool', callID: 'read-1', tool: 'read',
    state: { status: 'completed', input: {}, output: 'ok' } }]);
  const pending = assistant('stream-failed', [{ type: 'tool', callID: 'read-2', tool: 'read',
    state: { status: 'pending', input: {} } }]);
  delete pending.info.time.completed;
  const result = collectRunResult([earlier, pending], new Set(), [[{ file: 'fixture.txt', additions: 1, deletions: 0 }]], [], {}, 's', {
    settledAssistantID: earlier.info.id,
    eventError: 'GLM GLMM compatibility failed: Incomplete Tool Call (key).'
  });
  assert.equal(result.status, 'error');
  assert.match(result.error, /GLMM compatibility failed/);
  assert.doesNotMatch(result.text, /本轮任务已完成/);
  assert.equal(result.toolCalls.filter(tool => tool.ok).length, 1);
  assert.equal(result.toolCalls[1].status, 'error');
  assert.match(result.toolCalls[1].output, /GLMM compatibility failed/);
});

test('a provider stream error recovered by a later response does not fail the run', async () => {
  const directory = path.resolve('dsml-recovery-workspace');
  const events = [];
  const failed = assistant('dsml-failed', []);
  failed.info.error = { message: 'DeepSeek DSML compatibility failed: DeepSeek returned an incomplete Tool Call block.' };
  failed.info.sessionID = 'workspace-session';
  const recovered = assistant('dsml-recovered', [{ type: 'text', text: '工具调用已修正，任务完成。' }]);
  recovered.info.sessionID = 'workspace-session';
  let statusPolls = 0;
  const fixture = fakeClient(directory, (_payload, call, messages) => {
    if (call === 1) {
      messages.push(failed);
      messages.push(recovered);
    }
    return null;
  }, { id: 'workspace-session', directory }, {
    status: () => (++statusPolls >= 6 ? { type: 'idle' } : { type: 'busy' }),
    events: [
      { type: 'session.error', properties: { error: { message: failed.info.error.message } } },
      { type: 'message.updated', properties: { info: recovered.info } }
    ]
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd()
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'dsml-recovery',
    openCodeSessionId: 'workspace-session',
    workspace: directory,
    prompt: '完成任务',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  }, event => events.push(event));

  assert.equal(result.status, 'done');
  assert.equal(result.error, '');
  assert.ok(events.some(event => event.type === 'yan.model.recovered'), 'recovery event emitted');
});

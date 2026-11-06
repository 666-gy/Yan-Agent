'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { translateConfig, permissions } = require('../lib/kernel-v2/config');
const { instructionEntryBytes, INSTRUCTION_CHUNK_BYTES } = require('../lib/kernel-v2/instructions');

test('live review snapshots use the current turn and preserve an empty revert', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  const events = [], calls = [];
  let files = [{ file: 'current.js', additions: 1, deletions: 0 }];
  adapter.transport.client = { session: { diff: async args => { calls.push(args); return files; } } };
  const run = { id: 'review', sessionID: 'session', from: 'current-user', emit: event => events.push(event) };
  adapter.runs.set(run.id, run);
  adapter.scheduleReview(run);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(calls[0], { sessionID: 'session', from: 'current-user' });
  assert.equal(events[0].properties.diff[0].file, 'current.js');
  files = [];
  adapter.scheduleReview(run);
  await new Promise(resolve => setTimeout(resolve, 250));
  assert.deepEqual(events.at(-1).properties.diff, []);
  adapter.runs.delete(run.id);
});

test('web search onboarding is configured separately from model questions', async () => {
  // Decode with the exact schema the bundled V2 kernel uses. A bare string
  // used to pass this translation but was silently rejected by the kernel,
  // so the websearch onboarding form reappeared on every fresh store.
  const vendor = relative => pathToFileURL(path.resolve(__dirname, '..', 'vendor', 'opencode-v2', 'node_modules', relative)).href;
  const { Schema } = await import(vendor('effect/dist/index.js'));
  const { ConfigWebSearch } = await import(vendor('@opencode/schema/dist/config/websearch.js'));
  const decode = Schema.decodeUnknownSync(ConfigWebSearch.Selection);
  for (const input of [{}, { providers: {} }]) {
    const config = translateConfig(input);
    assert.deepEqual(config.websearch, { provider: 'random' });
    assert.equal(decode(config.websearch).provider, 'random');
    assert.equal(translateConfig({ ...input, websearch: false }).websearch, false);
    assert.equal(decode(false), false);
    assert.deepEqual(translateConfig({ ...input, websearch: 'exa' }).websearch, { provider: 'exa' });
    assert.equal(decode(translateConfig({ ...input, websearch: 'exa' }).websearch).provider, 'exa');
  }
  assert.ok(permissions({ hasUserWorkspace: true, permissions: { allowNetwork: false } }).some(rule => rule.action === 'websearch' && rule.effect === 'deny'));
});

test('V2 native shell matches the selected terminal shell', () => {
  if (process.platform !== 'win32') return;
  assert.equal(translateConfig({ plugin: ['file:///plugin.mjs?yanShell=git-bash'] }).shell, 'bash');
  assert.equal(translateConfig({ plugin: ['file:///plugin.mjs?yanShell=pwsh'] }).shell, 'pwsh');
  assert.equal(translateConfig({ plugin: ['file:///plugin.mjs?yanShell=powershell'] }).shell, 'powershell');
  assert.equal(translateConfig({ plugin: ['file:///plugin.mjs?yanShell=cmd'] }).shell, 'cmd');
  assert.equal(translateConfig({ plugin: ['file:///plugin.mjs'] }).shell, 'bash');
});

test('switching models replaces a reused runtime with the new context, compaction and output limits', async t => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  t.after(() => adapter.resources.close());
  const starts = [];
  let stops = 0;
  adapter.transport.start = async config => { starts.push(config); adapter.transport.client = {}; };
  adapter.transport.stop = async () => { stops++; adapter.transport.client = null; };
  const config = (id, context, threshold, output) => ({
    model: `fixture/${id}`,
    provider: { fixture: { models: { [id]: { limit: { context, input: context, output } } } } },
    compaction: { threshold }
  });
  const a = config('a', 100000, 70000, 12000);
  const b = config('b', 200000, 150000, 32000);
  await adapter.start(a);
  await adapter.start(b);
  assert.equal(stops, 1, 'a warm runtime must restart on model policy change');
  assert.deepEqual(starts[1].providers.fixture.models.b.limit, { context: 200000, input: 200000, output: 32000 });
  assert.equal(starts[1].compaction.buffer, 50000);
  await adapter.start(a);
  assert.equal(stops, 2);
  assert.deepEqual(starts[2].providers.fixture.models.a.limit, { context: 100000, input: 100000, output: 12000 });
  assert.equal(starts[2].compaction.buffer, 30000);
});

// Fake V2 client: the projection reports `idle` from the second read on, and
// the event stream connects immediately and stays open until aborted.
function fakeClient(session, { idle, events = [] } = {}) {
  let reads = 0;
  const calls = { list: [] };
  const client = {
    calls,
    session: { list: async () => ({ data: [] }), interrupt: async () => {}, diff: async () => [], form: { list: async () => [] }, ...session },
    permission: { list: async () => [] },
    message: { list: async input => {
      calls.list.push(input);
      if (input.order === 'desc') return { data: [], cursor: {} };
      return { data: reads++ && idle ? [idle] : [], cursor: {} };
    } },
    event: { subscribe: ({ signal, onActivity }) => ({ async *[Symbol.asyncIterator]() {
      onActivity();
      for (const event of events) yield event;
      await new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', resolve));
    } }) }
  };
  return client;
}

test('V2 run usage preserves cache counters across assistant steps without double counting', () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  const result = adapter.result({ sessionID: 'ses_cache' }, [
    { type: 'user', tokens: { input: 999 }, content: [] },
    { type: 'assistant', content: [], tokens: { input: 40, output: 15, reasoning: 5, cache: { read: 60, write: 10 }, total: 130 } },
    { type: 'assistant', content: [], tokens: { input: 20, output: 10, reasoning: 2, cache: { read: 80, write: 3 } } },
    { type: 'assistant', content: [] },
    { type: 'assistant', content: [], tokens: { input: NaN, output: -1, reasoning: Infinity, cache: { read: -1, write: NaN } } }
  ], 'done');
  assert.deepEqual(result.usage, { input: 60, output: 25, reasoning: 7, cacheRead: 140, cacheWrite: 13, total: 245 });
  assert.deepEqual(adapter.result({ sessionID: 'empty' }, [], 'done').usage,
    { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, total: 0 });
});

test('V2 submits selected skill context and distinguishes kernel interruption from user cancellation', async () => {
  for (const cancelled of [false, true]) {
    const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
    let submitted;
    adapter.start = async () => {};
    adapter.transport.client = fakeClient({
      create: async () => ({ id: 'ses_test' }),
      prompt: async input => { submitted = input; adapter.runs.get('test').cancelled = cancelled; }
    }, { idle: { id: 'idle', type: 'idle', outcome: 'interrupted' } });
    const result = await adapter.run({ runId: 'test', workspace: os.tmpdir(), hasUserWorkspace: true,
      prompt: 'Apply selected skill', selectedSkills: [{ id: 'proof', prompt: 'SECRET_SKILL_MARKER' }] });
    assert.match(submitted.text, /SECRET_SKILL_MARKER/);
    assert.match(submitted.text, /task_id=test/);
    assert.equal(result.status, cancelled ? 'interrupted' : 'error');
    if (!cancelled) assert.match(result.error, /非用户取消/);
  }
});

test('permission rejection cannot become success when the model acknowledges it', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  adapter.transport.client = fakeClient({
    create: async () => ({ id: 'ses_denied' }),
    prompt: async () => { adapter.runs.get('denied').permissionDenied = true; }
  }, { idle: { id: 'idle', type: 'idle', outcome: 'succeeded' } });
  const result = await adapter.run({ runId: 'denied', workspace: os.tmpdir(), hasUserWorkspace: true, prompt: 'Run command' });
  assert.equal(result.status, 'error');
  assert.match(result.error, /权限请求被拒绝/);
});

test('live deltas stream to the renderer and projection reads resume after the baseline', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  const delta = (ordinal, text) => ({ type: 'session.text.delta', created: Date.now(),
    data: { sessionID: 'ses_live', assistantMessageID: 'msg_a', ordinal, delta: text } });
  const client = fakeClient({ create: async () => ({ id: 'ses_live' }), prompt: async () => {} },
    { idle: { id: 'idle', type: 'idle', outcome: 'succeeded' },
      events: [delta(0, 'Hel'), delta(0, 'lo'), { type: 'session.text.delta', data: { sessionID: 'other', assistantMessageID: 'x', ordinal: 0, delta: 'LEAK' } }] });
  client.message.list = (list => async input => input.order === 'desc'
    ? { data: [{ id: 'msg_history' }], cursor: {} } : list(input))(client.message.list);
  adapter.transport.client = client;
  const events = [];
  const result = await adapter.run({ runId: 'live', workspace: os.tmpdir(), hasUserWorkspace: true, prompt: 'Say hello' }, event => events.push(event));
  assert.equal(result.status, 'done');
  const deltas = events.filter(event => event.type === 'message.part.delta').map(event => event.properties);
  assert.deepEqual(deltas.map(item => item.delta), ['Hel', 'lo']);
  assert.ok(deltas.every(item => item.partID === 'msg_a:text:0' && item.field === 'text'));
  // The part is announced before its first delta so the renderer appends immediately.
  assert.ok(events.findIndex(event => event.type === 'message.part.updated' && event.properties.part.id === 'msg_a:text:0')
    < events.findIndex(event => event.type === 'message.part.delta'));
  // History is never re-read: every projection read starts after the baseline message.
  const reads = client.calls.list.filter(input => input.order !== 'desc');
  assert.ok(reads.length > 0 && reads.every(input => input.cursor), JSON.stringify(reads));
  assert.equal(JSON.parse(Buffer.from(reads[0].cursor, 'base64url').toString()).id, 'msg_history');
  assert.ok(result.performance && typeof result.performance.streamEvents === 'number');
  for (const name of ['sessionOpenMs', 'instructionsAndRecoveryMs', 'mcpReadyMs', 'baselineAndTodosMs',
    'eventSubscriptionMs', 'attachmentsAndPromptMs', 'promptAdmissionMs']) {
    assert.ok(Number.isFinite(result.performance.admission[name]) && result.performance.admission[name] >= 0, name);
  }
});

test('V1 provider and MCP config translate without loading the V1 plugin', () => {
  const result = translateConfig({ model: 'sample/model', plugin: ['file:///old-plugin.mjs'],
    provider: { sample: { name: 'sample', npm: 'file:///provider.mjs', options: { baseURL: 'http://127.0.0.1:1234' }, models: { model: { id: 'model', limit: { context: 4096, output: 1024 } } } } },
    mcp: { disabled: { type: 'local', command: ['node', 'server.js'], enabled: false } } });
  assert.equal(result.providers.sample.package, 'aisdk:file:///provider.mjs');
  assert.equal(result.providers.sample.settings.baseURL, 'http://127.0.0.1:1234');
  assert.equal(result.mcp.servers.disabled.disabled, true);
  assert.ok(!JSON.stringify(result).includes('old-plugin'));
  assert.equal(result.provider, undefined);
});

test('missing legacy session resumes with Yan history and durable user policy', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  let submitted;
  const policies = new Map();
  adapter.start = async () => {};
  adapter.transport.client = fakeClient({
    get: async () => { throw new Error('Session not found'); },
    create: async () => ({ id: 'ses_migrated', location: { directory: os.tmpdir() } }),
    switchModel: async () => {}, update: async () => {},
    instructions: { entry: { put: async input => { policies.set(input.key, input.value); } } },
    prompt: async input => { submitted = input; }
  }, { idle: { id: 'idle', type: 'idle', outcome: 'succeeded' } });
  const result = await adapter.run({ workspace: os.tmpdir(), openCodeSessionId: 'ses_old',
    customInstructions: 'DURABLE_POLICY', prompt: 'Continue',
    history: [{ role: 'user', content: 'HISTORICAL_MARKER' }] });
  assert.equal(result.openCodeSessionId, 'ses_migrated');
  assert.match(submitted.text, /HISTORICAL_MARKER/);
  assert.match(policies.get('yan.policy'), /DURABLE_POLICY/);
  assert.match(policies.get('yan.turn'), /yan-turn-context/);
});

test('oversized durable policy is split across instruction entries instead of failing the session', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  const entries = new Map();
  adapter.transport.client = fakeClient({
    create: async () => ({ id: 'ses_large_policy' }),
    instructions: { entry: {
      put: async ({ key, value }) => { entries.set(key, value); },
      list: async () => [...entries].map(([key, value]) => ({ key, value })),
      remove: async ({ key }) => { entries.delete(key); }
    } },
    prompt: async () => {}
  }, { idle: { id: 'idle', type: 'idle', outcome: 'succeeded' } });
  const result = await adapter.run({ runId: 'large-policy', workspace: os.tmpdir(), hasUserWorkspace: true,
    customInstructions: 'POLICY_MARKER '.repeat(40000), prompt: 'Continue' });
  assert.equal(result.status, 'done');
  const policyKeys = [...entries.keys()].filter(key => key === 'yan.policy' || key.startsWith('yan.policy.'));
  assert.ok(policyKeys.length > 1, JSON.stringify(policyKeys));
  for (const key of policyKeys) assert.ok(instructionEntryBytes(entries.get(key)) <= INSTRUCTION_CHUNK_BYTES, key);
  assert.match(policyKeys.map(key => entries.get(key)).join(''), /POLICY_MARKER/);
});

test('V2 permission mapping preserves read-only policy and gates shell and subagents', () => {
  const rules = permissions({ hasUserWorkspace: true, sandboxMode: 'read-only', accessMode: 'request', permissions: { allowFileWrite: false } });
  assert.ok(rules.some(rule => rule.action === 'edit' && rule.effect === 'deny'));
  assert.ok(rules.some(rule => rule.action === 'shell'));
  assert.ok(!rules.some(rule => rule.action === 'bash'));
  assert.equal(rules.findLast(rule => rule.action === 'subagent').effect, 'deny');
});


test('contextCompressionCount is set on result', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  let compactionCount = 0;
  const client = fakeClient({ create: async () => ({ id: 'ses_compression' }), prompt: async () => {} },
    { idle: { id: 'idle', type: 'idle', outcome: 'succeeded' } });
  const orig = client.event.subscribe;
  client.event.subscribe = opts => {
    const base = orig(opts);
    return { async *[Symbol.asyncIterator]() {
      yield { type: 'session.compaction.started', data: { sessionID: 'ses_compression', reason: 'auto' } };
      yield { type: 'session.compaction.ended', data: { sessionID: 'ses_compression', reason: 'auto', tokens: { input: 10000, output: 800 } } };
      yield { type: 'session.compaction.started', data: { sessionID: 'ses_compression', reason: 'auto' } };
      yield { type: 'session.compaction.ended', data: { sessionID: 'ses_compression', reason: 'auto', tokens: { input: 5000, output: 400 } } };
      for await (const event of base) yield event;
    } };
  };
  adapter.transport.client = client;
  const compressionEvents = [];
  const result = await adapter.run({ runId: 'compress', workspace: os.tmpdir(), hasUserWorkspace: true, prompt: 'Do stuff' },
    event => { if (event.type === 'yan.context.compression.completed' || event.type === 'yan.context.compression.started') compressionEvents.push(event); });
  assert.equal(result.contextCompressionCount, 2);
  assert.equal(Object.hasOwn(result, 'goal'), false);
  const started = compressionEvents.filter(e => e.type === 'yan.context.compression.started');
  const completed = compressionEvents.filter(e => e.type === 'yan.context.compression.completed');
  assert.equal(started.length, 2);
  assert.equal(completed.length, 2);
  // No checkpoint or context channel: never substitute summarizer usage.
  assert.ok(completed.every(e => !Object.hasOwn(e.data, 'afterTokens')));
});

test('manual compaction reports measured before and after context sizes', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  let compacted = false;
  const before = Array.from({ length: 40 }, (_, index) => ({ id: `u${index}`, type: 'user', text: 'x'.repeat(4000) }));
  const after = [{ id: 'cmp', type: 'compaction', status: 'completed', summary: 'y'.repeat(8000), recent: '' }];
  adapter.transport.client = {
    session: {
      switchModel: async input => assert.deepEqual(input, { sessionID: 'ses_manual', model: { providerID: 'fixture', id: 'm' } }),
      context: async () => compacted ? after : before,
      compact: async () => { compacted = true; },
      interrupt: async () => {}
    },
    message: { list: async () => ({ data: compacted
      ? [{ id: 'cmp', type: 'compaction', status: 'completed' }]
      : [{ id: 'u0', type: 'user' }], cursor: {} }) }
  };
  const result = await adapter.compressSession({
    openCodeSessionId: 'ses_manual', providerId: 'fixture', modelId: 'm',
    openCodeConfig: { model: 'fixture/m',
      provider: { fixture: { models: { m: { limit: { context: 100000, input: 100000, output: 8000 } } } } },
      compaction: { threshold: 70000 } }
  });
  assert.equal(result.compacted, true);
  assert.ok(Number.isFinite(result.beforeTokens), 'beforeTokens must be a number');
  assert.ok(Number.isFinite(result.afterTokens), 'afterTokens must be a number');
  assert.ok(result.beforeTokens > result.afterTokens, `${result.beforeTokens} -> ${result.afterTokens}`);
  assert.equal(result.budget.contextWindow, 100000);
  assert.equal(result.budget.softThreshold, 70000);
});


test('manual compaction returns early execution failures without waiting for a checkpoint', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  let submitted = false;
  adapter.transport.client = {
    session: {
      switchModel: async () => {},
      context: async () => [],
      compact: async () => { submitted = true; },
      interrupt: async () => assert.fail('an already failed execution must not time out')
    },
    message: { list: async () => ({ data: submitted
      ? [{ id: 'failed-idle', type: 'idle', outcome: 'failed', error: { message: 'Provider unavailable' } }]
      : [], cursor: {} }) }
  };
  const result = await adapter.compressSession({ openCodeSessionId: 'session', providerId: 'fixture', modelId: 'm' });
  assert.equal(result.compacted, false);
  assert.equal(result.error, 'Provider unavailable');
});

// Projection whose idle messages appear only when the test releases a turn.
function turnClient(sessionID, onPrompt = () => {}) {
  const state = { prompts: [], list: [], turn: 0 };
  const client = fakeClient({ create: async () => ({ id: sessionID }), prompt: async input => {
    state.prompts.push(input);
    await onPrompt(input, state);
  } });
  client.message.list = async input => input.order === 'desc' ? { data: [], cursor: {} } : { data: state.list.slice(), cursor: {} };
  state.idle = (outcome = 'succeeded') => state.list.push({ id: `idle_${++state.turn}`, type: 'idle', outcome });
  return { client, state };
}
const waitFor = async (check, ms = 8000) => {
  const deadline = Date.now() + ms;
  while (!check()) { if (Date.now() > deadline) throw new Error('timed out'); await new Promise(r => setTimeout(r, 20)); }
};

test('requestFinish is tracked and embedded in the interjection prompt', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  const { client, state } = turnClient('ses_inj');
  adapter.transport.client = client;
  const events = [];
  const running = adapter.run({ runId: 'inj', workspace: os.tmpdir(), hasUserWorkspace: true, prompt: 'Do stuff' }, event => events.push(event));
  await waitFor(() => state.prompts.length === 1);
  const reply = await adapter.deliverInterjection('inj', { guidance: 'Stop now', requestFinish: true });
  assert.equal(reply.requestFinish, true);
  assert.equal(adapter.runs.get('inj').finishRequested, true);
  assert.match(state.prompts[1].text, /Stop now/);
  assert.match(state.prompts[1].text, /finish gracefully/);
  assert.equal(state.prompts[1].delivery, 'steer');
  assert.ok(events.some(event => event.type === 'yan.interjection.processing' && event.data.requestFinish));
  state.idle();
  assert.equal((await running).status, 'done');
});

test('compression start reports the last observed context size', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  const run = { sessionID: 'ses', sessions: new Set(['ses']), view: { parts: new Map(), emit() {} }, children: new Map(),
    performance: null, compactions: 0, lastContextTokens: 0, changedFiles: new Set(), requestIndex: 0, emit: event => events.push(event) };
  const events = [];
  adapter.scheduleSync = () => {};
  adapter.onEvent(run, { type: 'session.step.ended', data: { sessionID: 'ses', assistantMessageID: 'm', tokens: { input: 9000, output: 500, cache: { read: 500 } } } });
  adapter.onEvent(run, { type: 'session.compaction.started', data: { sessionID: 'ses', reason: 'auto' } });
  assert.equal(events.find(event => event.type === 'yan.context.compression.started').data.beforeTokens, 10000);
});

test('automatic compaction reports the measured post-compaction context', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  const events = [];
  const run = { sessionID: 'ses', sessions: new Set(['ses']), view: { parts: new Map(), emit() {} }, children: new Map(),
    performance: null, compactions: 0, lastContextTokens: 60000, changedFiles: new Set(), requestIndex: 0, emit: event => events.push(event) };
  adapter.scheduleSync = () => {};
  adapter.transport.client = { session: { context: async () => [
    { id: 'cmp', type: 'compaction', status: 'completed', summary: 'y'.repeat(4000), recent: '' }
  ] } };
  adapter.onEvent(run, { type: 'session.compaction.ended', data: { sessionID: 'ses', reason: 'auto',
    tokens: { input: 60000, output: 900, cache: { read: 40000 } } } });
  await waitFor(() => events.some(event => event.type === 'yan.context.compression.completed'));
  const completed = events.find(event => event.type === 'yan.context.compression.completed');
  assert.equal(completed.data.automatic, true);
  assert.equal(completed.data.beforeTokens, 60000);
  // ~4000 chars / 4 = ~1000 tokens, not the summarizer's 100900-token usage.
  assert.ok(completed.data.afterTokens > 0 && completed.data.afterTokens < 2000, String(completed.data.afterTokens));
  assert.equal(run.compactions, 1);
});

test('automatic compaction retries a read that still sees the pre-compaction context', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  const events = [];
  const run = { sessionID: 'ses', sessions: new Set(['ses']), view: { parts: new Map(), emit() {} }, children: new Map(),
    performance: null, compactions: 0, lastContextTokens: 60000, changedFiles: new Set(), requestIndex: 0, emit: event => events.push(event) };
  adapter.scheduleSync = () => {};
  const before = Array.from({ length: 60 }, (_, index) => ({ id: `u${index}`, type: 'user', text: 'x'.repeat(4000) }));
  const after = [{ id: 'cmp', type: 'compaction', status: 'completed', summary: 'y'.repeat(4000), recent: '' }];
  let reads = 0;
  adapter.transport.client = { session: { context: async () => reads++ ? after : before } };
  await adapter.onEvent(run, { type: 'session.compaction.ended', data: { sessionID: 'ses', reason: 'auto',
    tokens: { input: 60000, output: 900 } } });
  const completed = events.find(event => event.type === 'yan.context.compression.completed');
  assert.equal(reads, 2, 'the stale first read must be retried');
  assert.ok(completed.data.afterTokens > 0 && completed.data.afterTokens < 2000, String(completed.data.afterTokens));
});

test('real Node adapter routes form answers, permission replies and session deletion', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-node-adapter-'));
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir });
  try {
    await adapter.start();
    const session = await adapter.client.session.create({ location: { directory: dataDir }, permissions: [{ action: '*', resource: '*', effect: 'ask' }] });
    adapter.runs.set('test', { sessionID: session.id });
    const form = await adapter.client.session.form.create({ sessionID: session.id, title: 'Test', fields: [{ key: 'q0', title: 'Pick', type: 'string' }] });
    assert.equal((await adapter.replyQuestion({ runId: 'test', requestId: form.id, answers: [['answer']] })).ok, true);
    const answered = await adapter.client.session.form.get({ sessionID: session.id, formID: form.id });
    assert.equal(answered.state.answer.q0, 'answer');
    assert.equal((await adapter.replyQuestion({ runId: 'test', requestId: form.id, answers: [['answer']] })).ok, true,
      'retrying an accepted answer must not become an already-settled error');
    const choices = await adapter.client.session.form.create({ sessionID: session.id, title: 'Values', fields: [
      { key: 'q0', type: 'string', options: [{ label: 'Visible label', value: 'wire-value' }] },
      { key: 'q1', type: 'multiselect', options: [{ label: 'Second label', value: 'second-value' }, { label: 'Third label', value: 'third-value' }] },
      { key: 'q2', type: 'string', description: 'Describe your requirements' }
    ] });
    await adapter.replyQuestion({ runId: 'test', requestId: choices.id, answers: [['Visible label'], ['Second label', 'Third label'], ['中文自由回答']] });
    assert.deepEqual((await adapter.client.session.form.get({ sessionID: session.id, formID: choices.id })).state.answer,
      { q0: 'wire-value', q1: ['second-value', 'third-value'], q2: '中文自由回答' });
    const cancelled = await adapter.client.session.form.create({ sessionID: session.id, title: 'Cancel', fields: [{ key: 'q0', title: 'Pick', type: 'string' }] });
    await adapter.replyQuestion({ runId: 'test', requestId: cancelled.id, reject: true });
    assert.equal((await adapter.client.session.form.get({ sessionID: session.id, formID: cancelled.id })).state.status, 'cancelled');
    const pending = adapter.client.permission.create({ sessionID: session.id, action: 'shell', resources: ['echo test'] });
    const { setTimeout: delay } = require('node:timers/promises');
    let requests = [];
    for (let i = 0; i < 100 && !requests.length; i++) { requests = await adapter.client.permission.list({ sessionID: session.id }); await delay(10); }
    assert.ok(requests.length);
    await adapter.replyPermission({ runId: 'test', requestId: requests[0].id, reply: 'once' });
    assert.equal((await pending).effect, 'ask'); // create reports admission, reply resolves the pending request.
    assert.deepEqual(await adapter.client.permission.list({ sessionID: session.id }), []);
    assert.equal((await adapter.cancel('test')).ok, true);
    adapter.runs.delete('test');
    const child = await adapter.client.session.create({ parentID: session.id });
    const grandchild = await adapter.client.session.create({ parentID: child.id });
    let discovered = [];
    assert.equal((await adapter.deleteKernelSessionTrees([session.id], dataDir, {
      onDiscovered: ids => { discovered = ids; }
    })).ok, true);
    assert.deepEqual(new Set(discovered), new Set([session.id, child.id, grandchild.id]));
    await assert.rejects(adapter.client.session.get({ sessionID: session.id }));
    await assert.rejects(adapter.client.session.get({ sessionID: child.id }));
    await assert.rejects(adapter.client.session.get({ sessionID: grandchild.id }));
  } finally { await adapter.close(); fs.rmSync(dataDir, { recursive: true, force: true }); }
});

test('cancel discovers unseen paginated descendants and continues after an interrupt failure', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  const stopped = [];
  adapter.transport.client = { session: {
    interrupt: async ({ sessionID }) => {
      stopped.push(sessionID);
      if (sessionID === 'child1') throw new Error('interrupt failed');
    },
    list: async ({ parentID, cursor }) => parentID === 'parent'
      ? cursor ? { data: [{ id: 'child2' }] } : { data: [{ id: 'child1' }], cursor: { next: 'page2' } }
      : { data: parentID === 'child1' ? [{ id: 'grandchild' }] : [] }
  } };
  adapter.runs.set('run', { sessionID: 'parent' });
  const result = await adapter.cancel('run');
  assert.equal(result.ok, false);
  assert.match(result.error, /interrupt failed/);
  assert.equal(adapter.runs.get('run').cancelled, true);
  assert.deepEqual(stopped.sort(), ['parent', 'child1', 'child2', 'grandchild'].sort());
});

test('a local transport reset during prompt admission is retried with the same message id', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  const attempts = [];
  adapter.transport.client = fakeClient({
    create: async () => ({ id: 'ses_admit_retry' }),
    prompt: async input => {
      attempts.push(input);
      if (attempts.length === 1) throw new Error('Transport: terminated (POST http://127.0.0.1/api/session/prompt)');
    }
  }, { idle: { id: 'idle', type: 'idle', outcome: 'succeeded' } });
  const result = await adapter.run({ runId: 'admit-retry', workspace: os.tmpdir(), hasUserWorkspace: true, prompt: 'hello' });
  assert.equal(result.status, 'done');
  assert.equal(attempts.length, 2);
  assert.equal(attempts[0].id, attempts[1].id, 'retry reuses the admitted message id');
});

test('a transient local transport reset while syncing does not fail the turn', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  const client = fakeClient({ create: async () => ({ id: 'ses_sync_retry' }), prompt: async () => {} },
    { idle: { id: 'idle', type: 'idle', outcome: 'succeeded' } });
  const list = client.message.list;
  let reads = 0;
  client.message.list = async input => {
    if (input.order !== 'desc') {
      reads += 1;
      if (reads === 2) throw new Error('Transport: terminated (GET http://127.0.0.1/api/session/message)');
    }
    return list(input);
  };
  adapter.transport.client = client;
  const result = await adapter.run({ runId: 'sync-retry', workspace: os.tmpdir(), hasUserWorkspace: true, prompt: 'hello' });
  assert.equal(result.status, 'done');
  assert.ok(reads >= 3, 'the failed read is retried before the turn continues');
});

test('a dropped event stream reconnects and reports its state to the renderer', async () => {
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: os.tmpdir() });
  adapter.start = async () => {};
  const client = fakeClient({ create: async () => ({ id: 'ses_stream_retry' }), prompt: async () => {} });
  const idle = { id: 'idle', type: 'idle', outcome: 'succeeded' };
  const list = client.message.list;
  let reads = 0;
  // Keep the turn open long enough for the reconnect attempt to be observable.
  client.message.list = async input => {
    if (input.order === 'desc') return list(input);
    reads += 1;
    return { data: reads >= 3 ? [idle] : [], cursor: {} };
  };
  let subscriptions = 0;
  client.event.subscribe = ({ signal, onActivity }) => {
    subscriptions += 1;
    const dropped = subscriptions === 1;
    return { async *[Symbol.asyncIterator]() {
      onActivity();
      if (dropped) throw new Error('Transport: terminated');
      await new Promise(resolve => signal.aborted ? resolve() : signal.addEventListener('abort', resolve));
    } };
  };
  adapter.transport.client = client;
  const events = [];
  const result = await adapter.run({ runId: 'stream-retry', workspace: os.tmpdir(), hasUserWorkspace: true, prompt: 'hello' }, event => events.push(event));
  assert.equal(result.status, 'done');
  assert.ok(subscriptions >= 2, 'the stream is re-subscribed');
  assert.ok(events.some(event => event.type === 'yan.opencode.event-stream-lost'));
  assert.ok(events.some(event => event.type === 'yan.opencode.reconnecting'));
});

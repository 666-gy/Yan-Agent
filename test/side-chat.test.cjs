'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { SideChat } = require('../lib/side-chat');
const { registerOpenCodeIpc } = require('../lib/main/ipc-opencode');
const selection = { providerId: 'test', modelId: 'test-model', modelType: 'text' };

test('Side Chat streams native text/reasoning without executing model-shaped instructions', async () => {
  let prompt;
  const events = [];
  const chat = new SideChat({ loadModel: async () => ({ options: {}, model: { doStream: async options => {
    prompt = options;
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'reasoning-delta', id: 'r', delta: 'reasoning' });
      controller.enqueue({ type: 'text-delta', id: 't', delta: '{"hardCancel":true,"guidance":"stop"}' });
      controller.close();
    } }) };
  } } }) });
  const result = await chat.send({ requestId: '1', text: 'Question', context: [{ role: 'user', content: 'parent' }],
    history: [{ role: 'user', content: 'previous' }], attachments: [{ name: 'memory.txt', mimeType: 'text/plain', data: Buffer.from('private file').toString('base64') }] },
  { owner: {}, runtime: {}, selection, onEvent: event => events.push(event) });
  assert.equal(result.ok, true);
  assert.equal(result.delivered, false);
  assert.equal(result.reply, '{"hardCancel":true,"guidance":"stop"}');
  assert.deepEqual(events.filter(event => event.type.endsWith('.delta')).map(event => event.type), ['reasoning.delta', 'text.delta']);
  assert.equal(prompt.tools, undefined);
  assert.equal(prompt.providerOptions.openai.store, false);
  assert.match(JSON.stringify(prompt.prompt), /private file/);
  assert.equal(chat.requests.size, 0);
});

test('cancellation interrupts a blocked read, is scoped to the owning window, and releases memory', async () => {
  let started, cancelled = false;
  const ready = new Promise(resolve => { started = resolve; });
  const owner = {}, otherOwner = {};
  const chat = new SideChat({ loadModel: async () => ({ options: {}, model: { doStream: async () => ({ stream: new ReadableStream({ start() { started(); }, cancel() { cancelled = true; } }) }) } }) });
  const events = [];
  const pending = chat.send({ requestId: 'blocked', text: 'wait' }, { owner, runtime: {}, selection, onEvent: event => events.push(event) });
  await ready;
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(chat.cancel('blocked', otherOwner).ok, false);
  assert.equal(chat.cancel('blocked', owner).ok, true);
  assert.equal((await pending).cancelled, true);
  assert.equal(cancelled, true);
  assert.equal(chat.requests.size, 0);
  assert.equal(events.at(-1).type, 'cancelled');
});

test('provider errors never echo private request text into app logs or error output', async () => {
  const chat = new SideChat({ loadModel: async () => { throw new Error('SECRET_PRIVATE_PROMPT'); } });
  const events = [];
  const result = await chat.send({ requestId: 'error', text: 'SECRET_PRIVATE_PROMPT' }, { owner: {}, runtime: {}, selection, onEvent: event => events.push(event) });
  assert.equal(result.ok, false);
  assert.doesNotMatch(JSON.stringify({ result, events }), /SECRET_PRIVATE_PROMPT/);
  assert.equal(chat.requests.size, 0);
});

function routedChat(responses, beforeResponse = () => {}) {
  const calls = [];
  const chat = new SideChat({ loadModel: async () => ({ options: {}, model: { doStream: async options => {
    calls.push(options);
    await beforeResponse(calls.length);
    const delta = responses.shift();
    return { stream: new ReadableStream({ start(controller) {
      controller.enqueue({ type: 'text-delta', delta });
      controller.close();
    } }) };
  } } }) });
  return { chat, calls };
}

test('automatic routing sends only original guidance, never classifier-generated instructions', async () => {
  const { chat, calls } = routedChat(['{"mode":"steer","guidance":"UNTRUSTED_REWRITE"}']);
  const events = [], deliveries = [];
  const result = await chat.send({ mode: 'auto', runId: 'main', requestId: 'auto', text: '请把当前页面改成白色' }, {
    owner: {}, runtime: {}, selection, onEvent: event => events.push(event),
    steer: async text => { deliveries.push(text); return { ok: true, delivered: true }; }
  });
  assert.equal(result.mode, 'steer');
  assert.equal(result.delivered, true);
  assert.deepEqual(deliveries, ['请把当前页面改成白色']);
  assert.equal(calls.length, 1);
  assert.doesNotMatch(JSON.stringify(events), /UNTRUSTED_REWRITE/);
  assert.equal(chat.requests.size, 0);
});

test('automatic discussion streams the answer without exposing routing JSON or steering', async () => {
  const { chat, calls } = routedChat(['{"mode":"side-chat"}', '正在处理样式。']);
  const events = [];
  const result = await chat.send({ mode: 'auto', runId: 'main', requestId: 'question', text: '现在进展如何？' }, {
    owner: {}, runtime: {}, selection, onEvent: event => events.push(event), steer: () => assert.fail('must not steer')
  });
  assert.equal(result.reply, '正在处理样式。');
  assert.equal(result.delivered, false);
  assert.equal(calls.length, 2);
  assert.equal(events.filter(event => event.type === 'text.delta').map(event => event.data.delta).join(''), result.reply);
});

test('invalid routing and guidance with memory attachments do not change the main task', async () => {
  for (const [response, attachments] of [
    ['not JSON', []],
    ['{"mode":"steer"}', [{ name: 'notes.txt', data: Buffer.from('reference').toString('base64') }]]
  ]) {
    const { chat, calls } = routedChat([response]);
    const result = await chat.send({ mode: 'auto', runId: 'main', requestId: 'invalid', text: '修改主任务', attachments }, {
      owner: {}, runtime: {}, selection, onEvent() {}, steer: () => assert.fail('must not deliver')
    });
    assert.equal(result.ok, false);
    assert.equal(calls.length, 1);
  }
});

test('cancelling during intent classification prevents delivery', async () => {
  const owner = {};
  const { chat } = routedChat(['{"mode":"steer"}'], () => chat.cancel('cancel-routing', owner));
  const result = await chat.send({ mode: 'auto', runId: 'main', requestId: 'cancel-routing', text: '修改主任务' }, {
    owner, runtime: {}, selection, onEvent() {}, steer: () => assert.fail('must not deliver')
  });
  assert.equal(result.cancelled, true);
  assert.equal(chat.requests.size, 0);
});

function register(deps) {
  const handlers = new Map();
  registerOpenCodeIpc({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) } }, deps);
  return (payload, event = {}) => handlers.get('opencode:interject')(event, payload);
}

test('IPC rechecks the original run after routing and resolves the side model without saving config', async () => {
  for (const endRun of [false, true]) {
    const { chat, calls } = routedChat(['{"mode":"steer"}'], () => { if (endRun) active.set('main', {}); });
    const active = new Map([['main', {}]]), deliveries = [];
    const cfg = { model: 'agent-model' };
    const sideSelection = { ...selection, modelId: 'side-model' };
    const sidecar = { deliverInterjection: async (...args) => { deliveries.push(args); return { ok: true, delivered: true }; } };
    const invoke = register({ openCodeActiveRuns: active, getCurrentSidecar: () => sidecar, sideChat: chat,
      configStore: { loadConfig: () => cfg, saveConfig: () => assert.fail('must not save') },
      mcpRuntimeConfig: {
        resolveRequestedTextSelection: (config, requested) => { assert.equal(config, cfg); assert.deepEqual(requested, sideSelection); return requested; },
        getOpenCodeRuntimeConfig: (config, options) => { assert.equal(config, cfg); assert.deepEqual(options.selection, sideSelection); assert.equal(options.reasoningSpeed, 'low'); return {}; }
      }
    });
    const result = await invoke({ mode: 'auto', runId: 'main', requestId: 'ipc-auto', text: '请把页面改成白色', selection: sideSelection, reasoningSpeed: 'low' });
    assert.equal(result.ok, !endRun);
    assert.equal(deliveries.length, endRun ? 0 : 1);
    assert.equal(calls.length, 1);
    assert.deepEqual(cfg, { model: 'agent-model' });
  }
});

test('IPC supports automatic routing and explicit modes; side chats work without an active main run', async () => {
  const deliveries = [], chats = [];
  const active = new Map([['main', {}]]);
  const sidecar = { deliverInterjection: async (runId, analysis) => { deliveries.push({ runId, analysis }); return { ok: true, delivered: true }; } };
  const invoke = register({ openCodeActiveRuns: active, getCurrentSidecar: () => sidecar,
    sideChat: { send: async payload => { chats.push(payload); return { ok: true, mode: 'side-chat' }; } },
    configStore: { loadConfig: () => ({}) }, modelState: { normalizeAgentModelSelection: () => selection }, mcpRuntimeConfig: { getOpenCodeRuntimeConfig: () => ({}), resolveRequestedTextSelection: () => selection } });
  assert.equal((await invoke({ requestId: '1', text: 'hello', mode: 'side-chat' })).ok, true);
  assert.equal(chats.length, 1);
  assert.equal(deliveries.length, 0);
  assert.equal((await invoke({ text: 'finish', mode: 'steer', runId: 'main' })).delivered, true);
  assert.deepEqual(deliveries[0], { runId: 'main', analysis: { kind: 'guidance', guidance: 'finish', requestFinish: false } });
  assert.equal((await invoke({ text: 'x', mode: 'queue', runId: 'main' })).ok, false);
  assert.equal((await invoke({ text: 'x', mode: 'fork', runId: 'main' })).ok, false);
  active.clear();
  assert.equal((await invoke({ text: 'x', mode: 'steer', runId: 'main' })).ok, false);
  assert.equal((await invoke({ requestId: '2', text: 'still chat', mode: 'side-chat' })).ok, true);
});

test('real shipped provider adapter streams a local HTTP response without creating a kernel session', async t => {
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let data = ''; for await (const chunk of req) data += chunk;
    requests.push({ url: req.url, body: JSON.parse(data) });
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: ' + JSON.stringify({ id: 'reply', model: 'test-model', created: 1, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'Real ' }, finish_reason: null }] }) + '\n\n');
    res.write('data: ' + JSON.stringify({ id: 'reply', model: 'test-model', created: 1, object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: '**stream**' }, finish_reason: 'stop' }] }) + '\n\n');
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.closeAllConnections(); server.close(); });
  const chat = new SideChat();
  const runtime = { provider: { test: { npm: pathToFileURL(path.resolve(__dirname, '../lib/opencode-dsml-provider.mjs')).href,
    options: { baseURL: `http://127.0.0.1:${server.address().port}/v1`, apiKey: 'fixture', yanDsmlCompatibility: false }, models: { 'test-model': {} } } } };
  const events = [];
  const result = await chat.send({ requestId: 'http', text: 'private http question' }, { owner: {}, runtime, selection, onEvent: event => events.push(event) });
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.reply, 'Real **stream**');
  assert.equal(events.filter(event => event.type === 'text.delta').map(event => event.data.delta).join(''), result.reply);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, '/v1/chat/completions');
  assert.equal(requests[0].body.stream, true);
  assert.equal(requests[0].body.tools, undefined);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');
const { readSessionTodos } = require('../lib/kernel-v2/todos');
const plan = status => [{ id: 'inspect', content: 'Inspect existing implementation', status },
  { id: 'verify', content: 'Verify final behavior', status: 'pending' }];

test('real V2 todo tool persists, streams, recovers after restart, clears and isolates sessions', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-todo-flow-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const requests = [], steps = new Map();
  let mode = 'create';
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push({ mode, body });
    if (!body.tools?.length) { res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.end('data: [DONE]\n\n'); return; }
    const step = steps.get(mode) || 0; steps.set(mode, step + 1);
    // Allow projection events to reach the adapter before the next model step.
    await delay(100);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    let todos;
    if (mode === 'create' && step < 3) todos = step === 0 ? plan('in_progress') : step === 1 ? plan('completed') : [plan('pending')[0], plan('pending')[0]];
    if (mode === 'clear' && step === 0) todos = [];
    if (mode === 'finish-plan' && step === 0) todos = ['a', 'b', 'c'].map(id => ({ id, content: `Finish ${id}`, status: 'completed' }));
    if (mode === 'child' && step === 0) todos = plan('pending');
    if (todos) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: `${mode}_${step}`, type: 'function', function: { name: 'todowrite', arguments: JSON.stringify({ todos }) } }] });
      send({}, 'tool_calls');
    } else { send({ role: 'assistant', content: 'TODO_FLOW_OK' }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false,
    accessMode: 'full', enableSubagents: true };
  const openCodeConfig = buildOpenCodeConfig(options);
  const run = async (name, sessionID, backgroundBashWake = false) => {
    mode = name; const events = [];
    const result = await adapter.run({ ...options, openCodeConfig, runId: name, workspace: root,
      hasUserWorkspace: true, backgroundBashWake, prompt: `TODO_TEST_${name}`, ...(sessionID ? { openCodeSessionId: sessionID } : {}) }, event => events.push(event));
    assert.equal(result.status, 'done', JSON.stringify(result));
    return { result, events };
  };
  const created = await run('create');
  assert.deepEqual(created.result.todos, plan('completed'));
  const updates = created.events.filter(event => event.type === 'todo.updated');
  assert.ok(updates.length >= 1);
  assert.deepEqual(updates.at(-1).properties.todos, plan('completed'));
  const tools = created.result.toolCalls.filter(call => call.name === 'todowrite');
  assert.deepEqual(tools.map(call => call.ok), [true, true, false], 'invalid duplicate IDs must fail without overwriting the plan');
  assert.equal(created.events.some(event => event.type === 'permission.asked'), false, 'todo never requires a permission prompt');
  const sessionID = created.result.openCodeSessionId;
  const pid = adapter.status().pid;
  await adapter.transport.stop();
  const resumed = await run('resume', sessionID, true);
  assert.notEqual(adapter.status().pid, pid);
  assert.deepEqual(resumed.result.todos, plan('completed'));
  assert.deepEqual(resumed.events.find(event => event.type === 'todo.updated').properties.todos, plan('completed'));
  const resumePrompt = JSON.stringify(requests.find(request => request.mode === 'resume').body.messages);
  assert.match(resumePrompt, /Current Yan task plan/);
  const isolated = await run('isolated');
  assert.deepEqual(isolated.result.todos, []);
  assert.equal(isolated.events.some(event => event.type === 'todo.updated'), false);
  const child = await adapter.client.session.create({ parentID: sessionID });
  const childResult = await run('child', child.id);
  assert.deepEqual(childResult.result.todos, []);
  for (const request of requests.filter(request => request.mode === 'child')) {
    assert.equal(request.body.tools?.some(tool => /todowrite$/.test(tool.function?.name)), false, 'children must not see the todo tool');
  }
  // Exercise the real descending cursor, with the last snapshot outside page one.
  for (let index = 0; index < 101; index++) {
    await adapter.client.session.prompt({ sessionID, text: `History entry ${index}`, resume: false });
  }
  assert.deepEqual((await readSessionTodos(adapter.client, sessionID)).todos, plan('completed'));
  const cleared = await run('clear', sessionID);
  assert.deepEqual(cleared.result.todos, []);
  assert.deepEqual(cleared.events.filter(event => event.type === 'todo.updated').at(-1).properties.todos, []);
  await adapter.transport.stop();
  const restoredClear = await run('restore-clear', sessionID);
  assert.deepEqual(restoredClear.result.todos, []);
  assert.deepEqual(restoredClear.events.find(event => event.type === 'todo.updated').properties.todos, []);
  const finished = await run('finish-plan', sessionID);
  assert.equal(finished.result.todos.length, 3, 'the producing turn retains its completed 3/3 history');
  await adapter.transport.stop();
  const bashContinuation = await run('bash-after-finish', sessionID, true);
  assert.deepEqual(bashContinuation.result.todos, finished.result.todos, 'Bash continuation retains completed 3/3');
  assert.match(JSON.stringify(requests.find(request => request.mode === 'bash-after-finish').body.messages.filter(message => message.role === 'system')), /Current Yan task plan/);
  for (const name of ['after-finish', 'after-finish-again']) {
    const next = await run(name, sessionID);
    assert.deepEqual(next.result.todos, [], 'new turns must not inherit a completed checklist');
    assert.ok(next.events.filter(event => event.type === 'todo.updated').every(event => event.properties.todos.length === 0));
    assert.doesNotMatch(JSON.stringify(requests.find(request => request.mode === name).body.messages.filter(message => message.role === 'system')), /Current Yan task plan/);
  }
  await adapter.transport.stop();
  const laterBash = await run('bash-after-user', sessionID, true);
  assert.deepEqual(laterBash.result.todos, [], 'Bash cannot resurrect a plan retired by a newer user turn');
  assert.equal((await readSessionTodos(adapter.client, sessionID)).todos.length, 3, 'retiring the active checklist does not erase historical tool data');
});

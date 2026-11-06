'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

async function fixture(t, respond, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-delegation-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const finish = content => { send({ role: 'assistant', content }); send({}, 'stop'); res.end('data: [DONE]\n\n'); };
    respond(body, { send, finish, end: () => res.end('data: [DONE]\n\n') });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false,
    accessMode: 'full', ...overrides };
  return { adapter, request: { ...options, runId: 'probe', workspace: root, hasUserWorkspace: true,
    prompt: 'Dispatch independent children and summarize.', openCodeConfig: buildOpenCodeConfig(options) } };
}

const gate = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
function tool(stream, name, args, id = 'dispatch') {
  stream.send({ role: 'assistant', tool_calls: [{ index: 0, id, type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
  stream.send({}, 'tool_calls'); stream.end();
}

for (const agentPreset of ['standard', 'uncensored']) {
test(`${agentPreset}: full-access child executes Bash through the desktop ownership bridge`, { timeout: 40000 }, async t => {
  let turns = 0;
  const childOutputs = [], events = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('CHILD_SHELL_PROBE')) {
      const receipt = body.messages.find(m => m.role === 'tool' && m.tool_call_id === 'shell-probe');
      if (!receipt) tool(stream, 'bash', { command: 'echo CHILD_BASH_CONFIRMED' }, 'shell-probe');
      else { childOutputs.push(receipt.content); stream.finish('CHILD_SHELL_COMPLETE'); }
    } else if (++turns === 1) tool(stream, 'spawn_agent', { name: 'Shell probe', prompt: 'CHILD_SHELL_PROBE' });
    else stream.finish('PARENT_TURN_COMPLETE');
  }, { agentPreset, delegationReturn: true });
  const env = { url: process.env.YAN_BASH_BRIDGE_URL, token: process.env.YAN_BASH_BRIDGE_TOKEN };
  const service = require('../lib/main/background-bash').registerBackgroundBash({ ipcMain: { handle() {} }, getMainWindow: () => null,
    runContext: { openCodeActiveRuns: new Map(), openCodeRunAdmissions: new Map() } });
  t.after(() => { service.close(); for (const [key, value] of [['YAN_BASH_BRIDGE_URL', env.url], ['YAN_BASH_BRIDGE_TOKEN', env.token]]) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } });
  await service.ready;
  service.register(request.runId, { yanSessionId: 'desktop-shell-probe' });
  const result = await adapter.run(request, event => { events.push(event); service.observe(request.runId, event); });
  assert.equal(result.status, 'done');
  assert.match(JSON.stringify(childOutputs), /CHILD_BASH_CONFIRMED/);
  assert.equal(service.list('desktop-shell-probe').length, 1);
  assert.equal(service.list('desktop-shell-probe')[0].exit, 0);
  assert.equal(events.filter(event => event.type === 'permission.asked').length, 0);
  assert.equal(result.delegation.reports.length, 1);
});
}

for (const operation of ['list_agents', 'wait_agents']) {
test(`desktop ${operation} consumes the final report without an extra run or recovery notification`, { timeout: 40000 }, async t => {
  let turns = 0, delivered = '', recovered = '';
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('READ_CHILD_ONLY')) return stream.finish('FINAL_CHILD_DELIVERABLE');
    if (user.includes('CHECK_LATER')) { recovered = user; return stream.finish('LATER_REPLY'); }
    if (++turns === 1) return tool(stream, 'spawn_agent', { name: 'reader', prompt: 'READ_CHILD_ONLY' });
    if (turns === 2) {
      const record = adapter.delegation.children(adapter.runs.get(request.runId))[0];
      // For list_agents, ensure the returned snapshot really contains the final result.
      const ready = operation === 'list_agents' ? record.done.promise : Promise.resolve();
      void ready.then(() => tool(stream, operation, {}, 'read-final'));
      return;
    }
    delivered = JSON.stringify(body.messages.filter(m => m.role === 'tool' && m.tool_call_id === 'read-final'));
    stream.finish('INTEGRATED_AND_VERIFIED');
  }, { delegationReturn: true });
  const { BackgroundBash } = require('../lib/background-bash');
  let wakes = 0;
  const service = new BackgroundBash({ wake: async () => { wakes++; return { ok: true }; } });
  t.after(() => service.close());
  service.register(request.runId, { yanSessionId: 'read-report-session' });
  const result = await adapter.run(request, event => service.observe(request.runId, event));
  assert.match(delivered, /FINAL_CHILD_DELIVERABLE/);
  assert.equal(result.text, 'INTEGRATED_AND_VERIFIED');
  assert.equal(turns, 3);
  assert.deepEqual(result.delegation.reports, []);
  service.continueTask(request.runId, result.delegation.reports);
  service.settled(request.runId);
  await service.flush();
  assert.equal(wakes, 0);
  const child = (await adapter.client.session.list({ parentID: result.openCodeSessionId })).data[0];
  assert.equal(child.metadata.yanDelegation.reported, true);
  await adapter.run({ ...request, runId: 'read-report-resume', openCodeSessionId: result.openCodeSessionId, prompt: 'CHECK_LATER' });
  assert.doesNotMatch(recovered, /Unreported child results|FINAL_CHILD_DELIVERABLE/);
});
}

test('desktop completion opens a new execution and does not inject a prompt into the finished run', { timeout: 40000 }, async t => {
  let parentTurns = 0, injected = 0, integrationPrompt = '';
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('NEW_TURN_INTEGRATION')) { integrationPrompt = user; stream.finish('INTEGRATED_IN_NEW_RUN'); }
    else if (user.includes('NEW_TURN_CHILD')) stream.finish('CHILD_NEW_TURN_REPORT');
    else if (user.includes('Delegated work has settled')) { injected++; stream.finish('UNEXPECTED_REUSE'); }
    else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: 'probe', prompt: 'NEW_TURN_CHILD' });
    else stream.finish('ORIGINAL_TURN_FINISHED');
  }, { delegationReturn: true });
  const first = await adapter.run(request);
  assert.equal(first.text, 'ORIGINAL_TURN_FINISHED');
  assert.equal(first.delegation.reports.length, 1);
  assert.equal(injected, 0);
  assert.equal(adapter.runs.size, 0);
  const second = await adapter.run({ ...request, runId: 'new-desktop-execution', openCodeSessionId: first.openCodeSessionId,
    prompt: 'NEW_TURN_INTEGRATION\n' + JSON.stringify(first.delegation.reports), delegationReportActivations: first.delegation.reports.map(report => report.activationId) });
  assert.equal(integrationPrompt.split('CHILD_NEW_TURN_REPORT').length - 1, 1, 'one report per activation, not continuation plus recovery');
  assert.equal(second.text, 'INTEGRATED_IN_NEW_RUN');
  assert.equal(second.delegation.reports.length, 0, 'reports cannot trigger an infinite continuation loop');
  const child = (await adapter.client.session.list({ parentID: first.openCodeSessionId })).data[0];
  assert.equal(child.metadata.yanDelegation.reported, true);
});

for (const agentPreset of ['standard', 'uncensored']) {
test(`${agentPreset}: real dynamic child runs alongside parent; parent idle waits, receives result, and resumes`, { timeout: 40000 }, async t => {
  const childStarted = gate(), parentContinued = gate();
  const requests = [], events = [];
  let parentTurns = 0;
  const { adapter, request } = await fixture(t, (body, stream) => {
    requests.push(body);
    const user = body.messages.filter(m => m.role === 'user').at(-1);
    if (JSON.stringify(user).includes('CHILD_ASSIGNMENT_ONLY')) {
      stream.send({ role: 'assistant', content: 'CHILD_WORKING' });
      childStarted.resolve(stream);
    } else if (JSON.stringify(user).includes('Delegated work has settled')) {
      stream.finish('INTEGRATED_CHILD_RESULT');
    } else if (++parentTurns === 1) {
      tool(stream, 'spawn_agent', { name: '动态调查', prompt: 'CHILD_ASSIGNMENT_ONLY' });
    } else {
      stream.finish('PARENT_CONTINUES_INDEPENDENT_WORK');
      parentContinued.resolve();
    }
  }, { agentPreset });
  let settled = false;
  const work = adapter.run(request, event => events.push(event)).finally(() => { settled = true; });
  const childStream = await childStarted.promise;
  await parentContinued.promise;
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.equal(settled, false, 'parent final text must not settle an active task tree');
  childStream.finish('CHILD_VERIFIED_RESULT\n\n* package.json 根字段\n\n  * name: yan-agent\n\n  * version: 1.8.0\n\n  * main: main.js\n\n* test/ 文件\n\n  * 数量：227\n  * 前 3 个：\n    * delegation-manager.test.cjs\n    * deferred-json-store.test.cjs\n    * default-main-model.test.cjs\n\n* 完成检查。');
  const result = await work;
  assert.equal(result.status, 'done');
  assert.match(result.text, /INTEGRATED_CHILD_RESULT/);
  assert.equal(result.delegation.records.length, 1);
  assert.equal(result.delegation.records[0].status, 'completed');
  assert.ok(requests.some(body => JSON.stringify(body.messages).includes('CHILD_VERIFIED_RESULT') && JSON.stringify(body.messages).includes('Delegated work has settled')));
  assert.ok(events.some(event => event.type === 'yan.subagent.event'));
  const children = (await adapter.client.session.list({ parentID: result.openCodeSessionId })).data;
  assert.equal(children.length, 1);
  assert.equal(children[0].metadata.yanDelegation.status, 'completed');
  const policy = session => session.permissions.filter(rule => !rule.action.startsWith('yanp_') && rule.action !== 'yan_delegate');
  const parent = await adapter.client.session.get({ sessionID: result.openCodeSessionId });
  assert.deepEqual(policy(children[0]), policy(parent));
  assert.ok(!children[0].permissions.some(rule => rule.action === 'yan_delegate' && rule.effect === 'allow'), 'child must not inherit the delegation grant');
  assert.ok(parent.permissions.some(rule => rule.action === 'yan_delegate' && rule.effect === 'allow'), 'root keeps the delegation grant');
  assert.equal(adapter.delegation.executions.size, 0, 'root settlement releases execution records');
  const output = path.join(__dirname, '..', 'output', 'delegation-live-events.json');
  fs.mkdirSync(path.dirname(output), { recursive: true });
  if (agentPreset === 'standard') fs.writeFileSync(output, JSON.stringify({ events, result }));
});
}

test('root cancellation stops a running child and prevents completion from waking the root', { timeout: 40000 }, async t => {
  const childStarted = gate(), parentIdle = gate();
  let notices = 0, parentTurns = 0;
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('CANCEL_CHILD_ONLY')) {
      stream.send({ role: 'assistant', content: 'WORKING' }); childStarted.resolve();
    } else if (user.includes('Delegated work has settled')) {
      notices++; stream.finish('UNEXPECTED_WAKE');
    } else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: '可取消任务', prompt: 'CANCEL_CHILD_ONLY' });
    else { stream.finish('PARENT_IDLE'); parentIdle.resolve(); }
  });
  const work = adapter.run(request);
  await childStarted.promise; await parentIdle.promise;
  const stopped = await adapter.cancel(request.runId);
  assert.equal(stopped.ok, true);
  const result = await work;
  assert.equal(result.status, 'interrupted');
  assert.equal(notices, 0);
  assert.equal(Object.keys(await adapter.client.session.active()).length, 0);
  const children = (await adapter.client.session.list({ parentID: result.openCodeSessionId })).data;
  assert.equal(children[0].metadata.yanDelegation.status, 'interrupted');
  assert.equal(adapter.delegation.executions.size, 0);
});

test('parent can resume a completed child in the same session; each activation reports once', { timeout: 40000 }, async t => {
  let parentTurns = 0, notices = 0, agentID;
  const childRequests = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('RESUME_CHILD_FIRST') || user.includes('RESUME_CHILD_SECOND')) {
      childRequests.push(body);
      stream.finish(user.includes('RESUME_CHILD_SECOND') ? 'SECOND_RESULT' : 'FIRST_RESULT');
    } else if (user.includes('Delegated work has settled')) {
      if (!agentID) {
        const notice = body.messages.filter(m => m.role === 'user').at(-1);
        agentID = JSON.stringify(notice).match(/agent_[0-9a-f-]+/)[0];
      }
      const hasSend = body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'followup');
      if (!hasSend) { notices++; tool(stream, 'send_agent_message', { id: agentID, message: 'RESUME_CHILD_SECOND' }, 'followup'); }
      else stream.finish('BOTH_RESULTS_ACCEPTED');
    } else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: '连续调查', prompt: 'RESUME_CHILD_FIRST' });
    else stream.finish('WAITING_FOR_REPORT');
  });
  const result = await adapter.run(request);
  assert.equal(result.status, 'done');
  assert.equal(childRequests.length, 2);
  assert.ok(JSON.stringify(childRequests[1].messages).includes('FIRST_RESULT'), 'follow-up preserves child context');
  assert.equal((await adapter.client.session.list({ parentID: result.openCodeSessionId })).data.length, 1);
  assert.equal(result.delegation.records.length, 1, 'resumed activations share one agent record');
  assert.ok(result.delegation.records.every(record => record.status === 'completed'));
});

test('cancelling the root cascades through a child', { timeout: 40000 }, async t => {
  const childStarted = gate();
  let parentTurns = 0;
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('TREE_CHILD_ONLY')) {
      stream.send({ role: 'assistant', content: 'CHILD_WORKING' }); childStarted.resolve();
    } else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: '中间任务', prompt: 'TREE_CHILD_ONLY' });
    else stream.finish('ROOT_WAITING');
  });
  const work = adapter.run(request);
  await childStarted.promise;
  await adapter.cancel(request.runId);
  const result = await work;
  assert.equal(result.status, 'interrupted');
  assert.equal(Object.keys(await adapter.client.session.active()).length, 0);
  assert.equal(result.delegation.records.length, 1);
  assert.ok(result.delegation.records.every(record => record.status === 'interrupted'));
});

test('a full delegation queue admits the next child after a slot frees', { timeout: 40000 }, async t => {
  const childReady = gate();
  let parentTurns = 0, held;
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('QUEUE_HOLD_CHILD')) {
      held = stream; childReady.resolve(); stream.send({ role: 'assistant', content: 'HOLDING' });
    } else if (user.includes('QUEUE_QUEUED_CHILD')) stream.finish('QUEUED_REPORT');
    else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: 'hold', prompt: 'QUEUE_HOLD_CHILD' });
    else stream.finish('PARENT_AFTER_QUEUE');
  }, { delegationConcurrency: 1, delegationReturn: true });
  const work = adapter.run(request);
  await childReady.promise;
  const parentRun = adapter.runs.get(request.runId);
  assert.ok(parentRun, 'the root run stays alive while a child is pending');
  const queued = adapter.delegation.spawn(parentRun, { name: 'queued', prompt: 'QUEUE_QUEUED_CHILD' }, 'call-queued');
  await new Promise(resolve => setTimeout(resolve, 80));
  assert.equal(adapter.delegation.children(parentRun).length, 1, 'the second child waits without occupying a slot');
  held.finish('HOLD_REPORT');
  const receipt = await queued;
  assert.equal(receipt.queued, true);
  assert.ok(receipt.waitedMs >= 50);
  const result = await work;
  assert.equal(result.delegation.records.length, 2);
  assert.ok(result.delegation.records.every(record => record.status === 'completed'));
});

test('resume reports persisted orphan executions without rerunning them', { timeout: 40000 }, async t => {
  const requests = [];
  const { adapter, request } = await fixture(t, (body, stream) => { requests.push(body); stream.finish('RECOVERY_ACKNOWLEDGED'); });
  await adapter.start(request.openCodeConfig);
  const parent = await adapter.client.session.create({ location: { directory: request.workspace }, title: 'recovery', model: { providerID: 'fixture', id: 'fixture' } });
  const orphan = await adapter.client.session.create({ parentID: parent.id, location: { directory: request.workspace },
    metadata: { yanDelegation: { agentID: 'orphan-agent', activationID: 'old-activation', name: '旧工作', status: 'running', reported: false } } });
  const result = await adapter.run({ ...request, openCodeSessionId: parent.id });
  assert.equal(result.status, 'done');
  assert.equal(requests.length, 1);
  assert.match(JSON.stringify(requests[0].messages), /old-activation/);
  const recovered = await adapter.client.session.get({ sessionID: orphan.id });
  assert.equal(recovered.metadata.yanDelegation.status, 'interrupted');
  assert.equal(recovered.metadata.yanDelegation.reported, true);
});

test('child edits use inherited authorization and appear in the root change summary', { timeout: 40000 }, async t => {
  let parentTurns = 0, target;
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('WRITE_CHILD_ONLY')) {
      const wrote = body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'child-write');
      if (!wrote) {
        const schema = body.tools.find(item => item.function.name === 'write').function.parameters;
        tool(stream, 'write', { [schema.properties.path ? 'path' : 'filePath']: target, content: 'delegated content\n' }, 'child-write');
      } else stream.finish('CHILD_FILE_WRITTEN');
    } else if (user.includes('Delegated work has settled')) stream.finish('FILE_ACCEPTED');
    else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: '实现文件', prompt: 'WRITE_CHILD_ONLY' });
    else stream.finish('PARENT_WAITING');
  });
  target = path.join(request.workspace, 'delegated.txt');
  const result = await adapter.run(request);
  assert.equal(result.status, 'done');
  assert.equal(fs.readFileSync(target, 'utf8'), 'delegated content\n');
  assert.ok(result.changes.some(change => String(change.file || change.path).endsWith('delegated.txt')), JSON.stringify(result.changes));
  const history = await adapter.sessionChanges({ sessionId: result.openCodeSessionId, directory: request.workspace });
  assert.ok(history.some(change => String(change.file || change.path).endsWith('delegated.txt')));
});

test('a main runtime failure drains its child before releasing the task', { timeout: 40000 }, async t => {
  const childStarted = gate();
  let parentTurns = 0;
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('FAILURE_CHILD_ONLY')) { stream.send({ role: 'assistant', content: 'WORKING' }); childStarted.resolve(); }
    else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: '等待中的任务', prompt: 'FAILURE_CHILD_ONLY' });
    else stream.finish('ROOT_WAITING');
  });
  const work = adapter.run(request);
  const rejected = assert.rejects(work, /main runtime failed/);
  await childStarted.promise;
  const root = adapter.runs.get(request.runId);
  root.streamError = new Error('main runtime failed'); root.wake?.();
  await rejected;
  assert.equal(Object.keys(await adapter.client.session.active()).length, 0);
  assert.equal(adapter.delegation.executions.size, 0);
});

test('read-only parent cannot delegate a write or create child approval dialogs', { timeout: 40000 }, async t => {
  let parentTurns = 0, target;
  const events = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('READONLY_CHILD_ONLY')) {
      const wrote = body.messages.some(m => m.role === 'tool' && m.tool_call_id === 'forbidden-write');
      if (!wrote) tool(stream, 'write', { path: target, filePath: target, content: 'must not exist' }, 'forbidden-write');
      else stream.finish('CHILD_REPORTS_DENIED_WRITE');
    } else if (user.includes('Delegated work has settled')) stream.finish('RESTRICTION_ACKNOWLEDGED');
    else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: '只读调查', prompt: 'READONLY_CHILD_ONLY' });
    else stream.finish('WAITING');
  }, { sandboxMode: 'read-only' });
  target = path.join(request.workspace, 'forbidden.txt');
  const result = await adapter.run(request, event => events.push(event));
  assert.equal(result.status, 'done');
  assert.equal(fs.existsSync(target), false);
  assert.equal(events.filter(event => event.type === 'permission.asked').length, 0);
  const child = (await adapter.client.session.list({ parentID: result.openCodeSessionId })).data[0];
  assert.ok(child, JSON.stringify(events.filter(event => (event.properties || event.data)?.part?.state?.status === 'error')));
  assert.ok(child.permissions.some(rule => rule.action === 'yan_sandbox_read-only' && rule.effect === 'deny'));
});

test('guidance reaches the main agent while it is waiting for a child', { timeout: 40000 }, async t => {
  const childStarted = gate(), parentIdle = gate(), mainGuided = gate();
  let parentTurns = 0;
  const { adapter, request } = await fixture(t, (body, stream) => {
    const user = JSON.stringify(body.messages.filter(m => m.role === 'user').at(-1));
    if (user.includes('GUIDANCE_CHILD_ONLY')) { stream.send({ role: 'assistant', content: 'WORKING' }); childStarted.resolve(stream); }
    else if (user.includes('Delegated work has settled')) stream.finish('FINAL_AFTER_GUIDANCE');
    else if (user.includes('USER_GUIDES_MAIN_ONLY')) { stream.finish('MAIN_RECEIVED_GUIDANCE'); mainGuided.resolve(); }
    else if (++parentTurns === 1) tool(stream, 'spawn_agent', { name: '后台调查', prompt: 'GUIDANCE_CHILD_ONLY' });
    else { stream.finish('MAIN_IDLE'); parentIdle.resolve(); }
  });
  const work = adapter.run(request);
  const childStream = await childStarted.promise; await parentIdle.promise;
  const receipt = await adapter.deliverInterjection(request.runId, { guidance: 'USER_GUIDES_MAIN_ONLY' });
  assert.equal(receipt.delivered, true);
  await mainGuided.promise;
  childStream.finish('CHILD_DONE_AFTER_USER_GUIDANCE');
  const result = await work;
  assert.equal(result.status, 'done');
  assert.match(result.text, /FINAL_AFTER_GUIDANCE/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getCachedIndex, queryCallTree } = require('../lib/analysis/calltree');
const { buildRepoMap } = require('../lib/analysis/repo-map');
const { StreamReconnectBudget } = require('../lib/stream-reconnect-budget');
const { taskAdmission, recoverTaskInput } = require('../lib/subagent/admission');
const { SubagentEventBridge } = require('../lib/subagent/event-bridge');
const { recordSubagentTask } = require('../lib/opencode-sidecar');

test('call index refreshes immediately after edit, add and delete; file budgets stay independent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-index-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => fs.writeFileSync(path.join(root, name), text);
  write('a.js', 'export function alpha() { return 1; }');
  const initial = getCachedIndex(root);
  assert.equal(getCachedIndex(root), initial);
  write('a.js', 'export function beta() { return 22; }');
  assert.equal(queryCallTree(getCachedIndex(root), 'alpha').nodes, 0);
  assert.equal(queryCallTree(getCachedIndex(root), 'beta').nodes, 1);
  write('b.js', 'export function gamma() { return 3; }');
  assert.equal(getCachedIndex(root, { maxFiles: 1 }).files, 1);
  assert.equal(getCachedIndex(root, { maxFiles: 1 }).coverage.truncated, true);
  assert.equal(getCachedIndex(root).files, 2);
  fs.unlinkSync(path.join(root, 'b.js'));
  assert.equal(queryCallTree(getCachedIndex(root), 'gamma').nodes, 0);
});

test('ES and CommonJS aliases resolve original symbols; non-JS files do not consume calltree cap', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.py'), 'def unrelated():\n  pass\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'export function original() { return 1; }');
  fs.writeFileSync(path.join(root, 'c.js'), "import { original as alias } from './b';\nfunction entry() { return alias(); }\n");
  fs.writeFileSync(path.join(root, 'd.js'), "const { original: renamed } = require('./b');\nfunction cjsEntry() { return renamed(); }\n");
  const index = getCachedIndex(root, { maxFiles: 3 });
  assert.equal(index.files, 3);
  assert.equal(index.coverage.truncated, false);
  assert.match(queryCallTree(index, 'entry').text, /original.*b\.js/);
  assert.match(queryCallTree(index, 'cjsEntry').text, /original.*b\.js/);
  const map = buildRepoMap(root, { maxFiles: 2 });
  assert.equal(map.coverage.truncated, true);
  assert.match(map.text, /scan limit reached/);
});

test('successful handshakes cannot replenish a flapping stream retry budget', () => {
  let now = 0;
  const budget = new StreamReconnectBudget({ limit: 3, stableMs: 100, now: () => now });
  for (let i = 0; i < 3; i++) {
    assert.equal(budget.take(), true);
    budget.connected();
    now += 10;
    budget.progress();
  }
  assert.equal(budget.take(), false);
  now += 100;
  budget.progress();
  assert.equal(budget.take(), true);
});

test('admission blocks unfinished/self dependencies and duplicate active ids', () => {
  const plan = { id: 'feature', dependsOn: ['schema'] };
  const records = [{ callId: 'a', plan: { id: 'schema' }, status: 'running' }];
  assert.equal(taskAdmission(records, { plan }).granted, false);
  records[0].status = 'error';
  assert.equal(taskAdmission(records, { plan }).granted, false);
  records[0].status = 'completed';
  assert.equal(taskAdmission(records, { plan }).granted, true);
  records[0].outputTail = '<task state="running">';
  assert.equal(taskAdmission(records, { plan }).granted, false);
  assert.equal(taskAdmission([], { plan: { id: 'x', dependsOn: ['x'] } }).granted, false);
  assert.equal(taskAdmission([{ plan, callId: 'b', status: 'running' }], { plan }).granted, false);
  assert.equal(taskAdmission([], {}).granted, true);
});

test('partial terminal updates preserve delegation metadata and release acceptance correctly', () => {
  const run = { subagentTasks: [] };
  recordSubagentTask(run, { state: { input: { subagent_type: 'builder', prompt: 'yan-plan: {"id":"feature","dependsOn":["schema"]}' } } }, 'running', 'a');
  const done = recordSubagentTask(run, { state: { output: 'done' } }, 'completed', 'a');
  assert.equal(done.role, 'builder');
  assert.equal(done.plan.id, 'feature');
  assert.deepEqual(done.plan.dependsOn, ['schema']);
});

test('missed task input is recovered by call id and history lookup is cancellable', async () => {
  const part = { tool: 'task', callID: 'wanted', state: { input: { prompt: 'yan-plan: {"id":"child"}' } } };
  const client = { session: { messages: async () => ({ data: [{ parts: [part] }] }) } };
  assert.equal(await recoverTaskInput(client, { callId: 'wanted' }), part);
  assert.equal(await recoverTaskInput(client, { callId: 'different' }), null);
  const controller = new AbortController();
  const pending = recoverTaskInput({ session: { messages: () => new Promise(() => {}) } }, { signal: controller.signal });
  controller.abort();
  assert.equal(await pending, null);
});

test('child history cancellation returns promptly even for a non-cooperative client, with no late events', async () => {
  const events = [];
  const bridge = new SubagentEventBridge({ sessionID: 'parent', childSessions: new Map(), onEvent: event => events.push(event) });
  bridge.register('child');
  let complete;
  let receivedSignal;
  const client = { session: { messages: (_args, options) => {
    receivedSignal = options.signal;
    return new Promise(resolve => { complete = resolve; });
  } } };
  const controller = new AbortController();
  const result = bridge.catchUp(client, [], { signal: controller.signal, timeoutMs: 1000 });
  controller.abort();
  await result;
  assert.equal(receivedSignal.aborted, true);
  complete({ data: [{ info: { role: 'assistant' }, parts: [] }] });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.length, 0);
});

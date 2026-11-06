'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { resolveScheduledTaskContext } = require('../lib/scheduled-task-context');
const { combineTurnPrompt, turnContextSystem } = require('../lib/kernel-policy');
const { startRun } = require('../lib/run-orchestrator');
const { createRunContext } = require('./helpers/run-context.cjs');

const task = { id: 'sched-reminder', description: '提醒我玩宝宝少年' };
const session = { id: 'session-reminder', scheduledTaskId: task.id, memoryEnabled: false };
const store = { get: id => id === task.id ? task : null };

test('automatic/manual executions and unmarked resends recover intent from authoritative task records', () => {
  const auto = resolveScheduledTaskContext({ prompt: task.description, scheduledTaskId: task.id, scheduledRunAt: 123 }, session, store);
  assert.equal(auto.execution, true);
  assert.equal(auto.scheduledRunAt, 123);
  const resend = resolveScheduledTaskContext({ prompt: ` ${task.description} ` }, session, store);
  assert.equal(resend.execution, true);
  assert.equal(resend.scheduledRunAt, undefined);
  const followup = resolveScheduledTaskContext({ prompt: '为什么上次失败了？' }, session, store);
  assert.equal(followup.execution, false);
  assert.equal(resolveScheduledTaskContext({ prompt: task.description }, {}, store), null);
  assert.equal(resolveScheduledTaskContext({ utility: true, prompt: task.description }, session, store), null);
  assert.equal(resolveScheduledTaskContext({}, session, { get: () => null }), null);
  assert.equal(resolveScheduledTaskContext({ scheduledTaskId: 'another-task', scheduledRunAt: 123, prompt: '你好' }, session, store).execution, false);
});

test('execution instructions reach both kernel instructions and new/reused-session prompts for every preset', () => {
  for (const preset of [{}, { agentPreset: 'daily' }, { agentPreset: 'minimal' }, { customAgent: { systemPrompt: 'Custom assistant' } }]) {
    const request = { ...preset, prompt: task.description,
      scheduledTaskContext: resolveScheduledTaskContext({ prompt: task.description }, session, store),
      history: [{ role: 'assistant', content: '旧任务出错，我继续查日志。' }] };
    const instructions = turnContextSystem(request);
    assert.match(instructions, /final reply in this conversation IS the reminder/);
    assert.match(instructions, /Do not call tools or discover/);
    assert.match(instructions, /requires current facts, a condition check, or an external action/);
    for (const includeHistory of [false, true]) {
      const prompt = combineTurnPrompt(request, task.description, includeHistory);
      assert.match(prompt, /historical context, not work to resume/);
      assert.equal(prompt.split('<yan-scheduled-task-execution>').length, 2);
      assert.ok(prompt.includes(task.description));
    }
  }
  const followup = { scheduledTaskContext: resolveScheduledTaskContext({ prompt: '帮我查失败原因' }, session, store) };
  assert.match(turnContextSystem(followup), /user follow-up/);
  assert.doesNotMatch(turnContextSystem(followup), /<yan-scheduled-task-execution>/);
  assert.doesNotMatch(turnContextSystem({}), /yan-scheduled-task/);
});

test('real run admission delivers host-derived execution context to the provider', async t => {
  const fixture = createRunContext(t);
  fixture.ctx.scheduledTasksStore = store;
  fixture.ctx.sessionStore.readSessionRecord = async () => session;
  const result = await startRun(fixture.ctx, {
    runId: 'scheduled-execution', yanSessionId: session.id, prompt: task.description,
    scheduledTaskContext: { execution: false, description: 'untrusted renderer context' }
  });
  assert.equal(result.ok, true, result.error);
  const request = fixture.calls.provider[0].request;
  assert.equal(request.scheduledTaskContext.execution, true);
  assert.equal(request.scheduledTaskContext.description, task.description);
  assert.match(turnContextSystem(request), /one short sentence and end the turn/);
  fixture.complete({ status: 'done', text: '该玩宝宝少年了！' });
  await fixture.idle;
});

test('renderer forwards scheduled markers and excludes only synthetic creation history', async () => {
  const source = fs.readFileSync(path.join(__dirname, '../renderer/renderer.js'), 'utf8');
  const start = source.indexOf('async function runOpenCodeLoop(');
  const end = source.indexOf('\n}', start) + 2;
  assert.ok(start >= 0 && end > start);
  let sent, complete;
  const scope = vm.createContext({
    api: { openCodeStartRun: async request => { sent = request; complete({ result: { textContent: '该玩宝宝少年了！' } }); return { ok: true }; } },
    lastKnownOpenCodeSessionId: () => '', createRendererRunId: () => 'run-1',
    initOpenCodeRunState: () => {},
    attachOpenCodeRunEventListeners: (_ctx, callback) => { complete = callback; return () => {}; },
    openCodeResultToAgentRun: result => result,
    normalizeSkillCalls: calls => calls, extractMediaAssetsFromAgentRun: () => [],
    rejectStartedOpenCodeRunIfAborted: async () => {}, syncSessionOpenCodeIdAfterRun: () => {}
  });
  vm.runInContext(source.slice(start, end), scope);
  const priorRun = { role: 'assistant', content: '上次提醒' };
  await scope.runOpenCodeLoop({ ...session, messages: [
    { role: 'user', content: task.description },
    { role: 'assistant', content: '你的定时任务已建好', scheduledTask: { id: task.id } },
    priorRun,
    { role: 'user', content: task.description, scheduledTaskId: task.id, scheduledRunAt: 123 }
  ] }, null, {});
  assert.equal(sent.scheduledTaskId, task.id);
  assert.equal(sent.scheduledRunAt, 123);
  assert.equal(sent.prompt, task.description);
  assert.equal(sent.history.length, 1);
  assert.equal(sent.history[0].content, priorRun.content);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ModelLoopWatch } = require('../lib/model-loop-watch');
const { normalizeGeneralPreferences } = require('../lib/general-preferences');
const { startRun } = require('../lib/run-orchestrator');
const { createRunContext } = require('./helpers/run-context.cjs');

const thinking = (delta, id = 'r') => ({ type: 'session.next.reasoning.delta', data: { reasoningID: id, delta } });
function tool(watch, id, { name = 'read', input = { path: 'a' }, output = 'missing', ok = false } = {}, settings) {
  watch.observe({ type: 'session.next.tool.called', data: { callID: id, tool: name, input } }, settings);
  return watch.observe({ type: ok ? 'session.next.tool.success' : 'session.next.tool.failed', data: { callID: id, result: output } }, settings);
}

test('stream reasoning detection crosses chunk boundaries, warns once, and rearms after progress', () => {
  let time = 100_000;
  const watch = new ModelLoopWatch({ now: () => time });
  const text = '现在检查同一个问题，然后再次检查。'.repeat(30);
  const notices = [];
  for (let i = 0; i < text.length; i += 7) {
    const notice = watch.observe(thinking(text.slice(i, i + 7)));
    if (notice) notices.push(notice);
  }
  assert.equal(notices.length, 1);
  assert.equal(notices[0].data.kind, 'reasoning');
  assert.match(notices[0].data.message, /任务仍在继续/);
  assert.equal(watch.observe(thinking(text)), null);
  watch.observe(thinking('新的分析已经取得进展，下一步采用新的方案。'.repeat(7)));
  time += 61_000;
  assert.ok(watch.observe(thinking(text)));
});

test('normal changing reasoning and small repetitions stay quiet; short token floods are detected', () => {
  const watch = new ModelLoopWatch();
  assert.equal(watch.observe(thinking('ok go '.repeat(4))), null);
  for (let i = 0; i < 50; i++) assert.equal(watch.observe(thinking(`当前分析步骤 ${i}，根据新结果继续处理。`)), null);
  assert.ok(watch.observe(thinking('ok go '.repeat(80))));
});

test('authoritative snapshots and legacy mirror deltas do not multiply reasoning', () => {
  const watch = new ModelLoopWatch();
  const text = '分析步骤。'.repeat(10);
  watch.observe(thinking(text));
  for (let i = 0; i < 20; i++) {
    assert.equal(watch.observe({ type: 'message.part.updated', data: { part: { id: 'r', type: 'reasoning', text } } }), null);
    assert.equal(watch.observe({ type: 'message.part.delta', data: { partID: 'r', field: 'text', delta: text } }), null);
  }
  assert.equal(watch.reasoning.get('r').length, text.length);
  const rewritten = '新的思考内容';
  watch.observe({ type: 'session.next.reasoning.ended', data: { reasoningID: 'r', text: rewritten } });
  assert.equal(watch.reasoning.get('r').tail, rewritten);
});

test('tool failures repeat only with the same effective input and result; successful unchanged reads also warn', () => {
  for (const ok of [false, true]) {
    const watch = new ModelLoopWatch();
    for (let i = 0; i < 4; i++) assert.equal(tool(watch, String(i), { ok }), null);
    assert.equal(tool(watch, '4', { ok }).data.kind, 'tool');
    assert.equal(tool(watch, '5', { ok }), null);
  }
  const watch = new ModelLoopWatch();
  for (let i = 0; i < 30; i++) assert.equal(tool(watch, String(i), { input: { path: `file-${i}` } }), null);
  for (let i = 30; i < 60; i++) assert.equal(tool(watch, String(i), { output: `result-${i}` }), null);
});

test('alternating tool cycles and canonical argument keys are detected', () => {
  const watch = new ModelLoopWatch();
  let notice;
  for (let i = 0; i < 10; i++) {
    const result = tool(watch, String(i), { name: i % 2 ? 'inspect' : 'read', input: i % 4 < 2 ? { a: 1, b: 2 } : { b: 2, a: 1 } });
    if (result) notice = result;
  }
  assert.equal(notice.data.period, 2);
});

test('duplicate completed tool events do not count as new calls', () => {
  const watch = new ModelLoopWatch();
  for (let i = 0; i < 20; i++) assert.equal(tool(watch, 'same'), null);
  for (let i = 0; i < 4; i++) {
    const event = { type: 'message.part.updated', data: { part: { id: `p${i}`, callID: `c${i}`, type: 'tool', tool: 'read', state: { status: 'error', input: { path: 'a' }, error: 'missing' } } } };
    const result = watch.observe(event);
    if (i === 3) assert.ok(result);
    else assert.equal(result, null);
    assert.equal(watch.observe(event), null);
  }
});

test('waiting tools and real effects interrupt a tool cycle; unchanged todos do not reset it', () => {
  const watch = new ModelLoopWatch();
  for (let i = 0; i < 30; i++) assert.equal(tool(watch, String(i), { name: 'wait_external_task', ok: true }), null);
  for (let i = 30; i < 34; i++) assert.equal(tool(watch, String(i)), null);
  watch.observe({ type: 'file.edited', data: { file: 'a' } });
  assert.equal(tool(watch, '37'), null);
  const todo = { type: 'todo.updated', data: { todos: [{ text: 'check', status: 'pending' }] } };
  watch.observe(todo);
  let notice;
  for (let i = 40; i < 45; i++) {
    watch.observe(todo);
    notice = tool(watch, String(i));
  }
  assert.ok(notice);
});

test('disable resets state, threshold is fixed at five despite legacy settings, and runs are isolated', () => {
  const watch = new ModelLoopWatch();
  assert.equal(watch.observe(thinking('ok go '.repeat(300)), { loopNotification: false }), null);
  for (let i = 1; i < 5; i++) assert.equal(tool(watch, String(i), {}, { loopRepeatCount: 3 }), null);
  assert.equal(tool(watch, '5', {}, { loopRepeatCount: 20 }).data.repeats, 5);
  assert.equal(tool(new ModelLoopWatch(), '4'), null);
  assert.equal(normalizeGeneralPreferences({}).loopNotification, true);
  assert.equal(normalizeGeneralPreferences({ loopNotification: false }).loopNotification, false);
  assert.equal(Object.hasOwn(normalizeGeneralPreferences({ loopRepeatCount: 2 }), 'loopRepeatCount'), false);
});

test('real orchestrator reports loops while the provider continues and completes normally', async t => {
  const fixture = createRunContext(t);
  fixture.config.general = { loopNotification: true };
  assert.equal((await startRun(fixture.ctx, { runId: 'loop', utility: true, prompt: 'check' })).ok, true);
  const emit = fixture.calls.provider[0].emit;
  emit(thinking('反复检查相同的问题。'.repeat(40)));
  assert.equal(fixture.calls.events.filter(({ event }) => event.type === 'yan.model.loop-warning').length, 1);
  assert.equal(fixture.ctx.openCodeActiveRuns.size, 1);
  emit({ type: 'session.next.text.delta', data: { textID: 'answer', delta: '继续工作并完成' } });
  fixture.complete({ status: 'done', text: '正常完成' });
  await fixture.idle;
  assert.equal(fixture.calls.completed[0].result.status, 'done');
  assert.equal(fixture.calls.provider.length, 1);
});

'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createReasoningSummaries, generateSummary } = require('../lib/reasoning-summary');
const { combineSystem } = require('../lib/opencode-sidecar');
const ended = (id, text = '已确认配置使用旧端口，准备修改。') => ({ type: 'message.part.updated', data: { part: {
  id, messageID: 'm1', type: 'reasoning', text, time: { end: 1 }
} } });
const textEnd = (text, messageID = 'm1') => ({ type: 'message.part.updated', data: { part: {
  id: 'text1', messageID, type: 'text', text, time: { end: 2 }
} } });
function fixture(options = {}) {
  const events = [], calls = [];
  const coordinator = createReasoningSummaries({
    getClient: () => ({}), dataDir: os.tmpdir(), request: { prompt: '修改端口' },
    emit: event => events.push(event.data), graceMs: 10000,
    generate: async input => { calls.push(input); return '已确认旧端口，准备修改配置'; },
    ...options
  });
  return { coordinator, events, calls };
}

test('reply preferences reach the model and disabled summaries make no requests', async () => {
  const system = combineSystem({ replyVerbosity: 'high', reasoningSummary: 'none' });
  assert.match(system, /Give detailed, well-organized replies/);
  assert.doesNotMatch(system, /推理意图行（常驻规则）/);
  const { coordinator, events, calls } = fixture({ request: { reasoningSummary: 'none' } });
  coordinator.observe(ended('off'));
  await coordinator.finish();
  assert.deepEqual(events, []);
  assert.deepEqual(calls, []);
});

test('all reply detail choices produce distinct instructions and default adds none', () => {
  const patterns = { low: /Keep replies concise/, medium: /moderate level of detail/, high: /Give detailed, well-organized replies/ };
  for (const [replyVerbosity, pattern] of Object.entries(patterns)) assert.match(combineSystem({ replyVerbosity }), pattern);
  assert.doesNotMatch(combineSystem({ replyVerbosity: 'default' }), /Keep replies concise|moderate level of detail|Give detailed, well-organized replies/);
});

test('summary detail modes reach the actual summary request', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-summary-modes-'));
  try {
    for (const [reasoningSummary, pattern] of [['auto', /由你根据工作内容选择摘要详细程度/], ['concise', /最多30字/], ['detailed', /最多160字/]]) {
      let prompt;
      const client = { session: {
        create: async () => ({ data: { id: 'summary' } }),
        prompt: async args => { prompt = args; return { data: { parts: [{ type: 'text', text: '已核对配置，准备验证。' }] } }; },
        delete: async () => {}, abort: async () => {}
      } };
      await generateSummary({ client, directory, request: { reasoningSummary }, content: '配置事实', signal: new AbortController().signal });
      assert.match(prompt.system, pattern);
    }
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test('missing intent invokes the model once per stable segment, including duplicate event formats', async () => {
  const { coordinator: q, events, calls } = fixture();
  q.observe(ended('r1'));
  q.observe(ended('r1'));
  q.observe({ type: 'session.next.reasoning.ended', data: { reasoningID: 'r1', text: '重复内容' } });
  await q.finish();
  assert.equal(calls.length, 1);
  assert.match(calls[0].content, /旧端口/);
  assert.deepEqual(events.map(e => e.summaryStatus), ['pending', 'ready']);
  assert.equal(events[1].key, 'reasoning:r1');
  assert.equal(events[1].summarySource, 'generated');
});

test('explicit native intent avoids a second request; ordinary prose does not', async () => {
  const first = fixture();
  first.coordinator.observe(ended('r1'));
  first.coordinator.observe(textEnd('意图：已确认旧端口，准备修改配置'));
  await first.coordinator.finish();
  assert.equal(first.calls.length, 0);
  assert.equal(first.events.at(-1).summarySource, 'native');
  const second = fixture();
  second.coordinator.observe(ended('r1'));
  second.coordinator.observe(textEnd('修改完成。'));
  await second.coordinator.finish();
  assert.equal(second.calls.length, 1);
});

test('live completion generates a summary without waiting for run finalization', async () => {
  let resolveReady;
  const ready = new Promise(resolve => { resolveReady = resolve; });
  const { coordinator: q } = fixture({ graceMs: 0, emit: event => {
    if (event.data.summaryStatus === 'ready') resolveReady(event.data);
  } });
  try {
    q.observe(ended('live-segment'));
    const summary = await ready;
    assert.equal(summary.key, 'reasoning:live-segment');
    assert.equal(summary.summarySource, 'generated');
  } finally { q.close(); }
});

test('intent cannot cross tool or message boundaries', async () => {
  for (const boundary of ['tool', 'message']) {
    const { coordinator: q, calls } = fixture();
    q.observe(ended('r1'));
    if (boundary === 'tool') q.observe({ type: 'session.next.tool.called', data: { callID: 'c1' } });
    q.observe(textEnd('意图：这属于后面的工作', boundary === 'message' ? 'm2' : 'm1'));
    await q.finish();
    assert.equal(calls.length, 1);
  }
});

test('out-of-order model replies stay bound to their own IDs', async () => {
  const resolvers = [];
  const { coordinator: q, events } = fixture({ generate: ({content}) => new Promise(resolve => resolvers.push({resolve, content})) });
  q.observe(ended('r1', '第一段'));
  q.observe(ended('r2', '第二段'));
  const done = q.finish();
  await new Promise(resolve => setImmediate(resolve));
  resolvers[1].resolve('第二段的摘要');
  resolvers[0].resolve('第一段的摘要');
  await done;
  assert.deepEqual(events.filter(e => e.summaryStatus === 'ready').map(e => [e.key, e.summary]), [
    ['reasoning:r2', '第二段的摘要'], ['reasoning:r1', '第一段的摘要']
  ]);
});

test('timeout and cancellation terminate pending state and suppress late replies', async () => {
  let late;
  const { coordinator: q, events } = fixture({ timeoutMs: 20, generate: () => new Promise(resolve => { late = resolve; }) });
  q.observe(ended('r1'));
  await q.finish();
  assert.equal(events.at(-1).summaryStatus, 'failed');
  late('迟到的摘要');
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(events.at(-1).summaryStatus, 'failed');
  const abort = new AbortController();
  const cancelled = fixture({ signal: abort.signal });
  cancelled.coordinator.observe(ended('r2'));
  abort.abort();
  await cancelled.coordinator.finish();
  assert.equal(cancelled.calls.length, 0);
  assert.equal(cancelled.events.at(-1).summaryStatus, 'failed');
});

test('final snapshots and tagged thinking both receive durable timeline keys', async () => {
  const { coordinator: q, events, calls } = fixture();
  await q.finish([{ info: {id:'m1'}, parts: [
    {id:'r1',type:'reasoning',text:'没有结束事件的思考'},
    {id:'t1',type:'text',text:'<thinking>内嵌思考</thinking>正文'}
  ] }]);
  assert.equal(calls.length, 2);
  assert.deepEqual(events.filter(e => e.summaryStatus === 'ready').map(e => e.key), ['reasoning:r1', 'tagged-thinking:t1']);
});

test('model errors do not fail the main run or invent a summary', async () => {
  const { coordinator: q, events } = fixture({ generate: async () => { throw new Error('provider down'); } });
  q.observe(ended('r1'));
  await q.finish();
  assert.equal(events.at(-1).summaryStatus, 'failed');
  assert.equal(events.at(-1).summary, '');
});

test('summary uses the selected model in an isolated session with tools denied and cleanup', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-summary-test-'));
  const calls = [];
  const client = { session: {
    create: async args => { calls.push(['create', args]); return {data:{id:'summary-only'}}; },
    prompt: async args => { calls.push(['prompt', args]); return {data:{parts:[{type:'reasoning',text:'不应作为正文'}, {type:'text',text:'已确认问题，准备修复'}]}}; },
    delete: async args => { calls.push(['delete', args]); },
    abort: async () => {}
  } };
  try {
    const summary = await generateSummary({client, directory, request:{providerId:'selected',modelId:'chosen',prompt:'修复'},content:'本段事实',signal:new AbortController().signal});
    assert.equal(summary, '已确认问题，准备修复');
    assert.deepEqual(calls[0][1].permission, [{permission:'*',pattern:'*',action:'deny'}]);
    const prompt = calls.find(([name]) => name === 'prompt')[1];
    assert.equal(prompt.sessionID, 'summary-only');
    assert.deepEqual(prompt.tools, {'*':false});
    assert.deepEqual(prompt.model, {providerID:'selected',modelID:'chosen'});
    assert.equal(JSON.parse(prompt.parts[0].text).segment, '本段事实');
    assert.equal(calls.at(-1)[0], 'delete');
  } finally { fs.rmSync(directory, {recursive:true,force:true}); }
});

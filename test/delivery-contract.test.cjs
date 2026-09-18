'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseText, StreamTracker, stripReviews, stripProtocolBlocks } = require('../lib/delivery-contract');

const contract = '<yan-delivery-contract>\nintent: presentable（单文件）\nartifact: frontend\nscope: 2D 鹈鹕骑自行车 HTML\ndirection:\n海边悠闲骑行\ndecisions:\n- 近景快、远景慢\n- 踩踏与车轮协调\nacceptance: 观察主体和运动关系\n</yan-delivery-contract>';

test('multiline creative decisions and partial revisions share one schema', () => {
  const parsed = parseText(contract);
  assert.equal(parsed.intent, 'presentable');
  assert.equal(parsed.direction, '海边悠闲骑行');
  assert.equal(parsed.decisions, '- 近景快、远景慢\n- 踩踏与车轮协调');
  const revised = parseText(contract + '\n<yan-delivery-contract>\ndirection: 公园骑行\n</yan-delivery-contract>');
  assert.equal(revised.direction, '公园骑行');
  assert.equal(revised.scope, parsed.scope);
  assert.equal(revised.decisions, parsed.decisions);
  assert.equal(parseText('<yan-delivery-contract>\nintent: invalid\n</yan-delivery-contract>'), null);
});

test('streaming publishes a contract once it closes and keeps later revisions', () => {
  const tracker = new StreamTracker();
  const publish = text => tracker.observe({ type: 'message.part.updated', data: { part: { id: 'p1', type: 'text', text } } });
  assert.equal(publish(contract.slice(0, -4)), null);
  const ready = tracker.observe({ type: 'message.part.delta', data: { partID: 'p1', field: 'text', delta: contract.slice(-4) } });
  assert.equal(ready.direction, '海边悠闲骑行');
  assert.equal(publish(contract), null);
  assert.equal(tracker.observe({ type: 'message.part.updated', data: { part: {
    id: 'p2', type: 'text', text: '<yan-delivery-contract>\ndirection: 公园骑行\n</yan-delivery-contract>'
  } } }).scope, ready.scope);
  assert.equal(tracker.contract.direction, '公园骑行');
});

test('reasoning and tool outputs cannot create a delivery contract', () => {
  const tracker = new StreamTracker();
  assert.equal(tracker.observe({ type: 'message.part.updated', data: { part: { id: 'thinking', type: 'reasoning', text: contract } } }), null);
  assert.equal(tracker.observe({ type: 'message.part.delta', data: { partID: 'thinking', field: 'text', delta: contract } }), null);
  assert.equal(tracker.observe({ type: 'message.part.updated', data: { part: { id: 'tool', type: 'tool', state: { output: contract } } } }), null);
  assert.equal(tracker.contract, null);
});

test('review records stay out of narration even while their opening tag streams', () => {
  const opening = '<yan-delivery-review>';
  for (let length = 1; length <= opening.length; length++) {
    assert.equal(stripReviews('正文\n' + opening.slice(0, length)), '正文\n');
  }
  assert.equal(stripReviews('正文<yan-delivery-review>{"criteria":{}}</yan-delivery-review>结论'), '正文结论');
});

test('stripProtocolBlocks removes contract and review blocks in any state', () => {
  assert.equal(stripProtocolBlocks('前文\n' + contract + '\n后文'), '前文\n\n后文');
  assert.equal(stripProtocolBlocks('前文<yan-delivery-review>{"criteria":{}}</yan-delivery-review>后文'), '前文后文');
  assert.equal(stripProtocolBlocks('正文<yan-delivery-contract>\nintent: presentable'), '正文');
  assert.equal(stripProtocolBlocks('正文<yan-delivery-cont'), '正文');
  assert.equal(stripProtocolBlocks('普通正文'), '普通正文');
});

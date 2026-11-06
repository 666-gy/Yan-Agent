'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require('node:path').join(__dirname, '../renderer/renderer.js'), 'utf8');
const context = vm.createContext({ getAgentTimelinePartKey: (item, index) => item.openCodeKey || String(index) });
vm.runInContext(source.slice(source.indexOf('const BUILTIN_BROWSER_ACCEPTANCE_TOOLS =')), context);
const classify = context.browserAcceptanceTarget;
const group = parts => context.groupBrowserAcceptanceParts(parts);
const call = (purpose = 'frontend_acceptance', name = 'browser_snapshot', target = 'http://localhost:3000') => ({ type: 'tool_call', name, args: { purpose, acceptance: { target, check: 'Verify navigation and narrow layout' } } });
const part = (item, index) => ({ item, index });
test('acceptance requires explicit intent, known built-in tool and concrete criteria', () => {
  assert.equal(classify(call()), 'http://localhost:3000');
  assert.equal(classify(call('frontend_acceptance', 'yan_browser_browser_screenshot')), 'http://localhost:3000');
  for (const purpose of [undefined, 'browsing', 'website_operation']) {
    const item = call(); item.args.purpose = purpose;
    assert.equal(classify(item), '');
  }
  assert.equal(classify(call('frontend_acceptance', 'external_browser_snapshot')), '');
  assert.equal(classify(call('frontend_acceptance', 'browser_search_history')), '');
  const search = call('frontend_acceptance', 'open_builtin_browser'); search.args.target_type = 'search';
  assert.equal(classify(search), '');
  const missing = call(); delete missing.args.acceptance;
  assert.equal(classify(missing), '');
  const blank = call(); blank.args.acceptance.check = ' ';
  assert.equal(classify(blank), '');
});
test('grouping isolates ordinary operations, target changes and final answer', () => {
  const text = content => ({ type: 'text', content, stage: 'work' });
  const result = group([part(call(), 0), part(text('Inspect layout'), 1), part(call(), 2), part(call('website_operation'), 3), part(call(), 4), part(call('frontend_acceptance', 'browser_click', 'other preview'), 5), part({ ...text('Done'), stage: 'summary' }, 6)]);
  assert.deepEqual(Array.from(result, p => p.item.type), ['browser_acceptance_group', 'tool_call', 'browser_acceptance_group', 'browser_acceptance_group', 'text']);
  assert.equal(result[0].item.items.length, 3);
  assert.equal(result[2].item.items.length, 1);
  const tail = group([part(call(), 0), part(text('Now researching'), 1), part(call('browsing'), 2)]);
  assert.equal(tail[0].item.items.length, 2);
  assert.equal(tail[1].item.type, 'tool_call');
});
test('mixed groups and computer control are never swallowed; replay is deterministic', () => {
  const parts = [part({ type: 'tool_group', calls: [{ item: call() }, { item: call('browsing') }] }, 0), part({ type: 'computer_control_group', items: [] }, 1)];
  assert.deepEqual(Array.from(group(parts), p => p.item.type), ['tool_group', 'computer_control_group']);
  const input = [part(call(), 0), part(call(), 1)];
  assert.equal(JSON.stringify(group(input)), JSON.stringify(group(JSON.parse(JSON.stringify(input)))));
});

test('every streaming prefix keeps narration inside acceptance before the next tool arrives', () => {
  for (const type of ['text', 'thinking', 'thinking_group', 'progress']) {
    const input = [part(call(), 0), part({ type, stage: 'work', content: 'Checking', streaming: true }, 1)];
    const during = group(input);
    assert.equal(during.length, 1);
    assert.equal(during[0].item.items[1], input[1]);
    input[1].item.streaming = false;
    input.push(part(call(), 2));
    const after = group(input);
    assert.equal(after[0].item.openCodeKey, during[0].item.openCodeKey);
    assert.equal(after[0].item.items[1], input[1]);
    input.push(part(call('browsing'), 3));
    assert.equal(group(input)[0].item.items.length, 3);
  }
});

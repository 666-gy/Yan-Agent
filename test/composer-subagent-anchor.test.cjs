'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../renderer/renderer.js'), 'utf8');

function harness({ hidden = false, view = 'subagent', caret = 7 } = {}) {
  const menu = { dataset: { view }, classList: { contains: () => hidden } };
  const context = vm.createContext({
    composerSubagentQueryAnchor: 0,
    composerSubagentQueryEnd: 5,
    composerSubagentQuery: 'plan',
    composerSubagentTriggerOffset: 0,
    composerLastCaretTextOffset: 5,
    renders: 0,
    skillResets: 0,
    $: () => menu,
    getComposerCaretTextOffset: () => caret,
    resetComposerSkillQueryAnchor() { context.skillResets++; },
    input: { addEventListener(event, handler) { context.pointerup = handler; } }
  });
  const start = source.indexOf("input.addEventListener('pointerup',");
  assert.ok(start >= 0);
  const listener = source.slice(start, source.indexOf('\n});', start) + 4);
  vm.runInContext(listener, context);
  return context;
}

test('retired subagent picker no longer changes composer query state', () => {
  assert.doesNotMatch(source, /function (?:openComposerSubagentView|refreshComposerSubagentQuery|renderSubagentCallList|toggleComposerSubagent)\(/);
  for (const caret of [0, 7, 12]) {
    const ctx = harness({ caret });
    assert.doesNotThrow(() => ctx.pointerup());
    assert.equal(ctx.composerLastCaretTextOffset, caret);
    assert.equal(ctx.composerSubagentQueryAnchor, 0);
    assert.equal(ctx.composerSubagentQueryEnd, 5);
    assert.equal(ctx.renders, 0);
  }
});

test('closed picker does not reset query and skill picker retains its own handler', () => {
  const closed = harness({ hidden: true });
  closed.pointerup();
  assert.equal(closed.composerSubagentQuery, 'plan');
  assert.equal(closed.renders, 0);
  const skill = harness({ view: 'skill' });
  skill.pointerup();
  assert.equal(skill.skillResets, 1);
  assert.equal(skill.renders, 0);
});

'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const {
  combineSystem,
  combineTurnPrompt,
  subagentSystem,
  repoMapSystem,
  recordSubagentTask
} = require('../lib/opencode-sidecar');

test('repo map snapshot is injected into the current turn only when a map is present', () => {
  const request = { repoMap: 'repo map: 2 code files\n  src/index.js  [0.5]  main' };
  const withMap = combineTurnPrompt(request, 'Inspect the project.');
  assert.ok(withMap.includes('<yan-repo-map>'));
  assert.ok(withMap.includes('src/index.js  [0.5]'));
  assert.ok(withMap.includes('code_impact'));
  assert.ok(!combineTurnPrompt({}, 'Inspect the project.').includes('<yan-repo-map>'));
  assert.ok(!combineSystem(request).includes('<yan-repo-map>'));
  assert.equal(repoMapSystem({ repoMap: '' }), '');
});

test('subagent guidance documents the plan marker and worktree isolation', () => {
  const system = subagentSystem({});
  assert.ok(system.includes('yan-plan: {"id"'));
  assert.ok(system.includes('worktree_create'));
  assert.ok(system.includes('worktree_merge'));
});

test('recordSubagentTask upserts by callId and keeps the parsed plan', () => {
  const run = { subagentTasks: [] };
  const part = {
    type: 'tool',
    tool: 'task',
    callID: 'call-9',
    state: {
      status: 'running',
      input: { subagent_type: 'builder', description: 'Wire sidebar', prompt: 'yan-plan: {"id":"sidebar","acceptance":"npm test passes"}\nDo it.' }
    }
  };
  const running = recordSubagentTask(run, part, 'running', 'call-9');
  assert.equal(run.subagentTasks.length, 1);
  assert.equal(running.plan?.id, 'sidebar');

  part.state.status = 'completed';
  part.state.output = 'sidebar wired; 3 files changed';
  const done = recordSubagentTask(run, part, 'completed', 'call-9');
  assert.equal(run.subagentTasks.length, 1, 'updates must not duplicate records');
  assert.equal(done.status, 'completed');
  assert.ok(done.outputTail.includes('3 files changed'));
});


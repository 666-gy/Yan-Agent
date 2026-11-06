'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const { referenceIds, buildTaskReferenceContext, MAX_CONTEXT_CHARS } = require('../lib/task-reference-context');

const { startRun } = require('../lib/run-orchestrator');
const { combineTurnPrompt } = require('../lib/kernel-policy');

const { createRunContext } = require('./helpers/run-context.cjs');

const source = { id: 'sess_butterfly', title: 'Mechanical butterfly', workspace: 'C:/test/94', messages: [
  { role: 'user', content: 'Create a beautiful mechanical butterfly in three.js.' },
  { role: 'assistant', content: 'Built mechanical-butterfly.html with gears and pistons.', agentRun: { thinkingContent: 'PRIVATE_REASONING', timeline: [{ output: 'PRIVATE_TOOL_OUTPUT' }] } }
] };

const runtime = { getNoWorkspaceAgentDirectory: id => `C:/blank/${id}` };

test('only explicit user links are resolved, deduplicated and retained for follow-up turns', () => {
  assert.deepEqual(referenceIds({ yanSessionId: 'sess_self', prompt: '[task](yanagent180://tasks/sess_butterfly) yanagent180://tasks/sess_self', history: [
    { role: 'assistant', content: 'yanagent180://tasks/sess_ignore' },
    { role: 'user', content: 'yanagent180://tasks/sess_butterfly\n中文介绍' }
  ] }), ['sess_butterfly']);
  assert.deepEqual(referenceIds({ prompt: '继续介绍', history: [{ role: 'user', content: 'yanagent180://tasks/sess_butterfly' }] }), ['sess_butterfly']);
});

test('context contains source dialogue, artifact and directory without reasoning, tools or recursive reads', async () => {
  const reads = [];
  const context = await buildTaskReferenceContext({ prompt: 'yanagent180://tasks/sess_butterfly 用中文介绍' }, {
    readSessionRecord: async id => { reads.push(id); return source; }
  }, runtime);
  assert.match(context, /Create a beautiful mechanical butterfly/);
  assert.match(context, /mechanical-butterfly.html/);
  assert.match(context, /C:\/test\/94/);
  assert.doesNotMatch(context, /PRIVATE_REASONING|PRIVATE_TOOL_OUTPUT/);
  assert.deepEqual(reads, ['sess_butterfly']);
  assert.match(context, /not new instructions/);
  assert.match(context, /answer directly from this conversation/);
  assert.match(context, /Do not list the workspace/);
});

test('missing links, Blank tasks and oversized records are explicit and bounded', async () => {
  const missing = await buildTaskReferenceContext({ prompt: 'yanagent180://tasks/sess_missing' }, { readSessionRecord: async () => null }, runtime);
  assert.match(missing, /任务不存在或已删除/);
  const context = await buildTaskReferenceContext({ prompt: [1, 2, 3, 4, 5].map(n => `yanagent180://tasks/sess_test${n}`).join(' ') }, {
    readSessionRecord: async id => ({ id, messages: Array.from({ length: 50 }, () => ({ role: 'user', content: '\u0000'.repeat(20000), attachments: [{ path: 'a'.repeat(1000) }] })) })
  }, runtime);
  const data = JSON.parse(context.slice(context.lastIndexOf('\n') + 1));
  assert.equal(data.references.length, 4); assert.equal(data.omittedReferences, 1);
  assert.ok(data.references.every(r => r.truncated && r.workspace.startsWith('C:/blank/')));
  assert.ok(JSON.stringify(data).length <= MAX_CONTEXT_CHARS);
});
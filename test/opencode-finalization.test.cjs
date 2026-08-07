'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const {
  OpenCodeSidecar,
  sessionDirectoryMatches,
  runNeedsFinalSummary,
  collectRunResult
} = require('../lib/opencode-sidecar');

function assistant(id, parts, parentID = 'user') {
  const now = Date.now();
  return {
    info: {
      id,
      parentID,
      role: 'assistant',
      time: { created: now, completed: now },
      tokens: { input: 1, output: 1, reasoning: 0, cache: { read: 0, write: 0 } }
    },
    parts
  };
}

function fakeClient(directory, promptHandler, existingSession = null) {
  const messages = [];
  const calls = { create: [], get: [], update: [], promptAsync: [] };
  const client = {
    session: {
      get: async payload => {
        calls.get.push(payload);
        return { data: existingSession };
      },
      create: async payload => {
        calls.create.push(payload);
        return { data: { id: 'workspace-session', directory: payload.directory } };
      },
      update: async payload => {
        calls.update.push(payload);
        return { data: { ...existingSession, permission: payload.permission } };
      },
      messages: async () => ({ data: messages }),
      status: async () => ({ data: { 'workspace-session': { type: 'idle' } } }),
      promptAsync: async payload => {
        calls.promptAsync.push(payload);
        const next = promptHandler(payload, calls.promptAsync.length, messages);
        if (next) messages.push(next);
        return { data: true };
      },
      todo: async () => ({ data: [] }),
      diff: async () => ({ data: [] })
    },
    event: {
      subscribe: async () => ({
        stream: (async function* emptyStream() {})()
      })
    }
  };
  return { client, calls, messages, directory };
}

test('matches OpenCode sessions to their creation directory', () => {
  const workspace = path.resolve('workspace-a');
  assert.equal(sessionDirectoryMatches({ directory: workspace }, workspace), true);
  assert.equal(sessionDirectoryMatches({ directory: path.resolve('blank') }, workspace), false);
  assert.equal(sessionDirectoryMatches({}, workspace), false);
});

test('requires a summary after tools or an empty work response, but not after a direct answer', () => {
  assert.equal(runNeedsFinalSummary({ usedTools: true, lastAssistant: assistant('tool', []) }), true);
  assert.equal(runNeedsFinalSummary({ lastAssistant: assistant('empty', []) }), true);
  assert.equal(runNeedsFinalSummary({ lastAssistant: assistant('answer', [{ type: 'text', text: '完成' }]) }), false);
});

test('collects the explicitly settled summary assistant instead of an adjacent empty message', () => {
  const messages = [
    assistant('summary', [{ type: 'text', text: '已完成并验收。' }]),
    assistant('late-empty', [])
  ];
  const result = collectRunResult(messages, new Set(), [[]], [], { workMode: 'normal' }, 'session', {
    started: true,
    finalAssistantID: 'summary'
  });
  assert.equal(result.status, 'done');
  assert.equal(result.text, '已完成并验收。');
});

test('creates a workspace-bound session when a Yan task leaves Blank', async () => {
  const directory = path.resolve('workspace-target');
  const fixture = fakeClient(directory, (_payload, call) => (
    call === 1 ? assistant('direct-answer', [{ type: 'text', text: '已进入工作区。' }]) : null
  ), { id: 'blank-session', directory: path.resolve('blank-runtime') });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    finalTextSettleTimeoutMs: 5
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'workspace-switch',
    openCodeSessionId: 'blank-session',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '继续',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal',
    history: [{ role: 'user', content: '此前任务上下文' }]
  });

  assert.equal(fixture.calls.update.length, 0);
  assert.equal(fixture.calls.create.length, 1);
  assert.equal(fixture.calls.create[0].directory, directory);
  assert.equal(result.openCodeSessionId, 'workspace-session');
  assert.equal(result.text, '已进入工作区。');
});

test('disables tools in finalization and retries one empty summary response', async () => {
  const directory = path.resolve('summary-workspace');
  const fixture = fakeClient(directory, (_payload, call) => {
    if (call === 1) {
      return assistant('work-tool', [{
        type: 'tool',
        tool: 'bash',
        callID: 'call-1',
        state: { status: 'completed', input: { command: 'Get-Location' }, output: directory }
      }]);
    }
    if (call === 2) return assistant('empty-summary', []);
    if (call === 3) return assistant('final-summary', [{ type: 'text', text: '环境检查完成。' }]);
    return null;
  });
  const sidecar = new OpenCodeSidecar({
    appRoot: process.cwd(),
    dataDir: process.cwd(),
    finalTextSettleTimeoutMs: 5
  });
  sidecar.client = fixture.client;
  sidecar.start = async () => ({ ok: true });

  const result = await sidecar.run({
    runId: 'summary-retry',
    workspace: directory,
    hasUserWorkspace: true,
    prompt: '检查环境',
    providerId: 'deepseek',
    modelId: 'deepseek-v4-flash',
    workMode: 'normal'
  });

  assert.equal(fixture.calls.promptAsync.length, 3);
  assert.deepEqual(fixture.calls.promptAsync[1].tools, { '*': false });
  assert.deepEqual(fixture.calls.promptAsync[2].tools, { '*': false });
  assert.equal(result.summaryStarted, true);
  assert.equal(result.status, 'done');
  assert.equal(result.text, '环境检查完成。');
});

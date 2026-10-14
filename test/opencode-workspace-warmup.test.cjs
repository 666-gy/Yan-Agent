'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { warmOpenCodeWorkspace } = require('../lib/opencode-workspace-warmup');

test('shared warmup waits for MCP and reuses only the same client and workspace', async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let calls = 0;
  const client = {
    tool: { ids: async () => ({ data: ['read'] }) },
    mcp: { status: async () => { calls++; await gate; return { data: {} }; } }
  };
  const first = warmOpenCodeWorkspace(client, 'workspace');
  assert.equal(warmOpenCodeWorkspace(client, 'workspace'), first);
  let finished = false;
  first.then(() => { finished = true; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(finished, false);
  release();
  await first;
  await warmOpenCodeWorkspace(client, 'workspace');
  assert.equal(calls, 1);
  await warmOpenCodeWorkspace(client, 'another-workspace');
  await warmOpenCodeWorkspace({ ...client }, 'workspace');
  assert.equal(calls, 3);
});

test('failed warmup is evicted for retry; disconnected MCP status is not an API failure', async () => {
  let calls = 0;
  const client = { mcp: { status: async () => ++calls === 1
    ? { error: { message: 'temporary transport failure' } }
    : { data: { optional: { status: 'failed', error: 'server unavailable' } } } } };
  await assert.rejects(warmOpenCodeWorkspace(client, 'workspace'), /temporary transport failure/);
  await warmOpenCodeWorkspace(client, 'workspace');
  assert.equal(calls, 2);
});

'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { waitForMcp } = require('../lib/kernel-v2/mcp-readiness');

const config = names => ({ mcp: { servers: Object.fromEntries(names.map(name => [name, {}])) } });

test('reconnects a failed MCP server before admitting the turn', async () => {
  let status = 'failed';
  let connects = 0;
  let disconnects = 0;
  const client = {
    mcp: {
      list: async () => ({ data: [{ name: 'yan_web', status: { status } }] }),
      disconnect: async input => {
        assert.equal(input.server, 'yan_web');
        disconnects += 1;
      },
      connect: async input => {
        assert.equal(input.server, 'yan_web');
        assert.equal(input.location.directory, 'C:/workspace');
        connects += 1;
        status = 'connected';
      }
    }
  };
  await waitForMcp(client, config(['yan_web']), 'C:/workspace', () => false, { timeoutMs: 2000, maxReconnects: 2 });
  assert.equal(disconnects, 1);
  assert.equal(connects, 1);
});

test('keeps needs_auth and disabled servers fail-closed without reconnecting', async () => {
  for (const status of ['needs_auth', 'disabled']) {
    let connects = 0;
    const client = {
      mcp: {
        list: async () => ({ data: [{ name: 'auth', status: { status, error: 'login' } }] }),
        connect: async () => { connects += 1; }
      }
    };
    await assert.rejects(
      () => waitForMcp(client, config(['auth']), 'C:/workspace', () => false, { timeoutMs: 500 }),
      new RegExp(status)
    );
    assert.equal(connects, 0);
  }
});

test('stops after bounded reconnect attempts instead of looping forever', async () => {
  let connects = 0;
  const client = {
    mcp: {
      list: async () => ({ data: [{ name: 'broken', status: { status: 'failed', error: 'boom' } }] }),
      connect: async () => { connects += 1; }
    }
  };
  await assert.rejects(
    () => waitForMcp(client, config(['broken']), 'C:/workspace', () => false, {
      timeoutMs: 3000, maxReconnects: 2, reconnectDelays: [1, 1]
    }),
    /已自动重连 2 次仍失败/
  );
  assert.equal(connects, 2);
});

test('retries a transient mcp.list failure until the server answers', async () => {
  let lists = 0;
  const client = {
    mcp: {
      list: async () => {
        lists += 1;
        if (lists < 3) throw new Error('transport not ready');
        return { data: [{ name: 'yan_web', status: { status: 'connected' } }] };
      },
      connect: async () => {}
    }
  };
  await waitForMcp(client, config(['yan_web']), 'C:/workspace', () => false, { timeoutMs: 2000 });
  assert.equal(lists, 3);
});

test('reconnect can be disabled for callers that need the old fail-fast behavior', async () => {
  let connects = 0;
  const client = {
    mcp: {
      list: async () => ({ data: [{ name: 'yan_web', status: { status: 'failed' } }] }),
      connect: async () => { connects += 1; }
    }
  };
  await assert.rejects(
    () => waitForMcp(client, config(['yan_web']), 'C:/workspace', () => false, { timeoutMs: 500, reconnect: false }),
    /failed/
  );
  assert.equal(connects, 0);
});

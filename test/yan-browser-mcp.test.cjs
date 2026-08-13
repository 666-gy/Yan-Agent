'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');

async function startBridge() {
  const requests = [];
  const closedOperations = new Set();
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let input = '';
    let operationId = '';
    socket.on('data', chunk => {
      input += chunk;
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(input.slice(0, newline));
      operationId = String(request.operationId || '');
      requests.push(request);
      if (request.action === 'status') {
        socket.end(`${JSON.stringify({ ok: true, result: { ok: true, url: 'https://example.test/' } })}\n`);
      }
    });
    socket.on('close', () => {
      if (operationId) closedOperations.add(operationId);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, requests, closedOperations };
}

function startMcp(port) {
  const child = spawn(process.execPath, [path.join(appRoot, 'lib', 'yan-browser-mcp.js')], {
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_BROWSER_BRIDGE_PORT: String(port),
      YAN_BROWSER_BRIDGE_TOKEN: 'test-token',
      YAN_BROWSER_ALLOW_NETWORK: 'true'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffered += chunk;
    while (buffered.includes('\n')) {
      const newline = buffered.indexOf('\n');
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 5_000);
    pending.set(id, message => {
      clearTimeout(timer);
      resolve(message);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
  return { child, send, request };
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Condition was not met before timeout.');
}

test('Yan browser MCP transports operation identity and cancellation', async t => {
  const bridge = await startBridge();
  const mcp = startMcp(bridge.port);
  t.after(() => {
    mcp.child.kill();
    bridge.server.close();
  });

  const initialized = await mcp.request(1, 'initialize', { protocolVersion: '2025-03-26' });
  assert.equal(initialized.result.serverInfo.name, 'Yan Built-in Browser');
  const listed = await mcp.request(2, 'tools/list');
  const snapshot = listed.result.tools.find(tool => tool.name === 'browser_snapshot');
  assert.match(snapshot.description, /latest snapshot/i);

  const status = await mcp.request(3, 'tools/call', { name: 'browser_status', arguments: {} });
  assert.equal(status.result.structuredContent.url, 'https://example.test/');
  assert.match(bridge.requests[0].operationId, /^browser-/);
  assert.equal(bridge.requests[0].token, 'test-token');

  const waiting = mcp.request(4, 'tools/call', { name: 'browser_wait', arguments: { timeout_ms: 5000 } });
  await waitFor(() => bridge.requests.some(request => request.action === 'wait'));
  const waitRequest = bridge.requests.find(request => request.action === 'wait');
  mcp.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 4 } });
  const cancelled = await waiting;
  assert.equal(cancelled.result.isError, true);
  assert.equal(cancelled.result.structuredContent.code, 'BROWSER_ACTION_CANCELLED');
  await waitFor(() => bridge.closedOperations.has(waitRequest.operationId));
});

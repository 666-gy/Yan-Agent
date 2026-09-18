'use strict';

const assert = require('node:assert/strict');
const http = require('node:http');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const sidecar = require(path.join(appRoot, 'lib', 'opencode-sidecar.js'));
const remote = require(path.join(appRoot, 'lib', 'mcp-remote.js'));

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise(resolve => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, url: `http://127.0.0.1:${server.address().port}/mcp` });
    });
  });
}

function close(server) {
  return new Promise(resolve => server.close(resolve));
}

function readBody(request) {
  return new Promise(resolve => {
    let body = '';
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => resolve(body));
  });
}

const TOOLS = [
  { name: 'remote_ping', description: 'Ping', inputSchema: { type: 'object', properties: {} } },
  { name: 'remote_echo', description: 'Echo', inputSchema: { type: 'object', properties: {} } }
];

test('sidecar maps remote MCP servers into the OpenCode remote config', () => {
  const config = sidecar.buildOpenCodeConfig({
    mcpServers: [
      {
        id: 'remote-one',
        name: 'Remote One',
        type: 'remote',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer sk-test', 'X-Extra': '1' },
        enabled: true
      },
      { id: 'local-one', name: 'Local One', command: 'node', args: ['server.js'], enabled: true },
      { id: 'disabled-remote', name: 'Disabled', type: 'remote', url: 'https://mcp.example.com/off', enabled: false },
      { id: 'bad-url', name: 'Bad', type: 'remote', url: 'ftp://example.com/mcp', enabled: true },
      { id: 'url-without-type', name: 'No type', url: 'https://mcp.example.com/no-type', enabled: true }
    ]
  });

  assert.deepEqual(config.mcp['local-one'], {
    type: 'local',
    command: ['node', 'server.js'],
    enabled: true,
    timeout: 30_000
  });
  assert.equal(config.mcp['remote-one'].type, 'remote');
  assert.equal(config.mcp['remote-one'].url, 'https://mcp.example.com/mcp');
  assert.deepEqual(config.mcp['remote-one'].headers, { Authorization: 'Bearer sk-test', 'X-Extra': '1' });
  assert.equal(config.mcp['remote-one'].enabled, true);
  assert.equal(config.mcp['url-without-type'].type, 'remote');
  assert.equal(config.mcp['disabled-remote'], undefined);
  assert.equal(config.mcp['bad-url'], undefined);

  // Remote servers get a task permission rule; invalid ones do not.
  assert.equal(config.agent.build.permission['remote-one_*'], 'ask');
  assert.equal(config.agent.build.permission['bad-url_*'], undefined);
  assert.equal(config.agent.build.permission['disabled-remote_*'], undefined);
});

test('remote probe completes initialize -> initialized -> tools/list over JSON', async () => {
  const seen = [];
  const { server, url } = await listen(async (request, response) => {
    const body = await readBody(request);
    const message = JSON.parse(body);
    seen.push({
      method: message.method,
      session: String(request.headers['mcp-session-id'] || ''),
      protocol: String(request.headers['mcp-protocol-version'] || ''),
      auth: String(request.headers.authorization || '')
    });
    if (message.method === 'initialize') {
      response.writeHead(200, { 'content-type': 'application/json', 'mcp-session-id': 'sess-42' });
      response.end(JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'fake-remote', version: '1.0.0' }
        }
      }));
      return;
    }
    if (message.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (message.method === 'tools/list') {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS } }));
      return;
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const result = await remote.probeRemoteServer({
      type: 'remote',
      url,
      headers: { Authorization: 'Bearer probe' }
    });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.tools.length, 2);
    assert.equal(result.tools[0].name, 'remote_ping');
    assert.equal(result.serverInfo.name, 'fake-remote');

    const initialized = seen.find(entry => entry.method === 'initialize');
    assert.equal(initialized.auth, 'Bearer probe');
    const listed = seen.find(entry => entry.method === 'tools/list');
    assert.equal(listed.session, 'sess-42');
    assert.equal(listed.protocol, '2025-03-26');
    assert.ok(seen.some(entry => entry.method === 'notifications/initialized'));
  } finally {
    await close(server);
  }
});

test('remote probe reads a Streamable HTTP SSE response', async () => {
  const { server, url } = await listen(async (request, response) => {
    const body = await readBody(request);
    const message = JSON.parse(body);
    if (message.method === 'initialize') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`event: message\ndata: ${JSON.stringify({
        jsonrpc: '2.0',
        id: message.id,
        result: {
          protocolVersion: '2025-03-26',
          capabilities: {},
          serverInfo: { name: 'sse-remote', version: '1.0.0' }
        }
      })}\n\n`);
      response.end();
      return;
    }
    if (message.method === 'notifications/initialized') {
      response.writeHead(202);
      response.end();
      return;
    }
    if (message.method === 'tools/list') {
      response.writeHead(200, { 'content-type': 'text/event-stream' });
      response.write(`data: ${JSON.stringify({ jsonrpc: '2.0', id: message.id, result: { tools: TOOLS.slice(0, 1) } })}\n\n`);
      response.end();
      return;
    }
    response.writeHead(404);
    response.end();
  });
  try {
    const result = await remote.probeRemoteServer({ type: 'remote', url });
    assert.equal(result.ok, true, result.error);
    assert.equal(result.tools.length, 1);
    assert.equal(result.tools[0].name, 'remote_ping');
  } finally {
    await close(server);
  }
});

test('remote probe reports auth and connection failures with actionable text', async () => {
  const unauthorized = await listen((request, response) => {
    response.writeHead(401, { 'content-type': 'application/json' });
    response.end('{"error":"unauthorized"}');
  });
  const missing = await listen((request, response) => {
    response.writeHead(404);
    response.end();
  });
  try {
    const auth = await remote.probeRemoteServer({ type: 'remote', url: unauthorized.url });
    assert.equal(auth.ok, false);
    assert.match(auth.error, /401/);

    const gone = await remote.probeRemoteServer({ type: 'remote', url: missing.url });
    assert.equal(gone.ok, false);
    assert.match(gone.error, /404/);

    const invalid = await remote.probeRemoteServer({ type: 'remote', url: 'notaurl' });
    assert.equal(invalid.ok, false);
    assert.match(invalid.error, /http/);
  } finally {
    await close(unauthorized.server);
    await close(missing.server);
  }
});

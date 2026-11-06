'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const SERVER = path.resolve(__dirname, '..', 'lib', 'yan-provider-mcp.js');
const TOKEN = 'provider-bridge-token';

async function startFakeBridge(onRequest) {
  const requests = [];
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let buffer = '';
    socket.on('data', chunk => {
      buffer += chunk;
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(buffer.slice(0, newline).trim());
      requests.push(request);
      const response = onRequest(request);
      socket.end(`${JSON.stringify(response)}\n`);
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, requests, port: server.address().port };
}

function startServer(port, env = {}) {
  const child = spawn(process.execPath, [SERVER], {
    env: {
      ...process.env,
      YAN_PROVIDER_BRIDGE_PORT: String(port),
      YAN_PROVIDER_BRIDGE_TOKEN: TOKEN,
      ...env
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  const pending = new Map();
  let buffer = '';
  let nextId = 1;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });
  const request = (method, params) => new Promise(resolve => {
    const id = nextId++;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request, stop: () => child.kill() };
}

function structured(response) {
  return response.result?.structuredContent;
}

test('Yan Provider exposes the natural-language configuration tool', async t => {
  const bridge = await startFakeBridge(() => ({ ok: true, result: {} }));
  t.after(() => bridge.server.close());
  const client = startServer(bridge.port);
  t.after(() => client.stop());

  const listed = await client.request('tools/list');
  const names = listed.result.tools.map(tool => tool.name);
  assert.deepEqual(names, [
    'list_provider_connections',
    'test_provider_connection',
    'configure_provider',
    'remove_provider_connection'
  ]);
  const configure = listed.result.tools.find(tool => tool.name === 'configure_provider');
  assert.match(configure.description, /Base URL/);
  assert.deepEqual(configure.inputSchema.required, ['base_url']);
  assert.ok(configure.inputSchema.properties.image_models);
  assert.ok(configure.inputSchema.properties.api_key);
});

test('configure_provider forwards the user request to the main-process bridge', async t => {
  const bridge = await startFakeBridge(() => ({
    ok: true,
    result: {
      ok: true,
      verified: true,
      connection: { id: 'conn-1', name: '示例中转', apiKeyMasked: 'sk-t…7890' },
      models: [{ id: 'gpt-image-1', modelType: 'image' }],
      roles: { image: 'gpt-image-1' },
      missingModels: []
    }
  }));
  t.after(() => bridge.server.close());
  const client = startServer(bridge.port);
  t.after(() => client.stop());

  const response = await client.request('tools/call', {
    name: 'configure_provider',
    arguments: {
      name: '示例中转',
      base_url: 'https://api.example.com/v1',
      api_key: 'sk-test-1234567890',
      image_models: ['gpt-image-1']
    }
  });

  assert.equal(bridge.requests.length, 1);
  const request = bridge.requests[0];
  assert.equal(request.token, TOKEN);
  assert.equal(request.action, 'provider.configure');
  assert.equal(request.params.base_url, 'https://api.example.com/v1');
  assert.equal(request.params.api_key, 'sk-test-1234567890');
  assert.deepEqual(request.params.image_models, ['gpt-image-1']);

  const result = structured(response);
  assert.equal(result.ok, true);
  assert.equal(result.connection.apiKeyMasked, 'sk-t…7890');
  assert.equal(JSON.stringify(result).includes('sk-test-1234567890'), false);
});

test('bridge errors surface as tool errors instead of a false success', async t => {
  const bridge = await startFakeBridge(() => ({
    ok: false,
    error: '缺少 API Key：请让用户提供该服务商的密钥。',
    code: 'YAN_PROVIDER_BAD_INPUT'
  }));
  t.after(() => bridge.server.close());
  const client = startServer(bridge.port);
  t.after(() => client.stop());

  const response = await client.request('tools/call', {
    name: 'configure_provider',
    arguments: { base_url: 'https://api.example.com/v1' }
  });
  assert.equal(response.result.isError, true);
  assert.match(structured(response).error, /API Key/);
});

test('a missing bridge is reported instead of silently doing nothing', async t => {
  const client = startServer(0);
  t.after(() => client.stop());
  const response = await client.request('tools/call', {
    name: 'list_provider_connections',
    arguments: {}
  });
  assert.equal(response.result.isError, true);
  assert.match(structured(response).error, /桥接/);
});

test('network-denied runs cannot probe or write a provider', async t => {
  const bridge = await startFakeBridge(() => ({ ok: true, result: { ok: true } }));
  t.after(() => bridge.server.close());
  const client = startServer(bridge.port, { YAN_PROVIDER_ALLOW_NETWORK: 'false' });
  t.after(() => client.stop());

  const response = await client.request('tools/call', {
    name: 'configure_provider',
    arguments: { base_url: 'https://api.example.com/v1', api_key: 'sk-x' }
  });
  assert.equal(response.result.isError, true);
  assert.match(structured(response).error, /网络/);
  assert.equal(bridge.requests.length, 0);
});

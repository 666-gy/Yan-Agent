'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');

function createClient(runtime, dataDir) {
  const child = spawn(process.execPath, [path.join(appRoot, 'lib', 'yan-media-mcp.js')], {
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_MEDIA_DATA_DIR: dataDir,
      YAN_MEDIA_RUNTIME: Buffer.from(JSON.stringify(runtime), 'utf8').toString('base64')
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (line) {
        const message = JSON.parse(line);
        pending.get(message.id)?.(message);
        pending.delete(message.id);
      }
      newline = buffer.indexOf('\n');
    }
  });
  let nextId = 1;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`MCP request timed out: ${method}`)), 5000);
    pending.set(id, message => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request };
}

test('Yan Media exposes read_image by default and reports missing visual relay configuration', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-mcp-'));
  const client = createClient({
    access: { workspace: '', accessMode: 'request', allowFileRead: true, allowNetwork: true },
    vision: { providerId: 'agnes', baseUrl: 'https://apihub.agnes-ai.com/v1', apiKey: '' }
  }, dataDir);
  t.after(() => {
    client.child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const listed = await client.request('tools/list');
  const tool = listed.result.tools.find(item => item.name === 'read_image');
  assert.ok(tool);
  assert.equal(tool.inputSchema.properties.path.type, 'string');
  assert.equal(tool.inputSchema.properties.generated_image_id.type, 'string');
  assert.equal(tool.description.includes('Do not call it as a routine read-back after generate_image succeeds'), true);
  const called = await client.request('tools/call', {
    name: 'read_image',
    arguments: { generated_image_id: '0123456789abcdef0123456789abcdef' }
  });
  assert.equal(called.result.isError, true);
  assert.equal(called.result.structuredContent.error, '通用读图工具需要先配置可用的视觉中继模型');
});

test('Yan Media hides read_image when visual relay is disabled but keeps generation tools', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-mcp-'));
  const client = createClient({
    access: { workspace: '', accessMode: 'request', allowFileRead: true, allowNetwork: true },
    vision: { enabled: false, models: [] },
    image: {
      providerId: 'test',
      baseUrl: 'https://example.invalid/v1',
      apiKey: 'test-key',
      modelId: 'test-image-model'
    }
  }, dataDir);
  t.after(() => {
    client.child.kill();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const listed = await client.request('tools/list');
  const names = listed.result.tools.map(item => item.name);
  assert.equal(names.includes('read_image'), false);
  assert.equal(names.includes('generate_image'), true);
});

test('read_image prefers configured GLM models before falling back to Agnes', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-mcp-'));
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-workspace-'));
  const imagePath = path.join(workspace, 'test.png');
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      const payload = JSON.parse(body);
      requests.push({ model: payload.model, maxTokens: payload.max_tokens });
      if (payload.model === 'glm-5v-turbo') {
        response.writeHead(502, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'temporary gateway failure' } }));
        return;
      }
      if (payload.model === 'glm-4.6v-flash') {
        response.writeHead(429, { 'Content-Type': 'application/json' });
        response.end(JSON.stringify({ error: { message: 'rate limited' } }));
        return;
      }
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'Agnes 后备模型已读取图片。' } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const client = createClient({
    access: { workspace, accessMode: 'request', allowFileRead: true, allowNetwork: true },
    vision: {
      models: [
        {
          providerId: 'glm',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'glm-key',
          modelId: 'glm-5v-turbo'
        },
        {
          providerId: 'glm',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'glm-key',
          modelId: 'glm-4.6v-flash'
        },
        {
          providerId: 'agnes',
          baseUrl: `http://127.0.0.1:${port}/v1`,
          apiKey: 'agnes-key',
          modelId: 'agnes-2.5-flash'
        }
      ]
    }
  }, dataDir);
  t.after(() => {
    client.child.kill();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(workspace, { recursive: true, force: true });
  });
  const called = await client.request('tools/call', {
    name: 'read_image',
    arguments: { path: imagePath, prompt: '读取测试图片' }
  });
  assert.equal(called.result.isError, false);
  assert.equal(called.result.structuredContent.report, 'Agnes 后备模型已读取图片。');
  assert.equal(called.result.structuredContent.meta.observerProvider, 'agnes');
  assert.equal(called.result.structuredContent.meta.observerModel, 'agnes-2.5-flash');
  assert.equal(called.result.structuredContent.meta.fallback, true);
  assert.deepEqual(requests, [
    { model: 'glm-5v-turbo', maxTokens: 1024 },
    { model: 'glm-4.6v-flash', maxTokens: 1024 },
    { model: 'agnes-2.5-flash', maxTokens: 3000 }
  ]);
});

test('read_image keeps compatibility with the legacy Agnes relay configuration', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-mcp-'));
  const imageDir = path.join(dataDir, 'generated-images');
  fs.mkdirSync(imageDir, { recursive: true });
  const imagePath = path.join(imageDir, 'owned.png');
  fs.writeFileSync(imagePath, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const server = http.createServer((request, response) => {
    request.resume();
    request.on('end', () => {
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({ choices: [{ message: { content: 'Yan 图片可见。' } }] }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createClient({
    access: { workspace: '', accessMode: 'request', allowFileRead: true, allowNetwork: true },
    vision: {
      providerId: 'agnes',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: 'test-key',
      preferredModelId: 'agnes-2.5-flash',
      fallbackModelId: 'agnes-2.0-flash'
    }
  }, dataDir);
  t.after(() => {
    client.child.kill();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const called = await client.request('tools/call', {
    name: 'read_image',
    arguments: { path: imagePath }
  });
  assert.equal(called.result.isError, false);
  assert.equal(called.result.structuredContent.report, 'Yan 图片可见。');
});

test('generate_image normalizes SenseNova dimensions inside Yan Media', async t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-media-mcp-'));
  const requests = [];
  const server = http.createServer((request, response) => {
    let body = '';
    request.setEncoding('utf8');
    request.on('data', chunk => { body += chunk; });
    request.on('end', () => {
      requests.push(JSON.parse(body));
      response.writeHead(200, { 'Content-Type': 'application/json' });
      response.end(JSON.stringify({
        data: [{ b64_json: Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64') }]
      }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = createClient({
    access: { workspace: '', accessMode: 'request', allowFileRead: true, allowNetwork: true },
    image: {
      providerId: 'conn-sensenova',
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      apiKey: 'test-key',
      modelId: 'sensenova-u1-fast',
      strategy: 'chat',
      providerOptions: { adapterKind: 'openai' }
    }
  }, dataDir);
  t.after(() => {
    client.child.kill();
    server.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });

  const called = await client.request('tools/call', {
    name: 'generate_image',
    arguments: { prompt: '读取测试提示词', aspect_ratio: '16:9' }
  });
  assert.equal(called.result.isError, false);
  assert.equal(called.result.structuredContent.ok, true);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].size, '2752x1536');
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');
const { SideChat } = require('../lib/side-chat');

async function fixture(t, respond, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-parallel-steer-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    const finish = content => { send({ role: 'assistant', content }); send({}, 'stop'); res.end('data: [DONE]\n\n'); };
    respond(body, { send, finish, end: () => res.end('data: [DONE]\n\n') });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false,
    accessMode: 'full', enableSubagents: true, subagentMaxChildren: 10, ...overrides };
  return { adapter, request: { ...options, runId: 'probe', workspace: root, hasUserWorkspace: true,
    prompt: 'Dispatch independent children and summarize.', openCodeConfig: buildOpenCodeConfig(options) } };
}

test('native read image survives the desktop after hook and reaches the provider', { timeout: 30000 }, async t => {
  const requests = [];
  let screen;
  const { adapter, request } = await fixture(t, (body, stream) => {
    requests.push(body);
    if (requests.length === 1) {
      stream.send({ role: 'assistant', tool_calls: [{ index: 0, id: 'read_image', type: 'function', function: {
        name: 'read', arguments: JSON.stringify({ path: screen })
      } }] });
      stream.send({}, 'tool_calls'); stream.end();
    } else stream.finish('IMAGE_RECEIVED');
  }, { capabilities: { imageInput: true } });
  screen = path.join(request.workspace, 'screen.png');
  fs.writeFileSync(screen, Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAF0lEQVR4nGP4z8BAEiJN9aiGUQ1DSgMAkPn/Afnh+ngAAAAASUVORK5CYII=', 'base64'));
  const result = await adapter.run(request, event => {
    const data = event.properties || event.data;
    if (event.type === 'permission.asked') void adapter.replyPermission({ runId: 'probe', requestId: data.id, reply: 'once' });
  });
  assert.equal(result.status, 'done');
  assert.equal(requests.length, 2);
  assert.match(JSON.stringify(requests[1].messages), /Image read successfully/);
  assert.ok(requests[1].messages.some(message => Array.isArray(message.content) && message.content.some(part =>
    part.type === 'image_url' && part.image_url?.url?.startsWith('data:image/png;base64,'))),
  'the provider must receive image bytes, not just the successful read text');
});

test('Code Mode tools remain directly callable with no execute or catalog prompt', { timeout: 30000 }, async t => {
  const requests = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    requests.push(body);
    if (requests.length === 1) {
      stream.send({ role: 'assistant', tool_calls: [{ index: 0, id: 'resources', type: 'function', function: {
        name: 'opencode_list_mcp_resources', arguments: '{}'
      } }] });
      stream.send({}, 'tool_calls'); stream.end();
    } else stream.finish('DIRECT_RESOURCE_CALL_DONE');
  });
  const result = await adapter.run(request, event => {
    const data = event.properties || event.data;
    if (event.type === 'permission.asked') void adapter.replyPermission({ runId: 'probe', requestId: data.id, reply: 'once' });
  });
  assert.equal(result.status, 'done');
  assert.equal(requests.length, 2);
  const names = requests[0].tools.map(tool => tool.function.name);
  for (const name of ['opencode_list_mcp_resources', 'opencode_read_mcp_resource', 'opencode_models', 'glob']) assert.ok(names.includes(name), name);
  assert.ok(!names.includes('execute'));
  assert.ok(!names.includes('subagent'));
  for (const body of requests) assert.doesNotMatch(JSON.stringify(body.messages), /# Code Mode|Use the `execute` tool/);
  const returned = requests[1].messages.find(message => message.role === 'tool' && message.tool_call_id === 'resources');
  assert.ok(returned, 'direct tool result reaches the provider');
  assert.match(JSON.stringify(returned.content), /resources/);
  assert.doesNotMatch(JSON.stringify(returned.content), /Unknown tool|Tool not found/);
});

test('retired native subagent calls cannot create children even with legacy flags enabled', { timeout: 30000 }, async t => {
  const requests = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    requests.push(body);
    if (requests.length === 1) {
      stream.send({ role: 'assistant', tool_calls: [{ index: 0, id: 'retired', type: 'function', function: {
        name: 'subagent', arguments: JSON.stringify({ agent: 'builder', prompt: 'Create a child' })
      } }] });
      stream.send({}, 'tool_calls'); stream.end();
    } else stream.finish('CONTINUE_WITHOUT_CHILDREN');
  });
  const result = await adapter.run(request);
  assert.equal(result.status, 'done');
  assert.equal(requests.length, 2);
  for (const body of requests) assert.ok(!body.tools.some(tool => /^(?:opencode[._])?(subagent|task)$/.test(tool.function.name)));
  assert.match(JSON.stringify(requests[1].messages), /not found|unknown tool|not available/i);
  assert.deepEqual((await adapter.client.session.list({ parentID: result.openCodeSessionId })).data, []);
});

test('side chat guidance reaches the next real V2 provider request during an active response', { timeout: 30000 }, async t => {
  let first;
  const ready = new Promise(resolve => { first = resolve; });
  const requests = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    requests.push(body);
    if (requests.length === 1) { stream.send({ role: 'assistant', content: 'WORKING' }); first(stream); }
    else stream.finish('GUIDANCE_RECEIVED');
  });
  const running = adapter.run(request);
  const stream = await ready;
  const chat = new SideChat({ loadModel: async () => ({ options: {}, model: { doStream: async () => ({ stream: new ReadableStream({ start(controller) {
    controller.enqueue({ type: 'text-delta', delta: '{"mode":"steer"}' }); controller.close();
  } }) }) } }) });
  const delivered = await chat.send({ mode: 'auto', runId: 'probe', requestId: 'side', text: 'GUIDANCE_SENTINEL_8472' }, {
    owner: {}, runtime: {}, selection: { providerId: 'fixture', modelId: 'fixture', modelType: 'text' }, onEvent() {},
    steer: guidance => adapter.deliverInterjection('probe', { guidance })
  });
  stream.finish('FIRST_DONE');
  const result = await running;
  assert.equal(delivered.delivered, true);
  assert.equal(result.status, 'done');
  assert.ok(requests.slice(1).some(body => JSON.stringify(body.messages).includes('GUIDANCE_SENTINEL_8472')), `guidance absent from ${requests.length} provider requests`);
});

test('native media tools are exposed and execute without a Media MCP process', { timeout: 30000 }, async t => {
  const requests = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    requests.push(body);
    if (requests.length === 1) {
      stream.send({ role: 'assistant', tool_calls: [{ index: 0, id: 'media_read', type: 'function', function: {
        name: 'yan_media_read_image', arguments: JSON.stringify({ path: 'missing.png', prompt: 'Inspect' })
      } }] });
      stream.send({}, 'tool_calls'); stream.end();
    } else stream.finish('MEDIA_RUNTIME_REACHED');
  });
  request.openCodeConfig.yanMediaEnvironment = { YAN_MEDIA_DATA_DIR: request.workspace,
    YAN_MEDIA_RUNTIME: Buffer.from(JSON.stringify({access:{workspace:request.workspace,allowNetwork:true,allowFileRead:true},vision:{enabled:true,models:[]},video:{modelId:'fixture'}})).toString('base64') };
  const result = await adapter.run(request, event => {
    if (event.type === 'permission.asked') void adapter.replyPermission({ runId: 'probe', requestId: (event.properties || event.data).id, reply: 'once' });
  });
  assert.equal(result.status, 'done');
  const names = requests[0].tools.map(tool => tool.function.name);
  assert.ok(names.includes('yan_media_read_image'));
  assert.ok(names.includes('yan_media_generate_video'));
  assert.match(JSON.stringify(requests[1].messages), /missing|不存在|中继|视觉|ENOENT/);
  assert.ok(!Object.keys(request.openCodeConfig.mcp || {}).includes('yan_media'));
});

test('native image generation persists an asset and returns it to the model', { timeout: 30000 }, async t => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jq1kAAAAASUVORK5CYII=', 'base64');
  let generations = 0;
  const imageServer = http.createServer(async (req, res) => {
    for await (const chunk of req) {}
    generations++;
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ data: [{ b64_json: png.toString('base64') }] }));
  });
  await new Promise(resolve => imageServer.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => imageServer.close(resolve)));
  const requests = [];
  const { adapter, request } = await fixture(t, (body, stream) => {
    requests.push(body);
    if (requests.length === 1) {
      stream.send({ role: 'assistant', tool_calls: [{ index: 0, id: 'image_generation', type: 'function', function: {
        name: 'yan_media_generate_image', arguments: JSON.stringify({ prompt: 'A blue square', aspect_ratio: '1:1' })
      } }] });
      stream.send({}, 'tool_calls'); stream.end();
    } else stream.finish('IMAGE_GENERATED');
  });
  request.openCodeConfig.yanMediaEnvironment = { YAN_MEDIA_DATA_DIR: request.workspace,
    YAN_MEDIA_RUNTIME: Buffer.from(JSON.stringify({access:{workspace:request.workspace,allowNetwork:true,allowFileRead:true},vision:{enabled:false},
      image:{providerId:'openai',baseUrl:`http://127.0.0.1:${imageServer.address().port}/v1`,apiKey:'fixture',modelId:'gpt-image-test',strategy:'openai-images'}})).toString('base64') };
  const result = await adapter.run(request, event => {
    if (event.type === 'permission.asked') void adapter.replyPermission({ runId: 'probe', requestId: (event.properties || event.data).id, reply: 'once' });
  });
  assert.equal(result.status,'done');assert.equal(generations,1);
  assert.match(JSON.stringify(requests[1].messages),/generatedImageId/);
  assert.equal(fs.readdirSync(path.join(request.workspace,'generated-images')).length,1);
});

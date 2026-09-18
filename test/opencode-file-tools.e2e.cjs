'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, permissionRulesForRun } = require('../lib/opencode-sidecar');

const appRoot = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-file-tools-e2e-'));
const provider = 'yan-native-tools-test';
const models = ['gpt-5.3', 'gpt-4.1', 'deepseek-v4-flash', 'claude-sonnet-4-5', 'gemini-2.5-pro', 'qwen3.5-plus', 'arbitrary-custom-model'];
const writeTools = ['apply_patch', 'edit', 'write'];
const cases = new Map();
const failures = [];

function completion(response, message) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' });
  const payload = { id: 'native-tools-test', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
    model: 'test', choices: [{ index: 0, delta: { role: 'assistant', ...message }, finish_reason: null }] };
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
  payload.choices = [{ index: 0, delta: {}, finish_reason: message.tool_calls ? 'tool_calls' : 'stop' }];
  response.write(`data: ${JSON.stringify(payload)}\n\n`);
  response.end('data: [DONE]\n\n');
}

const server = http.createServer((request, response) => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    try {
      const body = JSON.parse(raw || '{}');
      const text = JSON.stringify(body.messages || []);
      const testCase = [...cases.values()].find(item => text.includes(item.marker));
      if (!testCase || !body.tools?.length) return completion(response, { content: 'Native tool test' });
      const names = body.tools.map(tool => tool.function?.name).filter(name => writeTools.includes(name)).sort();
      assert.deepEqual(names, testCase.denied ? [] : writeTools, `${testCase.marker}: outbound tools`);
      testCase.requests++;
      if (testCase.denied) return completion(response, { content: 'WRITE_TOOLS_DENIED' });
      const step = body.messages.filter(message => message.role === 'tool').length;
      const action = [
        ['write', { filePath: testCase.file, content: 'first\nsecond\n' }],
        ['read', { filePath: testCase.file }],
        ['edit', { filePath: testCase.file, oldString: 'first', newString: 'edited' }],
        ['apply_patch', { patchText: `*** Begin Patch\n*** Update File: ${testCase.file.replaceAll('\\', '/')}\n@@\n-second\n+patched\n*** End Patch` }],
        ['read', { filePath: testCase.file }]
      ][step];
      if (!action) return completion(response, { content: 'ALL_FILE_TOOLS_OK' });
      completion(response, { tool_calls: [{ index: 0, id: `call-${step}`, type: 'function',
        function: { name: action[0], arguments: JSON.stringify(action[1]) } }] });
    } catch (error) {
      failures.push(error);
      completion(response, { content: `TEST_FAILED: ${error.message}` });
    }
  });
});

function unwrap(result) {
  if (result.error) throw new Error(JSON.stringify(result.error));
  return result.data;
}

(async () => {
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir: path.join(directory, 'data') });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = buildOpenCodeConfig({ providerId: provider, modelId: models[0], accessMode: 'full',
      apiKey: 'local-test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      enableSubagents: false, mcpServers: [],
      capabilities: { contextWindow: 32768, maxOutputTokens: 8192 },
      permissions: { allowFileRead: true, allowFileWrite: true, allowNetwork: false } });
    for (const id of models.slice(1)) config.provider[provider].models[id] = { ...config.provider[provider].models[models[0]], id, name: id };
    await sidecar.start(config);
    assert.match(sidecar.server.executable, /all-file-tools-v1/);
    for (const model of models) {
      const tools = unwrap(await sidecar.client.tool.list({ directory, provider, model }));
      assert.deepEqual(tools.filter(tool => writeTools.includes(tool.id)).map(tool => tool.id).sort(), writeTools);
      const marker = `FILE_TOOL_CASE_${cases.size}`;
      const testCase = { marker, file: path.join(directory, `${cases.size}.txt`), requests: 0 };
      cases.set(marker, testCase);
      const session = unwrap(await sidecar.client.session.create({ directory }));
      const result = unwrap(await sidecar.client.session.prompt({ sessionID: session.id, directory,
        model: { providerID: provider, modelID: model }, agent: 'build',
        parts: [{ type: 'text', text: marker }] }, { signal: AbortSignal.timeout(45000) }));
      assert.ok(result.parts.some(part => part.type === 'text' && part.text.includes('ALL_FILE_TOOLS_OK')), JSON.stringify(result));
      assert.ok(testCase.requests >= 6);
      assert.equal(fs.readFileSync(testCase.file, 'utf8'), 'edited\npatched\n');
      const messages = unwrap(await sidecar.client.session.messages({ sessionID: session.id, directory }));
      const mutations = messages.flatMap(message => message.parts || []).filter(part => part.type === 'tool' && writeTools.includes(part.tool));
      assert.deepEqual(mutations.map(part => part.tool), ['write', 'edit', 'apply_patch']);
      assert.ok(mutations.every(part => part.state.status === 'completed'), JSON.stringify(mutations));
      console.log(`${model}: native write/edit/apply_patch executed`);
    }
    for (const workMode of ['normal', 'plan']) {
      const marker = `FILE_TOOL_CASE_${cases.size}`;
      const testCase = { marker, denied: true, requests: 0, file: path.join(directory, 'forbidden.txt') };
      cases.set(marker, testCase);
      const session = unwrap(await sidecar.client.session.create({ directory, permission: permissionRulesForRun({
        workMode, accessMode: 'full', hasUserWorkspace: true, permissions: { allowFileRead: true, allowFileWrite: false }
      }) }));
      const result = unwrap(await sidecar.client.session.prompt({ sessionID: session.id, directory,
        model: { providerID: provider, modelID: models[0] }, agent: workMode === 'plan' ? 'plan' : 'build',
        parts: [{ type: 'text', text: marker }] }, { signal: AbortSignal.timeout(45000) }));
      assert.ok(result.parts.some(part => part.type === 'text' && part.text.includes('WRITE_TOOLS_DENIED')), JSON.stringify(result));
      assert.equal(testCase.requests, 1);
      assert.equal(fs.existsSync(testCase.file), false);
    }
    assert.deepEqual(failures, []);
    console.log('Native file tools and read-only/plan permissions passed; no external model API used.');
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close();
    await stopped;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yan-file-tools-e2e-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

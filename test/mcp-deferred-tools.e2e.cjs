'use strict';

// Real kernel, MCP activation server, CodeGraph and DS adapter. Only model
// replies are scripted locally; inspect the actual outbound tool schemas.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, stageDeepSeekProviderModule } = require('../lib/opencode-sidecar');
const { resolveRuntime } = require('../lib/codegraph-runtime');

const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-deferred-tools-'));
const directory = path.join(root, 'workspace with spaces');
const dataDir = path.join(root, 'data');
const toolName = 'mcp_default_codegraph_codegraph_explore';
const errors = [];
const schemas = [];
const outputs = [];
let step = 0;
function completion(response, delta) {
  response.writeHead(200, { 'Content-Type': 'text/event-stream' });
  const chunk = { id: 'deferred-test', object: 'chat.completion.chunk', created: 1, model: 'deepseek-test',
    choices: [{ index: 0, delta: { role: 'assistant', ...delta }, finish_reason: null }] };
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  chunk.choices = [{ index: 0, delta: {}, finish_reason: delta.tool_calls ? 'tool_calls' : 'stop' }];
  response.write(`data: ${JSON.stringify(chunk)}\n\n`);
  response.end('data: [DONE]\n\n');
}
const server = http.createServer((request, response) => {
  let raw = '';
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    try {
      const body = JSON.parse(raw || '{}');
      if (!JSON.stringify(body.messages).includes('DEFERRED_SCHEMA_TEST') || !body.tools?.length) {
        return completion(response, { content: 'Test task' });
      }
      const names = body.tools.map(tool => tool.function.name);
      schemas.push(names);
      outputs.push(...body.messages.filter(message => message.role === 'tool').map(message => message.content));
      let action;
      if (step === 0) {
        assert.ok(!names.includes(toolName), 'CodeGraph must start deferred');
        action = ['yan_mcp_activate_mcp_server', { id: 'mcp_default_codegraph' }];
      } else if (step === 1) {
        assert.ok(names.includes(toolName), 'Activated CodeGraph schema missing from the SAME turn next DS request');
        action = [toolName, { query: 'deferredSchemaMarker', projectPath: directory }];
      } else {
        return completion(response, { content: 'DEFERRED_TOOLS_OK' });
      }
      step++;
      completion(response, { tool_calls: [{ index: 0, id: `deferred-${step}`, type: 'function',
        function: { name: action[0], arguments: JSON.stringify(action[1]) } }] });
    } catch (error) {
      errors.push(error);
      completion(response, { content: `TEST_FAILED: ${error.message}` });
    }
  });
});
function unwrap(response) {
  if (response.error) throw new Error(JSON.stringify(response.error));
  return response.data;
}
(async () => {
  fs.mkdirSync(directory, { recursive: true });
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(path.join(directory, 'marker.js'), 'function deferredSchemaMarker() { return 42; }\n');
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const runtime = resolveRuntime(appRoot);
    assert.equal(runtime.ok, true, runtime.error);
    const codegraph = { id: 'mcp_default_codegraph', command: runtime.command,
      args: [...runtime.args, 'serve', '--mcp'], env: runtime.env, enabled: true, deferred: true, timeout: 60000 };
    const configPath = path.join(dataDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ mcpServers: [codegraph] }));
    const config = buildOpenCodeConfig({ providerId: 'deepseek', modelId: 'deepseek-test', dsml: true,
      deepSeekProviderModule: stageDeepSeekProviderModule({ appRoot, dataDir }),
      apiKey: 'local-test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      accessMode: 'full', enableSubagents: false,
      capabilities: { reasoning: true, contextWindow: 32768, maxOutputTokens: 4096 },
      mcpServers: [codegraph, { id: 'yan_mcp', enabled: true, command: process.execPath,
        args: [path.join(appRoot, 'lib/yan-mcp-mcp.js')], env: {
          YAN_MCP_CONFIG_PATH: configPath, YAN_MCP_ALLOW_NETWORK: 'false',
          YAN_MCP_KERNEL_ENDPOINTS_DIR: path.join(dataDir, 'opencode-runtime/endpoints')
        } }]
    });
    await sidecar.start(config);
    const session = unwrap(await sidecar.client.session.create({ directory }));
    const result = unwrap(await sidecar.client.session.prompt({ sessionID: session.id, directory,
      model: { providerID: 'deepseek', modelID: 'deepseek-test' }, agent: 'build',
      parts: [{ type: 'text', text: 'DEFERRED_SCHEMA_TEST: activate CodeGraph, then call its explore tool.' }]
    }, { signal: AbortSignal.timeout(90000) }));
    if (errors.length) throw errors[0];
    assert.ok(result.parts.some(part => part.text?.includes('DEFERRED_TOOLS_OK')));
    const messages = unwrap(await sidecar.client.session.messages({ sessionID: session.id, directory }));
    const calls = messages.flatMap(message => message.parts || []).filter(part => part.type === 'tool');
    assert.deepEqual(calls.map(call => call.tool), ['yan_mcp_activate_mcp_server', toolName]);
    assert.ok(calls.every(call => call.state.status === 'completed'), JSON.stringify(calls));
    assert.equal(schemas.length, 3);
    const activeStatus = unwrap(await sidecar.client.mcp.status({ directory }));
    assert.equal(activeStatus.mcp_default_codegraph.status, 'connected');
    const otherDirectory = path.join(root, 'unrelated workspace');
    fs.mkdirSync(otherDirectory);
    const otherStatus = unwrap(await sidecar.client.mcp.status({ directory: otherDirectory }));
    assert.equal(otherStatus.mcp_default_codegraph.status, 'disabled', 'Activation must not leak into another directory');
    console.log('PASS: deferred CodeGraph schema reaches the next DS request and explore executes in the same turn.');
  } catch (error) {
    console.error('Tool outputs:', outputs);
    throw error;
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close();
    await stopped;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

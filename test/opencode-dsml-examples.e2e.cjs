'use strict';

// Exercise the staged provider, real kernel, tool loop and sidecar without
// calling an external model or touching the user's sessions.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig } = require('../lib/opencode-sidecar');

const appRoot = path.resolve(__dirname, '..');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-dsml-examples-'));
const file = path.join(directory, 'adapter.txt');
fs.writeFileSync(file, 'DSML adapter reference for planning.\n');
const marker = 'DSML_EXAMPLE_REGRESSION';
const tag = '<｜｜DSML｜｜tool_calls>';
const quote = 'Recovers text-serialized tool calls (DSML format `' + tag + '`).';
const call = tag + '<｜｜DSML｜｜invoke name="read"><｜｜DSML｜｜parameter name="filePath" string="true">'
  + file + '</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>';
const answer = '先规划 GLM 适配器：保留原生工具调用，补充协议解析与回归用例。\n\n示例：\n```xml\n' + call + '\n```';
let requests = 0;
const failures = [];

const server = http.createServer((request, response) => {
  let raw = '';
  request.setEncoding('utf8');
  request.on('data', chunk => { raw += chunk; });
  request.on('end', () => {
    try {
      const body = JSON.parse(raw);
      response.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish = null) => response.write('data: ' + JSON.stringify({
        id: 'dsml-example', object: 'chat.completion.chunk', created: Math.floor(Date.now() / 1000),
        model: 'deepseek-flash', choices: [{ index: 0, delta, finish_reason: finish }]
      }) + '\n\n');
      if (!body.tools?.length || !JSON.stringify(body.messages).includes(marker)) {
        emit({ content: 'Adapter planning' });
        emit({}, 'stop');
      } else {
        requests++;
        const step = body.messages.filter(message => message.role === 'tool').length;
        assert.ok(step <= 4 && requests <= 5, 'examples must not dispatch additional tools');
        // Split every delimiter and tag across SSE frames as in the failing
        // sessions, including reasoning immediately before a real tool call.
        for (const character of quote + ' Generic XML uses `<tool_calls>`.\n') emit({ reasoning_content: character });
        if (step === 1) {
          // The compatibility path must still execute an unquoted DSML call.
          for (const character of call) emit({ content: character });
          emit({}, 'stop');
        } else if (step < 4) {
          emit({ tool_calls: [{ index: 0, id: `read-${step}`, type: 'function',
            function: { name: 'read', arguments: JSON.stringify({ filePath: file }) } }] });
          emit({}, 'tool_calls');
        } else {
          for (const character of answer) emit({ content: character });
          emit({}, 'stop');
        }
      }
      response.end('data: [DONE]\n\n');
    } catch (error) {
      failures.push(error);
      response.destroy(error);
    }
  });
});

(async () => {
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir: path.join(directory, 'data') });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const config = buildOpenCodeConfig({
      providerId: 'deepseek', modelId: 'deepseek-flash', dsml: true, workMode: 'plan',
      apiKey: 'local-test-key', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      enableSubagents: false, mcpServers: [],
      capabilities: { contextWindow: 65536, maxOutputTokens: 8192 }
    });
    const events = [];
    const result = await sidecar.run({
      runId: 'dsml-examples', workspace: directory, hasUserWorkspace: true,
      prompt: marker + ': read the adapter and then discuss the GLM plan.',
      providerId: 'deepseek', modelId: 'deepseek-flash', workMode: 'plan',
      enableSubagents: false, openCodeConfig: config
    }, event => events.push(event));
    assert.deepEqual(failures, []);
    assert.equal(result.status, 'done', result.error);
    assert.equal(result.text, answer);
    assert.ok(result.reasoning.includes(quote));
    assert.equal(result.toolCalls.length, 4);
    assert.ok(result.toolCalls.every(tool => tool.name === 'read' && tool.status === 'completed'));
    assert.equal(requests, 5);
    assert.equal(events.some(event => event.type === 'session.error'), false);
    console.log(JSON.stringify({ ok: true, requests, tools: result.toolCalls.length, quotedExamplesPreserved: true }));
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close();
    await stopped;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(path.resolve(directory)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(directory).startsWith('yan-dsml-examples-'));
    fs.rmSync(directory, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

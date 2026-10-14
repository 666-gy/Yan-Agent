'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, stageCodingEnvironmentModule } = require('../lib/opencode-sidecar');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-config-runtime-'));
const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
const failures = [], requests = [];
let scenario;
const server = http.createServer((req, res) => {
  let raw = ''; req.setEncoding('utf8'); req.on('data', part => { raw += part; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw); requests.push(body);
      const messages = body.messages || [];
      const start = messages.findLastIndex(message => message.role === 'user');
      const tools = messages.slice(start + 1).filter(message => message.role === 'tool');
      const delta = tools.length >= scenario.calls.length ? { content: 'CONFIG_RUNTIME_DONE' } : { tool_calls: [{
        index: 0, id: `call-${tools.length}`, type: 'function', function: {
          name: scenario.calls[tools.length].name, arguments: JSON.stringify(scenario.calls[tools.length].args)
        }
      }] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [value, finish] of [[delta, null], [{}, delta.tool_calls ? 'tool_calls' : 'stop']]) {
        res.write('data: ' + JSON.stringify({ id: 'config-test', model: body.model, object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: value, finish_reason: finish }] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { failures.push(error.message); res.writeHead(500); res.end('{}'); }
  });
});
(async () => {
  const appRoot = path.resolve(__dirname, '..');
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    for (const mode of ['read-only', 'workspace-write', 'full']) {
      const inside = path.join(workspace, `${mode}.txt`), outside = path.join(root, `${mode}.txt`);
      const dataDir = path.join(root, `data-${mode}`);
      const sidecar = new OpenCodeSidecar({ appRoot, dataDir });
      scenario = { calls: [
        { name: 'write', args: { filePath: inside, content: 'inside' } },
        { name: 'write', args: { filePath: outside, content: 'outside' } },
        { name: 'bash', args: { command: process.platform === 'win32' ? 'Write-Output SANDBOX_SHELL' : 'echo SANDBOX_SHELL' } }
      ] };
      const begin = requests.length;
      try {
        const config = buildOpenCodeConfig({ providerId: 'fixture', modelId: 'fixture',
          codingEnvironmentModule: stageCodingEnvironmentModule({ appRoot, dataDir }),
          sandboxMode: mode, terminalShell: 'powershell', accessMode: 'full',
          apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, mcpServers: [], enableSubagents: false });
        const result = await sidecar.run({ runId: `config-${mode}`, providerId: 'fixture', modelId: 'fixture', workspace,
          hasUserWorkspace: true, workMode: 'normal', accessMode: 'full', sandboxMode: mode,
          replyVerbosity: 'high', reasoningSummary: 'none', openCodeConfig: config, prompt: `CONFIG_${mode}` });
        assert.equal(result.status, 'done', result.error);
        assert.equal(fs.existsSync(inside), mode !== 'read-only', `${mode} inside write`);
        assert.equal(fs.existsSync(outside), mode === 'full', `${mode} outside write`);
        const traffic = JSON.stringify(requests.slice(begin));
        assert.match(traffic, /Give detailed, well-organized replies/);
        assert.doesNotMatch(traffic, /推理意图行（常驻规则）/);
        const results = requests.slice(begin).flatMap(body => (body.messages || []).filter(m => m.role === 'tool').map(m => String(m.content)));
        assert.equal(results.some(value => value.includes('SANDBOX_SHELL') && !/denied|不允许|rejected|invalid/i.test(value)), mode === 'full');
        console.log(`${mode}: real kernel file writes, outside path, shell and outgoing reply preferences passed`);
      } finally {
        const child = sidecar.server?.child;
        const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
        sidecar.close(); await stopped;
      }
    }
    assert.deepEqual(failures, []);
  } finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

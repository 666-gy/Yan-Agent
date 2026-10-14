const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, stageCodingEnvironmentModule } = require('../lib/opencode-sidecar');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-child-runtime-'));
const requests = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      requests.push({ model: body.model, authorization: req.headers.authorization });
      const delegated = body.messages.some(message => message.role === 'tool');
      const delta = body.model === 'cheap' ? { content: 'CHILD_CHEAP_DONE' }
        : delegated ? { content: 'PARENT_DONE' } : { tool_calls: [{ index: 0, id: 'delegate-1', type: 'function',
          function: { name: 'task', arguments: JSON.stringify({ subagent_type: 'explorer', description: 'Inspect fixture',
            prompt: 'Return the text CHILD_CHEAP_DONE without calling tools.' }) } }] };
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      for (const [value, finish] of [[delta, null], [{}, delta.tool_calls ? 'tool_calls' : 'stop']]) {
        res.write('data: ' + JSON.stringify({ id: 'child-model-test', model: body.model, object: 'chat.completion.chunk',
          choices: [{ index: 0, delta: value, finish_reason: finish }] }) + '\n\n');
      }
      res.end('data: [DONE]\n\n');
    } catch (error) { res.writeHead(500); res.end(JSON.stringify({ error: error.message })); }
  });
});
(async () => {
  const appRoot = path.resolve(__dirname, '..');
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir: root });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const baseUrl = `http://127.0.0.1:${server.address().port}/v1`;
    const child = buildOpenCodeConfig({ providerId: 'fixture', modelId: 'cheap', apiKey: 'child-key', baseUrl, mcpServers: [] });
    const config = buildOpenCodeConfig({ providerId: 'fixture', modelId: 'expensive', apiKey: 'parent-key', baseUrl,
      codingEnvironmentModule: stageCodingEnvironmentModule({ appRoot, dataDir: root }), mcpServers: [],
      subagentConfigs: { explorer: child } });
    const result = await sidecar.run({ runId: 'child-model-test', providerId: 'fixture', modelId: 'expensive',
      workspace: root, hasUserWorkspace: true, workMode: 'normal', accessMode: 'full', enableSubagents: true,
      openCodeConfig: config, prompt: 'Delegate the fixture inspection to the explorer and report its result.' });
    assert.equal(result.status, 'done', result.error);
    assert.ok(requests.some(req => req.model === 'cheap' && req.authorization === 'Bearer child-key'), JSON.stringify(requests));
    assert.ok(requests.some(req => req.model === 'expensive' && req.authorization === 'Bearer parent-key'));
    assert.ok(requests.every(req => req.model !== 'cheap' || req.authorization === 'Bearer child-key'));
    console.log('Real kernel delegation uses the selected child model and independent credentials');
  } finally {
    const kernels = sidecar.kernelPoolingEnabled ? [...sidecar.kernels.values()] : [sidecar];
    const stopped = kernels.map(kernel => {
      const child = kernel.server?.child;
      return child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    });
    sidecar.close();
    await Promise.all(stopped);
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

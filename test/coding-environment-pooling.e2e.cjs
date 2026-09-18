'use strict';

// Pooling boundary verification: one pooled kernel serves two workspaces with
// the SAME provider/model config (identical config signature by design). The
// coding-environment plugin binds project rules to the workspace it resolved
// at construction time — this test proves (or refutes) that workspace B's
// session still receives workspace B's rules and never workspace A's.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig, stageCodingEnvironmentModule } = require('../lib/opencode-sidecar');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-coding-pool-'));
const workspaces = {
  a: path.join(root, 'workspace-a'),
  b: path.join(root, 'workspace-b')
};
for (const [key, workspace] of Object.entries(workspaces)) {
  fs.mkdirSync(workspace, { recursive: true });
  fs.writeFileSync(path.join(workspace, 'AGENTS.md'), `POOL_${key.toUpperCase()}_RULE_740: rules for workspace ${key}.\n`);
  fs.writeFileSync(path.join(workspace, 'sample.js'), `const value = '${key}';\n`);
}

const requests = [];
const server = http.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      if (raw.includes('"messages"')) requests.push(body);
      if (req.url?.endsWith('/models')) {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ object: 'list', data: [{ id: 'pooling-fixture', object: 'model' }] }));
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'pooling', model: body.model,
        object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
      emit({ role: 'assistant', content: 'Pooling fixture reply.' });
      emit({}, 'stop');
      res.end('data: [DONE]\n\n');
    } catch (error) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message } }));
    }
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const appRoot = path.resolve(__dirname, '..');
  const dataDir = path.join(root, 'data');
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir, maxKernels: 2 });
  try {
    const codingEnvironmentModule = stageCodingEnvironmentModule({ appRoot, dataDir });
    // One shared config object on purpose: both workspaces must resolve the
    // same config signature so the second run reuses the first run's kernel.
    const sharedConfig = buildOpenCodeConfig({
      providerId: 'fixture', modelId: 'pooling-fixture', codingEnvironmentModule,
      accessMode: 'full', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      mcpServers: [], enableSubagents: false
    });
    const resultA = await sidecar.run({
      runId: 'pooling-a', providerId: 'fixture', modelId: 'pooling-fixture',
      workspace: workspaces.a, hasUserWorkspace: true, workMode: 'normal', accessMode: 'full',
      openCodeConfig: sharedConfig, prompt: 'POOL_WS_A_TASK_740 reply done.'
    });
    const resultB = await sidecar.run({
      runId: 'pooling-b', providerId: 'fixture', modelId: 'pooling-fixture',
      workspace: workspaces.b, hasUserWorkspace: true, workMode: 'normal', accessMode: 'full',
      openCodeConfig: sharedConfig, prompt: 'POOL_WS_B_TASK_740 reply done.'
    });
    assert.equal(resultA.status, 'done', resultA.error);
    assert.equal(resultB.status, 'done', resultB.error);

    const mainRequests = requests.filter(body => body.tools?.length);
    assert.equal(mainRequests.length, 2, `expected one main request per workspace, got ${mainRequests.length}`);
    const [requestA, requestB] = mainRequests;
    const systemOf = body => body.messages.filter(message => message.role === 'system' || message.role === 'developer')
      .map(message => JSON.stringify(message.content)).join('\n');

    const systemA = systemOf(requestA);
    const systemB = systemOf(requestB);
    assert.match(systemA, /POOL_A_RULE_740/, 'workspace A rules must reach workspace A requests');
    assert.doesNotMatch(systemA, /POOL_B_RULE_740/, 'workspace B rules must not leak into workspace A requests');
    assert.match(systemB, /POOL_B_RULE_740/, 'workspace B rules must reach workspace B requests on a shared kernel');
    assert.doesNotMatch(systemB, /POOL_A_RULE_740/, 'workspace A rules must not leak into workspace B requests');

    assert.equal(sidecar.kernels.size, 1, 'both runs must share one pooled kernel for this scenario');
    console.log(JSON.stringify({ ok: true, requests: mainRequests.length, sharedKernels: sidecar.kernels.size }));
  } finally {
    const stopAll = [...sidecar.kernels.values()].map(kernel => {
      const child = kernel.server?.child;
      const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
      return stopped;
    });
    sidecar.close();
    await Promise.all(stopAll);
    await new Promise(resolve => server.close(resolve));
    assert.ok(path.basename(root).startsWith('yan-coding-pool-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

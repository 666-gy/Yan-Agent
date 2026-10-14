'use strict';

// Real kernels, local model fixture: cancelling cold tool initialization must
// not poison the next ordinary task while another task is still running.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { OpenCodeSidecar, buildOpenCodeConfig } = require('../lib/opencode-sidecar');

async function waitFor(predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) throw new Error('Timed out waiting for fixture');
    await new Promise(resolve => setTimeout(resolve, 10));
  }
}

for (const initialization of ['tool', 'mcp']) test(`cancelled ${initialization} initialization cannot abort a concurrent ordinary task`, { timeout: 90_000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-concurrent-start-'));
  const dataDir = path.join(root, 'data');
  const workspaceA = path.join(root, 'workspace-a');
  const workspaceB = path.join(root, 'workspace-b');
  const initializing = path.join(root, 'tool-initializing');
  const releaseTools = path.join(root, 'release-tools');
  for (const dir of [workspaceA, workspaceB]) fs.mkdirSync(dir, { recursive: true });
  const toolsDir = path.join(dataDir, 'opencode-runtime/config/opencode/tools');
  fs.mkdirSync(toolsDir, { recursive: true });
  // Only workspace B blocks. Its registry is genuinely initialized by the
  // kernel, rather than simulated by a fake sidecar/client.
  const toolSource = `
    import fs from 'node:fs';
    fs.writeFileSync(${JSON.stringify(initializing)}, 'ready');
    const deadline = Date.now() + 30000;
    while (!fs.existsSync(${JSON.stringify(releaseTools)})) {
      if (Date.now() >= deadline) throw new Error('Tool fixture was not released');
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    export default { description: 'Initialization probe', args: {}, execute: async () => 'ok' };
  `;
  // Use a separate config for B, as in the observed two-model failure. A has
  // no slow tool: create its kernel before installing B's global tool file.

  let releaseA;
  const firstRelease = new Promise(resolve => { releaseA = resolve; });
  const requests = [];
  const server = http.createServer((req, res) => {
    let raw = '';
    req.setEncoding('utf8');
    req.on('data', chunk => { raw += chunk; });
    req.on('end', async () => {
      try {
        const body = JSON.parse(raw);
        if (body.tools?.length) requests.push(body);
        if (body.tools?.length && raw.includes('ORDINARY_A')) await firstRelease;
        res.writeHead(200, { 'Content-Type': 'text/event-stream' });
        const emit = (delta, finish = null) => res.write(`data: ${JSON.stringify({
          id: 'fixture', model: body.model, object: 'chat.completion.chunk',
          choices: [{ index: 0, delta, finish_reason: finish }]
        })}\n\n`);
        emit({ role: 'assistant', content: 'Hello.' });
        emit({}, 'stop');
        res.end('data: [DONE]\n\n');
      } catch (error) {
        res.destroy(error);
      }
    });
  });
  const sidecar = new OpenCodeSidecar({ appRoot: path.resolve(__dirname, '..'), dataDir, maxKernels: 2 });
  const runs = [];
  const track = promise => {
    runs.push(promise);
    promise.catch(() => {});
    return promise;
  };
  t.after(async () => {
    fs.writeFileSync(releaseTools, 'release');
    releaseA();
    const stopped = [...sidecar.kernels.values()].map(kernel => {
      const child = kernel.server?.child;
      return child && child.exitCode === null
        ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    });
    sidecar.close();
    await Promise.allSettled(runs);
    await Promise.all(stopped);
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const configA = buildOpenCodeConfig({
    providerId: 'fixture', modelId: 'fixture', accessMode: 'full', apiKey: 'local',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, mcpServers: [], enableSubagents: false
  });
  const configB = { ...configA, username: 'second-kernel' };
  const common = { providerId: 'fixture', modelId: 'fixture', hasUserWorkspace: true,
    workMode: 'normal', accessMode: 'full', reasoningSummary: 'none' };
  const first = track(sidecar.run({ ...common, runId: 'ordinary-a', workspace: workspaceA,
    openCodeConfig: configA, prompt: 'ORDINARY_A hello' }));
  await waitFor(() => requests.some(body => JSON.stringify(body).includes('ORDINARY_A')));

  if (initialization === 'tool') {
    fs.writeFileSync(path.join(toolsDir, 'slow.js'), toolSource);
  } else {
    const fixture = path.join(root, 'slow-mcp.cjs');
    fs.writeFileSync(fixture, `
      const fs = require('node:fs');
      const readline = require('node:readline');
      readline.createInterface({ input: process.stdin }).on('line', async line => {
        const msg = JSON.parse(line);
        if (msg.id === undefined) return;
        let result = {};
        if (msg.method === 'initialize') {
          fs.writeFileSync(${JSON.stringify(initializing)}, 'ready');
          const deadline = Date.now() + 30000;
          while (!fs.existsSync(${JSON.stringify(releaseTools)})) {
            if (Date.now() > deadline) process.exit(1);
            await new Promise(resolve => setTimeout(resolve, 10));
          }
          result = { protocolVersion: '2024-11-05', capabilities: { tools: {} },
            serverInfo: { name: 'slow', version: '1' } };
        } else if (msg.method === 'tools/list') {
          result = { tools: [{ name: 'probe', description: 'Probe', inputSchema: { type: 'object', properties: {} } }] };
        }
        process.stdout.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result }) + '\\n');
      });
    `);
    configB.mcp = { ...configB.mcp, slow: { type: 'local', command: [process.execPath, fixture], timeout: 30000 } };
  }
  const suggestion = track(sidecar.run({ ...common, runId: 'suggestion', workspace: workspaceB,
    openCodeConfig: configB, utility: true, prompt: 'SUGGESTION' }));
  await waitFor(() => fs.existsSync(initializing));
  await sidecar.cancel('suggestion');
  let cancelled;
  suggestion.then(result => { cancelled = result; });
  await waitFor(() => cancelled, 2_000);
  assert.equal(cancelled.status, 'interrupted', 'cancel must not wait for registry initialization');
  assert.equal(fs.existsSync(releaseTools), false);

  const second = track(sidecar.run({ ...common, runId: 'ordinary-b', workspace: workspaceB,
    openCodeConfig: configB, prompt: 'ORDINARY_B hello' }));
  fs.writeFileSync(releaseTools, 'release');
  assert.equal((await second).status, 'done');
  assert.equal(sidecar.hasRun('ordinary-a'), true, 'A must still be running after B completes');
  releaseA();
  assert.equal((await first).status, 'done');
  assert.equal(requests.length, 2, 'cancelled suggestion must never reach the model');
  const requestB = requests.find(body => JSON.stringify(body).includes('ORDINARY_B'));
  assert.ok(requestB.tools.some(tool => tool.function?.name === (initialization === 'tool' ? 'slow' : 'slow_probe')));
  assert.equal(sidecar.kernels.size, 2, 'B must reuse the suggestion kernel, not hide the bug by restarting');
});

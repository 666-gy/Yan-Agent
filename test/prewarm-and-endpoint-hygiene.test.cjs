'use strict';

// Regression guard for the two latency fixes:
//   1. prewarm() warms the target DIRECTORY instance, not only the kernel.
//   2. dead kernel endpoint files are filtered (and removed) instead of walked.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const { OpenCodeSidecar, pruneStaleKernelEndpoints } = require('../lib/opencode-sidecar');

function fakeKernel(calls) {
  return {
    client: {
      session: { list: async args => { calls.push(args); return []; } },
      tool: { ids: async args => { calls.push({ toolIds: args }); return []; } },
      mcp: { status: async args => { calls.push({ mcpStatus: args }); return {}; } }
    },
    async start() { return this.status(); },
    status() { return { ok: true, activeRuns: 0, pendingRuns: 0 }; },
    close() {}
  };
}

test('prewarm warms the target directory instance through the pooled kernel', async t => {
  const calls = [];
  const pool = new OpenCodeSidecar({ maxKernels: 2, kernelFactory: () => fakeKernel(calls) });
  t.after(() => pool.close());
  await pool.prewarm({ model: 'vendor/m' }, '/tmp/yan-ws-a');
  assert.deepEqual(calls, [{ directory: '/tmp/yan-ws-a', limit: 1 },
    { toolIds: { directory: path.resolve('/tmp/yan-ws-a') } },
    { mcpStatus: { directory: path.resolve('/tmp/yan-ws-a') } }]);
});

test('prewarm without a directory only ensures the kernel', async t => {
  const calls = [];
  const pool = new OpenCodeSidecar({ maxKernels: 2, kernelFactory: () => fakeKernel(calls) });
  t.after(() => pool.close());
  await pool.prewarm({ model: 'vendor/m' }, '');
  assert.deepEqual(calls, []);
});

function listen(server) {
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve(server.address().port)));
}
function close(server) {
  return new Promise(resolve => server.close(() => resolve()));
}
function freePort() {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

function spawnMcp(endpointsDir, configPath) {
  const child = spawn(process.execPath, [path.join(appRoot, 'lib', 'yan-mcp-mcp.js')], {
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_MCP_CONFIG_PATH: configPath,
      YAN_MCP_KERNEL_ENDPOINTS_DIR: endpointsDir,
      YAN_MCP_ALLOW_NETWORK: 'false'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let nl = buffer.indexOf('\n');
    while (nl >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) { const msg = JSON.parse(line); pending.get(msg.id)?.(msg); pending.delete(msg.id); }
      nl = buffer.indexOf('\n');
    }
  });
  let id = 0;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const rid = ++id;
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 15_000);
    pending.set(rid, message => { clearTimeout(timer); resolve(message); });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id: rid, method, params })}\n`);
  });
  return { child, request };
}

test('a kernel start sweeps dead endpoint files (publisher side)', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-endpoint-prune-'));
  const endpointsDir = path.join(root, 'opencode-runtime', 'endpoints');
  fs.mkdirSync(endpointsDir, { recursive: true });
  const live = http.createServer((_req, res) => { res.statusCode = 404; res.end('{}'); });
  const livePort = await listen(live);
  const deadPort = await freePort();
  fs.writeFileSync(path.join(endpointsDir, `${livePort}.json`), JSON.stringify({ url: `http://127.0.0.1:${livePort}` }), 'utf8');
  fs.writeFileSync(path.join(endpointsDir, `${deadPort}.json`), JSON.stringify({ url: `http://127.0.0.1:${deadPort}` }), 'utf8');
  t.after(async () => {
    await close(live);
    fs.rmSync(root, { recursive: true, force: true });
  });

  await pruneStaleKernelEndpoints(root, livePort);
  assert.equal(fs.existsSync(path.join(endpointsDir, `${deadPort}.json`)), false, 'dead endpoint file is swept');
  assert.equal(fs.existsSync(path.join(endpointsDir, `${livePort}.json`)), true, 'live endpoint file is kept');
});

test('activation filters dead kernel endpoints and removes their stale files', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-endpoint-hygiene-'));
  const endpointsDir = path.join(root, 'endpoints');
  fs.mkdirSync(endpointsDir, { recursive: true });
  const configPath = path.join(root, 'config.json');
  fs.writeFileSync(configPath, JSON.stringify({ mcpServers: [] }), 'utf8');

  const live = http.createServer((_req, res) => { res.statusCode = 404; res.end('{}'); });
  const livePort = await listen(live);
  const deadPort = await freePort();
  fs.writeFileSync(path.join(endpointsDir, `${livePort}.json`), JSON.stringify({ url: `http://127.0.0.1:${livePort}`, username: 'opencode', password: 'x' }), 'utf8');
  fs.writeFileSync(path.join(endpointsDir, `${deadPort}.json`), JSON.stringify({ url: `http://127.0.0.1:${deadPort}`, username: 'opencode', password: 'x' }), 'utf8');

  const client = spawnMcp(endpointsDir, configPath);
  t.after(async () => {
    client.child.kill();
    await close(live);
    fs.rmSync(root, { recursive: true, force: true });
  });

  const response = await client.request('tools/call', { name: 'activate_mcp_server', arguments: { id: 'no-such-mcp-probe' } });
  const result = response.result.structuredContent;
  assert.equal(result.kernels, 1, 'only the live kernel is reported');
  assert.deepEqual(result.results.map(item => item.url), [`http://127.0.0.1:${livePort}`]);
  assert.equal(fs.existsSync(path.join(endpointsDir, `${deadPort}.json`)), false, 'dead endpoint file is removed');
  assert.equal(fs.existsSync(path.join(endpointsDir, `${livePort}.json`)), true, 'live endpoint file is kept');
});

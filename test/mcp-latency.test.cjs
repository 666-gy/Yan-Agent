'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { performance } = require('node:perf_hooks');
const { spawn } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');

function makeServer(name, dataDir) {
  const base = {
    cwd: appRoot,
    env: { ...process.env },
    stdio: ['pipe', 'pipe', 'pipe']
  };
  if (name === 'skills') {
    const root = path.join(dataDir, 'skills');
    fs.mkdirSync(root, { recursive: true });
    const configPath = path.join(dataDir, 'config.json');
    fs.writeFileSync(configPath, JSON.stringify({ customSkills: [] }), 'utf8');
    base.env = {
      ...base.env,
      YAN_SKILLS_ROOT: root,
      YAN_SKILLS_DATA_DIR: dataDir,
      YAN_SKILLS_CONFIG_PATH: configPath,
      YAN_SKILLS_APP_ROOT: appRoot,
      YAN_SKILLS_CLI: path.join(appRoot, 'node_modules', 'skills', 'bin', 'cli.mjs'),
      YAN_SKILLS_ALLOW_NETWORK: 'false',
      YAN_INPUT_TOKENS_PER_SECOND: '10000'
    };
  } else if (name === 'media') {
    base.env = {
      ...base.env,
      YAN_MEDIA_DATA_DIR: dataDir,
      YAN_MEDIA_RUNTIME: Buffer.from(JSON.stringify({ access: { allowNetwork: false } }), 'utf8').toString('base64')
    };
  } else if (name === 'browser') {
    base.env = { ...base.env, YAN_BROWSER_ALLOW_NETWORK: 'false' };
  } else if (name === 'session') {
    base.env = base.env;
  } else if (name === 'harness') {
    base.env = { ...base.env, YAN_HARNESS_CONTEXT_DIR: path.join(dataDir, 'contexts') };
  }
  return spawn(process.execPath, [path.join(appRoot, 'lib', `yan-${name}-mcp.js`)], base);
}

function rpc(child, method, params = {}, timeoutMs = 3_000) {
  let buffer = '';
  let nextId = 1;
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
        const waiter = pending.get(message.id);
        if (waiter) {
          pending.delete(message.id);
          clearTimeout(waiter.timer);
          if (message.error) waiter.reject(new Error(message.error.message || 'MCP error'));
          else waiter.resolve(message.result);
        }
      }
      newline = buffer.indexOf('\n');
    }
  });
  return (methodName = method, methodParams = params) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP timeout: ${methodName}`));
    }, timeoutMs);
    pending.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method: methodName, params: methodParams })}\n`);
  });
}

async function measureServer(name, dataDir) {
  const child = makeServer(name, dataDir);
  const request = rpc(child);
  const startedAt = performance.now();
  await request('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'latency-test', version: '1' } });
  const initializedMs = performance.now() - startedAt;
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  const toolsStartedAt = performance.now();
  const listed = await request('tools/list', {});
  const toolsMs = performance.now() - toolsStartedAt;
  const pings = [];
  for (let index = 0; index < 12; index += 1) {
    const pingStartedAt = performance.now();
    await request('ping', {});
    pings.push(performance.now() - pingStartedAt);
  }
  child.kill();
  return {
    name,
    toolCount: listed.tools?.length || 0,
    initializeMs: initializedMs,
    toolsListMs: toolsMs,
    pingP50Ms: [...pings].sort((a, b) => a - b)[Math.floor(pings.length / 2)]
  };
}

test('built-in MCP handshakes and steady JSON-RPC stay low-latency without network calls', async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mcp-latency-'));
  try {
    const results = await Promise.all(['skills', 'media', 'browser', 'session', 'harness'].map(name => measureServer(name, dataDir)));
    console.table(results.map(result => ({
      server: result.name,
      tools: result.toolCount,
      initialize_ms: result.initializeMs.toFixed(1),
      tools_list_ms: result.toolsListMs.toFixed(1),
      ping_p50_ms: result.pingP50Ms.toFixed(1)
    })));
    for (const result of results) {
      assert.ok(result.toolCount > 0, `${result.name} returned no tools`);
      assert.ok(result.initializeMs < 2_000, `${result.name} handshake exceeded 2s`);
      assert.ok(result.toolsListMs < 500, `${result.name} tools/list exceeded 500ms`);
      assert.ok(result.pingP50Ms < 100, `${result.name} ping p50 exceeded 100ms`);
    }
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

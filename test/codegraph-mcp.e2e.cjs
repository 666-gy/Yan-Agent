const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const packagedAppDir = path.resolve(process.env.YAN_PACKAGED_APP_DIR || path.join(__dirname, '..', 'dist', 'win-unpacked'));
const runtimeRoot = path.join(packagedAppDir, 'resources', 'codegraph-runtime');
const nodeCommand = path.join(runtimeRoot, 'node.exe');
const entryPoint = path.join(runtimeRoot, 'lib', 'dist', 'bin', 'codegraph.js');
const commanderPackage = path.join(runtimeRoot, 'lib', 'node_modules', 'commander', 'package.json');

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function stopProcessTree(processHandle) {
  if (!processHandle || processHandle.exitCode !== null) return;
  const result = spawnSync('taskkill', ['/pid', String(processHandle.pid), '/t', '/f'], {
    encoding: 'utf8',
    windowsHide: true,
    stdio: 'ignore'
  });
  if (result.status !== 0) {
    try { processHandle.kill(); } catch {}
  }
}

function request(server, id, method, params) {
  return new Promise((resolve, reject) => {
    if (server.parseError) {
      reject(server.parseError);
      return;
    }
    const timer = setTimeout(() => {
      server.pending.delete(id);
      reject(new Error(`CodeGraph MCP 请求超时：${method}`));
    }, 15000);
    server.pending.set(id, { resolve, reject, timer });
    server.process.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

async function main() {
  assert.equal(process.platform, 'win32', 'CodeGraph 打包握手测试只适用于 Windows。');
  assert.ok(fs.existsSync(nodeCommand), `缺少 CodeGraph 私有 Node：${nodeCommand}`);
  assert.ok(fs.existsSync(entryPoint), `缺少 CodeGraph 入口：${entryPoint}`);
  assert.ok(fs.existsSync(commanderPackage), `缺少 CodeGraph 私有 commander：${commanderPackage}`);

  const commander = JSON.parse(fs.readFileSync(commanderPackage, 'utf8'));
  assert.ok(String(commander.version || '').startsWith('14.'), 'CodeGraph 未使用 commander 14.x 私有依赖。');

  const processHandle = spawn(nodeCommand, [
    '--liftoff-only',
    '--disable-warning=ExperimentalWarning',
    entryPoint,
    'serve',
    '--mcp'
  ], {
    cwd: runtimeRoot,
    env: {
      ...process.env,
      CODEGRAPH_TELEMETRY: '0',
      CODEGRAPH_NO_DOWNLOAD: '1',
      DO_NOT_TRACK: '1',
      NO_COLOR: '1'
    },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true
  });
  const server = { process: processHandle, pending: new Map(), buffer: '', stderr: '', parseError: null };
  processHandle.stdout.on('data', chunk => {
    server.buffer += chunk.toString('utf8');
    let newline = server.buffer.indexOf('\n');
    while (newline >= 0) {
      const line = server.buffer.slice(0, newline).trim();
      server.buffer = server.buffer.slice(newline + 1);
      if (line) {
        try {
          const message = JSON.parse(line);
          const pending = server.pending.get(message.id);
          if (pending) {
            server.pending.delete(message.id);
            clearTimeout(pending.timer);
            if (message.error) pending.reject(new Error(message.error.message || 'MCP error'));
            else pending.resolve(message.result);
          }
        } catch (error) {
          server.parseError = new Error(`CodeGraph MCP 返回了无效 JSON：${error.message}`);
          for (const pending of server.pending.values()) {
            clearTimeout(pending.timer);
            pending.reject(server.parseError);
          }
          server.pending.clear();
        }
      }
      newline = server.buffer.indexOf('\n');
    }
  });
  processHandle.stderr.on('data', chunk => { server.stderr += chunk.toString('utf8'); });
  processHandle.once('error', error => {
    server.parseError = error;
    for (const pending of server.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    server.pending.clear();
  });

  try {
    await wait(300);
    const initialized = await request(server, 1, 'initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'Yan Agent', version: '1.4.0' }
    });
    assert.equal(initialized.serverInfo?.name, 'codegraph');
    const listed = await request(server, 2, 'tools/list', {});
    assert.ok(Array.isArray(listed.tools));
    assert.ok(listed.tools.some(tool => tool.name === 'codegraph_explore'), 'CodeGraph MCP 未暴露 codegraph_explore。');
    console.log(`CodeGraph MCP handshake passed (${listed.tools.length} tools).`);
  } finally {
    for (const pending of server.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(new Error('CodeGraph MCP process stopped.'));
    }
    server.pending.clear();
    stopProcessTree(processHandle);
  }
}

main().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});

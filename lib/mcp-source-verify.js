'use strict';

// Official-source verification for natural-language MCP installation.
//
// The agent must not install the user's memory of a command; it must check the
// claim against primary sources first. Two independent checks do that, and
// both produce evidence:
//
//   1. Registry check — the launcher's package is looked up in the OFFICIAL
//      npm / PyPI registry (registry.npmjs.org / pypi.org), never a mirror.
//   2. Handshake check — the server is actually started (local, stdio) or
//      probed over Streamable HTTP (remote) and must answer initialize and
//      tools/list, which is the only proof that the command/URL is usable.
//
// Outcomes:
//   verified    — official source agrees and/or the handshake succeeded
//   unavailable — nothing to check against (unknown launcher, offline)
//   blocked     — a definite contradiction (package missing, handshake failed)

const { spawn } = require('child_process');
const path = require('path');
const { isRemoteMcpServer, probeRemoteServer } = require('./mcp-remote');

const REGISTRY_TIMEOUT_MS = 20_000;
const LIVE_TIMEOUT_MS = 120_000;
const MAX_TOOLS_REPORTED = 40;
const MAX_MESSAGE = 300;

const NPM_LAUNCHERS = new Set(['npx', 'npm', 'bunx', 'bun', 'pnpm', 'pnpx', 'yarn']);
const PYPI_LAUNCHERS = new Set(['uvx', 'uv', 'pipx', 'python', 'python3', 'py']);
const WINDOWS_SHELL_LAUNCHERS = new Set([
  'npx', 'npm', 'pnpm', 'pnpx', 'yarn', 'bun', 'bunx',
  'node', 'uvx', 'uv', 'pipx', 'python', 'python3', 'py'
]);
const SUBCOMMAND_WORDS = new Set(['exec', 'dlx', 'run', 'tool', 'x', 'install', 'add']);

function baseCommand(server = {}) {
  const raw = String(server.command || '').trim().toLowerCase();
  const base = path.basename(raw);
  for (const suffix of ['.cmd', '.exe', '.ps1', '.bat']) {
    if (base.endsWith(suffix)) return base.slice(0, base.length - suffix.length);
  }
  return base;
}

function clipMessage(value) {
  return String(value || '').split('\u0000').join('').trim().slice(0, MAX_MESSAGE);
}

// Extract the registry package the launcher would install, if there is one.
function packageSpecFromCommand(server = {}) {
  const base = baseCommand(server);
  const registry = NPM_LAUNCHERS.has(base) ? 'npm' : (PYPI_LAUNCHERS.has(base) ? 'pypi' : '');
  if (!registry) {
    return { ok: false, reason: `启动命令「${server.command || ''}」不是已知的包启动器（npx/uvx 等），没有可在官方 registry 核对的包名。` };
  }
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  let spec = '';
  for (const arg of args) {
    if (arg.startsWith('-')) continue;
    if (SUBCOMMAND_WORDS.has(arg.toLowerCase())) continue;
    spec = arg;
    break;
  }
  if (!spec) return { ok: false, reason: '启动参数中没有可核对的包名。' };
  const lower = spec.toLowerCase();
  if (lower.startsWith('git+') || lower.includes('://') || lower.startsWith('github:')
    || lower.startsWith('file:') || lower.startsWith('./') || lower.startsWith('.\\')) {
    return { ok: false, reason: '该来源是 git 或本地路径，不是官方 registry 包，无法在 registry 中核对。' };
  }
  if (registry === 'npm') {
    const at = spec.lastIndexOf('@');
    const name = at > 0 ? spec.slice(0, at) : spec;
    if (!name) return { ok: false, reason: 'npm 包名为空。' };
    return { ok: true, registry, name, spec };
  }
  let name = spec.split('[')[0];
  const pinned = name.indexOf('==');
  if (pinned > 0) name = name.slice(0, pinned);
  if (!name) return { ok: false, reason: 'PyPI 包名为空。' };
  return { ok: true, registry, name, spec };
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || globalThis.fetch;
  if (typeof fetchImpl !== 'function') return { ok: false, error: '当前运行时不支持网络请求。' };
  const controller = new AbortController();
  const timeoutMs = Math.max(3_000, Number(options.timeoutMs) || REGISTRY_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': 'Yan-Agent-MCP-Puller' },
      signal: controller.signal
    });
    if (response.status === 404) return { ok: true, missing: true };
    if (!response.ok) return { ok: false, error: `官方 registry 返回 HTTP ${response.status}。` };
    return { ok: true, missing: false, data: await response.json() };
  } catch (error) {
    if (error?.name === 'AbortError') return { ok: false, error: '官方 registry 请求超时。' };
    return { ok: false, error: `官方 registry 请求失败：${clipMessage(error?.message || error)}` };
  } finally {
    clearTimeout(timer);
  }
}

async function registryCheck(spec, options = {}) {
  if (spec.registry === 'npm') {
    const url = `https://registry.npmjs.org/${encodeURIComponent(spec.name)}`;
    const result = await fetchJson(url, options);
    if (!result.ok) return { ok: false, url, error: result.error };
    if (result.missing) {
      return { ok: false, blocked: true, url, error: `npm 官方 registry 中没有包「${spec.name}」，请核对包名。` };
    }
    const data = result.data || {};
    const latest = String(data['dist-tags']?.latest || '');
    const versionData = latest && data.versions && data.versions[latest] ? data.versions[latest] : {};
    return {
      ok: true,
      url,
      registry: 'npm',
      package: spec.name,
      latestVersion: latest,
      description: clipMessage(data.description || versionData.description || ''),
      mcpName: String(versionData.mcpName || data.mcpName || ''),
      repository: String(versionData.repository?.url || data.repository?.url || ''),
      homepage: String(versionData.homepage || data.homepage || '')
    };
  }
  const url = `https://pypi.org/pypi/${encodeURIComponent(spec.name)}/json`;
  const result = await fetchJson(url, options);
  if (!result.ok) return { ok: false, url, error: result.error };
  if (result.missing) {
    return { ok: false, blocked: true, url, error: `PyPI 官方 registry 中没有包「${spec.name}」，请核对包名。` };
  }
  const info = result.data?.info || {};
  return {
    ok: true,
    url,
    registry: 'pypi',
    package: spec.name,
    latestVersion: String(info.version || ''),
    description: clipMessage(info.summary || ''),
    homepage: String(info.home_page || info.project_url || '')
  };
}

function commandLineForSpawn(server) {
  const command = String(server.command || '');
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  if (process.platform === 'win32' && WINDOWS_SHELL_LAUNCHERS.has(baseCommand(server))) {
    return {
      command: process.env.ComSpec || 'cmd.exe',
      args: ['/c', command, ...args.map(value => (value.includes(' ') ? `"${value}"` : value))]
    };
  }
  return { command, args };
}

function killTree(pid) {
  if (!pid) return;
  if (process.platform === 'win32') {
    try { spawn('taskkill', ['/pid', String(pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch {}
    return;
  }
  try { process.kill(-pid, 'SIGKILL'); } catch {}
  try { process.kill(pid, 'SIGKILL'); } catch {}
}

// Start a local MCP server, complete the real handshake, list its tools, stop it.
function probeLocalMcpServer(server = {}, options = {}) {
  const timeoutMs = Math.max(5_000, Number(options.timeoutMs) || LIVE_TIMEOUT_MS);
  const clientVersion = String(options.clientVersion || '0.0.0');
  return new Promise(resolve => {
    const { command, args } = commandLineForSpawn(server);
    if (!command) {
      resolve({ ok: false, error: '缺少启动命令。' });
      return;
    }
    let child;
    try {
      child = spawn(command, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...(server.env && typeof server.env === 'object' ? server.env : {}) },
        shell: false,
        windowsHide: true,
        detached: process.platform !== 'win32'
      });
    } catch (error) {
      resolve({ ok: false, error: `无法启动：${clipMessage(error?.message || error)}` });
      return;
    }
    let settled = false;
    let buffer = '';
    let stderr = '';
    const pending = new Map();
    const finish = payload => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { child.stdin.end(); } catch {}
      killTree(child.pid);
      resolve(payload);
    };
    const timer = setTimeout(() => finish({
      ok: false,
      error: `启动后 ${Math.round(timeoutMs / 1000)} 秒内未完成 MCP 握手（超时）。`
    }), timeoutMs);

    const rpc = (id, method, params, expectResponse = true) => new Promise((res, rej) => {
      if (expectResponse) pending.set(id, { res, rej });
      else res(null);
      try {
        child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
      } catch (error) {
        rej(error);
      }
    });

    child.stdin.on('error', () => {});
    child.on('error', error => finish({ ok: false, error: `无法启动：${clipMessage(error?.message || error)}` }));
    child.on('exit', code => finish({
      ok: false,
      error: `服务在握手完成前退出（code ${code}）。${stderr ? ` stderr: ${clipMessage(stderr.slice(-200))}` : ''}`
    }));
    child.stderr.on('data', data => {
      stderr += data.toString();
      if (stderr.length > 4_000) stderr = stderr.slice(-4_000);
    });
    child.stdout.on('data', data => {
      buffer += data.toString();
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim();
        buffer = buffer.slice(index + 1);
        if (!line) continue;
        let message;
        try { message = JSON.parse(line); } catch { continue; }
        if (message?.id == null || !pending.has(message.id)) continue;
        const entry = pending.get(message.id);
        pending.delete(message.id);
        if (message.error) entry.rej(new Error(clipMessage(message.error.message || 'MCP 错误')));
        else entry.res(message.result);
      }
    });

    (async () => {
      try {
        const initialized = await rpc(1, 'initialize', {
          protocolVersion: '2024-11-05',
          capabilities: {},
          clientInfo: { name: 'Yan Agent', version: clientVersion }
        });
        await rpc(undefined, 'notifications/initialized', {}, false);
        const listed = await rpc(2, 'tools/list', {});
        const tools = Array.isArray(listed?.tools)
          ? listed.tools.map(tool => String(tool?.name || '')).filter(Boolean)
          : [];
        finish({
          ok: true,
          toolCount: tools.length,
          tools: tools.slice(0, MAX_TOOLS_REPORTED),
          serverInfo: initialized?.serverInfo || null
        });
      } catch (error) {
        finish({ ok: false, error: `握手失败：${clipMessage(error?.message || error)}` });
      }
    })();
  });
}

// options: { allowNetwork, live, fetchImpl, timeoutMs, liveTimeoutMs, clientVersion }
async function verifyMcpSource(server = {}, options = {}) {
  const allowNetwork = options.allowNetwork !== false;
  const evidence = {
    target: {
      name: String(server.name || ''),
      type: isRemoteMcpServer(server) ? 'remote' : 'local',
      command: String(server.command || ''),
      args: Array.isArray(server.args) ? server.args.map(String) : [],
      url: String(server.url || '')
    },
    checks: []
  };

  if (isRemoteMcpServer(server)) {
    if (!allowNetwork || typeof fetch !== 'function') {
      evidence.checks.push({ kind: 'remote-probe', ok: false, skipped: true, reason: '网络未授权，无法探测远程端点。' });
      return { ok: true, verified: false, blocked: false, mode: 'remote', evidence, error: '网络未授权，未能核对远程 MCP 端点。' };
    }
    const probe = await probeRemoteServer(server, { clientVersion: options.clientVersion });
    if (!probe.ok) {
      evidence.checks.push({ kind: 'remote-probe', ok: false, error: probe.error });
      return { ok: false, verified: false, blocked: true, mode: 'remote', evidence, error: probe.error };
    }
    const tools = Array.isArray(probe.tools) ? probe.tools.map(tool => String(tool?.name || '')).filter(Boolean) : [];
    evidence.checks.push({
      kind: 'remote-probe',
      ok: true,
      protocolVersion: probe.protocolVersion,
      toolCount: tools.length,
      tools: tools.slice(0, MAX_TOOLS_REPORTED)
    });
    return { ok: true, verified: true, blocked: false, mode: 'remote', evidence };
  }

  const spec = packageSpecFromCommand(server);
  if (spec.ok && allowNetwork) {
    const check = await registryCheck(spec, options);
    evidence.checks.push({ kind: 'registry', ...check });
    if (check.blocked) {
      return { ok: false, verified: false, blocked: true, mode: 'local', evidence, error: check.error };
    }
  } else {
    evidence.checks.push({
      kind: 'registry',
      ok: false,
      skipped: true,
      reason: spec.ok ? '网络未授权，跳过官方 registry 核对。' : spec.reason
    });
  }

  if (options.live === false) {
    const registryOk = evidence.checks.some(check => check.kind === 'registry' && check.ok === true);
    return {
      ok: true,
      verified: registryOk,
      blocked: false,
      mode: 'local',
      evidence,
      ...(registryOk ? {} : { error: '已跳过实际启动核对。' })
    };
  }

  const live = await probeLocalMcpServer(server, {
    timeoutMs: options.liveTimeoutMs,
    clientVersion: options.clientVersion
  });
  if (!live.ok) {
    evidence.checks.push({ kind: 'handshake', ok: false, error: live.error });
    return { ok: false, verified: false, blocked: true, mode: 'local', evidence, error: live.error };
  }
  evidence.checks.push({
    kind: 'handshake',
    ok: true,
    toolCount: live.toolCount,
    tools: live.tools,
    serverInfo: live.serverInfo
  });
  return { ok: true, verified: true, blocked: false, mode: 'local', evidence };
}

// Fallback introduction for the MCP card, taken from the official source when
// the model did not write one: the registry summary first, otherwise the list
// of tools the real handshake returned.
function officialDescription(verification = {}) {
  const checks = Array.isArray(verification?.evidence?.checks) ? verification.evidence.checks : [];
  const registry = checks.find(check => check.kind === 'registry' && check.ok === true);
  if (registry?.description) return clipMessage(registry.description);
  const handshake = checks.find(check => check.kind === 'handshake' && check.ok === true);
  const remote = checks.find(check => check.kind === 'remote-probe' && check.ok === true);
  const tools = Array.isArray(handshake?.tools)
    ? handshake.tools
    : (Array.isArray(remote?.tools) ? remote.tools : []);
  if (tools.length) return `提供 ${tools.length} 个工具：${tools.slice(0, 6).join(', ')}`;
  return '';
}

// Compact, model-readable summary of a verification result.
function summarizeVerification(verification = {}) {
  const checks = Array.isArray(verification.evidence?.checks) ? verification.evidence.checks : [];
  const registry = checks.find(check => check.kind === 'registry');
  const handshake = checks.find(check => check.kind === 'handshake');
  const remote = checks.find(check => check.kind === 'remote-probe');
  return {
    mode: String(verification.mode || ''),
    verified: verification.verified === true,
    blocked: verification.blocked === true,
    registry: registry ? {
      ok: registry.ok === true,
      skipped: registry.skipped === true,
      source: registry.url || '',
      registry: registry.registry || '',
      package: registry.package || '',
      latestVersion: registry.latestVersion || '',
      mcpName: registry.mcpName || '',
      reason: registry.reason || '',
      error: registry.error || ''
    } : null,
    handshake: handshake ? {
      ok: handshake.ok === true,
      toolCount: Number(handshake.toolCount) || 0,
      tools: Array.isArray(handshake.tools) ? handshake.tools : [],
      error: handshake.error || ''
    } : null,
    remoteProbe: remote ? {
      ok: remote.ok === true,
      skipped: remote.skipped === true,
      toolCount: Number(remote.toolCount) || 0,
      tools: Array.isArray(remote.tools) ? remote.tools : [],
      reason: remote.reason || '',
      error: remote.error || ''
    } : null
  };
}

module.exports = {
  REGISTRY_TIMEOUT_MS,
  LIVE_TIMEOUT_MS,
  packageSpecFromCommand,
  registryCheck,
  officialDescription,
  probeLocalMcpServer,
  verifyMcpSource,
  summarizeVerification
};

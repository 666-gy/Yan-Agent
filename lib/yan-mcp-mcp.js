'use strict';

// Yan MCP: the agent-facing backend for natural-language MCP installation.
//
// stdio JSON-RPC, same shape as the other yan-* MCP servers. It gives the
// conversation owner four tools, all of which operate on the real
// YanData/config.json that the renderer wizard also writes:
//
//   list_mcp_servers    — what is configured right now
//   verify_mcp_server   — check a candidate against its official source
//   install_mcp_server  — validate, verify, then persist per the install rules
//   remove_mcp_server   — remove a user server (built-ins are protected)
//   activate_mcp_server — connect a default-deferred MCP to the live kernel
//
// No prompt text is ever pattern-matched here: the tools are described well
// enough for the model to decide, and the MCP-Puller Skill carries the policy.

const path = require('path');
const fs = require('fs');
const net = require('net');
const http = require('http');
const {
  normalizeMcpInstallRequest,
  addMcpServerToConfig,
  listMcpServersFromConfig,
  removeMcpServerFromConfig
} = require('./mcp-installer');
const { verifyMcpSource, summarizeVerification, officialDescription } = require('./mcp-source-verify');

const configPath = path.resolve(String(process.env.YAN_MCP_CONFIG_PATH || ''));
// Needed by `codegraph-runtime.resolveRuntime` to find the packaged runtime.
// Falls back to this file's parent so an unset env still resolves the dev tree.
const appRoot = path.resolve(String(process.env.YAN_MCP_APP_ROOT || path.join(__dirname, '..')));
const kernelEndpointsDir = String(process.env.YAN_MCP_KERNEL_ENDPOINTS_DIR || '').trim();
const allowNetwork = process.env.YAN_MCP_ALLOW_NETWORK !== 'false';
const clientVersion = String(process.env.YAN_MCP_CLIENT_VERSION || '').trim() || '0.0.0';
const MAX_TOOLS_REPORTED = 40;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan MCP error') } });
}

function toolResult(id, result) {
  success(id, {
    content: [{ type: 'text', text: JSON.stringify(result) }],
    structuredContent: result,
    isError: result && result.ok === false
  });
}

function requireConfigPath() {
  if (!configPath) throw new Error('Yan MCP 缺少配置文件路径（YAN_MCP_CONFIG_PATH）。');
  return configPath;
}

function summarizeServer(server = {}) {
  return {
    id: String(server.id || ''),
    name: String(server.name || ''),
    type: server.type === 'remote' || (!server.command && server.url) ? 'remote' : 'local',
    description: String(server.description || ''),
    command: server.command ? String(server.command) : '',
    args: Array.isArray(server.args) ? server.args.map(String) : [],
    url: server.url ? String(server.url) : '',
    enabled: server.enabled !== false
  };
}

function sanitizeMcpName(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function probeKernel(port, timeoutMs = 400) {
  return new Promise(resolve => {
    const socket = net.connect({ host: '127.0.0.1', port: Number(port) });
    const done = ok => { try { socket.destroy(); } catch {} resolve(ok); };
    socket.setTimeout(timeoutMs);
    socket.once('connect', () => done(true));
    socket.once('timeout', () => done(false));
    socket.once('error', () => done(false));
  });
}

// Endpoint files can outlive a kernel that exited without a clean stop. Probe
// each port and drop the dead ones (deleting the stale file) so activation
// never wastes attempts on corpses and `kernels` reports the live count.
async function readKernelEndpoints() {
  if (!kernelEndpointsDir) return [];
  let names = [];
  try {
    names = fs.readdirSync(kernelEndpointsDir);
  } catch {
    return [];
  }
  const endpoints = [];
  for (const entry of names) {
    if (!entry.endsWith('.json')) continue;
    const file = path.join(kernelEndpointsDir, entry);
    let parsed = null;
    try { parsed = JSON.parse(fs.readFileSync(file, 'utf8')); } catch {}
    if (!(parsed?.url && parsed.username && parsed.password)) continue;
    let port = 0;
    try { port = Number(new URL(parsed.url).port); } catch {}
    if (!port || !(await probeKernel(port))) {
      try { fs.rmSync(file, { force: true }); } catch {}
      continue;
    }
    endpoints.push(parsed);
  }
  return endpoints;
}

function deferredServerConfig(id) {
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(requireConfigPath(), 'utf8'));
  } catch {
    return null;
  }
  const servers = Array.isArray(raw?.mcpServers) ? raw.mcpServers : [];
  const wanted = sanitizeMcpName(id);
  const server = servers.find(item => String(item?.id || '') === id)
    || servers.find(item => sanitizeMcpName(item?.id || item?.name) === wanted);
  if (!server) return null;
  const timeout = Math.max(5_000, Number(server.timeout) || 30_000);
  if (server.type === 'remote' || (!server.command && server.url)) {
    if (!/^https?:\/\//i.test(String(server.url || ''))) return null;
    return {
      type: 'remote',
      url: String(server.url),
      enabled: true,
      timeout,
      ...(server.headers && typeof server.headers === 'object' ? { headers: server.headers } : {})
    };
  }
  if (!server.command) return null;

  if (server.runtime === 'playwright' || server.id === 'mcp_default_playwright') {
    // The plugin installs Chromium under the data directory that holds
    // config.json, so no extra environment (and no signature change) is needed.
    const resolved = require('./playwright-runtime').resolveServer(server, appRoot, path.dirname(requireConfigPath()));
    if (!resolved.ok) return { error: resolved.error };
    return { type: 'local', command: [resolved.server.command, ...resolved.server.args],
      environment: resolved.server.env, enabled: true, timeout };
  }

  // A `runtime`-backed server stores a *placeholder* command, not a runnable
  // one: the shipped `mcp_default_codegraph` entry is literally `codegraph`,
  // which is not on PATH. Every other path resolves it through
  // `codegraph-runtime` (the kernel's own config does this in
  // `getOpenCodeMcpServers`), so the activation path has to resolve it too --
  // otherwise the kernel is handed a command that cannot spawn, and the server
  // is unreachable through `activate_mcp_server` while looking healthy in the
  // management view. Skipped when the args are already resolved, so a caller
  // that passes the runtime-resolved config does not get a doubled prefix.
  const resolved = resolveServerRuntime(server);
  if (resolved?.error) return { error: resolved.error };
  const ownArgs = Array.isArray(server.args) ? server.args.map(String) : [];
  const command = resolved
    ? [resolved.command, ...resolved.args, ...ownArgs]
    : [String(server.command), ...ownArgs];
  const environment = { ...(resolved?.env || {}), ...(server.env && typeof server.env === 'object' ? server.env : {}) };
  return {
    type: 'local',
    command,
    enabled: true,
    timeout,
    ...(Object.keys(environment).length ? { environment } : {})
  };
}

// `codegraph-runtime` is loaded lazily: it is only needed for the default
// CodeGraph server, and requiring it up front would cost every yan_mcp handshake
// for a runtime most calls never touch.
//
// Returns `null` when nothing needs prepending, which includes the case where
// the manifest's args already start with the runtime's -- a caller holding an
// already-resolved config must not get a doubled `node.exe ... codegraph.js`.
//
// Resolution failure is reported, not swallowed: falling back to the manifest's
// placeholder `codegraph` would hand the kernel a command that cannot spawn, so
// the caller would report a generic connection failure for what is really a
// missing/broken runtime install. `error` lets the tool say which it was.
function resolveServerRuntime(server) {
  if (String(server?.runtime || '').toLowerCase() !== 'codegraph') return null;
  const ownArgs = Array.isArray(server.args) ? server.args.map(String) : [];
  let runtime;
  try {
    runtime = require('./codegraph-runtime').resolveRuntime(appRoot);
  } catch (error) {
    return { error: `CodeGraph 运行时不可用：${error.message}` };
  }
  if (!runtime?.ok) return { error: `CodeGraph 运行时不可用：${runtime?.error || '未知原因'}` };
  // Compare on the entry script (the runtime's last arg), not on a positional
  // prefix: a config resolved by an older build may carry different flags, and
  // requiring every flag to still match at the same index would prepend a second
  // `node.exe <entry>` in front of an already-resolved command. The entry is the
  // one component that identifies "this is already the resolved runtime".
  const entry = runtime.args[runtime.args.length - 1];
  if (ownArgs.some(value => value === entry)) return null;
  return { command: runtime.command, args: runtime.args, env: runtime.env };
}


function requestKernel(baseUrl, pathname, method, authorization, body) {
  return new Promise(resolve => {
    let target;
    try {
      target = new URL(pathname, baseUrl);
      // OpenCode owns MCP clients per directory, not per HTTP server. It
      // launches this stdio server in that instance's directory. Without the
      // selector, /connect affects the kernel's default instance while the
      // calling session continues with an unchanged tool list.
      target.searchParams.set('directory', process.cwd());
    } catch (error) {
      return resolve({ status: 0, error: error.message });
    }
    const payload = body ? JSON.stringify(body) : null;
    const headers = { Authorization: authorization };
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = Buffer.byteLength(payload);
    }
    const request = http.request(target, { method, headers, timeout: 180_000 }, response => {
      let text = '';
      response.setEncoding('utf8');
      response.on('data', chunk => {
        text += String(chunk || '');
        if (text.length > 4_000_000) text = text.slice(-1_000_000);
      });
      response.on('end', () => {
        let json = null;
        try { json = text ? JSON.parse(text) : null; } catch {}
        resolve({ status: response.statusCode || 0, json, text: text.slice(0, 1000) });
      });
    });
    request.on('timeout', () => request.destroy(new Error('连接内核超时')));
    request.on('error', error => resolve({ status: 0, error: error.message }));
    if (payload) request.write(payload);
    request.end();
  });
}

function summarizeActivation(value) {
  if (value === true || value === false) return String(value);
  if (value === null || value === undefined) return '';
  try { return JSON.stringify(value).slice(0, 400); } catch { return ''; }
}

// A terminal status is one the kernel will not move away from on its own, so
// there is nothing to wait for.
const ACTIVATION_TERMINAL = new Set(['connected', 'failed', 'error', 'disabled', 'needs_auth']);
const ACTIVATION_POLL_INTERVAL_MS = 300;
// A local MCP has to spawn and handshake; a slow one can take several seconds
// legitimately, so `connecting` gets the full budget.
const ACTIVATION_POLL_BUDGET_MS = 8_000;
// The server being *absent* from the status map is different, and must not get
// that budget: `/connect` was already accepted, so the kernel registered it
// before answering -- if the name is still missing after a couple of polls it
// is not going to appear, and waiting the whole budget only delays the error.
// Measured from the first read, not from loop entry, so the grace period covers
// the polls themselves rather than being consumed before the first one.
const ACTIVATION_ABSENT_GRACE_MS = 900;

function activationState(response, name) {
  if (!(response.status >= 200 && response.status < 300)) return { settled: true, present: false };
  const state = response.json?.[name];
  if (!state) return { settled: false, present: false };
  return { settled: ACTIVATION_TERMINAL.has(String(state.status || '').toLowerCase()), present: true };
}

async function pollForActivation(baseUrl, name, authorization) {
  const deadline = Date.now() + ACTIVATION_POLL_BUDGET_MS;
  const firstReadAt = Date.now();
  let response = await requestKernel(baseUrl, '/mcp', 'GET', authorization);
  for (;;) {
    const { settled, present } = activationState(response, name);
    if (settled) return response;
    if (!present && Date.now() - firstReadAt >= ACTIVATION_ABSENT_GRACE_MS) return response;
    if (Date.now() >= deadline) return response;
    await new Promise(resolve => setTimeout(resolve, ACTIVATION_POLL_INTERVAL_MS));
    response = await requestKernel(baseUrl, '/mcp', 'GET', authorization);
  }
}

async function activateDeferredMcp(input = {}) {
  const id = String(input.id || input.name || '').trim();
  if (!id) return { ok: false, error: '缺少要激活的 MCP id。' };
  const name = sanitizeMcpName(id) || id;
  const endpoints = await readKernelEndpoints();
  if (!endpoints.length) {
    return { ok: false, id, name, error: '当前没有运行中的 Yan 内核，无法按需连接 MCP。' };
  }
  const config = deferredServerConfig(id);
  // A `{ error }` here means the *local* resolution of the server's runtime
  // failed (broken/absent CodeGraph install). Sending the manifest's placeholder
  // command to the kernel would produce a connection failure whose message
  // blames the MCP rather than the install, so surface it before connecting.
  if (config?.error) {
    return { ok: false, id, name, connected: 0, kernels: endpoints.length, error: config.error };
  }
  const results = [];
  for (const endpoint of endpoints) {
    const authorization = `Basic ${Buffer.from(`${endpoint.username}:${endpoint.password}`).toString('base64')}`;
    let response = await requestKernel(endpoint.url, `/mcp/${encodeURIComponent(name)}/connect`, 'POST', authorization);
    if (!(response.status >= 200 && response.status < 300) && config) {
      response = await requestKernel(endpoint.url, '/mcp', 'POST', authorization, { name, config });
    }
    // /connect acknowledges the request with a boolean, even if the MCP
    // handshake failed. Only the kernel's live status proves tools are ready.
    //
    // That status is not available the instant /connect returns: a local MCP
    // has to spawn and complete its JSON-RPC handshake, which routinely takes
    // longer than the round trip that started it. A single immediate read
    // therefore reported failure for servers that came up a moment later, and
    // the model would give up on a working MCP. Poll until it connects or the
    // budget runs out -- and still report the *last* state, so a genuinely
    // broken server keeps its real error instead of a generic timeout.
    const accepted = response.status >= 200 && response.status < 300;
    const statusResponse = accepted
      ? await pollForActivation(endpoint.url, name, authorization)
      : response;
    const state = statusResponse.json?.[name];
    const ok = accepted && statusResponse.status >= 200 && statusResponse.status < 300
      && state?.status === 'connected';
    results.push({
      url: endpoint.url,
      directory: process.cwd(),
      ok,
      status: statusResponse.status,
      detail: state ? summarizeActivation(state)
        : (statusResponse.error || (!accepted || statusResponse.status >= 300
          ? statusResponse.text : '') || `内核状态中不存在该 MCP（missing），连接未被接受：${name}`)
    });
  }
  const connected = results.filter(item => item.ok).length;
  return {
    ok: connected > 0,
    id,
    name,
    connected,
    kernels: endpoints.length,
    results,
    note: connected > 0
      ? 'MCP 已连接，其工具在本轮后续步骤中可用；不需要时不会自动加载。'
      : '连接失败：请确认该 MCP 已配置且当前任务内核正在运行。'
  };
}

function toolDefinitions() {
  return [
    {
      name: 'list_mcp_servers',
      description: 'List every MCP server configured in Yan right now (built-in and user-installed) with its introduction, transport, command/args or URL, and enabled state. Read-only; call it before installing so an existing or built-in entry is never duplicated, and to see which servers still have no introduction.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'verify_mcp_server',
      description: 'Check a candidate MCP server against its official source before installing it: the launcher package is looked up in the official npm or PyPI registry, and the server must complete a real MCP handshake (local process or remote Streamable HTTP endpoint) and list its tools. Returns the evidence; it never writes configuration. Call this when the user pasted docs or a command and you need to confirm the facts.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'MCP display name, used only for reporting here.' },
          type: { type: 'string', enum: ['local', 'remote'], description: 'local = stdio command, remote = Streamable HTTP URL.' },
          command: { type: 'string', description: 'Local launcher, e.g. npx / uvx / node / an absolute path.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Local launcher arguments, exactly as documented.' },
          url: { type: 'string', description: 'Remote Streamable HTTP endpoint (http/https).' },
          headers: { type: 'object', description: 'Remote request headers such as Authorization.' },
          live: { type: 'boolean', description: 'Default true: actually start/probe the server. Set false to only check the official registry.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'install_mcp_server',
      description: 'Install one MCP server into Yan after validating it against the install rules and (by default) the official source. Use the values you confirmed with verify_mcp_server or the official documentation, and always pass a short Chinese description of what the server provides (the MCP card has no other introduction; when it is omitted, the official registry summary or the handshake tool list is used as a fallback). Refuses when the official registry has no such package, the handshake fails, or the name collides with a built-in server; pass allow_unverified true only when the user explicitly accepts an unverified install. Built-in servers are never overwritten, duplicates are not re-added, an existing server only receives a description when it has none, and credentials are not written: a server that needs secret environment variables must be added by the user in the MCP services page.',
      inputSchema: {
        type: 'object',
        properties: {
          name: { type: 'string', description: 'Display name for the MCP server.' },
          description: { type: 'string', description: '一句简要说明：这个 MCP 提供什么能力（依据官方资料，中文，建议 ≤60 字）。会显示在 MCP 服务卡片上；缺失时会用官方 registry 摘要或握手列出的工具兜底。' },
          type: { type: 'string', enum: ['local', 'remote'], description: 'local = stdio command, remote = Streamable HTTP URL.' },
          command: { type: 'string', description: 'Local launcher, e.g. npx / uvx / node / an absolute path.' },
          args: { type: 'array', items: { type: 'string' }, description: 'Local launcher arguments, exactly as documented.' },
          url: { type: 'string', description: 'Remote Streamable HTTP endpoint (http/https).' },
          headers: { type: 'object', description: 'Remote request headers such as Authorization.' },
          verify: { type: 'boolean', description: 'Default true. Run official-source verification before writing the configuration.' },
          live: { type: 'boolean', description: 'Default true. With verify, actually start/probe the server instead of only checking the registry.' },
          allow_unverified: { type: 'boolean', description: 'Install even though official verification definitively failed. Only after the user accepts it.' },
          source: { type: 'string', description: 'The official page you verified the facts against, for the report.' }
        },
        required: ['name'],
        additionalProperties: false
      }
    },
    {
      name: 'remove_mcp_server',
      description: 'Remove one user-installed MCP server from Yan by id or name. Built-in/system-managed servers are protected and the call is refused.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'Server id, e.g. mcp_1730000000000.' },
          name: { type: 'string', description: 'Server display name.' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'activate_mcp_server',
      description: 'Connect one default-deferred MCP server to the currently running Yan kernel so its tools become available for later steps. Call this only when the task genuinely needs that MCP: deferred servers are left unconnected by default to keep the first reply fast, and connecting may take time. Pass the MCP id shown in the system prompt (for example mcp_default_playwright).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string', description: 'MCP id to activate, e.g. mcp_default_playwright.' }
        },
        required: ['id'],
        additionalProperties: false
      }
    }
  ];
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object' ? request.params.arguments : {};
  try {
    let result;
    switch (name) {
      case 'list_mcp_servers': {
        result = listMcpServersFromConfig(requireConfigPath());
        break;
      }
      case 'verify_mcp_server': {
        const normalized = normalizeMcpInstallRequest(input);
        if (!normalized.ok) {
          result = { ok: false, error: normalized.error };
          break;
        }
        const verification = await verifyMcpSource(normalized.server, {
          allowNetwork,
          live: input.live !== false,
          clientVersion
        });
        result = {
          ok: verification.blocked !== true,
          verified: verification.verified === true,
          blocked: verification.blocked === true,
          server: summarizeServer(normalized.server),
          verification: summarizeVerification(verification),
          ...(verification.error ? { error: verification.error } : {})
        };
        break;
      }
      case 'install_mcp_server': {
        const normalized = normalizeMcpInstallRequest(input);
        if (!normalized.ok) {
          result = { ok: false, error: normalized.error };
          break;
        }
        let verification = null;
        if (input.verify !== false) {
          verification = await verifyMcpSource(normalized.server, {
            allowNetwork,
            live: input.live !== false,
            clientVersion
          });
          if (verification.blocked === true && input.allow_unverified !== true) {
            result = {
              ok: false,
              blocked: true,
              error: verification.error,
              server: summarizeServer(normalized.server),
              verification: summarizeVerification(verification),
              hint: '官方核对未通过，已拒绝安装。修正包名/参数/地址后重试；只有当用户明确接受未核实安装时才传 allow_unverified=true。'
            };
            break;
          }
        }
        const description = normalized.server.description || officialDescription(verification);
        const added = addMcpServerToConfig(
          requireConfigPath(),
          description ? { ...normalized.server, description } : normalized.server
        );
        if (!added.ok) {
          result = { ok: false, error: added.error, server: summarizeServer(normalized.server) };
          break;
        }
        result = {
          ok: true,
          installed: added.installed === true,
          action: added.action,
          server: summarizeServer(added.server),
          configPath: added.configPath,
          verified: verification ? verification.verified === true : false,
          verification: verification ? summarizeVerification(verification) : null,
          source: String(input.source || ''),
          effective: 'next-run',
          note: '新 MCP 在下一轮任务生效：内核按 MCP 配置签名启动，当前任务的内核已经启动。',
          ...(added.action === 'enrich'
            ? { descriptionNote: '该服务此前没有说明，已补上简介；已有说明不会被覆盖。' }
            : {})
        };
        break;
      }
      case 'remove_mcp_server': {
        result = removeMcpServerFromConfig(requireConfigPath(), input);
        break;
      }
      case 'activate_mcp_server': {
        result = await activateDeferredMcp(input);
        break;
      }
      default:
        throw new Error(`Unknown Yan MCP tool: ${name}`);
    }
    toolResult(request.id, result);
  } catch (error) {
    toolResult(request.id, { ok: false, error: error?.message || String(error), code: error?.code || 'YAN_MCP_TOOL_FAILED' });
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan MCP', version: '1.0.0' }
    });
    return;
  }
  if (message.method === 'ping') {
    success(message.id, {});
    return;
  }
  if (message.method === 'tools/list') {
    success(message.id, { tools: toolDefinitions() });
    return;
  }
  if (message.method === 'tools/call') {
    await callTool(message);
    return;
  }
  if (message.id !== undefined) failure(message.id, -32601, `Unsupported method: ${message.method}`);
}

let buffered = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  buffered += String(chunk || '');
  while (true) {
    const newline = buffered.indexOf('\n');
    if (newline < 0) break;
    const line = buffered.slice(0, newline).trim();
    buffered = buffered.slice(newline + 1);
    if (!line) continue;
    try {
      void handle(JSON.parse(line));
    } catch (error) {
      failure(null, -32700, error?.message || String(error));
    }
  }
});

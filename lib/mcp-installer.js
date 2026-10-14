'use strict';

// Yan MCP install rules + config persistence.
//
// This is the backend half of natural-language MCP installation: the
// agent-facing yan_mcp server validates a request with these rules and writes
// the result into the real YanData/config.json, exactly like the renderer
// wizard (lib/main/mcp-management.js buildUserMcpServer) does through
// mcp:add. Deliberately regex-free and dependency-free: the rules stay cheap
// to read and can be tested without Electron or the kernel.
//
// The config file also carries encrypted credentials (api keys are stored as
// `enc:v1:` ciphertext), so writes are always read-modify-write: unrelated
// fields and ciphertext strings are preserved byte for byte.

const fs = require('fs');
const path = require('path');
const { normalizeRemoteHeaders } = require('./mcp-remote');

const MAX_NAME = 120;
const MAX_COMMAND = 400;
const MAX_ARG = 400;
const MAX_ARGS = 40;
const MAX_URL = 2048;
const MAX_HEADERS = 16;
const MAX_DESCRIPTION = 200;

function hasLineBreak(value) {
  const text = String(value ?? '');
  return text.includes('\n') || text.includes('\r');
}

function cleanText(value, limit) {
  return String(value ?? '').split('\u0000').join('').trim().slice(0, limit);
}

// A short, single-line introduction shown on the MCP card. Newlines and
// control characters would break the card layout, so they collapse to spaces.
function cleanDescription(value) {
  let output = '';
  for (const character of String(value ?? '')) {
    const code = character.charCodeAt(0);
    if (code === 10 || code === 13 || code === 9) {
      output += ' ';
      continue;
    }
    if (code < 32 || code === 127) continue;
    output += character;
  }
  while (output.includes('  ')) output = output.replace('  ', ' ');
  return output.trim().slice(0, MAX_DESCRIPTION);
}

function sanitizeArgs(value) {
  const source = Array.isArray(value) ? value : [];
  const args = [];
  for (const item of source) {
    if (args.length >= MAX_ARGS) break;
    if (item === null || item === undefined || typeof item === 'object') continue;
    const text = cleanText(item, MAX_ARG);
    if (!text || hasLineBreak(text)) continue;
    args.push(text);
  }
  return args;
}

function sanitizeHeaders(value) {
  const normalized = normalizeRemoteHeaders(value);
  const headers = {};
  for (const key of Object.keys(normalized)) {
    if (Object.keys(headers).length >= MAX_HEADERS) break;
    headers[key] = normalized[key];
  }
  return headers;
}

// Returns { ok: true, server } with a normalized, not-yet-persisted entry, or
// { ok: false, error } describing the rule the request broke.
function normalizeMcpInstallRequest(input = {}) {
  const name = cleanText(input.name, MAX_NAME);
  if (!name) return { ok: false, error: '请输入 MCP 名称。' };
  if (hasLineBreak(name)) return { ok: false, error: 'MCP 名称不能包含换行。' };
  const type = String(input.type || '').trim().toLowerCase();
  const url = cleanText(input.url, MAX_URL);
  const command = cleanText(input.command, MAX_COMMAND);
  const description = cleanDescription(input.description);
  const remote = type === 'remote' || (!command && !!url);
  if (remote) {
    if (!(url.startsWith('http://') || url.startsWith('https://'))) {
      return { ok: false, error: '远程 MCP 地址必须以 http:// 或 https:// 开头。' };
    }
    const headers = sanitizeHeaders(input.headers);
    return {
      ok: true,
      server: {
        name,
        type: 'remote',
        url,
        ...(Object.keys(headers).length ? { headers } : {}),
        ...(description ? { description } : {}),
        enabled: input.enabled !== false
      }
    };
  }
  if (!command) return { ok: false, error: '本地 MCP 需要启动命令（command）。' };
  if (hasLineBreak(command)) return { ok: false, error: '启动命令不能包含换行。' };
  return {
    ok: true,
    server: {
      name,
      command,
      args: sanitizeArgs(input.args),
      ...(description ? { description } : {}),
      enabled: input.enabled !== false
    }
  };
}

// Two configured servers are the same service when they share a name, or when
// they would launch/probe the exact same target.
function serverIdentity(server = {}) {
  if (server.type === 'remote' || (!server.command && server.url)) {
    return `remote:${String(server.url || '').trim().toLowerCase()}`;
  }
  const command = String(server.command || '').trim().toLowerCase();
  const args = Array.isArray(server.args) ? server.args.map(value => String(value).trim()).join(' ') : '';
  return `local:${command} ${args}`.trim();
}

// Built-in servers are owned by Yan: never overwritten, never removed.
function isProtectedMcpServer(server = {}) {
  return server.builtin === true
    || server.systemManaged === true
    || String(server.id || '').startsWith('mcp_default_');
}

function readMcpConfig(configPath) {
  if (!configPath) return { ok: false, error: '缺少 Yan 配置路径。' };
  let raw = '';
  try {
    raw = fs.readFileSync(configPath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return { ok: true, config: {}, exists: false };
    return { ok: false, error: `读取 Yan 配置失败：${error?.message || error}` };
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: 'Yan 配置无法解析为 JSON，已中止以免覆盖用户数据。' };
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ok: false, error: 'Yan 配置不是 JSON 对象，已中止以免覆盖用户数据。' };
  }
  return { ok: true, config: parsed, exists: true };
}

function writeMcpConfigAtomic(configPath, config) {
  writeJsonAtomic(configPath, config);
}

function writeJsonAtomic(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const fd = fs.openSync(temporary, 'w');
  try {
    fs.writeFileSync(fd, JSON.stringify(value, null, 2), 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  try {
    fs.renameSync(temporary, filePath);
  } catch {
    // Windows cannot always replace an existing file with renameSync; the
    // fallback still writes the complete temporary file before replacing it.
    fs.copyFileSync(temporary, filePath);
    fs.rmSync(temporary, { force: true });
  }
}

// Agent-installed servers are mirrored next to the config so that an
// unrelated in-memory config save (the app persists the whole config object)
// cannot silently drop a just-installed MCP server. ensureDefaultMcp merges
// the mirror back on load; removals clear it.
function mcpMirrorPath(configPath) {
  return path.join(path.dirname(configPath), 'mcp', 'user-servers.json');
}

function readMcpMirror(configPath) {
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(mcpMirrorPath(configPath), 'utf8'));
  } catch {
    return [];
  }
  const servers = Array.isArray(parsed?.servers) ? parsed.servers : [];
  return servers.filter(server => server && typeof server === 'object' && String(server.id || '').trim());
}

function writeMcpMirror(configPath, servers) {
  writeJsonAtomic(mcpMirrorPath(configPath), { version: 1, servers });
}

function removeMcpServerFromMirror(configPath, id) {
  const key = String(id || '').trim();
  if (!key) return false;
  const current = readMcpMirror(configPath);
  const next = current.filter(server => String(server?.id || '') !== key);
  if (next.length === current.length) return false;
  writeMcpMirror(configPath, next);
  return true;
}

// `mcp_<Date.now()>` alone is not unique: the manual form and a scripted install
// can land in the same millisecond, and two servers sharing an id means the
// second silently shadows the first (the kernel maps them by id, and the mirror
// dedupes by id). Always widen with a numeric suffix until the id is free.
function allocateMcpServerId(list, options = {}) {
  const now = Number.isFinite(Number(options.now)) ? Number(options.now) : Date.now();
  const taken = new Set(
    (Array.isArray(list) ? list : []).map(server => String(server?.id || '')).filter(Boolean)
  );
  let id = `mcp_${now}`;
  let suffix = 1;
  while (taken.has(id)) {
    id = `mcp_${now}_${suffix}`;
    suffix += 1;
  }
  return id;
}

function planMcpInstall(config, request, options = {}) {
  const normalized = normalizeMcpInstallRequest(request);
  if (!normalized.ok) return normalized;
  const list = Array.isArray(config?.mcpServers) ? config.mcpServers : [];
  const wanted = normalized.server;
  const wantedName = wanted.name.toLowerCase();
  const wantedIdentity = serverIdentity(wanted);
  const existing = list.find(server => String(server?.name || '').trim().toLowerCase() === wantedName)
    || list.find(server => serverIdentity(server) === wantedIdentity);
  if (existing) {
    if (isProtectedMcpServer(existing)) {
      return { ok: false, error: `「${wanted.name}」与内置 MCP 重名，内置服务不可覆盖。` };
    }
    // Existing cards without an introduction get one; an existing description
    // is never overwritten by a re-install.
    const wantedDescription = String(wanted.description || '').trim();
    if (wantedDescription && !String(existing.description || '').trim()) {
      const enriched = { ...existing, description: wantedDescription };
      return {
        ok: true,
        action: 'enrich',
        server: enriched,
        config: {
          ...config,
          mcpServers: list.map(server => (server === existing ? enriched : server))
        }
      };
    }
    return { ok: true, action: 'exists', server: existing };
  }
  const server = { id: allocateMcpServerId(list, options), ...wanted };
  return {
    ok: true,
    action: 'add',
    server,
    config: { ...config, mcpServers: [...list, server] }
  };
}

function addMcpServerToConfig(configPath, request, options = {}) {
  const read = readMcpConfig(configPath);
  if (!read.ok) return read;
  const planned = planMcpInstall(read.config, request, options);
  if (!planned.ok) return planned;
  if (planned.action === 'exists') {
    return { ok: true, installed: false, action: 'exists', server: planned.server, configPath };
  }
  // Mirror first: if the config write is interrupted, the next load re-merges
  // the entry instead of losing it.
  writeMcpMirror(configPath, [
    ...readMcpMirror(configPath).filter(server => String(server?.id || '') !== String(planned.server.id)),
    planned.server
  ]);
  writeMcpConfigAtomic(configPath, planned.config);
  return {
    ok: true,
    installed: planned.action === 'add',
    action: planned.action,
    server: planned.server,
    configPath
  };
}

function listMcpServersFromConfig(configPath) {
  const read = readMcpConfig(configPath);
  if (!read.ok) return read;
  const list = Array.isArray(read.config.mcpServers) ? read.config.mcpServers : [];
  return {
    ok: true,
    configPath,
    exists: read.exists === true,
    servers: list.map(server => ({
      id: String(server?.id || ''),
      name: String(server?.name || server?.id || ''),
      type: server?.type === 'remote' || (!server?.command && server?.url) ? 'remote' : 'local',
      enabled: server?.enabled !== false,
      builtin: isProtectedMcpServer(server),
      description: String(server?.description || ''),
      command: server?.command ? String(server.command) : '',
      args: Array.isArray(server?.args) ? server.args.map(String) : [],
      url: server?.url ? String(server.url) : ''
    }))
  };
}

function removeMcpServerFromConfig(configPath, input = {}) {
  const read = readMcpConfig(configPath);
  if (!read.ok) return read;
  const list = Array.isArray(read.config.mcpServers) ? read.config.mcpServers : [];
  const id = String(input.id || '').trim();
  const name = String(input.name || '').trim().toLowerCase();
  if (!id && !name) return { ok: false, error: '请提供要移除的 MCP id 或名称。' };
  const index = list.findIndex(server => (
    (id && String(server?.id || '') === id)
    || (name && String(server?.name || '').trim().toLowerCase() === name)
  ));
  if (index < 0) return { ok: false, error: '未找到匹配的 MCP 服务。' };
  const target = list[index];
  if (isProtectedMcpServer(target)) {
    return { ok: false, error: '预装/系统管理的 MCP 服务器不可删除。' };
  }
  removeMcpServerFromMirror(configPath, target?.id);
  writeMcpConfigAtomic(configPath, {
    ...read.config,
    mcpServers: list.filter((_, position) => position !== index)
  });
  return {
    ok: true,
    removed: true,
    server: { id: String(target?.id || ''), name: String(target?.name || '') },
    configPath
  };
}

module.exports = {
  MAX_ARGS,
  MAX_NAME,
  cleanDescription,
  normalizeMcpInstallRequest,
  serverIdentity,
  isProtectedMcpServer,
  readMcpConfig,
  writeMcpConfigAtomic,
  mcpMirrorPath,
  readMcpMirror,
  removeMcpServerFromMirror,
  planMcpInstall,
  allocateMcpServerId,
  addMcpServerToConfig,
  listMcpServersFromConfig,
  removeMcpServerFromConfig
};

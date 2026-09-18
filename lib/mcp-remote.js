'use strict';

// Yan remote MCP client (Streamable HTTP).
//
// The runtime path for remote MCP servers is the OpenCode kernel itself: the
// sidecar maps a `{ type: 'remote', url, headers }` entry straight into its
// `mcp` config. This module is the management-side probe: it performs a real
// Streamable HTTP JSON-RPC handshake (initialize -> notifications/initialized
// -> tools/list) so the install wizard and the detail page can test a remote
// endpoint without starting the kernel.
//
// Implements the client side of MCP Streamable HTTP:
//   - POST JSON-RPC messages to the endpoint URL
//   - `Accept: application/json, text/event-stream`
//   - carry the `Mcp-Session-Id` returned by initialize into later requests
//   - send `MCP-Protocol-Version` on requests after initialization

const DEFAULT_TIMEOUT_MS = 30_000;
const MIN_TIMEOUT_MS = 3_000;
const MAX_TIMEOUT_MS = 300_000;
const MAX_RESPONSE_BYTES = 4 * 1024 * 1024;
const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

function isRemoteMcpServer(server = {}) {
  const type = String(server?.type || '').trim().toLowerCase();
  const url = String(server?.url || '').trim();
  if (!url) return false;
  if (type === 'remote') return true;
  return !server?.command;
}

function remoteUrlOf(server = {}) {
  return isRemoteMcpServer(server) ? String(server.url || '').trim() : '';
}

function normalizeRemoteHeaders(value) {
  const result = {};
  if (!value || typeof value !== 'object' || Array.isArray(value)) return result;
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || '').trim();
    if (!key || /[\r\n]/.test(key)) continue;
    const text = String(rawValue ?? '');
    if (/[\r\n]/.test(text)) continue;
    result[key] = text;
  }
  return result;
}

function probeTimeoutMs(server = {}) {
  const declared = Number(server?.timeout);
  const value = Number.isFinite(declared) && declared > 0 ? declared : DEFAULT_TIMEOUT_MS;
  return Math.max(MIN_TIMEOUT_MS, Math.min(MAX_TIMEOUT_MS, value));
}

async function readBoundedText(response, limit = MAX_RESPONSE_BYTES) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') return '';
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > limit) throw new Error('Remote MCP response exceeded the size limit.');
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    try { reader.releaseLock(); } catch {}
  }
  text += decoder.decode();
  return text;
}

function parseJsonOrNull(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return null;
  return JSON.parse(trimmed);
}

async function readSseMessage(response, expectedId) {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') return null;
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let bytes = 0;
  const messages = [];
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value?.byteLength || 0;
      if (bytes > MAX_RESPONSE_BYTES) throw new Error('Remote MCP response exceeded the size limit.');
      buffer += decoder.decode(value, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newline).replace(/\r$/, '');
        buffer = buffer.slice(newline + 1);
        if (!line.startsWith('data:')) continue;
        const payload = line.slice(5).trim();
        if (!payload) continue;
        let message;
        try { message = JSON.parse(payload); } catch { continue; }
        if (expectedId != null && message?.id === expectedId) return message;
        messages.push(message);
      }
    }
  } finally {
    try { reader.releaseLock(); } catch {}
    try { await response.body?.cancel?.(); } catch {}
  }
  // The stream ended without the matching response; fall back to any response
  // message that carried an id so the caller can surface its JSON-RPC error.
  return messages.find(message => message?.id != null) || null;
}

async function rpc(url, payload, options = {}) {
  const {
    headers = {},
    signal,
    sessionId = '',
    protocolVersion = '',
    expectResponse = true
  } = options;
  const requestHeaders = {
    ...headers,
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream'
  };
  if (sessionId) requestHeaders['mcp-session-id'] = sessionId;
  if (protocolVersion) requestHeaders['mcp-protocol-version'] = protocolVersion;

  const response = await fetch(url, {
    method: 'POST',
    headers: requestHeaders,
    body: JSON.stringify(payload),
    signal
  });
  const nextSessionId = response.headers.get('mcp-session-id') || sessionId || '';

  if (response.status === 401 || response.status === 403) {
    return {
      error: `服务返回 ${response.status}，请检查鉴权请求头（如 Authorization）。`,
      sessionId: nextSessionId
    };
  }
  if (response.status === 404 || response.status === 405) {
    return {
      error: `服务返回 ${response.status}，该地址可能不是 Streamable HTTP MCP 端点。`,
      sessionId: nextSessionId
    };
  }
  if (!response.ok) {
    let detail = '';
    try { detail = (await readBoundedText(response, 8 * 1024)).trim(); } catch {}
    return {
      error: `服务返回 HTTP ${response.status}${detail ? `：${detail.slice(0, 200)}` : ''}`,
      sessionId: nextSessionId
    };
  }
  if (!expectResponse || response.status === 202 || response.status === 204) {
    try { await response.body?.cancel?.(); } catch {}
    return { message: null, sessionId: nextSessionId };
  }

  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType.includes('text/event-stream')) {
    const message = await readSseMessage(response, payload?.id);
    return { message, sessionId: nextSessionId };
  }

  let text = '';
  try { text = await readBoundedText(response); } catch (error) {
    return { error: error?.message || String(error), sessionId: nextSessionId };
  }
  try {
    return { message: parseJsonOrNull(text), sessionId: nextSessionId };
  } catch {
    return { error: '服务返回了非 JSON 的内容。', sessionId: nextSessionId };
  }
}

async function probeRemoteServer(server = {}, options = {}) {
  const url = remoteUrlOf(server);
  if (!url) return { ok: false, error: '远程 MCP 地址为空。' };
  if (!/^https?:\/\//i.test(url)) {
    return { ok: false, error: '远程 MCP 地址必须以 http:// 或 https:// 开头。' };
  }
  if (typeof fetch !== 'function') return { ok: false, error: '当前运行时不支持 fetch。' };

  const headers = normalizeRemoteHeaders(server.headers);
  const timeoutMs = probeTimeoutMs(server);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const initialized = await rpc(url, {
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: DEFAULT_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: {
          name: 'Yan Agent',
          version: String(options.clientVersion || '').trim() || '0.0.0'
        }
      }
    }, { headers, signal: controller.signal });
    if (initialized.error) return { ok: false, error: initialized.error };
    const message = initialized.message;
    if (!message) return { ok: false, error: '服务未返回 initialize 响应。' };
    if (message.error) {
      return { ok: false, error: message.error.message || '远程 MCP initialize 失败。' };
    }
    const result = message.result || {};
    const sessionId = initialized.sessionId;
    const protocolVersion = String(result.protocolVersion || DEFAULT_PROTOCOL_VERSION);

    await rpc(url, { jsonrpc: '2.0', method: 'notifications/initialized' }, {
      headers,
      signal: controller.signal,
      sessionId,
      protocolVersion,
      expectResponse: false
    }).catch(() => {});

    if (options.listTools === false) {
      return { ok: true, tools: [], serverInfo: result.serverInfo || null, protocolVersion };
    }

    const listed = await rpc(url, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, {
      headers,
      signal: controller.signal,
      sessionId,
      protocolVersion
    });
    if (listed.error) return { ok: false, error: listed.error };
    if (!listed.message) return { ok: false, error: '服务未返回 tools/list 响应。' };
    if (listed.message.error) {
      return { ok: false, error: listed.message.error.message || '远程 MCP tools/list 失败。' };
    }
    return {
      ok: true,
      tools: listed.message.result?.tools || [],
      serverInfo: result.serverInfo || null,
      protocolVersion
    };
  } catch (error) {
    if (error?.name === 'AbortError') {
      return { ok: false, error: `连接超时（${Math.round(timeoutMs / 1000)} 秒）。` };
    }
    return { ok: false, error: error?.message || String(error) };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  DEFAULT_PROTOCOL_VERSION,
  isRemoteMcpServer,
  normalizeRemoteHeaders,
  probeRemoteServer,
  remoteUrlOf
};

'use strict';

const net = require('net');

const bridgePort = Number(process.env.YAN_SESSION_BRIDGE_PORT || 0);
const bridgeToken = String(process.env.YAN_SESSION_BRIDGE_TOKEN || '');
const activeCalls = new Map();
const MAX_BRIDGE_RESPONSE_BYTES = 8 * 1024 * 1024;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Session MCP error') } });
}

function bridgeCall(action, params, signal) {
  if (!bridgePort || !bridgeToken) return Promise.reject(new Error('Yan session bridge is not configured.'));
  return new Promise((resolve, reject) => {
    let settled = false;
    let input = '';
    const socket = net.createConnection({ host: '127.0.0.1', port: bridgePort });
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      if (!socket.destroyed) socket.destroy();
      if (error) reject(error);
      else resolve(result);
    };
    const onAbort = () => {
      const error = new Error('Yan session operation was cancelled.');
      error.name = 'AbortError';
      finish(error);
    };
    const timeoutMs = action === 'create_handoff' ? 285000 : 45000;
    const timer = setTimeout(() => finish(new Error('Yan session bridge timed out.')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: bridgeToken, action, params })}\n`);
    });
    socket.on('data', chunk => {
      input += String(chunk || '');
      if (Buffer.byteLength(input, 'utf8') > MAX_BRIDGE_RESPONSE_BYTES) {
        finish(new Error('Yan session bridge response exceeded the limit.'));
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(input.slice(0, newline));
        if (!response?.ok) finish(new Error(response?.error || 'Yan session bridge failed.'));
        else finish(null, response.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => {
      if (!settled) finish(new Error('Yan session bridge closed without a response.'));
    });
    if (signal?.aborted) onAbort();
  });
}

function toolDefinitions() {
  return [
    {
      name: 'create_handoff',
      description: 'Navigate Yan to another existing workspace after explicit user authorization. Yan reuses the most recently updated task already assigned to that workspace; only when no task exists there does it create an independent task and carry bounded source context into it. Use this whenever the user asks to open, return to, or continue in another workspace. Full Access and delegated approval never bypass authorization. Do not claim you cannot switch Yan tasks when this tool is available.',
      inputSchema: {
        type: 'object',
        properties: {
          target_path: { type: 'string', description: 'Existing target workspace as an absolute path.' },
          reason: { type: 'string', description: 'Why Yan should enter the target workspace task.' }
        },
        required: ['target_path', 'reason'],
        additionalProperties: false
      }
    },
    {
      name: 'read_source_context',
      description: 'Read a bounded page of the authoritative source Yan task when the current task was created by create_handoff and the injected handoff summary lacks a needed detail. This can only read the one source task bound to the current task.',
      inputSchema: {
        type: 'object',
        properties: {
          start: { type: 'integer', minimum: 0, default: 0 },
          limit: { type: 'integer', minimum: 1, maximum: 20, default: 10 }
        },
        additionalProperties: false
      }
    }
  ];
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  const controller = new AbortController();
  activeCalls.set(request.id, controller);
  try {
    const action = name === 'create_handoff'
      ? 'create_handoff'
      : (name === 'read_source_context' ? 'read_source_context' : '');
    if (!action) throw new Error(`Unknown Yan session tool: ${name}`);
    const result = await bridgeCall(action, input, controller.signal);
    const structured = result && typeof result === 'object'
      ? result
      : { ok: true, output: String(result || '') };
    success(request.id, {
      content: [{ type: 'text', text: JSON.stringify(structured) }],
      structuredContent: structured,
      isError: structured.ok === false
    });
  } catch (error) {
    const result = { ok: false, error: error?.message || String(error), code: error?.code || 'YAN_SESSION_TOOL_FAILED' };
    success(request.id, {
      content: [{ type: 'text', text: JSON.stringify(result) }],
      structuredContent: result,
      isError: true
    });
  } finally {
    activeCalls.delete(request.id);
  }
}

async function handle(message) {
  if (!message || message.jsonrpc !== '2.0') return;
  if (message.method === 'notifications/cancelled') {
    activeCalls.get(message.params?.requestId)?.abort();
    return;
  }
  if (message.method === 'notifications/initialized') return;
  if (message.method === 'initialize') {
    success(message.id, {
      protocolVersion: String(message.params?.protocolVersion || '2025-03-26'),
      capabilities: { tools: { listChanged: false } },
      serverInfo: { name: 'Yan Session', version: '1.0.0' }
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

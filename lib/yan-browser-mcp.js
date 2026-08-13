'use strict';

const net = require('net');

const bridgePort = Number(process.env.YAN_BROWSER_BRIDGE_PORT || 0);
const bridgeToken = String(process.env.YAN_BROWSER_BRIDGE_TOKEN || '');
const networkAllowed = process.env.YAN_BROWSER_ALLOW_NETWORK !== 'false';
const activeCalls = new Map();
const MAX_BRIDGE_RESPONSE_BYTES = 16 * 1024 * 1024;

function send(message) {
  process.stdout.write(`${JSON.stringify(message)}\n`);
}

function success(id, result) {
  send({ jsonrpc: '2.0', id, result });
}

function failure(id, code, message) {
  send({ jsonrpc: '2.0', id, error: { code, message: String(message || 'Yan Browser MCP error') } });
}

function bridgeCall(action, params, signal) {
  if (!bridgePort || !bridgeToken) return Promise.reject(new Error('Yan built-in browser bridge is not configured.'));
  return new Promise((resolve, reject) => {
    const operationId = `browser-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
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
      const error = new Error('Yan built-in browser operation was cancelled.');
      error.name = 'AbortError';
      error.code = 'BROWSER_ACTION_CANCELLED';
      finish(error);
    };
    const timeoutMs = action === 'screenshot' ? 135_000 : 45_000;
    const timer = setTimeout(() => finish(new Error('Yan built-in browser bridge timed out.')), timeoutMs);
    signal?.addEventListener('abort', onAbort, { once: true });
    socket.setEncoding('utf8');
    socket.on('connect', () => {
      socket.write(`${JSON.stringify({ token: bridgeToken, operationId, action, params })}\n`);
    });
    socket.on('data', chunk => {
      input += String(chunk || '');
      if (Buffer.byteLength(input, 'utf8') > MAX_BRIDGE_RESPONSE_BYTES) {
        finish(new Error('Yan built-in browser response exceeded the bridge limit.'));
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(input.slice(0, newline));
        if (!response?.ok) {
          const error = new Error(response?.error || 'Yan built-in browser bridge failed.');
          error.code = response?.code || 'YAN_BROWSER_BRIDGE_FAILED';
          finish(error);
        } else finish(null, response.result);
      } catch (error) {
        finish(error);
      }
    });
    socket.on('error', error => finish(error));
    socket.on('end', () => {
      if (!settled) finish(new Error('Yan built-in browser bridge closed without a response.'));
    });
    if (signal?.aborted) onAbort();
  });
}

function toolDefinitions() {
  const tools = [
    {
      name: 'open_builtin_browser',
      description: 'Open a URL, search query, absolute local file, or workspace-relative preview in a dedicated Agent-owned Yan browser tab. This never replaces the page the user is currently viewing. Use it first for ordinary browsing, research, local previews, and website verification.',
      inputSchema: {
        type: 'object',
        properties: {
          target_type: { type: 'string', enum: ['url', 'search', 'file'], description: 'Use url for a complete HTTP(S) URL, search for a query, and file for an absolute or workspace-relative local path.' },
          url_or_path: { type: 'string', description: 'Complete HTTP(S) URL, search query, absolute file path, or path relative to the active Yan workspace.' }
        },
        required: ['target_type', 'url_or_path'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_snapshot',
      description: 'Inspect the current Yan browser page and return fresh element refs, roles, labels, states, and visible text. Every ref belongs only to this latest snapshot: taking another snapshot or navigating invalidates all older refs. Call this before click or type, and call it again after navigation or major page changes.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'browser_read_page',
      description: 'Read up to 12000 characters of current page text with its URL and title. Prefer this over screenshots when the task is textual research or summarization.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'browser_click',
      description: 'Click one element from the latest browser_snapshot by ref. Yan verifies that the intended element receives the event and reports whether the target or page changed; do not repeat the click or inspect source code when this result already confirms the expected state change.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Element ref from the latest browser_snapshot only, such as e3.' },
          button: { type: 'string', enum: ['left', 'right'], default: 'left' },
          click_count: { type: 'integer', enum: [1, 2], default: 1 }
        },
        required: ['ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_type',
      description: 'Replace the value of an input from the latest browser_snapshot and dispatch normal input/change events.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string', description: 'Fresh textbox or editable element ref.' },
          text: { type: 'string', description: 'Exact text to enter.' },
          submit: { type: 'boolean', default: false, description: 'Press Enter after entering the text.' }
        },
        required: ['ref', 'text'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_select',
      description: 'Choose one option in a native select element by exact value or visible label.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          value: { type: 'string', description: 'Exact option value or visible label.' }
        },
        required: ['ref', 'value'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_check',
      description: 'Set a checkbox, radio option, switch, or equivalent ARIA control to the requested checked state.',
      inputSchema: {
        type: 'object',
        properties: {
          ref: { type: 'string' },
          checked: { type: 'boolean', default: true }
        },
        required: ['ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_hover',
      description: 'Move the independent Agent pointer over an element to reveal hover UI without moving the user mouse.',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_focus',
      description: 'Focus an element from the latest snapshot without clicking it.',
      inputSchema: {
        type: 'object',
        properties: { ref: { type: 'string' } },
        required: ['ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_drag',
      description: 'Drag from one fresh element ref to another using the independent Agent pointer.',
      inputSchema: {
        type: 'object',
        properties: { from_ref: { type: 'string' }, to_ref: { type: 'string' } },
        required: ['from_ref', 'to_ref'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_pointer',
      description: 'Operate canvas, maps, games, and other visual surfaces by viewport coordinates. Use only after a fresh screenshot or snapshot provides reliable coordinates.',
      inputSchema: {
        type: 'object',
        properties: {
          action: { type: 'string', enum: ['click', 'hover', 'drag'] },
          x: { type: 'number' },
          y: { type: 'number' },
          to_x: { type: 'number' },
          to_y: { type: 'number' },
          button: { type: 'string', enum: ['left', 'right'], default: 'left' }
        },
        required: ['action', 'x', 'y'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_press',
      description: 'Press one keyboard key or chord in Yan built-in browser and verify that the page receives both keydown and keyup. Set duration_ms for games, editors, hold-to-repeat controls, or any page that reads continuous key state. Event delivery proves input reached the page; verify the intended business or visual result separately.',
      inputSchema: {
        type: 'object',
        properties: {
          key: { type: 'string', description: 'Key or chord such as Enter, ArrowRight, Space, or Control+S.' },
          duration_ms: { type: 'integer', minimum: 30, maximum: 5000, default: 80, description: 'How long to hold the key before releasing it. Use several hundred milliseconds for continuous movement.' }
        },
        required: ['key'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_scroll',
      description: 'Scroll the current Yan browser page, then take another snapshot if new targets are needed.',
      inputSchema: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down', 'left', 'right'] },
          amount: { type: 'integer', minimum: 80, maximum: 2400 },
          ref: { type: 'string', description: 'Optional scrollable element ref. Omit to scroll the page.' }
        },
        required: ['direction'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_wait',
      description: 'Wait for the current page to settle or until exact visible text appears. Defaults to 1500ms; prefer waiting for text when the page updates dynamically.',
      inputSchema: {
        type: 'object',
        properties: {
          timeout_ms: { type: 'integer', minimum: 500, maximum: 15000, default: 1500 },
          text: { type: 'string', description: 'Optional exact page text to wait for.' },
          ref: { type: 'string', description: 'Optional fresh element ref to wait for.' },
          state: { type: 'string', enum: ['visible', 'hidden', 'enabled'], default: 'visible' }
        },
        additionalProperties: false
      }
    },
    {
      name: 'browser_screenshot',
      description: 'Capture the visible Yan browser viewport together with capture-time page text. This is required evidence for visual acceptance of games, 3D, Canvas, WebGL, imagery, and layout; DOM existence and a clean console do not prove visual quality.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'browser_inspect_page',
      description: 'Inspect page readiness, document size, forms, invalid fields, broken images, Canvas pixel coverage/flatness, recent console errors, and load errors. Use this for Yan browser diagnostics instead of opening Playwright merely to read the same page console.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    },
    {
      name: 'browser_history',
      description: 'Navigate back, forward, or reload in Yan built-in browser.',
      inputSchema: {
        type: 'object',
        properties: { action: { type: 'string', enum: ['back', 'forward', 'reload'] } },
        required: ['action'],
        additionalProperties: false
      }
    },
    {
      name: 'browser_status',
      description: 'Return the current Yan browser URL, title, loading state, and history availability without changing the page.',
      inputSchema: { type: 'object', properties: {}, additionalProperties: false }
    }
  ];
  return tools;
}

async function callTool(request) {
  const name = String(request.params?.name || '');
  const input = request.params?.arguments && typeof request.params.arguments === 'object'
    ? request.params.arguments
    : {};
  const controller = new AbortController();
  activeCalls.set(request.id, controller);
  try {
    let action = '';
    let params = input;
    if (name === 'open_builtin_browser') {
      if (!networkAllowed && input.target_type !== 'file') {
        throw new Error('Yan network permission is disabled. The built-in browser can only open local files.');
      }
      action = 'open';
    } else if (name === 'browser_snapshot') action = 'snapshot';
    else if (name === 'browser_read_page') action = 'read_page';
    else if (name === 'browser_click') action = 'click';
    else if (name === 'browser_type') action = 'type';
    else if (name === 'browser_select') action = 'select';
    else if (name === 'browser_check') action = 'check';
    else if (name === 'browser_hover') action = 'hover';
    else if (name === 'browser_focus') action = 'focus';
    else if (name === 'browser_drag') action = 'drag';
    else if (name === 'browser_pointer') action = 'pointer';
    else if (name === 'browser_press') action = 'press';
    else if (name === 'browser_scroll') action = 'scroll';
    else if (name === 'browser_wait') action = 'wait';
    else if (name === 'browser_screenshot') action = 'screenshot';
    else if (name === 'browser_inspect_page') action = 'inspect_page';
    else if (name === 'browser_history') {
      action = String(input.action || '');
      params = {};
    } else if (name === 'browser_status') action = 'status';
    else throw new Error(`Unknown Yan browser tool: ${name}`);

    const result = await bridgeCall(action, params, controller.signal);
    const image = result?.image;
    const structured = result && typeof result === 'object' ? { ...result } : { ok: true, output: String(result || '') };
    delete structured.image;
    if (structured.ok === undefined) structured.ok = !structured.error;
    const content = [{ type: 'text', text: JSON.stringify(structured) }];
    if (image?.data && image?.mimeType) content.push({ type: 'image', data: image.data, mimeType: image.mimeType });
    success(request.id, {
      content,
      structuredContent: structured,
      isError: structured.ok === false
    });
  } catch (error) {
    const result = { ok: false, error: error?.message || String(error), code: error?.code || 'YAN_BROWSER_TOOL_FAILED' };
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
      serverInfo: { name: 'Yan Built-in Browser', version: '2.0.0' }
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

let inputBuffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => {
  inputBuffer += chunk;
  let newline = inputBuffer.indexOf('\n');
  while (newline >= 0) {
    const line = inputBuffer.slice(0, newline).trim();
    inputBuffer = inputBuffer.slice(newline + 1);
    if (line) {
      try { void handle(JSON.parse(line)); }
      catch (error) { process.stderr.write(`[yan-browser-mcp] ${error.message}\n`); }
    }
    newline = inputBuffer.indexOf('\n');
  }
});
process.stdin.resume();

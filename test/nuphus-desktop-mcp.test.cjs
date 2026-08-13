'use strict';

const assert = require('node:assert/strict');
const path = require('node:path');
const { spawn } = require('node:child_process');

const expectedDesktopTools = [
  'desktop_screen_size',
  'desktop_screenshot',
  'desktop_windows_list',
  'desktop_window_activate',
  'desktop_window_screenshot',
  'desktop_window_move',
  'desktop_window_resize',
  'desktop_window_info',
  'desktop_vision',
  'desktop_perceive',
  'desktop_mouse',
  'desktop_mouse_drag',
  'desktop_input',
  'desktop_clipboard_clean',
  'desktop_clipboard_write'
];

function startServer() {
  const child = spawn(process.execPath, [path.resolve(__dirname, '..', 'lib', 'nuphus-desktop-mcp.js')], {
    cwd: path.resolve(__dirname, '..'),
    stdio: ['pipe', 'pipe', 'pipe']
  });
  let buffer = '';
  let nextId = 1;
  const pending = new Map();
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`MCP timeout: ${method}`));
    }, 10_000);
    pending.set(id, message => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request };
}

(async () => {
  const server = startServer();
  try {
    const initialized = await server.request('initialize', {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: { name: 'yan-nuphus-test', version: '1.0.0' }
    });
    assert.equal(initialized.result?.serverInfo?.name, 'nuphus-mcp');
    assert.equal(initialized.result?.serverInfo?.version, '0.1.11');
    server.child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })}\n`);

    const listed = await server.request('tools/list');
    const tools = listed.result?.tools;
    assert.equal(tools?.length, 15);
    assert.deepEqual(tools.map(tool => tool.name), expectedDesktopTools);
    assert.equal(tools.some(tool => tool.name.startsWith('browser_')), false);

    const perceive = tools.find(tool => tool.name === 'desktop_perceive');
    assert.equal(perceive.annotations?.readOnlyHint, true);
    assert.deepEqual(perceive.inputSchema?.required, []);
    assert.match(perceive.description, /center coordinate/);

    const input = tools.find(tool => tool.name === 'desktop_input');
    assert.deepEqual(input.inputSchema?.required, ['mode', 'hwnd']);
    assert.deepEqual(input.inputSchema?.properties?.mode?.enum, ['type', 'hotkey']);
    assert.equal(input.annotations?.destructiveHint, true);
  } finally {
    server.child.kill();
  }
  console.log('Nuphus desktop proxy handshake and native tool schemas passed.');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

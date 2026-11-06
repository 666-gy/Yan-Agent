'use strict';

const assert = require('node:assert/strict');
const net = require('node:net');
const path = require('node:path');
const { spawn } = require('node:child_process');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');

async function startBridge() {
  const requests = [];
  const closedOperations = new Set();
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    let input = '';
    let operationId = '';
    socket.on('data', chunk => {
      input += chunk;
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      const request = JSON.parse(input.slice(0, newline));
      operationId = String(request.operationId || '');
      requests.push(request);
      if (['snapshot', 'read_page', 'back', 'forward', 'reload', 'focus', 'press', 'pointer', 'type'].includes(request.action)) socket.end(`${JSON.stringify({ ok: true, result: { ok: true, action: request.action, params: request.params } })}\n`);
      if (request.action === 'status') {
        socket.end(`${JSON.stringify({ ok: true, result: { ok: true, url: 'https://example.test/' } })}\n`);
      }
      if (request.action === 'set_viewport') socket.end(`${JSON.stringify({ ok: true, result: { ok: true, viewport: request.params } })}\n`);
      if (request.action === 'list_tabs') socket.end(`${JSON.stringify({ ok: true, result: { ok: true, tabs: [{ tabId: 'browser-1', url: 'https://example.test/', reusable: true, controlledByOtherTask: false, releasing: false }] } })}\n`);
      if (request.action === 'open') socket.end(`${JSON.stringify({ ok: true, result: { ok: true, url: request.params.url_or_path || 'https://example.test/', tabId: request.params.tab_id || 'browser-new', reused: !!request.params.tab_id || request.params.reuse === 'scope' } })}\n`);
      if (request.action === 'apply_annotation') socket.end(`${JSON.stringify({ok:true,result:{ok:true,styles:request.params.styles,text:request.params.text}})}\n`);
      if (request.action === 'screenshot') {
        socket.end(`${JSON.stringify({ ok: true, result: {
          ok: true,
          url: 'https://example.test/',
          image: { mimeType: 'image/png', data: 'AAAA' }
        } })}\n`);
      }
    });
    socket.on('close', () => {
      if (operationId) closedOperations.add(operationId);
    });
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return { server, port: server.address().port, requests, closedOperations };
}

function startMcp(port) {
  const child = spawn(process.execPath, [path.join(appRoot, 'lib', 'yan-browser-mcp.js')], {
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_BROWSER_BRIDGE_PORT: String(port),
      YAN_BROWSER_BRIDGE_TOKEN: 'test-token',
      YAN_BROWSER_ALLOW_NETWORK: 'true'
    },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const pending = new Map();
  let buffered = '';
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffered += chunk;
    while (buffered.includes('\n')) {
      const newline = buffered.indexOf('\n');
      const line = buffered.slice(0, newline).trim();
      buffered = buffered.slice(newline + 1);
      if (!line) continue;
      const message = JSON.parse(line);
      pending.get(message.id)?.(message);
      pending.delete(message.id);
    }
  });
  const send = message => child.stdin.write(`${JSON.stringify(message)}\n`);
  const request = (id, method, params = {}) => new Promise((resolve, reject) => {
    if (method === 'tools/call') params = { ...params, arguments: { task_id: 'run-test', ...params.arguments } };
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 5_000);
    pending.set(id, message => {
      clearTimeout(timer);
      resolve(message);
    });
    send({ jsonrpc: '2.0', id, method, params });
  });
  return { child, send, request };
}

async function waitFor(predicate, timeoutMs = 3_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  throw new Error('Condition was not met before timeout.');
}

test('Yan browser MCP transports operation identity and cancellation', async t => {
  const bridge = await startBridge();
  const mcp = startMcp(bridge.port);
  t.after(() => {
    mcp.child.kill();
    bridge.server.close();
  });

  const initialized = await mcp.request(1, 'initialize', { protocolVersion: '2025-03-26' });
  assert.equal(initialized.result.serverInfo.name, 'Yan Built-in Browser');
  const listed = await mcp.request(2, 'tools/list');
  assert.equal(listed.result.tools.length, 19);
  for (const name of ['browser_snapshot', 'browser_read_page', 'browser_status', 'browser_focus', 'browser_history', 'browser_type']) {
    assert.ok(!listed.result.tools.some(tool => tool.name === name), name);
  }
  const snapshot = listed.result.tools.find(tool => tool.name === 'browser_observe');
  assert.ok(listed.result.tools.find(tool => tool.name === 'browser_set_viewport'));
  const viewport = await mcp.request(21, 'tools/call', { name: 'browser_set_viewport', arguments: { width: 390, height: 844 } });
  assert.deepEqual(viewport.result.structuredContent.viewport, { width: 390, height: 844, yan_run_id: 'run-test' });
  assert.match(snapshot.description, /latest snapshot/i);
  assert.ok(listed.result.tools.find(tool=>tool.name==='browser_apply_annotation'));
  const annotation=await mcp.request(20,'tools/call',{name:'browser_apply_annotation',arguments:{text:'修改文字',styles:{fontSize:'23px'}}});
  assert.equal(annotation.result.structuredContent.text,'修改文字');
  assert.equal(annotation.result.structuredContent.styles.fontSize,'23px');

  const status = await mcp.request(3, 'tools/call', { name: 'browser_observe', arguments: { mode: 'status',} });
  assert.equal(status.result.structuredContent.url, 'https://example.test/');
  assert.match(bridge.requests[0].operationId, /^browser-/);
  assert.equal(bridge.requests[0].token, 'test-token');
  assert.ok(listed.result.tools.every(tool => tool.inputSchema.required.includes('task_id')));
  const missing = await mcp.request(30, 'tools/call', { name: 'browser_observe', arguments: { mode: 'status', task_id: '' } });
  assert.equal(missing.result.isError, true);
  const other = await mcp.request(31, 'tools/call', { name: 'browser_observe', arguments: { mode: 'status', task_id: 'run-other' } });
  assert.equal(other.result.isError, false);
  assert.equal(bridge.requests.at(-1).params.yan_run_id, 'run-other');
  await mcp.request(32, 'tools/call', { name: 'browser_observe', arguments: { task_id: 'history-run', mode: 'status' } });
  assert.equal(bridge.requests.at(-1).params.yan_run_id, 'history-run');

  for (const [mode, action] of [['interactive', 'snapshot'], ['text', 'read_page'], ['status', 'status']]) {
    await mcp.request(40, 'tools/call', { name: 'browser_observe', arguments: { mode } });
    assert.equal(bridge.requests.at(-1).action, action);
  }
  for (const action of ['back', 'forward', 'reload']) {
    await mcp.request(41, 'tools/call', { name: 'open_builtin_browser', arguments: { action } });
    assert.equal(bridge.requests.at(-1).action, action);
    assert.equal(bridge.requests.at(-1).params.yan_run_id, 'run-test');
  }
  await mcp.request(42, 'tools/call', { name: 'browser_press', arguments: { ref: 'e4' } });
  assert.equal(bridge.requests.at(-1).action, 'focus');
  await mcp.request(43, 'tools/call', { name: 'browser_press', arguments: { ref: 'e4', key: 'Enter' } });
  assert.equal(bridge.requests.at(-1).action, 'press');
  assert.equal(bridge.requests.at(-1).params.ref, 'e4');
  await mcp.request(44, 'tools/call', { name: 'browser_pointer', arguments: { action: 'click', x: 10, y: 20 } });
  assert.equal(bridge.requests.at(-1).params.action, 'click');
  await mcp.request(45, 'tools/call', { name: 'browser_fill', arguments: { ref: 'e4', text: 'hello' } });
  assert.equal(bridge.requests.at(-1).action, 'type');
  for (const [name, args] of [['browser_observe', { mode: 'bogus' }], ['open_builtin_browser', { action: 'status' }], ['browser_press', {}]]) {
    const before = bridge.requests.length;
    const rejected = await mcp.request(46, 'tools/call', { name, arguments: args });
    assert.equal(rejected.result.isError, true);
    assert.equal(bridge.requests.length, before);
  }

  const screenshotTool = listed.result.tools.find(tool => tool.name === 'browser_screenshot');
  assert.equal(screenshotTool.inputSchema.properties.question.type, 'string');
  assert.equal(screenshotTool.inputSchema.properties.compare_to_previous.type, 'boolean');
  const screenshot = await mcp.request(4, 'tools/call', { name: 'browser_screenshot',
    arguments: { question: '双皮带是否可见', compare_to_previous: true } });
  assert.equal(screenshot.result.structuredContent.ok, true);
  assert.equal(screenshot.result.content.some(part => part.type === 'image'), true);
  const screenshotRequest = bridge.requests.find(request => request.action === 'screenshot');
  assert.equal(screenshotRequest.params.question, '双皮带是否可见');
  assert.equal(screenshotRequest.params.compare_to_previous, true);

  const waiting = mcp.request(5, 'tools/call', { name: 'browser_wait', arguments: { timeout_ms: 5000 } });
  await waitFor(() => bridge.requests.some(request => request.action === 'wait'));
  const waitRequest = bridge.requests.find(request => request.action === 'wait');
  mcp.send({ jsonrpc: '2.0', method: 'notifications/cancelled', params: { requestId: 5 } });
  const cancelled = await waiting;
  assert.equal(cancelled.result.isError, true);
  assert.equal(cancelled.result.structuredContent.code, 'BROWSER_ACTION_CANCELLED');
  await waitFor(() => bridge.closedOperations.has(waitRequest.operationId));
});

test('browser tab reuse is explicit and transported with the open request', async t => {
  const bridge = await startBridge();
  const mcp = startMcp(bridge.port);
  t.after(() => { mcp.child.kill(); bridge.server.close(); });

  const listed = await mcp.request(1, 'tools/list');
  const openTool = listed.result.tools.find(tool => tool.name === 'open_builtin_browser');
  assert.equal(openTool.inputSchema.properties.tab_id.type, 'string');
  assert.deepEqual(openTool.inputSchema.properties.reuse.enum, ['none', 'scope']);
  assert.equal((openTool.inputSchema.required || []).includes('url_or_path'), false);
  assert.ok(listed.result.tools.find(tool => tool.name === 'browser_list_tabs'));

  const tabs = await mcp.request(2, 'tools/call', { name: 'browser_list_tabs', arguments: {} });
  assert.equal(tabs.result.structuredContent.tabs[0].tabId, 'browser-1');
  assert.equal(bridge.requests.at(-1).action, 'list_tabs');

  const attached = await mcp.request(3, 'tools/call', { name: 'open_builtin_browser', arguments: { tab_id: 'browser-9' } });
  assert.equal(attached.result.structuredContent.tabId, 'browser-9');
  assert.equal(attached.result.structuredContent.reused, true);
  const attachRequest = bridge.requests.find(request => request.action === 'open');
  assert.equal(attachRequest.params.tab_id, 'browser-9');
  assert.equal(attachRequest.params.url_or_path, undefined);

  const scoped = await mcp.request(4, 'tools/call', { name: 'open_builtin_browser',
    arguments: { reuse: 'scope', target_type: 'url', url_or_path: 'https://example.test/next' } });
  assert.equal(scoped.result.structuredContent.reused, true);
  assert.equal(bridge.requests.at(-1).params.reuse, 'scope');

  const bare = await mcp.request(5, 'tools/call', { name: 'open_builtin_browser', arguments: {} });
  assert.equal(bare.result.isError, true);
  assert.match(bare.result.structuredContent.error, /url_or_path/);
});

test('browser acceptance intent is validated per call and transported for backend policy', async t => {
  const bridge = await startBridge();
  const mcp = startMcp(bridge.port);
  t.after(() => { mcp.child.kill(); bridge.server.close(); });
  const bad = await mcp.request(100, 'tools/call', { name: 'browser_observe', arguments: { mode: 'status', purpose: 'frontend_acceptance' } });
  assert.equal(bad.result.isError, true);
  assert.equal(bridge.requests.length, 0);
  const good = await mcp.request(101, 'tools/call', { name: 'browser_observe', arguments: { mode: 'status', purpose: 'frontend_acceptance', acceptance: { target: 'preview', check: 'layout' } } });
  assert.equal(good.result.isError, false);
  assert.deepEqual(bridge.requests[0].params, { yan_run_id: 'run-test', purpose: 'frontend_acceptance', acceptance: { target: 'preview', check: 'layout' } });
  const normal = await mcp.request(102, 'tools/call', { name: 'browser_observe', arguments: { mode: 'status',} });
  assert.equal(normal.result.isError, false);
  assert.equal(normal.result.structuredContent.acceptance, undefined);
});

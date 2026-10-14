'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerBridges } = require('../lib/main/bridges');
const { createIntelligentUi, MAX_HTML_BYTES } = require('../lib/intelligent-ui-creator');
const { permissionForRun } = require('../lib/opencode-sidecar');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const path = require('node:path');
const { stateCell } = require('../lib/main/context');

const start = { task_id: 'r1', action: 'start', title: '方案成本', purpose: '调整人数和调用量，比较成本临界点', placement: 'final' };
test('Creator enforces start/render order, opt-in and bounded content; updates retain identity', () => {
  const active = { intelligentUiAllowed: true };
  const render = { task_id: 'r1', action: 'render', html: '<button>调整</button>' };
  assert.throws(() => createIntelligentUi(active, 'r1', render), /start/);
  assert.throws(() => createIntelligentUi({}, 'r1', start), /未启用/);
  assert.throws(() => createIntelligentUi(active, 'other', start), /不匹配/);
  const initial = createIntelligentUi(active, 'r1', start);
  assert.equal(initial.intelligent_ui.status, 'creating');
  const ready = createIntelligentUi(active, 'r1', render);
  assert.equal(ready.intelligent_ui.status, 'ready');
  assert.equal(ready.intelligent_ui.id, initial.intelligent_ui.id);
  assert.equal(ready.intelligent_ui.revision, 1);
  assert.equal(createIntelligentUi(active, 'r1', render).intelligent_ui.revision, 2);
  assert.throws(() => createIntelligentUi(active, 'r1', { ...render, html: '中'.repeat(MAX_HTML_BYTES / 2) }), /160 KiB/);
});

test('Creator bridge requires matching observed input and task ownership with concurrent runs', async () => {
  const runs = new Map([['r1', { intelligentUiAllowed: true }], ['r2', { intelligentUiAllowed: false }]]);
  const bridges = registerBridges({ app: new EventEmitter() }, {
    openCodeActiveRuns: runs, sessionAgentToolClaims: new Map(), browserHelpers: {}, OPEN_CODE_SESSION_TOOL_ACTIONS: {}
  });
  const observe = (id, args, callId) => bridges.trackSessionAgentToolClaim(id, {
    type: 'session.next.tool.called', data: { callID: callId, tool: 'yan_session_intelligent_ui_creator', input: args }
  });
  observe('r1', start, 'start');
  const result = await bridges.dispatchSessionAgentCommand('intelligent_ui_creator', start);
  assert.equal(result.intelligent_ui.id, 'r1');
  assert.equal(runs.get('r2').intelligentUi, undefined);
  await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', start), /来源任务/);
  const wrong = { ...start, task_id: 'r2' };
  observe('r1', wrong, 'wrong');
  await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', wrong), /来源任务/);
  observe('r2', wrong, 'disabled');
  await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', wrong), /未启用/);
  const render = { task_id: 'r1', action: 'render', html: '<p>界面</p>' };
  observe('r1', render, 'render');
  await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', { ...render, html: '<p>替换内容</p>' }), /来源任务/);
  assert.equal((await bridges.dispatchSessionAgentCommand('intelligent_ui_creator', render)).intelligent_ui.status, 'ready');
  const resourceRender = { ...render, resources: { map: true, images: ['https://images.pexels.com/photos/123/example.jpg'] } };
  observe('r1', resourceRender, 'resource-render');
  for (const resources of [undefined, { ...resourceRender.resources, map: false }, { ...resourceRender.resources, images: ['https://images.pexels.com/photos/456/other.jpg'] }]) {
    await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', { ...resourceRender, resources }), /来源任务/);
  }
  // Object property order may differ across the two JSON transports.
  const accepted = await bridges.dispatchSessionAgentCommand('intelligent_ui_creator', {
    ...resourceRender, resources: { images: [...resourceRender.resources.images], map: true }
  });
  assert.deepEqual(accepted.intelligent_ui.resources, resourceRender.resources);
  const openui = {task_id:'r1',action:'render',format:'openui',code:'root = App([Note("hello")])'};
  observe('r1', openui, 'openui');
  await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', {...openui,handoff:true}), /来源任务/);
  await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', {...openui,format:'html'}), /来源任务/);
  await assert.rejects(bridges.dispatchSessionAgentCommand('intelligent_ui_creator', {...openui,code:'root = App([Note("changed")])'}), /来源任务/);
  assert.equal((await bridges.dispatchSessionAgentCommand('intelligent_ui_creator', openui)).intelligent_ui.format,'openui');
});

test('Creator validates exact public photo grants and resets resources on the next render', () => {
  const active = { intelligentUiAllowed: true, intelligentUiNetworkAllowed: true };
  const render = { task_id: 'r1', action: 'render', html: '<div>地图</div>' };
  assert.throws(() => createIntelligentUi(active, 'r1', { ...start, resources: {} }), /render/);
  assert.equal(active.intelligentUi, undefined);
  createIntelligentUi(active, 'r1', start);
  const first = createIntelligentUi(active, 'r1', {
    ...render, resources: { map: true, images: [
      'https://UPLOAD.WIKIMEDIA.ORG:443/wikipedia/commons/a/a0/Photo.jpg',
      'https://upload.wikimedia.org/wikipedia/commons/a/a0/Photo.jpg',
      'https://images.unsplash.com/photo-123?w=600&fit=crop'
    ] }
  });
  assert.deepEqual(first.intelligent_ui.resources, { map: true, images: [
    'https://upload.wikimedia.org/wikipedia/commons/a/a0/Photo.jpg',
    'https://images.unsplash.com/photo-123?w=600&fit=crop'
  ] });
  const revision = active.intelligentUi.revision;
  for (const resources of [null, [], { script: 'https://example.com/script.js' }, { map: 'yes' }, { images: 'url' },
    { images: Array(13).fill('https://images.pexels.com/photo.jpg') }]) {
    assert.throws(() => createIntelligentUi(active, 'r1', { ...render, resources }), /resources/);
  }
  for (const url of [
    'http://images.pexels.com/photo.jpg', 'https://127.0.0.1/photo.jpg', 'https://localhost/photo.jpg',
    'https://images.pexels.com.evil.example/photo.jpg', 'https://evil.example/photo.jpg',
    'https://name:secret@images.pexels.com/photo.jpg', 'https://images.pexels.com:8443/photo.jpg',
    'https://images.pexels.com/photo.jpg#fragment', 'https://images.pexels.com/photo.jpg#',
    'https://images.pexels.com/photo\njpg', ' https://images.pexels.com/photo.jpg',
    'file:///tmp/photo.jpg', 'data:image/png;base64,abc', 'https://images.pexels.com/' + 'x'.repeat(2048)
  ]) assert.throws(() => createIntelligentUi(active, 'r1', { ...render, resources: { images: [url] } }), /URL/);
  assert.equal(active.intelligentUi.revision, revision, 'failed validation must not advance the accepted revision');
  assert.deepEqual(createIntelligentUi(active, 'r1', render).intelligent_ui.resources, { map: false, images: [] });
  assert.deepEqual(first.intelligent_ui.resources.images.length, 2, 'a later render does not mutate earlier acceptance metadata');
});

test('Creator denies map and photos when the authoritative run disables networking', () => {
  const active = { intelligentUiAllowed: true, intelligentUiNetworkAllowed: false };
  const render = { task_id: 'r1', action: 'render', html: '<div>离线方案</div>' };
  createIntelligentUi(active, 'r1', start);
  for (const resources of [{ map: true }, { images: ['https://images.pexels.com/photo.jpg'] }]) {
    assert.throws(() => createIntelligentUi(active, 'r1', { ...render, resources }), /网络权限/);
  }
  assert.equal(active.intelligentUi.revision, 0);
  assert.deepEqual(createIntelligentUi(active, 'r1', render).intelligent_ui.resources, { map: false, images: [] });
  const largest = createIntelligentUi({ intelligentUiAllowed: true, intelligentUi: { revision: 0 } }, 'r1', {
    ...render, resources: { map: true, images: Array.from({ length: 12 }, (_, i) => `https://images.pexels.com/${i}/` + 'x'.repeat(1950)) }
  });
  assert.ok(Buffer.byteLength(JSON.stringify(largest), 'utf8') < 30 * 1024, 'bounded grants keep the acknowledgement below the tool output limit');
});

test('kernel permissions disable Creator independently of other session tools', () => {
  const base = { accessMode: 'full', intelligentUiEnabled: true, intelligentUiAvailable: true };
  assert.equal(permissionForRun(base).yan_session_intelligent_ui_creator, 'allow');
  for (const restrictions of [{ intelligentUiEnabled: false }, { workMode: 'plan' }]) {
    assert.equal(permissionForRun({ ...base, ...restrictions }).yan_session_intelligent_ui_creator, 'deny');
  }
});

test('real MCP process transports large render input with a small acknowledgement', async t => {
  const cell = value => stateCell(() => value, next => { value = next; });
  const bridges = registerBridges({ app: new EventEmitter() }, {
    openCodeActiveRuns: new Map([['r1', { intelligentUiAllowed: true }]]),
    sessionAgentToolClaims: new Map(), browserHelpers: {}, OPEN_CODE_SESSION_TOOL_ACTIONS: {},
    sessionAgentBridgePending: new Map(),
    sessionAgentBridgeToken: 'creator-test-token', SESSION_AGENT_BRIDGE_MAX_BYTES: 8 * 1024 * 1024,
    sessionBridgeServer: cell(null), sessionBridgePort: cell(0)
  });
  const bridge = await bridges.startSessionAgentBridge();
  t.after(() => bridges.stopSessionAgentBridge());
  const child = spawn(process.execPath, [path.join(__dirname, '../lib/yan-session-mcp.js')], {
    env: { ...process.env, YAN_SESSION_BRIDGE_PORT: String(bridge.port), YAN_SESSION_BRIDGE_TOKEN: bridge.token },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  const lines = readline.createInterface({ input: child.stdout });
  t.after(() => { lines.close(); child.kill(); });
  let sequence = 0;
  const rpc = (method, params) => new Promise((resolve, reject) => {
    const id = ++sequence;
    const timer = setTimeout(() => { lines.off('line', receive); reject(new Error('MCP timed out')); }, 5000);
    function receive(line) {
      const message = JSON.parse(line);
      if (message.id !== id) return;
      clearTimeout(timer); lines.off('line', receive); resolve(message.result);
    }
    lines.on('line', receive);
    child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n');
  });
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.ok((await rpc('tools/list', {})).tools.some(tool => tool.name === 'intelligent_ui_creator'));
  for (const args of [start,
    { task_id: 'r1', action: 'render', html: '<p>' + '内容'.repeat(20000) + '</p>' },
    { task_id: 'r1', action: 'render', html: '<div id="map"></div>', resources: { map: true, images: ['https://images.pexels.com/photo.jpg'] } }
  ]) {
    bridges.trackSessionAgentToolClaim('r1', { type: 'session.next.tool.called', data: {
      callID: `creator-${sequence}`, tool: 'yan_session_intelligent_ui_creator', input: args
    } });
    const result = (await rpc('tools/call', { name: 'intelligent_ui_creator', arguments: args })).structuredContent;
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.intelligent_ui.status, args.action === 'start' ? 'creating' : 'ready');
    if (args.action === 'start') assert.ok(result.design_skill.includes('ui-controls'));
    else {
      assert.ok(JSON.stringify(result).length < 2000);
      assert.deepEqual(result.intelligent_ui.resources, args.resources || { map: false, images: [] });
    }
    assert.equal(result.intelligent_ui.html, undefined);
  }
});

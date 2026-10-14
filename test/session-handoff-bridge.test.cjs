'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { spawn } = require('node:child_process');
const readline = require('node:readline');
const test = require('node:test');
const { createSessionStore } = require('../lib/session-store');
const { registerBridges } = require('../lib/main/bridges');
const { stateCell } = require('../lib/main/context');

function cell(value) {
  return stateCell(() => value, next => { value = next; });
}

test('session MCP reaches approval, creates/reuses a task and reads bound context through the real store', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-handoff-bridge-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const sessionsDir = path.join(root, 'sessions');
  const sourceWorkspace = path.join(root, 'source');
  const targetWorkspace = path.join(root, 'target');
  for (const directory of [sessionsDir, sourceWorkspace, targetWorkspace]) fs.mkdirSync(directory);
  const store = createSessionStore({
    sessionsDir, ensureDirs() {}, mainWindow: cell(null),
    yanagent: { migrateMemoryToWorkspace() {}, ensureYanagent() {} },
    activeRuns: new Map(), runAdmissions: new Map()
  });
  const source = await store.createFreshSessionRecord({ workspace: sourceWorkspace, title: 'Source task' });
  source.messages = [{ role: 'user', content: 'Keep the source context marker.' }];
  await store.saveSession(source);
  const pending = new Map();
  const events = [];
  let approved = false;
  const window = {
    isDestroyed: () => false,
    webContents: { send(channel, detail) {
      events.push({ channel, detail });
      if (channel === 'session:agent-command') {
        const entry = pending.get(detail.requestId);
        clearTimeout(entry.timer);
        pending.delete(detail.requestId);
        entry.resolve({ approved });
      }
    } }
  };
  const runs = new Map([['run-source', { yanSessionId: source.id }]]);
  const bridges = registerBridges({ app: new EventEmitter() }, {
    sessionStore: store, browserHelpers: {},
    getMainWindow: () => window, isMainRendererReady: () => true,
    openCodeActiveRuns: runs, sessionAgentToolClaims: new Map(),
    sessionAgentBridgePending: pending, sessionAgentBridgeToken: 'handoff-test-token',
    SESSION_AGENT_ACTIONS: new Set(['create_handoff', 'read_source_context']),
    SESSION_AGENT_BRIDGE_MAX_BYTES: 65536,
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
  let id = 0;
  function rpc(method, params) {
    return new Promise((resolve, reject) => {
      const requestId = ++id;
      const timer = setTimeout(() => { lines.off('line', onLine); reject(new Error('MCP call timed out')); }, 5000);
      function onLine(line) {
        const message = JSON.parse(line);
        if (message.id !== requestId) return;
        clearTimeout(timer);
        lines.off('line', onLine);
        resolve(message.result);
      }
      lines.on('line', onLine);
      child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: requestId, method, params }) + '\n');
    });
  }
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).structuredContent;
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.ok((await rpc('tools/list', {})).tools.some(tool => tool.name === 'create_handoff'));
  const args = { target_path: targetWorkspace, reason: 'Continue in target workspace' };
  const denied = await call('create_handoff', args);
  assert.equal(denied.code, 'SESSION_HANDOFF_DENIED', JSON.stringify(denied));
  assert.equal(events.filter(event => event.channel === 'session:agent-command').length, 1);
  assert.equal((await store.listSessionSummaries()).length, 1);
  approved = true;
  const created = await call('create_handoff', args);
  assert.equal(created.ok, true, JSON.stringify(created));
  assert.equal(created.created, true);
  const target = await store.readSessionRecord(created.targetSessionId);
  assert.equal(target.parentSessionId, source.id);
  assert.equal(target.workspace, targetWorkspace);
  assert.ok(events.some(event => event.channel === 'session:agent-handoff-ready'));
  const reused = await call('create_handoff', args);
  assert.equal(reused.reused, true);
  assert.equal(reused.targetSessionId, target.id);
  runs.set('run-source', { yanSessionId: target.id });
  const context = await call('read_source_context', { start: 0, limit: 10 });
  assert.equal(context.ok, true);
  assert.equal(context.messages[0].content, source.messages[0].content);
  const approvalsBefore = events.filter(event => event.channel === 'session:agent-command').length;
  assert.equal((await call('create_handoff', args)).code, 'WORKSPACE_TARGET_SAME');
  assert.equal((await call('create_handoff', { ...args, target_path: path.join(root, 'missing') })).ok, false);
  assert.equal(events.filter(event => event.channel === 'session:agent-command').length, approvalsBefore);
});

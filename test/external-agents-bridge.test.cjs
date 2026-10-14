'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const readline = require('readline');
const { spawn } = require('child_process');
const { EventEmitter } = require('events');
const { registerBridges } = require('../lib/main/bridges');
const { ExternalAgentService } = require('../lib/external-agents/service');
const { atomic } = require('../lib/external-agents/storage');
const cell = value => ({ get: () => value, set: next => { value = next; } });

test('real MCP -> authenticated TCP bridge -> durable jobs; multi-run ownership rejects wrong workspace', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-external-bridge-'));
  const workspace = path.join(root, 'A'); fs.mkdirSync(workspace);
  const historyRoot = path.join(root, 'history'); fs.mkdirSync(historyRoot);
  fs.writeFileSync(path.join(historyRoot, 'independent.jsonl'), [
    { type: 'session_meta', payload: { id: '11111111-2222-4333-a444-555555555555', cwd: workspace, originator: 'Codex Desktop' } },
    { type: 'response_item', payload: { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Earlier solution' }] } }
  ].map(event => JSON.stringify(event)).join('\n') + '\n');
  let launches = 0;
  const service = new ExternalAgentService({ dataDir: root, historyOptions: { roots: [{ provider: 'codex', root: historyRoot, depth: 0, archived: false }] }, loadConfig: () => ({ externalAgents: {
    enabled: true, providers: { codex: { enabled: true }, claude: { enabled: true } }
  } }), launch: dir => { launches++; atomic(path.join(dir, 'state.json'), { status: 'running', workerPid: process.pid, heartbeatAt: Date.now() }); return process.pid; } });
  service.close();
  const runs = new Map([['run-a', { yanSessionId: 'session-a', workspace, prompt: 'Original request' }]]);
  const bridges = registerBridges({ app: new EventEmitter() }, { openCodeActiveRuns: runs, externalAgents: () => service,
    sessionAgentToolClaims: new Map(), sessionAgentBridgePending: new Map(), sessionAgentBridgeToken: 'test-token',
    SESSION_AGENT_ACTIONS: new Set(['create_handoff', 'read_source_context']), OPEN_CODE_SESSION_TOOL_ACTIONS: {},
    SESSION_AGENT_BRIDGE_MAX_BYTES: 8 * 1024 * 1024, sessionBridgeServer: cell(null), sessionBridgePort: cell(0), browserHelpers: {} });
  const bridge = await bridges.startSessionAgentBridge();
  const child = spawn(process.execPath, [path.join(__dirname, '../lib/yan-session-mcp.js')], { stdio: ['pipe', 'pipe', 'pipe'],
    env: { ...process.env, YAN_SESSION_BRIDGE_PORT: String(bridge.port), YAN_SESSION_BRIDGE_TOKEN: bridge.token } });
  const pending = new Map(); let next = 0;
  const lines = readline.createInterface({ input: child.stdout });
  lines.on('line', line => { const message = JSON.parse(line); pending.get(message.id)?.(message.result); pending.delete(message.id); });
  const rpc = (method, params) => new Promise(resolve => { const id = ++next; pending.set(id, resolve); child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id, method, params }) + '\n'); });
  const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).structuredContent;
  t.after(async () => { child.stdin.end(); await new Promise(resolve => child.once('close', resolve)); lines.close(); bridges.stopSessionAgentBridge(); service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  await rpc('initialize', { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
  assert.ok((await rpc('tools/list', {})).tools.some(tool => tool.name === 'delegate_external_task'));
  const history = await call('list_external_sessions', { task_id: 'run-a', provider: 'codex' });
  assert.equal(history.total, 1);
  const historyId = history.sessions[0].history_id;
  const transcript = await call('read_external_session', { task_id: 'run-a', history_id: historyId });
  assert.equal(transcript.messages[0].text, 'Earlier solution');
  assert.equal(launches, 0);
  const assignment = { task_id: 'run-a', provider: 'codex', request_key: 'one', prompt: '完整任务\n'.repeat(10000) };
  const first = await call('delegate_external_task', assignment);
  assert.equal(first.workspace, fs.realpathSync(workspace));
  assert.equal(launches, 1);
  assert.equal((await call('delegate_external_task', assignment)).job_id, first.job_id);
  const waiting = await call('wait_external_tasks', { task_id: 'run-a', job_ids: [first.job_id], wait_ms: 5 });
  assert.equal(waiting.wait_expired, true);
  runs.set('run-b', { yanSessionId: 'session-b', workspace: root });
  const historyArgs = { task_id: 'run-a', history_id: historyId };
  bridges.trackSessionAgentToolClaim('run-a', { type: 'session.next.tool.called', data: { callID: 'history-scope', tool: 'yan_session_read_external_session', input: historyArgs } });
  const badScope = await call('read_external_session', { ...historyArgs, scope: 'all' });
  assert.equal(badScope.ok, false);
  const verifiedHistory = await call('read_external_session', historyArgs);
  assert.equal(verifiedHistory.messages[0].text, 'Earlier solution');
  const wrong = { ...assignment, task_id: 'run-b' };
  bridges.trackSessionAgentToolClaim('run-a', { type: 'session.next.tool.called', data: { callID: 'wrong', tool: 'yan_session_delegate_external_task', input: wrong } });
  const denied = await call('delegate_external_task', wrong);
  assert.equal(denied.ok, false);
  assert.match(denied.error, /不匹配/);
  assert.equal(launches, 1);
  const dir = path.join(service.root, first.job_id);
  atomic(path.join(dir, 'state.json'), { status: 'failed', endedAt: Date.now(), error: 'Expected failure' });
  fs.writeFileSync(path.join(dir, 'result.txt'), 'Full failed result');
  const args = { task_id: 'run-a', job_id: first.job_id };
  bridges.trackSessionAgentToolClaim('run-a', { type: 'session.next.tool.called', data: { callID: 'result', tool: 'yan_session_read_external_task_result', input: args } });
  const result = await call('read_external_task_result', args);
  assert.equal(result.status, 'failed'); assert.equal(result.output, 'Full failed result');
  assert.equal(launches, 1);
  const continuation = { task_id: 'run-a', provider: 'codex', session_mode: 'history', history_id: historyId,
    request_key: 'specified-history', prompt: 'A new issue in the selected historical task', previous_job_id: first.job_id, new_issue: 'New regression to investigate' };
  bridges.trackSessionAgentToolClaim('run-a', { type: 'session.next.tool.called', data: { callID: 'history-dispatch', tool: 'yan_session_delegate_external_task', input: continuation } });
  assert.equal((await call('delegate_external_task', { ...continuation, history_id: '0'.repeat(64) })).ok, false);
  const resumed = await call('delegate_external_task', continuation);
  assert.equal(resumed.history_id, historyId);
  assert.equal(resumed.session_mode, 'history');
  assert.equal(service.record(resumed.job_id).historyBinding.externalSessionId, '11111111-2222-4333-a444-555555555555');
  assert.equal(launches, 2);
});

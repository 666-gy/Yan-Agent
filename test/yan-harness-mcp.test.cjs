'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

function startMcp(root) {
  const workspace = path.join(root, 'workspace');
  fs.mkdirSync(workspace, { recursive: true });
  const requestPath = path.join(root, 'pending', 'run-test.json');
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'lib', 'yan-harness-mcp.js')], {
    env: {
      ...process.env,
      YAN_HARNESS_REQUEST_PATH: requestPath,
      YAN_HARNESS_RUN_ID: 'run-test',
      YAN_HARNESS_SESSION_ID: 'session-test',
      YAN_HARNESS_WORKSPACE: workspace,
      YAN_HARNESS_GLOBAL_STATE_PATH: path.join(root, 'global.json'),
      YAN_HARNESS_WORKSPACE_STATE_PATH: path.join(workspace, '.yanagent', 'harness', 'harness-state.json')
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
  let nextId = 1;
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = nextId++;
    const timer = setTimeout(() => reject(new Error(`MCP timeout: ${method}`)), 5_000);
    pending.set(id, message => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  return { child, request, requestPath, workspace };
}

test('MCP queues refine and rollback operations without applying them', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-harness-mcp-'));
  const mcp = startMcp(root);
  t.after(() => {
    mcp.child.kill();
    fs.rmSync(root, { recursive: true, force: true });
  });
  const initialized = await mcp.request('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(initialized.result.serverInfo.name, 'Yan Continual Harness');
  const listed = await mcp.request('tools/list');
  assert.deepEqual(listed.result.tools.map(tool => tool.name), [
    'schedule_refinement',
    'get_refinement_status',
    'schedule_rollback'
  ]);
  const refine = await mcp.request('tools/call', {
    name: 'schedule_refinement',
    arguments: { instructions: 'Retain the verified project build recovery tactic.', scope: 'workspace' }
  });
  assert.equal(refine.result.structuredContent.scheduled, true);
  assert.equal(JSON.parse(fs.readFileSync(mcp.requestPath, 'utf8')).action, 'refine');
  const status = await mcp.request('tools/call', { name: 'get_refinement_status', arguments: {} });
  assert.equal(status.result.structuredContent.pending.runId, 'run-test');
  const rollback = await mcp.request('tools/call', {
    name: 'schedule_rollback',
    arguments: { refinement_id: 'refine-target', scope: 'workspace', reason: 'The user explicitly requested undo.' }
  });
  assert.equal(rollback.result.structuredContent.rollbackId, 'refine-target');
  const queued = JSON.parse(fs.readFileSync(mcp.requestPath, 'utf8'));
  assert.equal(queued.action, 'rollback');
  assert.equal(queued.rollbackId, 'refine-target');
});

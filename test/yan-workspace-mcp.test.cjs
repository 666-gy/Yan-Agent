'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const test = require('node:test');

function git(root, args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' });
}

function makeRepo(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workspace-mcp-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  git(root, ['init', '--initial-branch=main']);
  git(root, ['config', 'user.email', 'yan@example.com']);
  git(root, ['config', 'user.name', 'Yan Test']);
  fs.writeFileSync(path.join(root, 'b.js'), 'module.exports = 2;\n');
  fs.writeFileSync(path.join(root, 'a.js'), "const b = require('./b');\nmodule.exports = b + 1;\n");
  git(root, ['add', '.']);
  git(root, ['commit', '-m', 'init']);
  return root;
}

function startServer(t, contextDir) {
  const child = spawn(process.execPath, [path.join(__dirname, '..', 'lib', 'yan-workspace-mcp.js')], {
    env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', YAN_WORKSPACE_CONTEXT_DIR: contextDir },
    stdio: ['pipe', 'pipe', 'pipe']
  });
  t.after(() => child.kill());
  let buffer = '';
  const pending = new Map();
  let nextId = 0;
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', chunk => {
    buffer += chunk;
    while (true) {
      const newline = buffer.indexOf('\n');
      if (newline < 0) break;
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      let message;
      try { message = JSON.parse(line); } catch { continue; }
      const resolver = pending.get(message.id);
      if (resolver) {
        pending.delete(message.id);
        resolver(message);
      }
    }
  });
  child.stderr.on('data', () => { /* surface through hangs, not noise */ });
  const request = (method, params) => new Promise((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, resolve);
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`workspace MCP timed out on ${method}`));
      }
    }, 15000).unref?.();
  });
  return { child, request };
}

async function callTool(request, name, args) {
  const response = await request('tools/call', { name, arguments: args });
  assert.equal(response.error, undefined, `${name} must not return a protocol error`);
  const structured = response.result?.structuredContent;
  return { isError: response.result?.isError === true, structured };
}

test('yan-workspace-mcp exposes worktree and impact tools over stdio', async t => {
  const repo = makeRepo(t);
  const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workspace-ctx-'));
  t.after(() => fs.rmSync(contextDir, { recursive: true, force: true }));
  const taskId = 'impact-test-run';
  const contextKey = crypto.createHash('sha256').update(taskId).digest('hex');
  fs.writeFileSync(path.join(contextDir, `${contextKey}.json`), JSON.stringify({
    runId: taskId,
    sessionId: 'session-1',
    workspace: repo,
    allowFileRead: true,
    allowFileWrite: true
  }));

  const { request } = startServer(t, contextDir);

  const initialized = await request('initialize', { protocolVersion: '2025-03-26' });
  assert.equal(initialized.result.serverInfo.name, 'Yan Workspace');

  const tools = await request('tools/list', {});
  assert.deepEqual(tools.result.tools.map(tool => tool.name).sort(), [
    'code_impact', 'worktree_create', 'worktree_list', 'worktree_merge', 'worktree_remove', 'worktree_status'
  ]);

  const created = await callTool(request, 'worktree_create', { task_id: taskId, name: 'builder-a' });
  assert.equal(created.isError, false);
  assert.ok(fs.existsSync(path.join(created.structured.path, 'a.js')));

  const list = await callTool(request, 'worktree_list', { task_id: taskId });
  assert.equal(list.structured.worktrees.length, 1);

  const status = await callTool(request, 'worktree_status', { task_id: taskId, name: 'builder-a' });
  assert.equal(status.structured.dirty, false);

  fs.writeFileSync(path.join(created.structured.path, 'feature.txt'), 'built\n');
  git(created.structured.path, ['add', '.']);
  git(created.structured.path, ['commit', '-m', 'builder work']);
  const merged = await callTool(request, 'worktree_merge', { task_id: taskId, name: 'builder-a', message: 'merge builder-a' });
  assert.equal(merged.isError, false, JSON.stringify(merged.structured));
  assert.equal(merged.structured.merged, true);
  assert.ok(fs.existsSync(path.join(repo, 'feature.txt')));

  const removed = await callTool(request, 'worktree_remove', { task_id: taskId, name: 'builder-a' });
  assert.equal(removed.structured.removed, true);

  const impact = await callTool(request, 'code_impact', { task_id: taskId, paths: [path.join(repo, 'b.js')] });
  assert.equal(impact.structured.ok, true);
  const target = impact.structured.targets[0];
  assert.equal(target.ok, true);
  assert.deepEqual(target.directDependents, ['a.js']);
  fs.writeFileSync(path.join(repo, 'a.js'), 'export function independent() { return 1; }\n');
  const refreshed = await callTool(request, 'code_impact', { task_id: taskId, paths: [path.join(repo, 'b.js')] });
  assert.deepEqual(refreshed.structured.targets[0].directDependents, [], 'edits must invalidate impact immediately');
});

test('yan-workspace-mcp refuses calls without an authorized task context', async t => {
  const repo = makeRepo(t);
  const contextDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-workspace-ctx2-'));
  t.after(() => fs.rmSync(contextDir, { recursive: true, force: true }));
  const { request } = startServer(t, contextDir);
  await request('initialize', { protocolVersion: '2025-03-26' });
  const result = await callTool(request, 'worktree_list', { task_id: 'ghost-run' });
  assert.equal(result.isError, true);
  assert.match(result.structured.error, /context/i);
});

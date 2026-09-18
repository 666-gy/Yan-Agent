'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const {
  createHandoffPackage,
  findLatestWorkspaceSession,
  normalizeAbsoluteWorkspacePath,
  sameWorkspace
} = require('../lib/session-handoff');
const { sessionPermissionForRun } = require('../lib/opencode-sidecar');

test('requires an absolute target workspace before normalization', () => {
  assert.equal(normalizeAbsoluteWorkspacePath('Desktop\\2'), '');
  assert.equal(normalizeAbsoluteWorkspacePath(''), '');
  const absolute = path.resolve('test-target-workspace');
  assert.equal(normalizeAbsoluteWorkspacePath(absolute), absolute);
});



test('reuses the most recently updated task in the target workspace', () => {
  const sourceWorkspace = path.resolve('workspace-one');
  const targetWorkspace = path.resolve('workspace-two');
  const sessions = [
    { id: 'source', workspace: sourceWorkspace, updatedAt: 500, createdAt: 100 },
    { id: 'target-old-pinned', workspace: targetWorkspace, updatedAt: 200, createdAt: 100, pinned: true },
    { id: 'target-latest', workspace: targetWorkspace, updatedAt: 400, createdAt: 200 },
    { id: 'target-excluded', workspace: targetWorkspace, updatedAt: 900, createdAt: 300 }
  ];

  const selected = findLatestWorkspaceSession(sessions, targetWorkspace, {
    excludeSessionIds: ['target-excluded']
  });
  assert.equal(selected?.id, 'target-latest');
  assert.equal(findLatestWorkspaceSession(sessions, path.resolve('workspace-missing')), null);
});

test('Yan Session MCP advertises the handoff and bounded source tools', () => {
  const input = [
    JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'test', version: '1' } }
    }),
    JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
    ''
  ].join('\n');
  const result = spawnSync(process.execPath, [path.join(__dirname, '..', 'lib', 'yan-session-mcp.js')], {
    input,
    encoding: 'utf8',
    timeout: 10_000
  });

  assert.equal(result.status, 0, result.stderr);
  const responses = result.stdout.trim().split('\n').map(line => JSON.parse(line));
  assert.equal(responses[0].result.serverInfo.name, 'Yan Session');
  assert.deepEqual(responses[1].result.tools.map(tool => tool.name), [
    'create_handoff',
    'read_source_context'
  ]);
  assert.deepEqual(responses[1].result.tools[0].inputSchema.required, ['target_path', 'reason']);
});

test('Yan Session tools stay callable with or without a user workspace', () => {
  const server = {
    id: 'yan_session',
    runtime: 'yan-session',
    enabled: true,
    command: process.execPath
  };
  for (const hasUserWorkspace of [false, true]) {
    const rules = sessionPermissionForRun({
      hasUserWorkspace,
      accessMode: 'request',
      mcpServers: [server]
    });
    assert.ok(rules.some(rule => (
      rule.permission === 'yan_session_*'
      && rule.pattern === '*'
      && rule.action === 'allow'
    )));
  }
});

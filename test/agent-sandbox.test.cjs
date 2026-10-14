'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { assertSandboxTool } = require('../lib/agent-sandbox');
const { permissionForRun, sessionPermissionForRun, builderSessionPermissionForRun, buildOpenCodeConfig } = require('../lib/opencode-sidecar');
test('restricted modes deny bypass tools in parent, blank and builder rules', () => {
  for (const sandboxMode of ['read-only', 'workspace-write']) {
    const config = { sandboxMode, accessMode: 'full', hasUserWorkspace: true, mcpServers: [{ id: 'external', enabled: true, command: 'node' }] };
    const permissions = permissionForRun(config);
    assert.equal(permissions.bash, 'deny');
    assert.equal(permissions.external_directory, 'deny');
    assert.equal(permissions['external_*'], 'deny');
    for (const rules of [sessionPermissionForRun(config), builderSessionPermissionForRun(config)]) {
      assert.equal(rules.find(r => r.permission === 'bash').action, 'deny');
      assert.equal(rules.find(r => r.permission === 'external_*').action, 'deny');
      assert.equal(rules.find(r => r.permission === 'write').action, sandboxMode === 'read-only' ? 'deny' : 'allow');
    }
    assert.equal(sessionPermissionForRun({ ...config, hasUserWorkspace: false }).find(rule => rule.permission === 'write').action, 'deny');
    const kernel = buildOpenCodeConfig({ ...config, providerId: 'fixture', modelId: 'fixture' });
    assert.match(kernel.plugin[0], /yanSandbox=/);
    assert.equal(kernel.agent.builder.permission.bash, 'deny');
  }
});
test('workspace writes reject traversal, patch moves, junctions, and direct shell calls', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-sandbox-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const workspace = path.join(root, 'work'), outside = path.join(root, 'outside');
  fs.mkdirSync(workspace); fs.mkdirSync(outside);
  fs.symlinkSync(outside, path.join(workspace, 'link'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.doesNotThrow(() => assertSandboxTool('workspace-write', workspace, 'write', { filePath: 'new/ok.txt' }));
  for (const filePath of ['../outside/no.txt', path.join(outside, 'no.txt'), 'link/no.txt']) {
    assert.throws(() => assertSandboxTool('workspace-write', workspace, 'write', { filePath }), /之外/);
  }
  assert.throws(() => assertSandboxTool('workspace-write', workspace, 'apply_patch', { patchText: '*** Update File: ok.txt\n*** Move to: ../outside/no.txt' }), /之外/);
  assert.throws(() => assertSandboxTool('read-only', workspace, 'edit', { filePath: 'ok.txt' }), /只读/);
  const plugin = (await import(pathToFileURL(path.resolve('lib/coding-environment-plugin.mjs')).href + '?yanSandbox=workspace-write')).default;
  const hooks = await plugin({ directory: workspace, client: {} });
  await assert.rejects(() => hooks.tool.bash.execute({ command: 'echo bypass' }, {}), /不允许/);
  await assert.rejects(() => hooks['tool.execute.before']({ tool: 'write' }, { args: { filePath: '../outside/no.txt' } }), /之外/);
  await assert.rejects(() => hooks['tool.execute.before']({ tool: 'external_execute' }, { args: {} }), /不允许/);
});

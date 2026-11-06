'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const { pathToFileURL } = require('node:url');

const { assertSandboxTool } = require('../lib/agent-sandbox');
const { permissionForRun, sessionPermissionForRun, buildOpenCodeConfig } = require('../lib/kernel-policy');
const { permissions, translateConfig } = require('../lib/kernel-v2/config');

test('V2 restricted modes deny shell bypasses and keep legacy role dispatch disabled', () => {
  for (const sandboxMode of ['read-only', 'workspace-write']) {
    const config = { sandboxMode, accessMode: 'full', hasUserWorkspace: true,
      mcpServers: [{ id: 'external', enabled: true, command: 'node' }] };
    const parent = permissions(config);
    assert.equal(parent.find(rule => rule.action === 'shell').effect, 'deny');
    assert.equal(parent.find(rule => rule.action === 'external_*').effect, 'deny');
    assert.equal(parent.find(rule => rule.action === 'edit').effect,
      sandboxMode === 'read-only' ? 'deny' : 'allow');
    const blank = permissions({ ...config, hasUserWorkspace: false });
    assert.equal(blank.find(rule => rule.action === 'edit').effect,
      sandboxMode === 'read-only' ? 'deny' : 'allow');
    const translated = translateConfig(buildOpenCodeConfig({ ...config, providerId: 'fixture', modelId: 'fixture' }));
    assert.equal(translated.agents.build.permissions.find(rule => rule.action === 'shell').effect, 'deny');
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

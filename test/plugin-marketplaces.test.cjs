'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const { createPluginSessions } = require('../lib/plugins/sessions');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-market-test-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));
  const source = path.join(root, 'repo'), data = path.join(root, 'data');
  fs.mkdirSync(source);
  const store = createPluginStore(data), catalog = createPluginCatalog(store);
  const seed = (relative, id = 'market-fixture') => {
    const target = path.join(source, relative);
    fs.cpSync(path.join(__dirname, 'fixtures/plugin-package'), target, { recursive: true });
    const file = path.join(target, 'yan-plugin.json'), manifest = JSON.parse(fs.readFileSync(file));
    manifest.id = id;
    fs.writeFileSync(file, JSON.stringify(manifest));
    return target;
  };
  const git = (...args) => execFileSync('git', args, { cwd: source, windowsHide: true, stdio: 'pipe' }).toString().trim();
  return { root, source, data, store, catalog, seed, git };
}

test('local market persists and installs an immutable plugin usable by Agent sessions', async t => {
  const f = fixture(t); f.seed('plugins/one');
  const added = await f.catalog.addMarketplace({ source: f.source, sparsePaths: 'plugins/one' });
  assert.equal(added.count, 1);
  assert.equal(f.store.list().length, 0);
  fs.rmSync(f.source, { recursive: true });
  const reloaded = createPluginCatalog(f.store);
  assert.equal(reloaded.list().find(item => item.id === 'market-fixture').installed, false);
  const installed = await reloaded.install('market-fixture');
  assert.equal(installed.enabled, false);
  assert.equal(installed.ready, true);
  f.store.update(installed.id, { enabled: true });
  const sessions = createPluginSessions(f.data, f.root, 'market-test');
  const binding = sessions.activate(installed.id);
  assert.match(sessions.resource(binding, 'skill:text-review').text, /文本|text/i);
  assert.equal(f.store.manifest(f.store.get(installed.id)).mcpServers[0].command, '$node');
});

test('real Git ref and sparse paths choose committed content rather than the current worktree', async t => {
  const f = fixture(t);
  f.seed('plugins/one'); f.seed('plugins/two', 'excluded-fixture');
  f.git('init', '-b', 'main');
  f.git('add', '.');
  f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'main');
  f.git('checkout', '-b', 'alternate');
  const file = path.join(f.source, 'plugins/one/yan-plugin.json');
  const manifest = JSON.parse(fs.readFileSync(file)); manifest.version = '2.0.0';
  fs.writeFileSync(file, JSON.stringify(manifest));
  f.git('add', '.');
  f.git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid', 'commit', '-m', 'alternate');
  f.git('checkout', 'main');
  const added = await f.catalog.addMarketplace({ source: f.source, ref: 'alternate', sparsePaths: 'plugins/one' });
  assert.equal(added.count, 1);
  assert.equal(f.catalog.list().some(item => item.id === 'excluded-fixture'), false);
  assert.equal((await f.catalog.install('market-fixture')).version, '2.0.0');
  assert.equal(f.git('branch', '--show-current'), 'main');
  await assert.rejects(f.catalog.addMarketplace({ source: f.source, ref: 'missing-ref', sparsePaths: 'plugins/one' }), /Git/);
});

test('Codex skills and MCP declarations become real validated contributions', async t => {
  const f = fixture(t), folder = f.seed('plugins/codex');
  fs.unlinkSync(path.join(folder, 'yan-plugin.json'));
  fs.mkdirSync(path.join(folder, '.codex-plugin'));
  fs.writeFileSync(path.join(folder, '.codex-plugin/plugin.json'), JSON.stringify({ name: 'codex-fixture', version: '1.0.0', description: 'Codex fixture', skills: './skills/', mcpServers: './.mcp.json' }));
  fs.writeFileSync(path.join(folder, '.mcp.json'), JSON.stringify({ mcpServers: { text: { command: '$node', args: ['${CLAUDE_PLUGIN_ROOT}/server.cjs'] } } }));
  await f.catalog.addMarketplace({ source: folder });
  const installed = await f.catalog.install('codex-fixture');
  assert.equal(installed.skills.length, 1);
  assert.equal(installed.servers.length, 1);
  assert.equal(installed.ready, true);
  assert.deepEqual(f.store.manifest(f.store.get(installed.id)).mcpServers[0].args, ['${pluginRoot}/server.cjs']);
});

test('invalid sources, escaping paths and malformed packages leave the registry unchanged', async t => {
  const f = fixture(t); f.seed('valid');
  for (const sparsePaths of ['../secret', '/absolute', 'C:/Windows', 'valid/../escape', '-option']) {
    await assert.rejects(f.catalog.addMarketplace({ source: f.source, sparsePaths }), /稀疏路径/);
  }
  await assert.rejects(f.catalog.addMarketplace({ source: 'ext::arbitrary-command' }), /来源/);
  await assert.rejects(f.catalog.addMarketplace({ source: f.source, ref: 'main' }), /本地目录/);
  fs.writeFileSync(path.join(f.source, 'valid/yan-plugin.json'), '{}');
  await assert.rejects(f.catalog.addMarketplace({ source: f.source }));
  assert.equal(f.catalog.list().some(item => item.category === 'custom'), false);
});

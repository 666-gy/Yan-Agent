'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const { registerPluginsRuntime } = require('../lib/main/plugins-runtime');

function fixture(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-catalog-test-'));
  t.after(() => { assert.equal(path.dirname(dataDir), path.resolve(os.tmpdir())); fs.rmSync(dataDir, { recursive: true, force: true }); });
  const store = createPluginStore(dataDir);
  return { dataDir, store, catalog: createPluginCatalog(store) };
}
test('catalog installs verified real workflow packages, keeps resources and persists state', t => {
  const { dataDir, store, catalog } = fixture(t);
  assert.deepEqual(catalog.list().map(item => item.id), ['yan-computer-use', 'playwright', 'remotion', 'hyperframes', 'figma', 'canva', 'game-studio', 'circleci', 'build-ios-apps', 'build-macos-apps']);
  assert.throws(() => catalog.install('../example'), /目录/);
  for (const id of ['remotion', 'hyperframes']) {
    const item = catalog.install(id);
    assert.equal(item.enabled, false);
    assert.equal(item.ready, true);
    assert.equal(item.skills.length, id === 'remotion' ? 12 : 5);
    assert.ok(item.resources.length > 50);
    assert.equal(item.servers.length, 0);
    const root = store.packageRoot(item);
    assert.match(fs.readFileSync(path.join(root, 'NOTICE.txt'), 'utf8'), /1dc195897af4161d039b80d8471ec0a10c9bbc89/);
    for (const resource of [...item.skills, ...item.resources]) assert.ok(fs.statSync(path.join(root, resource.path)).isFile());
    store.update(id, { enabled: true });
  }
  assert.equal(createPluginCatalog(createPluginStore(dataDir)).list().filter(item => item.installation?.enabled).length, 2);
  store.remove('remotion');
  assert.equal(catalog.list().find(item => item.id === 'remotion').installed, false);
});
test('catalog workflows activate and read through model tools without registering fake MCP tools', async t => {
  const { dataDir, store, catalog } = fixture(t);
  const { createPluginTools } = await import(pathToFileURL(path.resolve(__dirname, '../lib/plugins/kernel-tools.mjs')));
  const permission = [{ permission: '*', pattern: '*', action: 'allow' }];
  const client = { session: { get: async () => ({ data: { permission } }), update: async ({ permission: next }) => { permission.splice(0, permission.length, ...next); return { data: {} }; } }, mcp: { add: () => { throw new Error('A workflow package must not start an MCP server'); } } };
  const runtime = createPluginTools({ client, directory: dataDir, dataDir });
  for (const id of ['remotion', 'hyperframes']) {
    catalog.install(id); store.update(id, { enabled: true });
    const context = { sessionID: 'catalog-session', ask: () => { throw new Error('No process launch'); } };
    const activation = JSON.parse(await runtime.tools.plugins_activate.execute({ id }, context));
    assert.equal(activation.activated, true);
    assert.match(activation.instructions.text, /plugins_read_resource/);
    for (const skill of activation.skills) {
      const resource = JSON.parse(await runtime.tools.plugins_read_resource.execute({ id, resource: skill.id }, context));
      assert.ok(resource.text.length > 100);
    }
    const inspected = JSON.parse(await runtime.tools.plugins_inspect.execute({ id }));
    const ref = inspected.resources.find(resource => resource.path.endsWith('.md'));
    const text = JSON.parse(await runtime.tools.plugins_read_resource.execute({ id, resource: `resource:${ref.id}` }, context));
    assert.ok(text.text.length > 50);
    store.update(id, { enabled: false });
    await assert.rejects(runtime.tools.plugins_read_resource.execute({ id, resource: activation.skills[0].id }, context));
  }
});
test('IPC exposes catalog IDs only; removed import and demonstration routes are absent', async t => {
  const { dataDir } = fixture(t); const handlers = new Map();
  const ctx = { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, windows: { getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 7, send() {} } }) }, shell: { openPath: async () => '' } };
  registerPluginsRuntime(ctx, { dataDir });
  for (const name of ['plugins:preview', 'plugins:example', 'plugins:install']) assert.equal(handlers.has(name), false);
  const install = handlers.get('plugins:install-catalog');
  assert.equal((await install({ sender: { id: 8 } }, { id: 'remotion' })).ok, false);
  assert.equal((await install({ sender: { id: 7 } }, { source: __dirname })).ok, false);
  assert.equal((await install({ sender: { id: 7 } }, { id: 'remotion' })).ok, true);
});

test('individual skill switches persist, filter model discovery and revoke previously active reads', async t => {
  const { dataDir, store, catalog } = fixture(t);
  catalog.install('remotion'); store.update('remotion', { enabled: true });
  const { createPluginTools } = await import(pathToFileURL(path.resolve(__dirname, '../lib/plugins/kernel-tools.mjs')));
  const permission = [{ permission: '*', pattern: '*', action: 'allow' }];
  const client = { session: { get: async () => ({ data: { permission } }), update: async () => ({ data: {} }) } };
  const runtime = createPluginTools({ client, directory: dataDir, dataDir });
  const context = { sessionID: 'skill-switches' };
  await runtime.tools.plugins_activate.execute({ id: 'remotion' }, context);
  const manifest = store.manifest(store.get('remotion'));
  const reference = manifest.resources.find(r => r.path.includes('/remotion-captions/') && r.path.endsWith('.md'));
  const skill = { id: 'remotion-captions', enabled: false };
  store.update('remotion', { skill });
  assert.deepEqual(createPluginStore(dataDir).get('remotion').disabledSkills, [skill.id]);
  await assert.rejects(runtime.tools.plugins_read_resource.execute({ id: 'remotion', resource: 'skill:remotion-create' }, context), /重新激活/);
  const listed = JSON.parse(await runtime.tools.plugins_list.execute({}));
  assert.equal(listed.plugins[0].skills.some(s => s.id === skill.id), false);
  const inspected = JSON.parse(await runtime.tools.plugins_inspect.execute({ id: 'remotion' }));
  assert.equal(inspected.skills.length, 11);
  assert.equal(inspected.resources.some(r => r.path.includes('/remotion-captions/')), false);
  const activated = JSON.parse(await runtime.tools.plugins_activate.execute({ id: 'remotion' }, context));
  assert.equal(activated.skills.length, 11);
  await assert.rejects(runtime.tools.plugins_read_resource.execute({ id: 'remotion', resource: `skill:${skill.id}` }, context), /不存在/);
  await assert.rejects(runtime.tools.plugins_read_resource.execute({ id: 'remotion', resource: `resource:${reference.id}` }, context), /不存在/);
  assert.ok(JSON.parse(await runtime.tools.plugins_read_resource.execute({ id: 'remotion', resource: 'skill:remotion-create' }, context)).text.length > 100);
  // Nested subskills remain available when only the top-level router is off.
  store.update('remotion', { skill: { id: 'remotion-best-practices', enabled: false } });
  assert.ok(store.contributions(store.get('remotion')).resources.some(r => r.path.includes('/remotion-create/')));
  catalog.install('remotion');
  assert.equal(store.describe(store.get('remotion')).skills.find(s => s.id === skill.id).enabled, false);
  assert.throws(() => store.update('remotion', { skill: { id: 'missing', enabled: false } }), /无效技能/);
  assert.throws(() => store.update('remotion', { skill: { id: skill.id, enabled: 'false' } }), /无效技能/);
  store.update('remotion', { skill: { id: skill.id, enabled: true } });
  assert.ok(store.contributions(store.get('remotion')).skills.some(s => s.id === skill.id));
  store.update('remotion', { enabled: false });
  assert.equal(JSON.parse(await runtime.tools.plugins_list.execute({})).plugins.length, 0);
  assert.doesNotMatch(await runtime.system(context.sessionID), /remotion \|/);
  await assert.rejects(runtime.tools.plugins_inspect.execute({ id: 'remotion' }), /未启用/);
});

test('detail metadata comes from upstream and external links accept only catalog-owned destinations', async t => {
  const { dataDir, catalog } = fixture(t); const handlers = new Map(), opened = [];
  const item = catalog.list().find(item => item.id === 'remotion');
  assert.equal(item.presentation.shortDescription, 'Make videos agentically');
  assert.deepEqual(item.presentation.capabilities, ['Read', 'Write']);
  assert.equal(item.presentation.privacy, 'https://www.remotion.dev/privacy');
  registerPluginsRuntime({ ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, windows: { getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 7, send() {} } }) }, shell: { openExternal: async url => opened.push(url) } }, { dataDir });
  const open = handlers.get('plugins:open-link');
  assert.equal((await open({ sender: { id: 7 } }, { id: 'remotion', kind: 'privacy' })).ok, true);
  assert.deepEqual(opened, ['https://www.remotion.dev/privacy']);
  for (const kind of ['https://example.com', '__proto__', 'source']) assert.equal((await open({ sender: { id: 7 } }, { id: 'remotion', kind })).ok, false);
  assert.equal((await open({ sender: { id: 8 } }, { id: 'remotion', kind: 'website' })).ok, false);
});
function writeLocalPlugin(dir, { id = 'sample-tool', name = 'Sample Tool' } = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'yan-plugin.json'), JSON.stringify({
    schemaVersion: 1, id, version: '1.0.0', name, description: 'A sample marketplace plugin.'
  }));
  return dir;
}

test('marketplace sources can be added, listed and removed without touching installed plugins', async t => {
  const { catalog } = fixture(t);
  const source = writeLocalPlugin(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yan-market-src-')), 'sample'));
  t.after(() => fs.rmSync(path.dirname(source), { recursive: true, force: true }));
  const added = await catalog.addMarketplace({ source });
  assert.equal(added.count, 1);
  assert.ok(catalog.list().some(item => item.id === 'sample-tool' && item.category === 'custom'));
  const markets = catalog.markets();
  assert.equal(markets.length, 1);
  assert.equal(markets[0].source, source);
  assert.equal(markets[0].count, 1);
  assert.deepEqual(markets[0].plugins, [{ id: 'sample-tool', name: 'Sample Tool' }]);
  const removed = catalog.removeMarketplace(markets[0].id);
  assert.equal(removed.removed, true);
  assert.deepEqual(catalog.markets(), []);
  assert.equal(catalog.list().some(item => item.id === 'sample-tool'), false);
  assert.throws(() => catalog.removeMarketplace(markets[0].id), /不存在/);
});

test('IPC lists and removes marketplace sources', async t => {
  const { dataDir } = fixture(t); const handlers = new Map();
  const ctx = { ipcMain: { handle: (name, handler) => handlers.set(name, handler) }, windows: { getMainWindow: () => ({ isDestroyed: () => false, webContents: { id: 7, send() {} } }) }, shell: { openExternal: async () => {} } };
  registerPluginsRuntime(ctx, { dataDir });
  const source = writeLocalPlugin(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yan-market-ipc-')), 'sample'));
  t.after(() => fs.rmSync(path.dirname(source), { recursive: true, force: true }));
  assert.equal((await handlers.get('plugins:add-marketplace')({ sender: { id: 7 } }, { source })).ok, true);
  const listed = await handlers.get('plugins:markets')({ sender: { id: 7 } });
  assert.equal(listed.ok, true);
  assert.equal(listed.markets.length, 1);
  const removed = await handlers.get('plugins:remove-marketplace')({ sender: { id: 7 } }, { id: listed.markets[0].id });
  assert.equal(removed.ok, true);
  assert.equal((await handlers.get('plugins:markets')({ sender: { id: 7 } })).markets.length, 0);
  assert.equal((await handlers.get('plugins:remove-marketplace')({ sender: { id: 8 } }, { id: 'x' })).ok, false);
});

test('yan_plugin tools list, install, uninstall and manage marketplaces', async t => {
  const { dataDir } = fixture(t);
  const previous = process.env.YAN_PLUGIN_DATA_DIR;
  process.env.YAN_PLUGIN_DATA_DIR = dataDir;
  t.after(() => { if (previous === undefined) delete process.env.YAN_PLUGIN_DATA_DIR; else process.env.YAN_PLUGIN_DATA_DIR = previous; });
  const plugin = require('../lib/yan-plugin-mcp.js');
  const listed = plugin.listPlugins({});
  assert.ok(listed.plugins.some(item => item.id === 'remotion' && item.source === 'bundled' && item.installed === false));
  assert.deepEqual(plugin.toolDefinitions().map(tool => tool.name), ['list_plugins', 'add_plugin_marketplace', 'install_plugin', 'remove_plugin', 'remove_plugin_marketplace']);
  const installed = await plugin.installPlugin({ id: 'remotion' });
  assert.equal(installed.ok, true);
  assert.equal(installed.enabled, false);
  assert.ok(plugin.listPlugins({ query: 'remotion' }).plugins.some(item => item.id === 'remotion' && item.installed === true));
  assert.equal((await plugin.installPlugin({})).ok, false);
  assert.match((await plugin.installPlugin({ id: 'playwright' })).error, /运行时/);
  const source = writeLocalPlugin(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'yan-market-mcp-')), 'sample'));
  t.after(() => fs.rmSync(path.dirname(source), { recursive: true, force: true }));
  const added = await plugin.addMarketplace({ source });
  assert.equal(added.ok, true);
  assert.equal(added.count, 1);
  assert.equal((await plugin.removeMarketplace({ source })).ok, true);
  assert.deepEqual(plugin.listPlugins({}).marketplaces, []);
  assert.equal((await plugin.removePlugin({ id: 'remotion' })).removed, true);
  assert.equal(plugin.listPlugins({}).plugins.find(item => item.id === 'remotion').installed, false);
});

test('the former bundled demo is retired without deleting retained version files', t => {
  const { dataDir, store } = fixture(t);
  const source = path.join(__dirname, 'fixtures/plugin-package');
  const candidate = store.preview(source);
  const installed = store.install(source, candidate.digest);
  const ctx = { ipcMain: { handle() {} }, windows: { getMainWindow: () => null }, shell: {} };
  registerPluginsRuntime(ctx, { dataDir });
  assert.equal(store.get('yan-text-kit'), null);
  assert.ok(fs.existsSync(store.packageRoot(installed)));
});

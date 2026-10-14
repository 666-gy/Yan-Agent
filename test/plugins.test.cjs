'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { pathToFileURL } = require('node:url');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginSessions, compactPermissionRules, withPluginSessionPermissions } = require('../lib/plugins/sessions');
const { createGateway } = require('../lib/plugins/gateway');
const { manifestSchema } = require('../lib/plugins/manifest');
const { permissionForRun, sessionPermissionForRun } = require('../lib/opencode-sidecar');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-plugins-test-'));
  const cleanups = [];
  t.after(async () => { for (const cleanup of cleanups) await cleanup(); assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true, maxRetries: 4, retryDelay: 100 }); });
  const source = path.join(root, 'source'); fs.cpSync(path.join(__dirname, 'fixtures/plugin-package'), source, { recursive: true });
  const dataDir = path.join(root, 'data'); const directory = path.join(root, 'workspace'); fs.mkdirSync(directory);
  const store = createPluginStore(dataDir);
  const install = () => { const p = store.preview(source); return store.install(source, p.digest); };
  const alter = change => { const file = path.join(source, 'yan-plugin.json'); const m = JSON.parse(fs.readFileSync(file)); change(m); fs.writeFileSync(file, JSON.stringify(m)); };
  return { root, source, dataDir, directory, store, install, alter, cleanups };
}
test('install is a verified copy, disabled by default; state survives restart', t => {
  const f = fixture(t); const p = f.install();
  assert.equal(p.enabled, false); assert.equal(p.ready, true); assert.equal(p.skills.length, 1);
  fs.rmSync(f.source, { recursive: true });
  assert.equal(createPluginStore(f.dataDir).list()[0].id, p.id);
  assert.ok(fs.existsSync(path.join(f.store.packageRoot(p), 'server.cjs')));
});
test('platform and executable requirements block activation without hiding installed content', t => {
  const f = fixture(t);
  f.alter(m => { m.platforms = [process.platform === 'darwin' ? 'win32' : 'darwin']; m.requiredCommands = ['missing-yan-build-tool']; });
  const item = f.install(); f.store.update(item.id, { enabled: true });
  assert.equal(item.ready, false); assert.equal(item.skills.length, 1);
  assert.equal(item.issues.length, 1); assert.match(item.issues[0], /运行需要/);
  assert.throws(() => createPluginSessions(f.dataDir, f.directory, 'unsupported').activate(item.id), /运行需要/);
  f.alter(m => { m.platforms = [process.platform]; });
  const supported = f.install();
  assert.ok(supported.issues.includes('缺少运行工具：missing-yan-build-tool'));
  assert.throws(() => createPluginSessions(f.dataDir, f.directory, 'missing-command').activate(item.id), /缺少运行工具/);
  f.alter(m => { m.requiredCommands = []; });
  assert.equal(f.install().ready, true);
  const manifest = f.store.manifest(f.store.get(item.id));
  for (const command of ['../tool', 'node && echo', '/bin/sh']) assert.equal(manifestSchema.safeParse({ ...manifest, requiredCommands: [command] }).success, false);
});

test('changed preview and escaping resource paths cannot be installed', t => {
  const f = fixture(t); const p = f.store.preview(f.source);
  fs.appendFileSync(path.join(f.source, 'instructions.md'), '\nchanged');
  assert.throws(() => f.store.install(f.source, p.digest), /变化/);
  assert.equal(f.store.list().length, 0);
  for (const resourcePath of ['../secret', '/tmp/file', 'C:/secret', 'dir\\file', './file']) {
    f.alter(m => { m.instructions = resourcePath; }); assert.throws(() => f.store.preview(f.source));
  }
});
test('manifest is strict and duplicate contributions are rejected', t => {
  const f = fixture(t); f.alter(m => { m.installScript = 'run arbitrary code'; }); assert.throws(() => f.install());
  assert.equal(manifestSchema.safeParse({ schemaVersion: 2 }).success, false);
  f.alter(m => { delete m.installScript; m.skills.push(m.skills[0]); }); assert.throws(() => f.install(), /重复/);
});
test('preparation reports missing configuration and environment without exposing values', t => {
  const f = fixture(t); f.alter(m => { m.configuration = { region: { label: '地区', required: true } }; m.environment = [{ name: 'YAN_PLUGIN_MISSING_KEY_TEST', description: 'API key' }]; });
  const p = f.install(); assert.equal(p.ready, false); assert.equal(p.issues.length, 2);
  assert.throws(() => f.store.update(p.id, { configuration: { unknown: 'x' } }), /无效/);
  f.store.update(p.id, { configuration: { region: 'cn' } });
  const prepared = f.store.prepare(f.store.get(p.id), { ...process.env, YAN_PLUGIN_MISSING_KEY_TEST: 'private-secret' });
  assert.equal(prepared.ready, true); assert.ok(!JSON.stringify(prepared).includes('private-secret'));
});
test('session activation pins package AND configuration, upgrade does not mix resources', t => {
  const f = fixture(t); f.alter(m => { m.configuration = { label: { label: 'Label' } }; });
  f.install(); f.store.update('yan-text-kit', { enabled: true, configuration: { label: 'old' } });
  const a = createPluginSessions(f.dataDir, f.directory, 'session-a'); const old = a.activate('yan-text-kit');
  f.alter(m => { m.version = '2.0.0'; }); fs.writeFileSync(path.join(f.source, 'instructions.md'), 'VERSION_TWO');
  f.install(); f.store.update('yan-text-kit', { configuration: { label: 'new' } });
  assert.equal(a.activate('yan-text-kit').digest, old.digest);
  assert.equal(a.activate('yan-text-kit').configuration.label, 'old');
  assert.ok(!a.resource(old, 'instructions').text.includes('VERSION_TWO'));
  const b = createPluginSessions(f.dataDir, f.directory, 'session-b'); const next = b.activate('yan-text-kit');
  assert.equal(next.version, '2.0.0'); assert.equal(next.configuration.label, 'new');
  assert.notEqual(next.name, old.name); assert.throws(() => b.authorize(old), /当前会话/);
});
test('scope, disabling, reenabling, uninstalling all revoke old grants', t => {
  const f = fixture(t); f.install(); f.store.update('yan-text-kit', { enabled: true, scope: 'workspace', workspace: f.directory });
  const a = createPluginSessions(f.dataDir, f.directory, 'a'); const b = createPluginSessions(f.dataDir, f.root, 'b');
  assert.throws(() => b.activate('yan-text-kit'), /工作区/);
  const original = a.activate('yan-text-kit'); f.store.update(original.id, { enabled: false });
  assert.throws(() => a.authorize(original), /禁用/);
  f.store.update(original.id, { enabled: true }); assert.throws(() => a.authorize(original));
  const renewed = a.activate(original.id); assert.notEqual(renewed.token, original.token);
  f.store.remove(original.id); assert.throws(() => a.authorize(renewed)); assert.equal(f.store.list().length, 0);
  assert.ok(fs.existsSync(f.store.packageRoot(original)));
});
test('real stdio gateway lists actual schemas, validates arguments and executes; disable blocks old tools', async t => {
  const f = fixture(t); f.install(); f.store.update('yan-text-kit', { enabled: true });
  const s = createPluginSessions(f.dataDir, f.directory, 'a'); const binding = s.activate('yan-text-kit');
  const gateway = createGateway({ ...f, sessionId: 'a', pluginId: binding.id, token: binding.token });
  f.cleanups.push(() => gateway.close());
  const tools = await gateway.start(); assert.equal(tools.length, 1); assert.deepEqual(tools[0].inputSchema.required, ['text']);
  await assert.rejects(gateway.call(tools[0].name, { text: 15 }), /schema/);
  const result = await gateway.call(tools[0].name, { text: 'hello 世界\nnext' });
  assert.deepEqual(JSON.parse(result.content[0].text), { characters: 13, words: 3, lines: 2 });
  f.store.update(binding.id, { enabled: false }); await assert.rejects(gateway.call(tools[0].name, { text: 'no' }), /禁用/);
});
test('resource chunks are lossless and pinned to their owner', t => {
  const f = fixture(t); const content = '文本abc'.repeat(12000); fs.writeFileSync(path.join(f.source, 'instructions.md'), content);
  f.install(); f.store.update('yan-text-kit', { enabled: true });
  const s = createPluginSessions(f.dataDir, f.directory, 'a'); const binding = s.activate('yan-text-kit');
  let offset = 0; let reconstructed = '';
  do { const chunk = s.resource(binding, 'instructions', offset); reconstructed += chunk.text; offset = chunk.nextOffset; } while (offset !== null);
  assert.equal(reconstructed, content); assert.throws(() => s.resource(binding, 'resource:../secret'));
});
test('runtime policy denies external plugin execution in restricted modes', () => {
  assert.equal(permissionForRun({ accessMode: 'full' }).plugins_execute, 'allow');
  for (const config of [{ workMode: 'plan' }, { sandboxMode: 'read-only' }, { sandboxMode: 'workspace-write' }, { permissions: { allowNetwork: false } }]) {
    assert.equal(permissionForRun({ accessMode: 'full', ...config }).plugins_execute, 'deny');
  }
  assert.equal(permissionForRun({ accessMode: 'full' })['yanp_*'], 'deny');
  assert.equal(sessionPermissionForRun({ accessMode: 'full', hasUserWorkspace: false }).find(rule => rule.permission === 'plugins_execute').action, 'allow');
});
test('repeated permission sync never grows the stored rule array', async t => {
  const f = fixture(t); f.install(); f.store.update('yan-text-kit', { enabled: true });
  const { createPluginTools } = await import(pathToFileURL(path.join(__dirname, '../lib/plugins/kernel-tools.mjs')));
  const base = [
    { permission: 'plugins_execute', pattern: '*', action: 'allow' },
    { permission: 'plugins_read_resource', pattern: '*', action: 'allow' },
    { permission: 'yanp_*', pattern: '*', action: 'deny' }
  ];
  const infos = new Map([['b', { id: 'b', permission: base.slice() }]]);
  // The kernel appends an update's rules to the stored ones. Mirror that, so a
  // regression that re-sends the whole array shows up as runaway growth.
  const client = { session: {
    get: async input => ({ data: infos.get(input.sessionID) }),
    update: async input => {
      const session = infos.get(input.sessionID);
      session.permission = [...session.permission, ...input.body.permission];
      return { data: session };
    }
  } };
  const api = createPluginTools({ ...f, client, nodeExecutable: process.execPath });
  for (let i = 0; i < 12; i++) await api.system('b');
  assert.ok(infos.get('b').permission.length <= base.length + 8, `rules stayed bounded, got ${infos.get('b').permission.length}`);

  // Compaction must not change which rule answers a lookup: the kernel takes the
  // last matching rule, which is always the last of its permission/pattern pair.
  const rules = [
    { permission: 'edit', pattern: '*', action: 'allow' }, { permission: 'bash', pattern: '*', action: 'ask' },
    { permission: 'edit', pattern: '*', action: 'deny' }, { permission: 'bash', pattern: '*', action: 'allow' },
    { permission: 'edit', pattern: 'src/**', action: 'allow' }
  ];
  const resolve = list => { let found = null; for (const rule of list) if (rule.permission === 'edit') found = rule.action; return found; };
  assert.equal(resolve(compactPermissionRules(rules)), resolve(rules));
  assert.deepEqual(compactPermissionRules(rules), [rules[2], rules[3], rules[4]]);
  assert.deepEqual(withPluginSessionPermissions(f.directory, 'b', rules).slice(0, 3), [rules[2], rules[3], rules[4]]);
});
test('kernel integration grants only the activating session and rejects foreign tool calls', async t => {
  const f = fixture(t); f.install(); f.store.update('yan-text-kit', { enabled: true });
  const { createPluginTools } = await import(pathToFileURL(path.join(__dirname, '../lib/plugins/kernel-tools.mjs')));
  const infos = new Map(['a', 'b'].map(id => [id, { id, permission: [
    { permission: 'plugins_execute', pattern: '*', action: 'allow' }, { permission: 'plugins_read_resource', pattern: '*', action: 'allow' },
    { permission: 'yanp_*', pattern: '*', action: 'deny' }
  ] }]));
  const client = { session: { get: async input => ({ data: infos.get(input.sessionID) }), update: async input => { Object.assign(infos.get(input.sessionID), input.body); return { data: infos.get(input.sessionID) }; } },
    mcp: { add: async input => ({ data: { [input.name]: { status: 'connected' } } }), disconnect: async () => ({ data: true }) } };
  const api = createPluginTools({ ...f, client, gatewayEntry: path.join(__dirname, '../lib/plugins/gateway.js'), nodeExecutable: process.execPath });
  const answer = JSON.parse(await api.tools.plugins_activate.execute({ id: 'yan-text-kit' }, { sessionID: 'a', ask: async () => {} }));
  assert.equal(answer.activated, true);
  assert.ok(infos.get('a').permission.some(p => p.permission.startsWith('yanp_') && p.permission !== 'yanp_*' && answer.namespace.startsWith(p.permission.slice(0, -1)) && p.action === 'allow'));
  await api.system('b'); assert.ok(!infos.get('b').permission.some(p => p.permission === `${answer.namespace}_*`));
  await assert.rejects(api.guard({ sessionID: 'b', tool: answer.namespace + '_tool' }), /当前会话/);
  await api.guard({ sessionID: 'a', tool: answer.namespace + '_tool' });
});

test('directory junctions are rejected rather than copied out of the package', t => {
  const f = fixture(t); const outside = path.join(f.root, 'outside'); fs.mkdirSync(outside);
  fs.writeFileSync(path.join(outside, 'private.txt'), 'private');
  fs.symlinkSync(outside, path.join(f.source, 'linked'), process.platform === 'win32' ? 'junction' : 'dir');
  assert.throws(() => f.store.preview(f.source), /联接/); assert.equal(f.store.list().length, 0);
});
test('one failed service prevents a partially activated plugin and closes its peers', async t => {
  const f = fixture(t);
  f.alter(m => m.mcpServers.push({ id: 'broken', type: 'local', command: '$node', args: ['-e', 'setInterval(()=>{},1000)'], timeoutMs: 1000 }));
  f.install(); f.store.update('yan-text-kit', { enabled: true });
  const s = createPluginSessions(f.dataDir, f.directory, 'failure'); const binding = s.activate('yan-text-kit');
  const gateway = createGateway({ ...f, sessionId: 'failure', pluginId: binding.id, token: binding.token });
  f.cleanups.push(() => gateway.close());
  await assert.rejects(gateway.start(), /超时/);
  await assert.rejects(gateway.call('anything', {}));
  await gateway.close();
});
test('broken packages remain removable and can be disabled; corrupt registry fails closed', t => {
  const f = fixture(t); const item = f.install(); f.store.update(item.id, { enabled: true });
  fs.unlinkSync(path.join(f.store.packageRoot(item), 'instructions.md'));
  assert.equal(f.store.list()[0].broken, true);
  assert.equal(f.store.update(item.id, { enabled: false }).enabled, false);
  f.store.remove(item.id); assert.equal(f.store.list().length, 0);
  fs.writeFileSync(path.join(f.store.root, 'registry.json'), '{'); assert.throws(() => f.store.list());
});
test('remote gateway negotiates, carries its session and declared secret, then forwards results', async t => {
  const f = fixture(t); const seen = [];
  const server = http.createServer((req, res) => {
    let raw = ''; req.on('data', chunk => { raw += chunk; }); req.on('end', () => {
      const message = JSON.parse(raw); seen.push({ method: message.method, headers: req.headers });
      res.setHeader('content-type', 'application/json'); res.setHeader('mcp-session-id', 'session-one');
      if (message.id === undefined) { res.statusCode = 202; res.end(); return; }
      const result = message.method === 'initialize' ? { protocolVersion: '2025-03-26', capabilities: { tools: {} }, serverInfo: { name: 'remote-test', version: '1' } }
        : message.method === 'tools/list' ? { tools: [{ name: 'echo', description: 'Echo', inputSchema: { type: 'object', properties: { value: { type: 'string' } }, required: ['value'] } }] }
          : { content: [{ type: 'text', text: message.params.arguments.value }] };
      res.end(JSON.stringify({ jsonrpc: '2.0', id: message.id, result }));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  f.cleanups.push(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const oldEnv = process.env.YAN_PLUGIN_REMOTE_TEST_TOKEN; process.env.YAN_PLUGIN_REMOTE_TEST_TOKEN = 'unit-test-secret';
  f.cleanups.push(() => { if (oldEnv === undefined) delete process.env.YAN_PLUGIN_REMOTE_TEST_TOKEN; else process.env.YAN_PLUGIN_REMOTE_TEST_TOKEN = oldEnv; });
  f.alter(m => { m.environment = [{ name: 'YAN_PLUGIN_REMOTE_TEST_TOKEN', description: 'Test token' }]; m.mcpServers = [{ id: 'remote', type: 'remote', url: `http://127.0.0.1:${server.address().port}/mcp`, headers: { Authorization: 'Bearer ${env.YAN_PLUGIN_REMOTE_TEST_TOKEN}' } }]; });
  f.install(); f.store.update('yan-text-kit', { enabled: true });
  const s = createPluginSessions(f.dataDir, f.directory, 'remote'); const binding = s.activate('yan-text-kit');
  const gateway = createGateway({ ...f, sessionId: 'remote', pluginId: binding.id, token: binding.token });
  f.cleanups.unshift(() => gateway.close());
  const tools = await gateway.start(); const result = await gateway.call(tools[0].name, { value: 'actual-result' });
  assert.equal(result.content[0].text, 'actual-result'); assert.equal(seen[0].headers.authorization, 'Bearer unit-test-secret');
  assert.equal(seen.at(-1).headers['mcp-session-id'], 'session-one');
  assert.ok(!JSON.stringify(f.store.list()).includes('unit-test-secret'));
});

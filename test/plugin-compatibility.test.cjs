'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const { installPackage } = require('../lib/plugins/creation');
const { inventory } = require('../lib/plugins/manifest');
const { createPluginStore } = require('../lib/plugins/store');
function fixture(t, host) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-compat-test-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, 'source');
  fs.mkdirSync(path.join(source, 'skills', 'example'), { recursive: true });
  fs.writeFileSync(path.join(source, 'skills/example/SKILL.md'), '---\nname: Example\ndescription: Example skill\n---\nUse this skill.');
  fs.mkdirSync(path.join(source, `.${host}-plugin`));
  const upstream = { name: 'third-party', version: '1.0.0', author: 'Independent author', hooks: { dangerous: 'never execute' }, mcpServers: {
    service: { command: '$node', args: [`\u0024{${host.toUpperCase()}_PLUGIN_ROOT}/server.cjs`] },
    remote: { url: 'https://example.com/mcp' }
  } };
  fs.writeFileSync(path.join(source, `.${host}-plugin/plugin.json`), JSON.stringify(upstream));
  fs.writeFileSync(path.join(source, 'server.cjs'), 'throw new Error("Installation must not execute this");');
  return { workspace, source, store: createPluginStore(path.join(workspace, 'data')) };
}
for (const host of ['codex', 'claude']) test(`${host}: warn then opt-in import without modifying or executing source`, async t => {
  const { workspace, source, store } = fixture(t, host);
  const before = inventory(source).digest;
  const input = { source_directory: source };
  const warning = await installPackage(input, { workspace }, store);
  assert.equal(warning.compatibilityAvailable, true);
  assert.match(warning.reason, /未针对 Yan 适配/);
  assert.equal(store.list().length, 0);
  assert.equal(inventory(source).digest, before);
  const result = await installPackage({ ...input, allow_compatibility: true }, { workspace }, store);
  assert.equal(result.installed, true);
  assert.equal(result.enabled, false);
  assert.equal(result.runtimeVerified, false);
  assert.equal(result.plugin.source, source);
  assert.equal(inventory(source).digest, before);
  assert.equal(fs.existsSync(path.join(source, 'yan-plugin.json')), false);
  assert.equal(result.manifest.hooks, undefined);
  assert.equal(result.manifest.mcpServers[0].args[0], '${pluginRoot}/server.cjs');
  store.update('third-party', { enabled: true });
  const contributions = store.contributions(store.get('third-party'));
  assert.equal(contributions.skills.length, 1);
  assert.match(fs.readFileSync(path.join(result.path, contributions.skills[0].path), 'utf8'), /Use this skill/);
});
test('native third-party installs directly, unknown formats return adaptation guidance', async t => {
  const { workspace, source, store } = fixture(t, 'codex');
  fs.unlinkSync(path.join(source, '.codex-plugin/plugin.json'));
  const unknown = await installPackage({ source_directory: source, allow_compatibility: true }, { workspace }, store);
  assert.equal(unknown.installed, false);
  assert.match(unknown.reason, /兼容副本/);
  fs.writeFileSync(path.join(source, 'yan-plugin.json'), JSON.stringify({ schemaVersion: 1, id: 'independent', version: '1.0.0', name: 'Independent', description: 'Third party', author: 'Not Yan', skills: [{ id: 'example', name: 'Example', description: 'Example', path: 'skills/example/SKILL.md' }] }));
  const result = await installPackage({ source_directory: source }, { workspace }, store);
  assert.equal(result.installed, true);
  assert.equal(result.plugin.author, 'Not Yan');
  assert.ok(result.digest && result.path && result.requirements);
});
test('compatibility keeps task permissions and rejects traversal without source mutation', async t => {
  const { workspace, source, store } = fixture(t, 'claude');
  const input = { source_directory: source, allow_compatibility: true };
  await assert.rejects(installPackage(input, { workspace, allowFileWrite: false }, store), /读写/);
  await assert.rejects(installPackage(input, { workspace: path.join(source, 'skills') }, store), /当前任务/);
  const file = path.join(source, '.claude-plugin/plugin.json');
  const manifest = JSON.parse(fs.readFileSync(file)); manifest.skills = '../outside';
  fs.writeFileSync(file, JSON.stringify(manifest));
  const digest = inventory(source).digest;
  await assert.rejects(installPackage(input, { workspace }, store), /相对目录/);
  assert.equal(inventory(source).digest, digest);
  assert.equal(store.list().length, 0);
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { inspectPackage, createPackage } = require('../lib/plugins/creation');

function fixture(t) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-create-plugin-'));
  t.after(() => fs.rmSync(workspace, { recursive: true, force: true }));
  const source = path.join(workspace, 'source'); fs.mkdirSync(source);
  const manifest = { schemaVersion: 1, id: 'example', version: '1.0.0', name: 'Example', description: 'Example workflow', instructions: 'instructions.md' };
  fs.writeFileSync(path.join(source, 'instructions.md'), 'Use this workflow.');
  const save = () => fs.writeFileSync(path.join(source, 'yan-plugin.json'), JSON.stringify(manifest));
  save(); return { workspace, source, manifest, save };
}
test('creation produces an immutable copy without installation and refuses overwrite', t => {
  const { workspace, source } = fixture(t);
  const result = createPackage({ source_directory: source }, { workspace });
  assert.equal(result.installed, false); assert.equal(result.enabled, false); assert.equal(result.runtimeVerified, false);
  assert.equal(inspectPackage(result.path).digest, result.digest);
  assert.equal(fs.existsSync(path.join(workspace, 'plugins', 'registry.json')), false);
  assert.throws(() => createPackage({ source_directory: source }, { workspace }), /exist/i);
});
test('native compatibility rejects unknown declarations and unresolved resources', t => {
  const { source, manifest, save } = fixture(t);
  manifest.hooks = {}; save(); assert.throws(() => inspectPackage(source));
  delete manifest.hooks; manifest.schemaVersion = 2; save(); assert.throws(() => inspectPackage(source));
  manifest.schemaVersion = 1; manifest.instructions = '../escape.md'; save(); assert.throws(() => inspectPackage(source));
  manifest.instructions = 'absent.md'; save(); assert.throws(() => inspectPackage(source));
  manifest.instructions = 'instructions.md'; manifest.mcpServers = [{ id:'remote', type:'remote', url:'https://example.com/mcp', headers:{Authorization:'${env.TOKEN}'} }]; save();
  assert.throws(() => inspectPackage(source), /占位符/);
  manifest.environment = [{name:'TOKEN', description:'Token'}]; save(); assert.equal(inspectPackage(source).compatible, true);
});
test('creation enforces task directory and read/write permissions', t => {
  const { workspace, source } = fixture(t);
  assert.throws(() => createPackage({ source_directory: source }, null), /task_id/);
  assert.throws(() => createPackage({ source_directory: source }, { workspace, allowFileWrite: false }), /读写/);
  assert.throws(() => createPackage({ source_directory: workspace }, { workspace: source }), /当前任务/);
});
test('catalog install and obsolete natural-language installation are unavailable', () => {
  const catalog = require('../lib/plugins/catalog').createPluginCatalog({});
  assert.equal(typeof catalog.install, 'function');
  assert.equal(catalog.addMarketplace, undefined);
  assert.deepEqual(require('../lib/yan-plugin-mcp').toolDefinitions().map(t => t.name), ['list_plugins', 'install_plugin', 'remove_plugin']);
  assert.equal(require('../lib/creative-agent').toolAllowed('yan_skills_create_plugin'), true);
  assert.equal(require('../lib/minimal-agent').toolAllowed('yan_skills_create_plugin'), false);
  assert.equal(require('../lib/daily-agent').toolAllowed('yan_skills_create_plugin'), false);
});
test('Plugin Creator is readable from the built-in skill registry', t => {
  const { workspace } = fixture(t);
  const result = require('../lib/skill-registry').readSkill('plugin-creator', '', { customSkills: [] }, path.resolve(__dirname, '..'), workspace);
  assert.equal(result.ok, true, result.error);
  assert.ok(result.prompt.includes('yan_skills_create_plugin'));
});

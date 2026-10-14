'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const { installDeveloperPlugins, entries } = require('./helpers/install-developer-plugins.cjs');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-developer-plugins-'));
(async () => {
  try {
    const store = createPluginStore(root);
    await installDeveloperPlugins(store);
    const { createPluginTools } = await import(pathToFileURL(path.resolve(__dirname, '../lib/plugins/kernel-tools.mjs')));
    const permission = [{ permission: '*', pattern: '*', action: 'allow' }];
    const client = { session: { get: async () => ({ data: { permission } }), update: async () => ({ data: {} }) }, mcp: { add: () => { throw new Error('No external service may start in this test'); } } };
    const runtime = createPluginTools({ client, directory: root, dataDir: root });
    const counts = { 'game-studio': 9, circleci: 4, 'build-ios-apps': 9, 'build-macos-apps': 11 };
    // Playwright also ships in this group but downloads its browser, so it is
    // covered by test/playwright-runtime.test.cjs instead.
    assert.deepEqual(createPluginCatalog(store).list().filter(entry => entry.category === 'developer-tools' && !entry.runtime).map(entry => entry.id), Object.keys(counts));
    for (const entry of entries) {
      const record = store.get(entry.id); const manifest = store.manifest(record);
      assert.equal(manifest.skills.length, counts[entry.id]);
      for (const file of entry.files) assert.equal(fs.statSync(path.join(store.packageRoot(record), file.path)).size, file.size);
      const instructions = fs.readFileSync(path.join(store.packageRoot(record), manifest.instructions), 'utf8');
      assert.ok(instructions.includes(entry.runtimeInstructions));
      store.update(entry.id, { enabled: true });
      const context = { sessionID: 'developer-catalog', ask: () => { throw new Error('No process launch'); } };
      if (entry.platforms?.includes('darwin') && process.platform !== 'darwin') {
        assert.equal(store.describe(record).ready, false);
        await assert.rejects(runtime.tools.plugins_activate.execute({ id: entry.id }, context), /macOS/);
      } else if (!manifest.mcpServers.length && store.prepare(record).ready) {
        const activation = JSON.parse(await runtime.tools.plugins_activate.execute({ id: entry.id }, context));
        assert.equal(activation.activated, true);
        for (const skill of activation.skills) {
          const resource = JSON.parse(await runtime.tools.plugins_read_resource.execute({ id: entry.id, resource: skill.id }, context));
          assert.ok(resource.text.length > 100);
        }
        const reference = manifest.resources.find(resource => resource.path.endsWith('.md'));
        const resource = JSON.parse(await runtime.tools.plugins_read_resource.execute({ id: entry.id, resource: `resource:${reference.id}` }, context));
        assert.ok(resource.text.length > 50);
        store.update(entry.id, { enabled: false });
        await assert.rejects(runtime.tools.plugins_read_resource.execute({ id: entry.id, resource: `skill:${entry.entry}` }, context));
      }
    }
    console.log('PASS: four real developer packages, all pinned source files, model skill/reference reads, revocation and Apple platform gates. Native Xcode execution is outside this test.');
  } finally {
    assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

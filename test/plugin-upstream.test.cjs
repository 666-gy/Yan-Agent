'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { createPluginStore } = require('../lib/plugins/store');
const { installUpstream } = require('../lib/plugins/upstream');
const entries = require('../lib/plugins/remote-catalog.json');

function setup(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-upstream-test-'));
  t.after(() => { assert.equal(path.dirname(root), path.resolve(os.tmpdir())); fs.rmSync(root, { recursive: true, force: true }); });
  const files = { 'skills/design/SKILL.md': '---\nname: design\ndescription: Create a design.\n---\nRead reference.md first.', 'skills/design/reference.md': '# Reference\nPreserve original content.', 'LICENSE.txt': 'Original upstream terms.' };
  const entry = { id: 'design-kit', entry: 'design', name: 'Design Kit', revision: 'a'.repeat(40), source: 'https://github.com/openai/plugins',
    manifest: { schemaVersion: 1, id: 'design-kit', version: '1.0.0', name: 'Design Kit', description: 'Design workflow', instructions: 'yan-instructions.md', skills: [{ id: 'design', name: 'design', description: 'design', path: 'skills/design/SKILL.md' }] },
    files: Object.entries(files).map(([file, text]) => ({ path: file, size: Buffer.byteLength(text), sha: crypto.createHash('sha1').update(`blob ${Buffer.byteLength(text)}\0`).update(text).digest('hex') })) };
  return { root, store: createPluginStore(path.join(root, 'data')), entry, files };
}
test('remote catalog has six pinned upstream packages and only real remote services require OAuth', () => {
  assert.deepEqual(entries.map(entry => entry.id), ['figma', 'canva', 'game-studio', 'circleci', 'build-ios-apps', 'build-macos-apps']);
  for (const entry of entries) {
    assert.match(entry.revision, /^[a-f0-9]{40}$/); assert.ok(entry.files.length > 10);
    assert.ok(entry.manifest.skills.length >= 3);
    assert.ok(entry.files.some(file => file.path === '.codex-plugin/plugin.json'));
    assert.equal(entry.manifest.mcpServers.length, ['figma', 'canva', 'build-ios-apps'].includes(entry.id) ? 1 : 0);
    for (const server of entry.manifest.mcpServers) {
      if (server.type === 'remote') { assert.equal(server.auth, 'oauth'); assert.match(server.url, /^https:\/\//); }
      else { assert.equal(entry.id, 'build-ios-apps'); assert.equal(server.auth, undefined); assert.deepEqual(server.args, ['-y', 'xcodebuildmcp@2.7.0', 'mcp']); }
    }
  }
});
test('download verifies every byte, adapts skills and reuses verified cache without executing files', async t => {
  const { store, entry, files } = setup(t); const urls = [];
  entry.runtimeInstructions = 'Route design tasks to skill:design; verify the available host tools.';
  entry.requirements = 'Use the existing host tools.';
  const fetcher = async url => { urls.push(url); const file = decodeURIComponent(url.split('/design-kit/')[1]); return new Response(files[file]); };
  const result = await installUpstream(store, entry, { fetcher });
  assert.equal(result.skills[0].description, 'Create a design.'); assert.equal(result.enabled, false);
  const instructions = fs.readFileSync(path.join(store.packageRoot(result), 'yan-instructions.md'), 'utf8');
  assert.ok(instructions.includes(entry.runtimeInstructions)); assert.ok(instructions.includes(entry.requirements));
  assert.doesNotMatch(instructions, /Figma|Canva/);
  assert.equal(fs.readFileSync(path.join(store.packageRoot(result), 'LICENSE.txt'), 'utf8'), files['LICENSE.txt']);
  const again = await installUpstream(store, entry, { fetcher: () => { throw new Error('Should use verified cache'); } });
  assert.equal(again.digest, result.digest); assert.equal(urls.length, 3);
  assert.ok(urls.every(url => url.includes(entry.revision)));
});
test('corrupt upstream or cached data cannot be installed; traversal fails closed', async t => {
  const { store, entry } = setup(t);
  await assert.rejects(installUpstream(store, entry, { fetcher: async () => new Response('wrong') }), /校验/);
  assert.equal(store.list().length, 0);
  const unsafe = structuredClone(entry); unsafe.files[0].path = '../outside';
  await assert.rejects(installUpstream(store, unsafe, { fetcher: async () => new Response('wrong') }), /路径/);
  assert.equal(store.list().length, 0);
});

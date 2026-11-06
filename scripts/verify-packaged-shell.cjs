'use strict';
const fs = require('node:fs'), path = require('node:path'), crypto = require('node:crypto');
const assert = require('node:assert/strict');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const resources = path.resolve(process.argv[2] || path.join(root, 'dist/shell-fix-20261019/win-unpacked/resources'));
const archive = path.join(resources, 'app.asar');
const read = file => asar.extractFile(archive, file.split('/').join(path.sep));
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
const files = ['lib/background-bash.js', 'lib/background-bash-store.js', 'lib/main/background-bash.js',
  'lib/workspace/file-locks.js', 'lib/kernel-bash-tool.mjs', 'lib/shell-network.js', 'lib/native/yan-shell-job.exe',
  'lib/coding-environment-plugin.mjs', 'lib/coding-environment-plugin.bundle.mjs', 'lib/kernel-v2/plugin/coding.js',
  'lib/kernel-v2/adapter.js', 'lib/kernel-v2/pool.js', 'lib/kernel-v2/sidecar.js', 'lib/kernel-v2/diagnostics.js',
  'lib/yan-core/protocol.js', 'renderer/run-outcome.js', 'renderer/renderer.js', 'renderer/background-bash.js',
  'renderer/index.html', 'lib/build-manifest.json', 'vendor/opencode-v2/runtime.json', 'vendor/opencode-v2/patches/shell-settlement.patch'];
for (const file of files) assert.equal(digest(read(file)), digest(fs.readFileSync(path.join(root, file))), file);
const manifest = JSON.parse(read('vendor/opencode-v2/runtime.json'));
for (const [file, hash] of Object.entries(manifest.files)) {
  const binary = path.join(resources, 'app.asar.unpacked/vendor/opencode-v2/node-runtime', file);
  assert.equal(digest(fs.readFileSync(binary)), hash, file);
}
for (const patch of manifest.patches) assert.equal(digest(read('vendor/opencode-v2/' + patch.file)), patch.sha256, patch.file);
console.log(JSON.stringify({ ok: true, checkedApplicationFiles: files.length, checkedRuntimeFiles: Object.keys(manifest.files).length,
  build: JSON.parse(read('lib/build-manifest.json')), kernelSha256: manifest.files['opencode.mjs'], resources }, null, 2));

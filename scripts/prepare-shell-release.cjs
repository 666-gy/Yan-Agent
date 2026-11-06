'use strict';
// Build from a fresh release-only copy. Never strip in-development source in place.
const fs = require('node:fs'), path = require('node:path');
const root = path.resolve(__dirname, '..');
function prepare(destination) {
  destination = path.resolve(destination);
  if (!destination.startsWith(path.join(root, 'output') + path.sep) || fs.existsSync(destination)) throw new Error('Choose a new staging directory inside output');
  fs.mkdirSync(destination, { recursive: true });
  const items = ['main.js', 'preload.js', 'quick-input-preload.js', 'voice-call-preload.js', 'tokens.css', 'package.json', 'package-lock.json', 'lib', 'renderer', 'vendor', 'scripts', 'build', '.pets'];
  for (const item of items) if (fs.existsSync(path.join(root, item))) fs.cpSync(path.join(root, item), path.join(destination, item), {
    recursive: true
  });
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(destination, 'node_modules'), 'junction');
  fs.mkdirSync(path.join(destination, 'output'));
  fs.symlinkSync(path.join(root, 'output/playwright-runtime'), path.join(destination, 'output/playwright-runtime'), 'junction');
  const pkg = JSON.parse(fs.readFileSync(path.join(destination, 'package.json')));
  pkg.build.directories.output = path.join(root, 'dist');
  fs.writeFileSync(path.join(destination, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
  const manifest = { name: pkg.name, version: pkg.version, buildId: new Date().toISOString() };
  fs.writeFileSync(path.join(destination, 'lib/build-manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
  console.log(JSON.stringify({ destination, output: pkg.build.directories.output, manifest }, null, 2));
}
if (require.main === module) prepare(process.argv[2] || path.join(root, 'output/shell-release-stage-' + Date.now()));
module.exports = { prepare };

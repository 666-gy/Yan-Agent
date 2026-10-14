'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const asar = require('@electron/asar');
const root = path.resolve(__dirname, '..');
const platform = process.platform;
const output = path.join(root, 'dist', `${platform}-${process.arch}`);
const resources = process.argv[2] || (platform === 'darwin'
  ? path.join(output, process.arch === 'arm64' ? 'mac-arm64' : 'mac', 'Yan Agent.app/Contents/Resources')
  : path.join(output, 'linux-unpacked/resources'));
const archive = path.join(resources, 'app.asar');
const files = new Set(asar.listPackage(archive).map(file => file.replace(/\\/g, '/').replace(/^\//, '')));
const read = file => asar.extractFile(archive, file).toString('utf8');
function assert(condition, message) { if (!condition) throw Error(message); }
assert(JSON.parse(read('package.json')).version === require('../package.json').version, 'Packaged version mismatch');
const html = read('renderer/index.html');
for (const match of html.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)) {
  if (/^(?:[a-z]+:|\/\/|#)/i.test(match[1])) continue;
  const file = path.posix.normalize(path.posix.join('renderer', match[1].split('?')[0]));
  assert(files.has(file), `Missing renderer asset: ${file}`);
}
for (const file of ['main.js', 'preload.js', 'lib/opencode-sidecar.js', 'lib/opencode-runtime.js', 'lib/voice-input.js']) {
  assert(read(file) === fs.readFileSync(path.join(root, file), 'utf8'), `Packaged source differs: ${file}`);
}
assert(![...files].some(file => /^lib\/native\/.*\.exe$/.test(file)), 'Windows native executables in Unix package');
const runtime = path.join(resources, 'opencode-runtime');
const manifest = JSON.parse(fs.readFileSync(path.join(runtime, 'runtime.json')));
const pin = require('../vendor/opencode/runtime-patch.json').binaries.find(item => item.package === manifest.package);
assert(pin && manifest.sourceSha256 === pin.sourceSha256, 'Unpinned OpenCode source');
assert(manifest.platform === platform && manifest.arch === process.arch, 'OpenCode platform mismatch');
const binary = path.join(runtime, manifest.executable);
assert(crypto.createHash('sha256').update(fs.readFileSync(binary)).digest('hex') === manifest.sha256, 'OpenCode binary integrity mismatch');
fs.accessSync(binary, fs.constants.X_OK);
fs.accessSync(path.join(resources, 'codegraph-runtime', platform === 'win32' ? 'node.exe' : 'node'), fs.constants.X_OK);
const playwright = JSON.parse(fs.readFileSync(path.join(resources, 'playwright-runtime/runtime.json')));
assert(playwright.platform === platform && playwright.arch === process.arch, 'Playwright platform mismatch');
for (const item of playwright.files) {
  const file = path.resolve(resources, 'playwright-runtime', item.path);
  assert(file.startsWith(path.resolve(resources, 'playwright-runtime') + path.sep), 'Invalid Playwright path');
  assert(crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex') === item.sha256, `Playwright integrity mismatch: ${item.path}`);
}
assert(playwright.browserFiles.some(file => file.path === playwright.browserExecutable), 'Missing browser executable pin');
console.log(`Verified ${platform}/${process.arch} package: renderer references, current source, native runtime integrity and executable permissions`);

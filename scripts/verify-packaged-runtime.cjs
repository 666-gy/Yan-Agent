'use strict';

// Packaging guard: every local asset referenced by renderer/index.html (plus a
// small required-runtime manifest) must resolve inside app.asar or its
// app.asar.unpacked companion. Run after electron-builder so a partial package
// fails the build instead of shipping a renderer that dies on a missing script.

const fs = require('node:fs');
const path = require('node:path');
const asar = require('@electron/asar');

const appRoot = path.resolve(__dirname, '..');
const resourcesRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(appRoot, 'dist', 'win-unpacked', 'resources');
const archive = path.join(resourcesRoot, 'app.asar');
const unpackedRoot = path.join(resourcesRoot, 'app.asar.unpacked');

if (!fs.existsSync(archive)) {
  console.error(`[verify-packaged-runtime] app.asar not found: ${archive}`);
  process.exit(1);
}

const header = asar.getRawHeader(archive).header;

function headerNode(rel) {
  let node = header;
  for (const part of String(rel).split('/')) {
    node = node && node.files ? node.files[part] : null;
    if (!node) return null;
  }
  return node;
}

function unpackedPath(rel) {
  return path.join(unpackedRoot, ...String(rel).split('/'));
}

function exists(rel) {
  const node = headerNode(rel);
  if (!node) return false;
  return node.unpacked ? fs.existsSync(unpackedPath(rel)) : true;
}

function readAsarText(rel) {
  const node = headerNode(rel);
  if (!node) return '';
  if (node.unpacked) return fs.readFileSync(unpackedPath(rel), 'utf8');
  return asar.extractFile(archive, String(rel).split('/').join(path.sep)).toString('utf8');
}

const html = readAsarText('renderer/index.html');
if (!html) {
  console.error('[verify-packaged-runtime] renderer/index.html is missing from the package');
  process.exit(1);
}

const refs = new Set();
for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(match[1]);
for (const match of html.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.add(match[1]);

function resolveRef(ref) {
  const value = String(ref || '').trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return '';
  const resolved = path.posix.normalize(path.posix.join('renderer', value));
  return resolved.startsWith('..') ? '' : resolved;
}

const required = [
  'main.js',
  'preload.js',
  'renderer/renderer.js',
  'renderer/i18n.js',
  'renderer/subagent-panel.js',
  'lib/subagent/workflow-state.js',
  'lib/subagent/event-bridge.js'
];

const missing = [];
for (const ref of refs) {
  const resolved = resolveRef(ref);
  if (resolved && !exists(resolved)) missing.push(`${resolved} (referenced by renderer/index.html as ${ref})`);
}
for (const rel of required) {
  if (!exists(rel)) missing.push(`${rel} (required runtime file)`);
}

if (missing.length) {
  console.error('[verify-packaged-runtime] missing packaged files:');
  for (const item of missing) console.error(`  - ${item}`);
  process.exit(1);
}
console.log(`[verify-packaged-runtime] ok: ${refs.size} renderer references and ${required.length} runtime files present in ${archive}`);

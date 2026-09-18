'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const appRoot = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const patterns = Array.isArray(pkg.build?.asarUnpack) ? pkg.build.asarUnpack : [];

// Native MCP children run as `ELECTRON_RUN_AS_NODE`, where the app.asar
// archive is not readable. Anything reachable from a yan-*-mcp.js entry must
// therefore be unpacked next to the archive, or the child exits with code 1
// and the MCP manager reports a crash.
function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  const body = escaped.replace(/\*\*\/|\*\*|\*/g, (token) => {
    if (token === '**/') return '(?:.*/)?';
    if (token === '**') return '.*';
    return '[^/]*';
  });
  return new RegExp(`^${body}$`);
}

const matchers = patterns.map(globToRegExp);

function isUnpacked(relativePath) {
  const normalized = relativePath.split(path.sep).join('/');
  return matchers.some(matcher => matcher.test(normalized));
}

function localRequires(file) {
  const source = fs.readFileSync(file, 'utf8');
  const requests = new Set();
  for (const match of source.matchAll(/require\(\s*['"](\.[^'"]+)['"]\s*\)/g)) {
    requests.add(match[1]);
  }
  return [...requests];
}

function resolveLocal(fromFile, request) {
  const base = path.resolve(path.dirname(fromFile), request);
  const candidates = [base, `${base}.js`, `${base}.mjs`, `${base}.cjs`, `${base}.json`, path.join(base, 'index.js')];
  return candidates.find(candidate => fs.existsSync(candidate) && fs.statSync(candidate).isFile()) || null;
}

function collectDependencyTree(entry) {
  const seen = new Set();
  const unresolved = [];
  const stack = [entry];
  while (stack.length) {
    const file = stack.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    for (const request of localRequires(file)) {
      const resolved = resolveLocal(file, request);
      if (!resolved) {
        unresolved.push(`${path.relative(appRoot, file)} -> ${request}`);
        continue;
      }
      stack.push(resolved);
    }
  }
  return { files: [...seen], unresolved };
}

test('native MCP entries and their local dependency trees are unpacked', () => {
  const entries = fs.readdirSync(path.join(appRoot, 'lib'))
    .filter(name => /^yan-.+-mcp\.js$/.test(name))
    .map(name => path.join(appRoot, 'lib', name));
  assert.ok(entries.length >= 8, `expected the native MCP entries, found ${entries.length}`);
  assert.ok(matchers.length > 0, 'build.asarUnpack must not be empty');
  for (const entry of entries) {
    const { files, unresolved } = collectDependencyTree(entry);
    assert.deepEqual(unresolved, [], `${path.basename(entry)} has unresolved local requires`);
    for (const file of files) {
      const relative = path.relative(appRoot, file);
      assert.ok(isUnpacked(relative), `${relative} must match build.asarUnpack`);
    }
  }
});

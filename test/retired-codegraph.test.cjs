'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntimeDefaults } = require('../lib/main/runtime-defaults');

test('upgrading retires bundled CodeGraph while preserving user MCPs', t => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-retired-codegraph-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const { ensureDefaultMcp } = createRuntimeDefaults({ dataDir });
  const custom = { id: 'user-codegraph', name: 'My CodeGraph', command: 'custom-codegraph', enabled: false };
  const old = { id: 'mcp_default_codegraph', name: 'CodeGraph', command: 'codegraph', runtime: 'codegraph', builtin: true, enabled: true };
  const result = ensureDefaultMcp([old, custom]);
  assert.equal(result.some(server => server.id === old.id), false);
  assert.deepEqual(result.find(server => server.id === custom.id), custom);
  assert.deepEqual(ensureDefaultMcp(result), result);
});

test('release inputs contain no bundled CodeGraph runtime', () => {
  const pkg = require('../package.json');
  const lock = require('../package-lock.json');
  assert.equal(Object.keys(pkg.dependencies).some(name => name.includes('codegraph')), false);
  assert.equal(Object.keys(lock.packages).some(name => name.includes('codegraph')), false);
  assert.equal(JSON.stringify(pkg.build).includes('codegraph'), false);
  assert.equal(JSON.stringify(pkg.scripts).includes('codegraph'), false);
});

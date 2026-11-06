'use strict';

const test = require('node:test');

const assert = require('node:assert/strict');

const fs = require('node:fs');

const os = require('node:os');

const path = require('node:path');

const { getCachedIndex, queryCallTree } = require('../lib/analysis/calltree');

const { buildRepoMap } = require('../lib/analysis/repo-map');





test('call index refreshes immediately after edit, add and delete; file budgets stay independent', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-index-refresh-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const write = (name, text) => fs.writeFileSync(path.join(root, name), text);
  write('a.js', 'export function alpha() { return 1; }');
  const initial = getCachedIndex(root);
  assert.equal(getCachedIndex(root), initial);
  write('a.js', 'export function beta() { return 22; }');
  assert.equal(queryCallTree(getCachedIndex(root), 'alpha').nodes, 0);
  assert.equal(queryCallTree(getCachedIndex(root), 'beta').nodes, 1);
  write('b.js', 'export function gamma() { return 3; }');
  assert.equal(getCachedIndex(root, { maxFiles: 1 }).files, 1);
  assert.equal(getCachedIndex(root, { maxFiles: 1 }).coverage.truncated, true);
  assert.equal(getCachedIndex(root).files, 2);
  fs.unlinkSync(path.join(root, 'b.js'));
  assert.equal(queryCallTree(getCachedIndex(root), 'gamma').nodes, 0);
});


test('ES and CommonJS aliases resolve original symbols; non-JS files do not consume calltree cap', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-alias-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  fs.writeFileSync(path.join(root, 'a.py'), 'def unrelated():\n  pass\n');
  fs.writeFileSync(path.join(root, 'b.js'), 'export function original() { return 1; }');
  fs.writeFileSync(path.join(root, 'c.js'), "import { original as alias } from './b';\nfunction entry() { return alias(); }\n");
  fs.writeFileSync(path.join(root, 'd.js'), "const { original: renamed } = require('./b');\nfunction cjsEntry() { return renamed(); }\n");
  const index = getCachedIndex(root, { maxFiles: 3 });
  assert.equal(index.files, 3);
  assert.equal(index.coverage.truncated, false);
  assert.match(queryCallTree(index, 'entry').text, /original.*b\.js/);
  assert.match(queryCallTree(index, 'cjsEntry').text, /original.*b\.js/);
  const map = buildRepoMap(root, { maxFiles: 2 });
  assert.equal(map.coverage.truncated, true);
  assert.match(map.text, /scan limit reached/);
});




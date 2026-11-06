'use strict';

const assert = require('node:assert/strict');

const test = require('node:test');
const { combineSystem, combineTurnPrompt, repoMapSystem } = require('../lib/kernel-policy');

test('repo map snapshot is injected into the current turn only when a map is present', () => {
  const request = { repoMap: 'repo map: 2 code files\n  src/index.js  [0.5]  main' };
  const withMap = combineTurnPrompt(request, 'Inspect the project.');
  assert.ok(withMap.includes('<yan-repo-map>'));
  assert.ok(withMap.includes('src/index.js  [0.5]'));
  assert.ok(withMap.includes('code_impact'));
  assert.ok(!combineTurnPrompt({}, 'Inspect the project.').includes('<yan-repo-map>'));
  assert.ok(!combineSystem(request).includes('<yan-repo-map>'));
  assert.equal(repoMapSystem({ repoMap: '' }), '');
});


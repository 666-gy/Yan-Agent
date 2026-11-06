'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createPluginStore } = require('../lib/plugins/store');
const { createPluginCatalog } = require('../lib/plugins/catalog');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-developer-plugins-'));
try {
  const catalog = createPluginCatalog(createPluginStore(root));
  assert.deepEqual(catalog.list().filter(entry => entry.category === 'developer-tools').map(entry => entry.id), ['playwright']);
  for (const id of ['game-studio', 'circleci', 'build-ios-apps', 'build-macos-apps']) {
    assert.throws(() => catalog.install(id), /目录/);
  }
  // Browser downloads and activation remain covered by playwright-runtime.test.cjs.
  console.log('PASS: developer tools contain only Playwright; removed entries cannot be installed.');
} finally {
  assert.equal(path.dirname(root), path.resolve(os.tmpdir()));
  fs.rmSync(root, { recursive: true, force: true });
}

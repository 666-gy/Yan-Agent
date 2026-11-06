'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createPluginCatalog } = require('../lib/plugins/catalog');
test('catalog membership comes from Yan catalogs, not installation or plugin naming', () => {
  const catalog = createPluginCatalog({ list: () => [
    { id: 'ego-lite', name: 'Ego Lite', enabled: true },
    { id: 'YanPlugin-unlisted', name: 'Unlisted', officialMarket: true, catalogSource: 'official-market' },
    { id: 'yan-computer-use', name: 'Installed computer use' }
  ] });
  catalog.setOfficialEntries([{ id: 'YanPlugin-listed', download: true, manifest: { name: 'Listed' } }]);
  const items = catalog.list();
  for (const id of ['ego-lite', 'YanPlugin-unlisted']) {
    const item = items.find(item => item.id === id);
    assert.equal(item.catalogSource, 'local');
    assert.equal(item.officialMarket, false);
    assert.equal(item.installed, true);
  }
  assert.equal(items.find(item => item.id === 'yan-computer-use').catalogSource, 'bundled');
  assert.equal(items.find(item => item.id === 'yan-computer-use').installed, true);
  assert.equal(items.find(item => item.id === 'YanPlugin-listed').catalogSource, 'official-market');
  catalog.setOfficialEntries([]);
  assert.equal(catalog.list().some(item => item.id === 'YanPlugin-listed'), false);
});

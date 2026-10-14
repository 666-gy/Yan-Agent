'use strict';
const fs = require('node:fs');
const path = require('node:path');
const entries = require('../../lib/plugins/remote-catalog.json').filter(entry => entry.category === 'developer-tools');
const { installUpstream } = require('../../lib/plugins/upstream');

// A caller may provide previously downloaded public source bytes. The production
// installer still validates their size and pinned Git hash before using them.
function seedDeveloperCache(store, ids = entries.map(entry => entry.id)) {
  if (process.env.YAN_PLUGIN_TEST_CACHE) {
    const target = path.join(store.root, 'download-cache'); fs.mkdirSync(target, { recursive: true });
    for (const entry of entries.filter(entry => ids.includes(entry.id))) for (const file of entry.files) {
      const source = path.join(process.env.YAN_PLUGIN_TEST_CACHE, file.sha);
      if (fs.existsSync(source)) fs.copyFileSync(source, path.join(target, file.sha));
    }
  }
}
async function installDeveloperPlugins(store, ids = entries.map(entry => entry.id)) {
  seedDeveloperCache(store, ids);
  for (const entry of entries.filter(entry => ids.includes(entry.id))) await installUpstream(store, entry);
}
module.exports = { installDeveloperPlugins, seedDeveloperCache, entries };

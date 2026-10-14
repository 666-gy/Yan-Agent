'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { presentation } = require('./presentation');
const { readManifest, inventory } = require('./manifest');
const entries = [...require('./catalog/index.json'), ...require('./remote-catalog.json')];
const { installUpstream } = require('./upstream');
const { createPluginMarketplaces } = require('./marketplaces');

function createPluginCatalog(store, { fetcher, runtimes, onProgress } = {}) {
  const marketplaces = createPluginMarketplaces(store, { reservedIds: entries.map(item => item.id) });
  function entry(id) {
    const item = [...entries, ...marketplaces.list()].find(item => item.id === id);
    if (!item) throw new Error('插件不在内置目录中');
    return item;
  }
  function packageRoot(item) { return path.join(__dirname, 'catalog', item.id); }
  function details(item) { return item.presentation || (!item.download ? presentation(JSON.parse(fs.readFileSync(path.join(packageRoot(item), '.codex-plugin/plugin.json'), 'utf8'))) : {}); }
  function list() {
    const installed = new Map(store.list().map(item => [item.id, item]));
    const catalog = [...entries, ...marketplaces.list()].map(item => {
      const manifest = item.marketId ? item : item.download ? item.manifest : readManifest(packageRoot(item));
      const current = installed.get(item.id);
      installed.delete(item.id);
      const { files, manifest: template, ...metadata } = item;
      return { ...manifest, ...metadata, presentation: details(item), installed: !!current, installation: current || null };
    });
    // Existing installations remain manageable even after a catalog entry retires.
    for (const current of installed.values()) catalog.push({ ...current, category: 'installed', installed: true, installation: current, retired: true });
    return catalog;
  }
  // A catalog entry may name a downloadable runtime (currently Playwright's
  // Chromium). The package digest covers only the built-in source tree, so the
  // runtime is fetched *before* the plugin is recorded: a failed download or
  // hash mismatch leaves nothing installed, and the action is retryable.
  // Plain packages stay synchronous; only a runtime download returns a promise.
  function install(id) {
    const item = entry(id);
    if (item.marketId) return marketplaces.install(id);
    if (item.download) return installUpstream(store, item, { fetcher });
    const source = packageRoot(item);
    if (inventory(source).digest !== item.digest) throw new Error('内置插件完整性检查失败');
    if (!item.runtime || !runtimes?.[item.runtime]) return store.install(source, item.digest);
    return (async () => {
      await runtimes[item.runtime].install({ progress: progressFor(id) });
      store.install(source, item.digest);
      // The runtime's MCP server registers as enabled, so the record follows it:
      // the user downloaded the runtime precisely to use it.
      return store.update(id, { enabled: true });
    })();
  }
  function progressFor(id) { return event => { try { onProgress?.({ id, ...event }); } catch { /* reporting must not fail an install */ } }; }
  async function remove(id) {
    const item = entries.find(entry => entry.id === id);
    const result = store.remove(id);
    if (item?.runtime && runtimes?.[item.runtime]) {
      // Deliberately after the record is gone: the plugin must never stay
      // installed because a browser could not be deleted (a running Chromium
      // holds its files on Windows; the leftovers are swept on next launch).
      try { await runtimes[item.runtime].remove(); }
      catch (error) { console.warn(`[plugins] Could not remove the ${item.runtime} runtime:`, error.message); }
    }
    return result;
  }
  function link(id, kind) { if (!['website', 'privacy', 'terms'].includes(kind)) throw new Error('无效插件链接'); const url = details(entry(id))[kind]; if (!url) throw new Error('上游未提供此链接'); return url; }
  return { list, install, remove, entry, link, addMarketplace: marketplaces.add, markets: marketplaces.markets, removeMarketplace: marketplaces.remove };
}
module.exports = { createPluginCatalog };

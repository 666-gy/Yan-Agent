'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { presentation } = require('./presentation');
const { readManifest, inventory } = require('./manifest');
const { installUpstream } = require('./upstream');
const entries = [...require('./catalog/index.json'), ...require('./remote-catalog.json')];
// Locally installed plugins have no catalog metadata, so they cannot declare a
// logo through the strict manifest schema. Map the ones we ship assets for here.
const LOCAL_PLUGIN_LOGOS = Object.freeze({ 'YanPlugin-ego-lite-for-yan': 'assets/skill-logos/ego-lite.png' });

function createPluginCatalog(store, { fetcher, runtimes, onProgress, officialUpdater } = {}) {
  let officialEntries = [];
  const allEntries = () => [...entries, ...officialEntries];
  function entry(id) {
    const item = allEntries().find(item => item.id === id);
    if (!item) throw new Error('插件不在内置目录中');
    return item;
  }
  function packageRoot(item) { return path.join(__dirname, 'catalog', item.id); }
  function details(item) { return item.presentation || (!item.download ? presentation(JSON.parse(fs.readFileSync(path.join(packageRoot(item), '.codex-plugin/plugin.json'), 'utf8'))) : {}); }
  function list() {
    const installed = new Map(store.list().map(item => [item.id, item]));
    const catalog = allEntries().map(item => {
      const manifest = item.download ? item.manifest : readManifest(packageRoot(item));
      const current = installed.get(item.id);
      installed.delete(item.id);
      const { files, manifest: template, ...metadata } = item;
      const logo = item.logo || LOCAL_PLUGIN_LOGOS[item.id];
      return { ...manifest, ...metadata, ...(logo ? { logo } : {}), catalogSource: item.officialMarket ? 'official-market' : 'bundled', presentation: details(item), installed: !!current, installation: current || null };
    });
    // Existing installations remain manageable even after a catalog entry retires.
    for (const current of installed.values()) {
      const logo = current.logo || LOCAL_PLUGIN_LOGOS[current.id];
      catalog.push({ ...current, ...(logo ? { logo } : {}), catalogSource: 'local', officialMarket: false, category: 'installed', installed: true, installation: current, retired: true });
    }
    return catalog;
  }
  function install(id) {
    const item = entry(id);
    if (item.officialMarket) { const { officialMarket, ...native } = item; return require('./native-download').installNative(store, native, { fetcher }); }
    if (item.download) return installUpstream(store, item, { fetcher });
    const source = packageRoot(item);
    if (inventory(source).digest !== item.digest) throw new Error('内置插件完整性检查失败');
    if (!item.runtime || !runtimes?.[item.runtime]) return store.install(source, item.digest);
    return (async () => {
      await runtimes[item.runtime].install({ progress: progressFor(id) });
      store.install(source, item.digest);
      return store.update(id, { enabled: true });
    })();
  }
  async function updateInstalled(id) {
    const previous = store.get(id);
    if (!previous) throw new Error('插件未安装');
    let item;
    try { item = entry(id); } catch { throw new Error('此插件没有可用的官方更新来源。'); }
    if (item.officialMarket) {
      if (previous.digest === item.digest) return { updated: false, plugin: store.describe(previous) };
      const plugin = await install(id);
      return { updated: true, plugin };
    }
    const updater = officialUpdater || require('./official-updates').makeUpdater({ store, fetcher, onProgress });
    let candidate;
    let committed = false;
    try {
      const release = await updater.check(item, previous);
      if (!release.updated) return { updated:false, plugin:store.describe(previous) };
      candidate = await updater.prepare(item, previous, release);
      if (inventory(candidate.source).digest !== candidate.digest) throw new Error('插件完整性检查失败');
      const current = store.get(id);
      if (!current || current.epoch !== previous.epoch || current.digest !== previous.digest) throw new Error('插件状态在检查期间发生变化，请重试');
      progressFor(id)({phase:'update',percent:90});
      const plugin = store.install(candidate.source, candidate.digest, { officialUpdate:candidate.metadata });
      committed = true;
      progressFor(id)({phase:'update',percent:100});
      return {updated:true,plugin};
    } finally {
      if (committed) candidate?.cleanup?.();
      else candidate?.discard?.();
    }
  }
  function progressFor(id) { return event => { try { onProgress?.({ id, ...event }); } catch { /* reporting must not fail an install */ } }; }
  async function remove(id) {
    const item = allEntries().find(entry => entry.id === id);
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
  function setOfficialEntries(next = []) {
    officialEntries = Array.isArray(next) ? next.map(item => ({ ...item, officialMarket: true })) : [];
    return officialEntries.length;
  }
  return { list, install, updateInstalled, remove, entry, link, setOfficialEntries };
}
module.exports = { createPluginCatalog };

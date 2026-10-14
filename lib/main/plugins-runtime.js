'use strict';
const { createPluginStore } = require('../plugins/store');
const { createPluginCatalog } = require('../plugins/catalog');
const { createPluginAccounts } = require('../plugins/accounts');
const playwrightRuntime = require('../playwright-runtime');
const computerUse = require('../plugins/computer-use');
function registerPluginsRuntime(ctx, { dataDir, appRoot, safeStorage, fetcher, config, invalidateSidecar }) {
  const { ipcMain, shell } = ctx;
  const store = createPluginStore(dataDir);
  try { computerUse.ensureInstalled(store, appRoot); }
  catch (error) { console.warn('[plugins] Could not prepare Yan Computer Use:', error.message); }
  // Playwright's Chromium is ~440 MB in user data, so an interrupted uninstall
  // (Chromium still holding its files) would otherwise leave it there forever.
  // Only runs when the marker says nothing is installed.
  playwrightRuntime.sweep(dataDir).catch(error => console.warn('[plugins] Playwright sweep failed:', error.message));
  // Retire only the exact former bundled demonstration. Removing its registry
  // entry also revokes active bindings; other user packages remain manageable.
  try {
    const legacy = store.get('yan-text-kit');
    if (legacy?.digest === '4fac63171e8ed621cb3de9e8f52248b110efb4defc87003b7c567d20df1b3632') store.remove(legacy.id);
  } catch (error) {
    // A damaged registry is reported by management IPC, not an app startup crash.
    console.warn('[plugins] Could not retire the former demonstration:', error.message);
  }
  // The runtime plugin adds and removes its own entry in cfg.mcpServers through
  // ensureDefaultMcp, so the config has to be re-read and re-saved for the
  // management view (and the kernel) to see the change. A running kernel keeps
  // its old tool set until invalidated, exactly as with a manual mcp:add.
  function syncMcpRegistration() {
    try {
      const cfg = config.load();
      cfg.mcpServers = config.ensureDefaultMcp(cfg.mcpServers || []);
      config.save(cfg);
      try { invalidateSidecar?.(); } catch (error) { console.warn(`[plugins] sidecar invalidation failed: ${error.message}`); }
      return cfg;
    } catch (error) {
      console.warn('[plugins] Could not refresh MCP registration:', error.message);
      return null;
    }
  }
  // Enabling or disabling the plugin is the switch for its MCP server, kept in
  // the config entry rather than in the registry so a user who turned the server
  // off in settings does not have it silently turned back on.
  function setServerEnabled(id, enabled) {
    if (id !== playwrightRuntime.PLUGIN_ID) return;
    const cfg = config.load();
    const index = (cfg.mcpServers || []).findIndex(server => server?.id === 'mcp_default_playwright');
    if (index < 0 || cfg.mcpServers[index].enabled === enabled) return;
    cfg.mcpServers[index] = { ...cfg.mcpServers[index], enabled };
    config.save(cfg);
    try { invalidateSidecar?.(); } catch (error) { console.warn(`[plugins] sidecar invalidation failed: ${error.message}`); }
  }
  // A record whose runtime is gone (the user cleared the data directory, or the
  // download was deleted by hand) must not claim to be installed. The reverse --
  // runtime present, record missing -- is left alone: the 440 MB download is the
  // user's to keep, and the plugin can be reinstalled over it.
  function reconcile() {
    try {
      if (!store.get(playwrightRuntime.PLUGIN_ID)) return;
      if (playwrightRuntime.isInstalled(dataDir)) return;
      store.update(playwrightRuntime.PLUGIN_ID, { enabled: false });
      console.warn('[plugins] Playwright browser files are missing; the plugin is disabled until it is reinstalled.');
    } catch (error) {
      console.warn('[plugins] Could not reconcile the Playwright plugin:', error.message);
    }
  }
  reconcile();
  const runtimes = {
    [playwrightRuntime.PLUGIN_ID]: {
      install: ({ progress } = {}) => playwrightRuntime.install({ appRoot, dataDir, onProgress: progress }),
      remove: () => playwrightRuntime.remove(dataDir)
    }
  };
  const catalog = createPluginCatalog(store, { fetcher, runtimes, onProgress: progress });
  const accounts = createPluginAccounts({ dataDir, store, safeStorage, fetcher, openExternal: url => shell.openExternal(url), changed });
  ctx.app?.whenReady().then(() => accounts.ensureServer()).catch(() => {});
  ctx.app?.once('before-quit', () => accounts.close());
  const installing = new Map();
  const wrap = handler => async (event, payload) => {
    try {
      const win = ctx.windows.getMainWindow();
      if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) throw new Error('仅主窗口可以管理插件');
      return { ok: true, ...await handler(payload) };
    }
    catch (error) { return { ok: false, error: error.message || String(error) }; }
  };
  function changed() {
    const win = ctx.windows.getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('plugins:changed');
      win.webContents.send('skills:changed', { reason: 'plugin' });
    }
  }
  // A 440 MB download reports nothing in the plugin list until it finishes, so
  // the page needs its own channel to show the phase and the percentage.
  function progress(event) {
    const win = ctx.windows.getMainWindow();
    if (win && !win.isDestroyed()) win.webContents.send('plugins:progress', event);
  }
  ipcMain.handle('plugins:list', wrap(() => ({ plugins: store.list() })));
  ipcMain.handle('plugins:catalog', wrap(() => ({ plugins: catalog.list() })));
  ipcMain.handle('plugins:add-marketplace', wrap(async payload => {
    const result = await catalog.addMarketplace(payload);
    changed();
    return result;
  }));
  ipcMain.handle('plugins:markets', wrap(() => ({ markets: catalog.markets() })));
  ipcMain.handle('plugins:remove-marketplace', wrap(({ id } = {}) => {
    const result = catalog.removeMarketplace(id);
    changed();
    return result;
  }));
  async function connect(id) {
    try { return await accounts.connect(id); }
    catch (error) {
      const entry = catalog.entry(id);
      // Official signup/login remains available if discovery or registration is
      // temporarily unavailable. Opening a page alone never marks a connection ready.
      if (entry.url && entry.website) {
        try { await shell.openExternal(entry.website); return { state: 'needs-auth', browserOpened: true, message: `${error.message} 已打开官方网站，可先登录或注册，再返回重试连接。` }; } catch {}
      }
      return { state: 'needs-auth', browserOpened: false, message: error.message };
    }
  }
  ipcMain.handle('plugins:install-catalog', wrap(async ({ id } = {}) => {
    if (installing.has(id)) return installing.get(id);
    const operation = (async () => {
      const plugin = await catalog.install(id);
      const account = plugin.accounts?.length ? await connect(id) : null;
      syncMcpRegistration(); changed(); return { plugin: store.describe(store.get(id)), account };
    })();
    installing.set(id, operation);
    try { return await operation; } finally { installing.delete(id); }
  }));
  ipcMain.handle('plugins:connect-account', wrap(async ({ id } = {}) => ({ account: await connect(id) })));
  ipcMain.handle('plugins:disconnect-account', wrap(({ id } = {}) => {
    accounts.disconnect(id); const plugin = store.update(id, { enabled: false }); setServerEnabled(id, false); changed(); return { plugin };
  }));
  ipcMain.handle('plugins:update', wrap(({ id, ...changes } = {}) => {
    const plugin = store.update(id, changes);
    if (changes.enabled !== undefined) setServerEnabled(id, changes.enabled);
    changed(); return { plugin };
  }));
  ipcMain.handle('plugins:prepare', wrap(({ id } = {}) => {
    const record = store.get(id); if (!record) throw new Error('插件未安装');
    return { plugin: store.describe(record) };
  }));
  ipcMain.handle('plugins:remove', wrap(async ({ id } = {}) => {
    accounts.disconnect(id);
    const result = await catalog.remove(id);
    // Saved after the runtime is gone so the eviction sees a runtime-less data
    // directory and retires mcp_default_playwright in the same step.
    syncMcpRegistration(); changed(); return result;
  }));
  ipcMain.handle('plugins:open-directory', wrap(async ({ id } = {}) => {
    const record = store.get(id); if (!record) throw new Error('插件未安装');
    const error = await shell.openPath(store.packageRoot(record)); if (error) throw new Error(error); return {};
  }));
  ipcMain.handle('plugins:open-link', wrap(async ({ id, kind } = {}) => { await shell.openExternal(catalog.link(id, kind)); return {}; }));
  return { store, accounts };
}
module.exports = { registerPluginsRuntime };

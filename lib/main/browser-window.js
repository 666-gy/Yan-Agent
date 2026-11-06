'use strict';

// Detached browser windows (one window can hold several browser tabs).
// The main window's browser tab turns into a placeholder while its page lives
// here. Tabs are re-created in this window, so page state is transferred by URL
// rather than by reparenting the guest webContents (Electron cannot move a
// <webview> between windows).

const path = require('node:path');

function registerBrowserWindows(ctx, deps = {}) {
  const { BrowserWindow, ipcMain, screen } = ctx;
  const {
    appRoot,
    configStore,
    getMainWindow,
    configureBrowserGuest,
    applyWindowIcon,
    windowIconPngPath,
    nativeTheme,
    hangGuard
  } = deps;

  const windows = new Map(); // tabId -> entry

  const mainSender = event => {
    const main = getMainWindow();
    return !!main && !main.isDestroyed() && event.sender === main.webContents
      && event.senderFrame === event.sender.mainFrame;
  };
  const entryForSender = event => {
    if (event.senderFrame !== event.sender.mainFrame) return null;
    for (const entry of windows.values()) {
      if (!entry.win.isDestroyed() && entry.win.webContents === event.sender) return entry;
    }
    return null;
  };
  const notifyMain = (channel, payload) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return;
    try { main.webContents.send(channel, payload); } catch { /* window is closing */ }
  };
  const effectiveTheme = () => {
    const theme = String(configStore?.loadConfig?.()?.theme || 'dark');
    if (theme === 'light') return 'light';
    if (theme === 'dark') return 'dark';
    return nativeTheme?.shouldUseDarkColors === false ? 'light' : 'dark';
  };
  const normalizeTabs = (tabs, fallback = {}) => {
    const source = Array.isArray(tabs) && tabs.length ? tabs : [fallback];
    const list = source.map((tab, index) => ({
      id: String(tab?.id || `tab-${index + 1}`),
      url: /^(?:https?|file):/i.test(String(tab?.url || '')) ? String(tab.url) : '',
      title: String(tab?.title || '').slice(0, 160),
      favicon: /^(?:https?|data:image\/)/i.test(String(tab?.favicon || '')) ? String(tab.favicon) : ''
    }));
    // Empty new-tab pages are dropped when the window also carries real pages.
    const withUrl = list.filter(tab => tab.url);
    return withUrl.length ? withUrl : list.slice(0, 1);
  };
  const windowBounds = (anchor) => {
    const parent = getMainWindow();
    const area = screen.getDisplayMatching(parent && !parent.isDestroyed() ? parent.getBounds() : screen.getPrimaryDisplay().workArea).workArea;
    const width = Math.min(1180, Math.max(720, area.width - 96));
    const height = Math.min(820, Math.max(520, area.height - 96));
    let x = Math.round(area.x + (area.width - width) / 2);
    let y = Math.round(area.y + (area.height - height) / 2);
    if (anchor && Number.isFinite(Number(anchor.x)) && Number.isFinite(Number(anchor.y))) {
      x = Math.round(Number(anchor.x) - 72);
      y = Math.round(Number(anchor.y) - 26);
    }
    x = Math.min(Math.max(x, area.x + 8), area.x + area.width - width - 8);
    y = Math.min(Math.max(y, area.y + 8), area.y + area.height - height - 8);
    return { x, y, width, height };
  };

  ipcMain.handle('browser-window:open', async (event, payload = {}) => {
    if (!mainSender(event)) return { ok: false, error: '只允许主窗口创建独立浏览器窗口' };
    const tabId = String(payload.tabId || '');
    if (!tabId) return { ok: false, error: '缺少标签页标识' };
    const existing = windows.get(tabId);
    if (existing && !existing.win.isDestroyed()) {
      if (existing.win.isMinimized()) existing.win.restore();
      existing.win.show();
      existing.win.focus();
      return { ok: true, reused: true };
    }
    const bounds = windowBounds(payload.anchor);
    const tabs = normalizeTabs(payload.tabs, { id: 'tab-1', url: payload.url, title: payload.title });
    if (!tabs.length) tabs.push({ id: 'tab-1', url: '', title: '新标签页', favicon: '' });
    const win = new BrowserWindow({
      ...bounds,
      minWidth: 520,
      minHeight: 380,
      backgroundColor: '#1a1a1a',
      show: false,
      frame: false,
      titleBarStyle: 'hidden',
      autoHideMenuBar: true,
      icon: windowIconPngPath?.(),
      webPreferences: {
        preload: path.join(appRoot, 'renderer', 'browser-window', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: true,
        backgroundThrottling: false
      }
    });
    const entry = {
      tabId,
      win,
      tabs,
      theme: effectiveTheme(),
      pinned: payload.pinned === true,
      restoring: false,
      closingSilently: false,
      title: String(payload.title || ''),
      url: String(payload.url || '')
    };
    windows.set(tabId, entry);
    if (entry.pinned) win.setAlwaysOnTop(true, 'floating');
    win.webContents.on('did-attach-webview', (_event, guest) => {
      configureBrowserGuest?.(guest, win);
      // A popup must open inside this detached window, not in the main window.
      guest.setWindowOpenHandler(({ url }) => {
        if (/^(?:https?|file):/i.test(String(url || ''))) {
          try { win.webContents.send('browser-window:new-tab', { url }); } catch {}
        }
        return { action: 'deny' };
      });
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.on('maximize', () => { try { win.webContents.send('browser-window:maximize-changed', true); } catch {} });
    win.on('unmaximize', () => { try { win.webContents.send('browser-window:maximize-changed', false); } catch {} });
    win.on('closed', () => {
      if (windows.get(tabId) === win) windows.delete(tabId);
      if (!entry.restoring && !entry.closingSilently) notifyMain('browser-window:closed', { event: 'closed', tabId });
    });
    win.once('ready-to-show', () => {
      if (win.isDestroyed()) return;
      applyWindowIcon?.(win);
      win.show();
      win.focus();
    });
    try {
      await win.loadFile(path.join(appRoot, 'renderer', 'browser-window', 'index.html'));
    } catch (error) {
      hangGuard?.note?.('browser-window-load-failed', { error: error.message });
      entry.closingSilently = true;
      if (!win.isDestroyed()) win.destroy();
      return { ok: false, error: `独立窗口加载失败：${error.message}` };
    }
    notifyMain('browser-window:opened', { tabId });
    return { ok: true };
  });

  ipcMain.handle('browser-window:init', event => {
    const entry = entryForSender(event);
    if (!entry) return null;
    return {
      tabId: entry.tabId,
      tabs: entry.tabs,
      theme: entry.theme,
      pinned: entry.pinned,
      title: entry.title,
      url: entry.url
    };
  });

  ipcMain.handle('browser-window:focus', (event, tabId) => {
    if (!mainSender(event)) return { ok: false };
    const entry = windows.get(String(tabId || ''));
    if (!entry || entry.win.isDestroyed()) return { ok: false, error: '窗口已关闭' };
    if (entry.win.isMinimized()) entry.win.restore();
    entry.win.show();
    entry.win.focus();
    return { ok: true };
  });

  // The main window cannot snapshot the detached tabs, so it asks the detached
  // renderer to hand them back through the normal restore path.
  ipcMain.handle('browser-window:request-restore', (event, tabId) => {
    if (!mainSender(event)) return { ok: false };
    const entry = windows.get(String(tabId || ''));
    if (!entry || entry.win.isDestroyed()) return { ok: false, error: '窗口已关闭' };
    try { entry.win.webContents.send('browser-window:restore-request'); } catch {}
    return { ok: true };
  });

  ipcMain.handle('browser-window:restore', (event, payload = {}) => {
    const entry = entryForSender(event);
    if (!entry) return { ok: false, error: '窗口已关闭' };
    const tabs = normalizeTabs(payload.tabs, { id: 'tab-1', url: entry.url, title: entry.title });
    entry.restoring = true;
    windows.delete(entry.tabId);
    notifyMain('browser-window:restore', { event: 'restore', tabId: entry.tabId, tabs });
    if (!entry.win.isDestroyed()) entry.win.close();
    return { ok: true };
  });

  ipcMain.handle('browser-window:close', event => {
    const entry = entryForSender(event);
    if (!entry) return { ok: false };
    if (!entry.win.isDestroyed()) entry.win.close();
    return { ok: true };
  });

  ipcMain.handle('browser-window:close-tab', (event, tabId) => {
    if (!mainSender(event)) return { ok: false };
    const entry = windows.get(String(tabId || ''));
    if (!entry) return { ok: true };
    entry.closingSilently = true;
    windows.delete(entry.tabId);
    if (!entry.win.isDestroyed()) entry.win.close();
    return { ok: true };
  });

  ipcMain.handle('browser-window:minimize', event => {
    const entry = entryForSender(event);
    if (entry && !entry.win.isDestroyed()) entry.win.minimize();
    return { ok: !!entry };
  });

  ipcMain.handle('browser-window:toggle-maximize', event => {
    const entry = entryForSender(event);
    if (!entry || entry.win.isDestroyed()) return { ok: false };
    if (entry.win.isMaximized()) entry.win.unmaximize();
    else entry.win.maximize();
    return { ok: true, maximized: entry.win.isMaximized() };
  });

  ipcMain.handle('browser-window:is-maximized', event => {
    const entry = entryForSender(event);
    return !!entry && !entry.win.isDestroyed() && entry.win.isMaximized();
  });

  ipcMain.handle('browser-window:set-pinned', (event, pinned) => {
    const entry = entryForSender(event);
    if (!entry || entry.win.isDestroyed()) return { ok: false };
    entry.pinned = pinned === true;
    entry.win.setAlwaysOnTop(entry.pinned, 'floating');
    return { ok: true, pinned: entry.pinned };
  });

  ipcMain.on('browser-window:meta', (event, meta = {}) => {
    const entry = entryForSender(event);
    if (!entry || entry.win.isDestroyed()) return;
    const title = String(meta.title || '').slice(0, 160);
    const url = String(meta.url || '').slice(0, 4000);
    if (title) entry.title = title;
    if (url) entry.url = url;
    try { entry.win.setTitle(`${title || '浏览器'} · Yan Agent`); } catch {}
    notifyMain('browser-window:meta', { event: 'meta', tabId: entry.tabId, title, url, favicon: String(meta.favicon || '').slice(0, 100000) });
  });

  function closeAll() {
    for (const entry of windows.values()) {
      entry.closingSilently = true;
      if (!entry.win.isDestroyed()) entry.win.destroy();
    }
    windows.clear();
  }

  return { closeAll };
}

module.exports = { registerBrowserWindows };

'use strict';

// Main application window (plan T2.2): creation, maximize/console plumbing and
// the custom-title-bar window controls. Moved verbatim from main.js; main.js
// keeps ownership of the window reference through state cells.

const path = require('path');

function registerMainWindow(ctx, deps = {}) {
  const { BrowserWindow, ipcMain, dialog, screen, state, paths } = ctx;
  const { configureBrowserGuest, applyWindowIcon, windowIconPngPath, hangGuard } = deps;
  const mark = label => hangGuard?.mark?.(label);
  const note = (text, extra) => hangGuard?.note?.(text, extra);
  // 非阻塞提示:showErrorBox 会在主进程里跑嵌套消息循环,窗口藏在托盘时用户看不到
  // 它,整个主进程就一直卡着(与 AppHangTransient 的表现一致)。
  const notifyError = (win, message) => {
    if (!win || win.isDestroyed() || !win.isVisible() || win.isMinimized()) return;
    dialog.showMessageBox(win, { type: 'error', title: 'Yan Agent发生了错误', message, buttons: ['确定'] }).catch(() => {});
  };
  const { mainWindow, mainRendererReady, pendingFocusMain, isQuiting } = state;
  let painted = false, initialized = false, bootFallback;
  const finishBoot = () => {
    if (!painted || !initialized) return;
    clearTimeout(bootFallback);
    const win = mainWindow.get();
    if (!win || win.isDestroyed()) return;
    applyWindowIcon(win);
    win.show();
    if (pendingFocusMain.get()) {
      win.focus();
      pendingFocusMain.set(false);
    }
  };
  const isMainFrame = event => {
    const win = mainWindow.get();
    return win && !win.isDestroyed() && event.sender === win.webContents && event.senderFrame === win.webContents.mainFrame;
  };
  ipcMain.on('win:ui-ready', event => {
    if (!isMainFrame(event)) return;
    initialized = true;
    finishBoot();
  });
  ipcMain.on('win:background', (event, color) => {
    if (isMainFrame(event) && /^#[0-9a-f]{6}$/i.test(String(color))) mainWindow.get().setBackgroundColor(color);
  });

  function createWindow() {
    mainRendererReady.set(false);
    painted = false; initialized = false;
    clearTimeout(bootFallback);
    const win = new BrowserWindow({
      name: 'yan-main-window',
      windowStatePersistence: { bounds: true, displayMode: true },
      width: 1280,
      height: 820,
      minWidth: 880,
      minHeight: 600,
      backgroundColor: '#1a1a1a',
      show: false,
      titleBarStyle: 'hidden',
      frame: false,
      autoHideMenuBar: true,
      icon: windowIconPngPath(),
      webPreferences: {
        preload: path.join(paths.appRoot, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: false,
        webviewTag: true,
        // Keep the main surface ready for immediate restore, including while idle.
        backgroundThrottling: false
      }
    });
    mainWindow.set(win);
    const ensureVisibleBounds = () => {
      if (win.isDestroyed() || !screen?.getAllDisplays || win.isMaximized() || win.isFullScreen()) return;
      const bounds = win.getBounds();
      const displays = screen.getAllDisplays();
      const reachable = displays.some(({ workArea: area }) =>
        Math.min(bounds.x + bounds.width, area.x + area.width) - Math.max(bounds.x, area.x) >= Math.min(400, bounds.width, area.width)
        && bounds.y >= area.y && bounds.y < area.y + area.height - 32);
      if (reachable || !displays.length) return;
      const area = screen.getPrimaryDisplay().workArea;
      const width = Math.min(bounds.width, area.width), height = Math.min(bounds.height, area.height);
      win.setBounds({ width, height, x: area.x + Math.round((area.width - width) / 2), y: area.y + Math.round((area.height - height) / 2) });
    };
    win.on('persisted-state-restored', ensureVisibleBounds);
    // Native restoration can finish during construction, before listeners exist.
    ensureVisibleBounds();
    screen?.on('display-removed', ensureVisibleBounds);
    screen?.on('display-metrics-changed', ensureVisibleBounds);
    win.once('closed', () => {
      screen?.removeListener('display-removed', ensureVisibleBounds);
      screen?.removeListener('display-metrics-changed', ensureVisibleBounds);
    });

    win.loadFile(path.join(paths.appRoot, 'renderer', 'index.html'));
    win.webContents.on('did-start-navigation', (_event, _url, _isInPlace, isMainFrame) => {
      if (isMainFrame) mainRendererReady.set(false);
    });
    win.webContents.on('did-finish-load', () => { mainRendererReady.set(true); });
    win.webContents.on('did-attach-webview', (_event, guestContents) => {
      configureBrowserGuest(guestContents);
    });
    win.once('ready-to-show', () => {
      ensureVisibleBounds();
      painted = true;
      finishBoot();
    });
    // A failed boot must still reveal the renderer's error/watchdog screen.
    bootFallback = setTimeout(() => { if (!win.isDestroyed()) { initialized = true; painted = true; finishBoot(); } }, 16000);
    bootFallback.unref?.();
    win.once('closed', () => clearTimeout(bootFallback));
    win.on('show', () => applyWindowIcon(win));

    // 窗口状态切换是卡死的高发点(最小化/遮挡后恢复时 GPU 通道重建),打上阶段
    // 标签让 hang.log 能指出停在哪一步;恢复后主动重绘,避免停在过期帧上。
    const repaint = () => { try { if (!win.isDestroyed()) win.webContents.invalidate(); } catch { /* 正在销毁 */ } };
    for (const name of ['minimize', 'hide', 'blur', 'focus']) win.on(name, () => mark(`window:${name}`));
    win.on('restore', () => { mark('window:restore'); repaint(); });
    win.on('show', () => { mark('window:show'); repaint(); });
    win.on('unresponsive', () => note('main-window-unresponsive'));
    win.on('responsive', () => note('main-window-responsive'));

    // Sync maximize state to renderer (for toggling the maximize button icon)
    win.on('maximize', () => win.webContents.send('win:maximize-changed', true));
    win.on('unmaximize', () => win.webContents.send('win:maximize-changed', false));

    // Forward renderer console to terminal for debugging
    win.webContents.on('console-message', ({ level, message, lineNumber, sourceId }) => {
      const tag = { debug: 'DEBUG', info: 'LOG', warning: 'WARN', error: 'ERROR' }[level] || 'LOG';
      console.log(`[renderer ${tag}] ${message}  (${sourceId}:${lineNumber})`);
    });
    win.webContents.on('render-process-gone', (_e, details) => {
      console.log('[renderer gone]', JSON.stringify(details));
      // The page cannot paint its own error screen once its process is gone, so
      // bring the UI back first, then tell the user without blocking the main process.
      if (isQuiting.get()) return;
      try { win.webContents.reload(); } catch {}
      notifyError(win, `渲染进程已退出（${details?.reason || 'unknown'}${details?.exitCode === undefined ? '' : ` · code ${details.exitCode}`}）。\n\n界面已重新加载。`);
    });
    win.webContents.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      console.log('[did-fail-load]', code, desc, url);
      // -3 is a deliberate abort (a redirect or a reload in flight).
      if (isMainFrame === false || code === -3 || isQuiting.get()) return;
      note('main-window-did-fail-load', { code, desc, url });
      notifyError(win, `界面加载失败：${desc || 'unknown'} (${code})\n${url || ''}`);
    });

    if (process.argv.includes('--dev')) {
      win.webContents.openDevTools({ mode: 'detach' });
    }

    // 关闭窗口时最小化到托盘，而非真正退出
    win.on('close', (e) => {
      if (!isQuiting.get()) {
        e.preventDefault();
        win.hide();
        return;
      }
    });
    win.on('closed', () => { mainWindow.set(null); });
  }

  ipcMain.on('win:minimize', () => {
    const win = mainWindow.get();
    if (win) win.minimize();
  });
  ipcMain.on('win:toggle-maximize', () => {
    const win = mainWindow.get();
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });
  ipcMain.on('win:close', () => {
    // 点击标题栏关闭按钮时，最小化到托盘而非退出
    const win = mainWindow.get();
    if (win) win.hide();
  });
  ipcMain.handle('win:is-maximized', () => {
    const win = mainWindow.get();
    return win ? win.isMaximized() : false;
  });

  return { createWindow };
}

module.exports = { registerMainWindow };

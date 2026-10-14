'use strict';

// Quick input palette (plan T2.3): the floating input window, its full-screen
// glow backdrop, the global shortcut and the quick-launch IPC handlers. Moved
// verbatim from main.js; state stays owned by main.js through state cells.

const path = require('path');

function registerQuickInput(ctx, deps = {}) {
  const { BrowserWindow, globalShortcut, screen, ipcMain, config, state, paths, services } = ctx;
  const { focusMainWindow, normalizeQuickLaunchConfig, defaultShortcut } = deps;
  const loadConfig = config.load;
  const saveConfig = config.save;
  const normalizeLanguage = services.normalizeLanguage;
  const {
    quickInputWindow,
    quickInputGlowWindow,
    quickInputGlowDisplayId,
    quickInputActive,
    registeredQuickInputShortcut,
    mainWindow,
    mainRendererReady
  } = state;

  function destroyQuickInputWindows() {
    quickInputActive.set(false);
    const inputWindow = quickInputWindow.get();
    const glow = quickInputGlowWindow.get();
    if (inputWindow && !inputWindow.isDestroyed()) inputWindow.destroy();
    if (glow && !glow.isDestroyed()) glow.destroy();
    quickInputWindow.set(null);
    quickInputGlowWindow.set(null);
    quickInputGlowDisplayId.set(null);
  }

  function createQuickInputGlowWindow(display) {
    const existing = quickInputGlowWindow.get();
    if (existing && !existing.isDestroyed()) {
      existing.setBounds(display.bounds, false);
      return existing;
    }
    quickInputGlowDisplayId.set(display.id);
    const glow = new BrowserWindow({
      ...display.bounds,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      focusable: false,
      hasShadow: false,
      title: 'Yan Agent Quick Input Glow',
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    quickInputGlowWindow.set(glow);
    glow.setIgnoreMouseEvents(true, { forward: true });
    glow.setAlwaysOnTop(true, 'screen-saver');
    glow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    glow.loadFile(path.join(paths.appRoot, 'renderer', 'quick-input-glow', 'index.html'));
    glow.on('closed', () => {
      quickInputGlowWindow.set(null);
      quickInputGlowDisplayId.set(null);
    });
    return glow;
  }

  function createQuickInputWindow(display) {
    const existing = quickInputWindow.get();
    if (existing && !existing.isDestroyed()) return existing;
    const width = 560;
    const height = 76;
    const workArea = display.workArea || display.bounds;
    const x = Math.round(workArea.x + (workArea.width - width) / 2);
    const y = Math.round(workArea.y + Math.min(180, Math.max(72, workArea.height * 0.18)));
    const win = new BrowserWindow({
      width,
      height,
      x,
      y,
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      hasShadow: false,
      title: 'Yan Agent Quick Input',
      webPreferences: {
        preload: path.join(paths.appRoot, 'quick-input-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: false
      }
    });
    quickInputWindow.set(win);
    win.setAlwaysOnTop(true, 'screen-saver');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.loadFile(path.join(paths.appRoot, 'renderer', 'quick-input', 'index.html'), {
      query: { lang: loadConfig().language === 'auto' ? (ctx.app.getLocale().startsWith('zh') ? 'zh-CN' : 'en') : normalizeLanguage(loadConfig().language) }
    });
    win.once('ready-to-show', () => {
      const current = quickInputWindow.get();
      if (current && !current.isDestroyed()) {
        current.show();
        current.focus();
      }
    });
    win.on('closed', () => {
      quickInputActive.set(false);
      quickInputWindow.set(null);
      const glow = quickInputGlowWindow.get();
      if (glow && !glow.isDestroyed()) glow.destroy();
      quickInputGlowWindow.set(null);
      quickInputGlowDisplayId.set(null);
    });
    return win;
  }

  function showQuickInputWindow() {
    const main = mainWindow.get();
    if (main && !main.isDestroyed() && main.isVisible() && !main.isMinimized()) {
      main.focus();
      return;
    }
    quickInputActive.set(true);
    const point = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(point);
    const glow = createQuickInputGlowWindow(display);
    const inputWindow = createQuickInputWindow(display);
    if (glow && !glow.isDestroyed()) glow.showInactive();
    if (inputWindow && !inputWindow.isDestroyed() && !inputWindow.isVisible() && !inputWindow.webContents.isLoading()) {
      inputWindow.show();
      inputWindow.focus();
    }
  }

  function formatQuickInputShortcut(shortcut) {
    const labels = {
      CommandOrControl: process.platform === 'darwin' ? 'Cmd' : 'Ctrl',
      Command: 'Cmd',
      Control: 'Ctrl',
      Alt: process.platform === 'darwin' ? 'Option' : 'Alt',
      Shift: 'Shift',
      Super: process.platform === 'darwin' ? 'Cmd' : 'Win',
      Space: 'Space'
    };
    return String(shortcut || defaultShortcut)
      .split('+')
      .map(part => labels[part] || part)
      .join('+');
  }

  function toggleQuickInputFromShortcut() {
    if (quickInputActive.get()) {
      destroyQuickInputWindows();
      return;
    }
    showQuickInputWindow();
  }

  function unregisterQuickInputShortcut() {
    const shortcut = registeredQuickInputShortcut.get();
    if (!shortcut) return;
    globalShortcut.unregister(shortcut);
    registeredQuickInputShortcut.set('');
  }

  function registerQuickInputShortcut(value = {}) {
    const settings = normalizeQuickLaunchConfig(value);
    const previousShortcut = registeredQuickInputShortcut.get();
    if (!settings.enabled) {
      unregisterQuickInputShortcut();
      return { ok: true, settings, registered: false, displayShortcut: formatQuickInputShortcut(settings.shortcut) };
    }
    if (previousShortcut === settings.shortcut && globalShortcut.isRegistered(settings.shortcut)) {
      return { ok: true, settings, registered: true, displayShortcut: formatQuickInputShortcut(settings.shortcut) };
    }

    unregisterQuickInputShortcut();
    let registered = false;
    let error = '';
    try {
      registered = globalShortcut.register(settings.shortcut, toggleQuickInputFromShortcut);
      if (!registered) error = '该快捷键已被系统或其他应用占用。';
    } catch (registrationError) {
      error = registrationError?.message || '快捷键格式不受系统支持。';
    }
    if (registered) {
      registeredQuickInputShortcut.set(settings.shortcut);
      return { ok: true, settings, registered: true, displayShortcut: formatQuickInputShortcut(settings.shortcut) };
    }

    if (previousShortcut) {
      try {
        if (globalShortcut.register(previousShortcut, toggleQuickInputFromShortcut)) {
          registeredQuickInputShortcut.set(previousShortcut);
        }
      } catch {}
    }
    console.warn(`[quick-input] failed to register ${settings.shortcut}: ${error}`);
    return {
      ok: false,
      error,
      settings,
      registered: false,
      displayShortcut: formatQuickInputShortcut(settings.shortcut)
    };
  }

  function quickLaunchRuntimeState(cfg = loadConfig()) {
    const settings = normalizeQuickLaunchConfig(cfg.quickLaunch);
    return {
      ok: true,
      settings,
      registered: settings.enabled
        && registeredQuickInputShortcut.get() === settings.shortcut
        && globalShortcut.isRegistered(settings.shortcut),
      displayShortcut: formatQuickInputShortcut(settings.shortcut)
    };
  }

  function sendQuickInputPromptToMain(text) {
    const prompt = String(text || '').trim();
    const main = mainWindow.get();
    if (!prompt || !main || main.isDestroyed()) return;
    focusMainWindow();
    const deliver = () => {
      const current = mainWindow.get();
      if (current && !current.isDestroyed() && !current.webContents.isDestroyed()) {
        current.webContents.send('quick-input:submit', { text: prompt });
      }
    };
    if (mainRendererReady.get()) setTimeout(deliver, 80);
    else main.webContents.once('did-finish-load', deliver);
  }

  ipcMain.handle('quick-launch:get', () => quickLaunchRuntimeState());
  ipcMain.handle('quick-launch:update', (_e, payload = {}) => {
    const cfg = loadConfig();
    const previous = normalizeQuickLaunchConfig(cfg.quickLaunch);
    const next = normalizeQuickLaunchConfig({
      enabled: payload.enabled,
      shortcut: payload.shortcut
    });
    const registration = registerQuickInputShortcut(next);
    if (!registration.ok) {
      return {
        ...registration,
        settings: previous,
        registered: previous.enabled
          && registeredQuickInputShortcut.get() === previous.shortcut
          && globalShortcut.isRegistered(previous.shortcut),
        displayShortcut: formatQuickInputShortcut(previous.shortcut)
      };
    }
    cfg.quickLaunch = next;
    saveConfig(cfg);
    return quickLaunchRuntimeState(cfg);
  });

  ipcMain.on('quick-input:submit', (event, text) => {
    const inputWindow = quickInputWindow.get();
    if (!inputWindow || inputWindow.isDestroyed() || event.sender.id !== inputWindow.webContents.id) return;
    const prompt = String(text || '').trim();
    if (!prompt) return;
    destroyQuickInputWindows();
    sendQuickInputPromptToMain(prompt);
  });
  ipcMain.on('quick-input:close', (event) => {
    const inputWindow = quickInputWindow.get();
    if (!inputWindow || inputWindow.isDestroyed() || event.sender.id !== inputWindow.webContents.id) return;
    destroyQuickInputWindows();
  });

  return {
    destroyQuickInputWindows,
    registerQuickInputShortcut,
    unregisterQuickInputShortcut,
    quickLaunchRuntimeState,
    sendQuickInputPromptToMain
  };
}

module.exports = { registerQuickInput };

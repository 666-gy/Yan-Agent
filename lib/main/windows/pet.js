'use strict';

// Desktop pet window (plan T2.4): creation, drag loop, visibility sync and the
// pet IPC handlers. Moved verbatim from main.js; the pet window reference,
// active pet id and pet state stay owned by main.js through state cells.

const path = require('path');
const fs = require('fs');
const { petRoot, readPet, listPets, deletePet } = require('../../pet-store');
const { createPetDataPoller } = require('../../pet-data');

const PET_COLLAPSED_SIZE = { width: 248, height: 238 };
const PET_LABELS = Object.freeze({
  orb: 'Yan Agent Orb',
  deepseek: '大烧货',
  claude: 'claude'
});

function registerPetWindow(ctx, deps = {}) {
  const { BrowserWindow, screen, ipcMain, config, state, paths, services } = ctx;
  const { normalizePetConfig } = deps;
  const loadConfig = config.load;
  const saveConfig = config.save;
  const normalizeLanguage = services.normalizeLanguage;
  const { petWindow, activePetId, petState, mainWindow, isQuiting } = state;

  let petDragState = null;
  let petDragTimer = null;
  const dataPoller = createPetDataPoller({ loadConfig, emit: payload => {
    const win = petWindow.get();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed()) win.webContents.send('pet:data', payload);
  } });
  const storeRoot = petRoot(paths.dataDir);
  fs.mkdirSync(storeRoot, { recursive: true });
  let refreshTimer;
  const watcher = fs.watch(storeRoot, { recursive: true }, () => {
    clearTimeout(refreshTimer);
    refreshTimer = setTimeout(() => {
      const main = mainWindow.get();
      if (main && !main.isDestroyed()) main.webContents.send('pets:changed');
      sendPetConfig();
    }, 200);
  });
  watcher.on('error', error => console.warn('[pets]', error.message));
  ctx.app.on('before-quit', () => { clearTimeout(refreshTimer); watcher.close(); dataPoller.stop(); });
  ipcMain.handle('pets:list', event => {
    if (event.sender.id !== mainWindow.get()?.webContents.id) return [];
    return listPets(paths.dataDir, true);
  });
  ipcMain.handle('pets:delete', (event, id) => {
    if (event.sender.id !== mainWindow.get()?.webContents.id) throw new Error('不允许删除宠物');
    deletePet(paths.dataDir, id);
    const cfg = loadConfig();
    cfg.pet = normalizePetConfig(cfg.pet);
    saveConfig(cfg);
    applyPetConfigRuntime(cfg.pet);
    mainWindow.get().webContents.send('pets:changed');
    return cfg.pet;
  });

  function resizePet(win, scale, viewport = PET_COLLAPSED_SIZE) {
    const bounds = win.getBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.round(viewport.width * scale);
    const height = Math.round(viewport.height * scale);
    win.setBounds({ width, height,
      x: Math.max(area.x, Math.min(bounds.x + bounds.width - width, area.x + area.width - width)),
      y: Math.max(area.y, Math.min(bounds.y + bounds.height - height, area.y + area.height - height)) });
  }

  function getInitialPetBounds() {
    const { workArea } = screen.getPrimaryDisplay();
    return {
      width: PET_COLLAPSED_SIZE.width,
      height: PET_COLLAPSED_SIZE.height,
      x: workArea.x + workArea.width - PET_COLLAPSED_SIZE.width - 18,
      y: workArea.y + workArea.height - PET_COLLAPSED_SIZE.height - 18
    };
  }

  function updatePetDrag() {
    const win = petWindow.get();
    if (!petDragState || !win || win.isDestroyed()) {
      stopPetDrag();
      return;
    }
    const cursor = screen.getCursorScreenPoint();
    const nextX = Math.round(petDragState.windowX + cursor.x - petDragState.cursorX);
    const nextY = Math.round(petDragState.windowY + cursor.y - petDragState.cursorY);
    const current = win.getBounds();
    if (current.x !== nextX || current.y !== nextY) win.setPosition(nextX, nextY, false);
  }

  function startPetDrag() {
    const win = petWindow.get();
    if (!win || win.isDestroyed()) return;
    stopPetDrag();
    const cursor = screen.getCursorScreenPoint();
    const bounds = win.getBounds();
    petDragState = {
      cursorX: cursor.x,
      cursorY: cursor.y,
      windowX: bounds.x,
      windowY: bounds.y
    };
    petDragTimer = setInterval(updatePetDrag, 16);
  }

  function stopPetDrag() {
    if (petDragTimer) clearInterval(petDragTimer);
    petDragTimer = null;
    petDragState = null;
  }

  function sendPetState() {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    win.webContents.send('pet:state', petState.get());
  }

  function sendPetConfig() {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || win.webContents.isDestroyed()) return;
    const selected = activePetId.get();
    const pet = normalizePetConfig(loadConfig().pet);
    const custom = readPet(paths.dataDir, selected, true);
    resizePet(win, pet.scale, custom?.viewport);
    win.webContents.send('pet:config', {
      selected,
      label: custom?.name || PET_LABELS[selected],
      scale: pet.scale,
      spriteDataUrl: custom?.spriteDataUrl || '',
      layout: custom?.layout || 'sprite',
      frontend: custom?.frontend || null,
      dataLabel: custom?.dataSource?.label || custom?.name || '',
      hasDataSource: !!custom?.dataSource,
      entertainment: selected !== 'orb'
    });
    dataPoller.select(win.isVisible() ? custom : null);
  }

  function notifyPetVisibility() {
    const main = mainWindow.get();
    if (!main || main.isDestroyed() || main.webContents.isDestroyed()) return;
    const win = petWindow.get();
    main.webContents.send('pet:visibility', {
      visible: !!(win && !win.isDestroyed() && win.isVisible())
    });
  }

  function destroyPetWindow() {
    dataPoller.stop();
    stopPetDrag();
    const win = petWindow.get();
    if (!win || win.isDestroyed()) {
      petWindow.set(null);
      notifyPetVisibility();
      return;
    }
    win.destroy();
  }

  function togglePetWindow() {
    const cfg = loadConfig();
    cfg.pet = normalizePetConfig(cfg.pet);
    const win = petWindow.get();
    cfg.pet.enabled = !(win && !win.isDestroyed() && win.isVisible());
    activePetId.set(cfg.pet.selected);
    saveConfig(cfg);
    if (!cfg.pet.enabled) {
      destroyPetWindow();
      return false;
    }
    createPetWindow();
    return true;
  }

  function applyPetConfigRuntime(pet = {}) {
    const next = normalizePetConfig(pet);
    activePetId.set(next.selected);
    if (!next.enabled) {
      destroyPetWindow();
      return;
    }
    const win = petWindow.get();
    if (!win || win.isDestroyed()) {
      createPetWindow();
      return;
    }
    sendPetConfig();
    sendPetState();
  }

  function createPetWindow() {
    const existing = petWindow.get();
    if (existing && !existing.isDestroyed()) {
      existing.showInactive();
      sendPetConfig();
      return existing;
    }

    const win = new BrowserWindow({
      ...getInitialPetBounds(),
      show: false,
      frame: false,
      transparent: true,
      backgroundColor: '#00000000',
      alwaysOnTop: true,
      skipTaskbar: true,
      resizable: false,
      maximizable: false,
      minimizable: false,
      fullscreenable: false,
      hasShadow: false,
      autoHideMenuBar: true,
      webPreferences: {
        preload: path.join(paths.appRoot, 'renderer', 'pet', 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        backgroundThrottling: true
      }
    });
    petWindow.set(win);

    win.setAlwaysOnTop(true, 'floating');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    win.loadFile(path.join(paths.appRoot, 'renderer', 'pet', 'index.html'), {
      query: { lang: normalizeLanguage(loadConfig().language) }
    });
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-frame-navigate', event => event.preventDefault());
    win.once('ready-to-show', () => {
      win.showInactive();
      sendPetConfig();
      sendPetState();
      notifyPetVisibility();
    });
    win.on('close', (event) => {
      stopPetDrag();
      if (!isQuiting.get()) {
        event.preventDefault();
        win.hide();
        dataPoller.stop();
      }
    });
    win.on('closed', () => {
      dataPoller.stop();
      stopPetDrag();
      petWindow.set(null);
      notifyPetVisibility();
    });
    return win;
  }

  function showMainWindowForPet(sessionId) {
    let main = mainWindow.get();
    if (!main || main.isDestroyed()) {
      deps.createMainWindow?.();
      main = mainWindow.get();
    }
    if (!main || main.isDestroyed()) return;
    if (main.isMinimized()) main.restore();
    main.show();
    main.focus();
    if (sessionId) {
      setTimeout(() => {
        const current = mainWindow.get();
        if (current && !current.isDestroyed()) {
          current.webContents.send('pet:action', { type: 'open-task', sessionId });
        }
      }, 0);
    }
  }

  function normalizePetState(payload = {}) {
    const allowedStates = new Set(['idle', 'observing', 'warning', 'paused', 'completed', 'error']);
    return {
      status: allowedStates.has(payload.status) ? payload.status : 'observing',
      sessionId: payload.sessionId ? String(payload.sessionId) : null,
      running: !!payload.running,
      title: String(payload.title || 'Yan Agent').slice(0, 80),
      message: String(payload.message || '正在监督任务').slice(0, 140),
      updatedAt: Date.now()
    };
  }

  ipcMain.on('pet:update', (event, payload = {}) => {
    const main = mainWindow.get();
    if (!main || main.isDestroyed() || event.sender.id !== main.webContents.id) return;
    petState.set(normalizePetState(payload));
    sendPetState();
  });

  ipcMain.on('pet:ready', (event) => {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) return;
    sendPetConfig();
    sendPetState();
  });

  ipcMain.on('pet:refresh-data', event => {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || !win.isVisible() || event.sender.id !== win.webContents.id) return;
    void dataPoller.refresh();
  });

  ipcMain.handle('pet:get-visible', (event) => {
    const main = mainWindow.get();
    if (!main || main.isDestroyed() || event.sender.id !== main.webContents.id) return false;
    const win = petWindow.get();
    return !!(win && !win.isDestroyed() && win.isVisible());
  });

  ipcMain.handle('pet:toggle-window', (event) => {
    const main = mainWindow.get();
    if (!main || main.isDestroyed() || event.sender.id !== main.webContents.id) return false;
    return togglePetWindow();
  });

  ipcMain.on('pet:drag-start', (event) => {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) return;
    startPetDrag();
  });

  ipcMain.on('pet:drag-end', (event) => {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) return;
    updatePetDrag();
    stopPetDrag();
  });

  ipcMain.on('pet:open-task', (event, sessionId) => {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) return;
    showMainWindowForPet(activePetId.get() === 'orb' ? sessionId : null);
  });

  ipcMain.on('pet:stop-task', (event, sessionId) => {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) return;
    const main = mainWindow.get();
    if (!main || main.isDestroyed() || !sessionId) return;
    main.webContents.send('pet:action', { type: 'stop-task', sessionId: String(sessionId) });
  });

  ipcMain.on('pet:close', (event) => {
    const win = petWindow.get();
    if (!win || win.isDestroyed() || event.sender.id !== win.webContents.id) return;
    destroyPetWindow();
  });

  return {
    createPetWindow,
    destroyPetWindow,
    togglePetWindow,
    applyPetConfigRuntime
  };
}

module.exports = { registerPetWindow };

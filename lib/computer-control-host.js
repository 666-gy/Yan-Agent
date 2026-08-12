'use strict';

const { globalShortcut, BrowserWindow, ipcMain, screen } = require('electron');
const path = require('path');
const bridge = require('./computer-control-bridge');

const ESCAPE_KEY = 'Escape';

let mainWindowRef = null;
let isControlling = false;
let controlState = {
  targetHwnd: null,
  targetTitle: '',
  useVisionRelay: false,
  startTime: null,
  overlayWindow: null,
  trackingInterval: null
};

function setMainWindow(win) { mainWindowRef = win; }

function sendToRenderer(channel, payload) {
  if (mainWindowRef && !mainWindowRef.isDestroyed()) {
    mainWindowRef.webContents.send(channel, payload);
  }
}

function registerEscapeHotkey() {
  try {
    if (globalShortcut.isRegistered(ESCAPE_KEY)) return true;
    const ok = globalShortcut.register(ESCAPE_KEY, () => {
      if (isControlling) {
        sendToRenderer('computer:stop-requested', { reason: 'esc' });
        stopComputerControl();
      }
    });
    return ok;
  } catch (err) {
    console.error('[computer-control] register Esc failed:', err);
    return false;
  }
}

function unregisterEscapeHotkey() {
  try {
    globalShortcut.unregister(ESCAPE_KEY);
  } catch (err) {
    console.error('[computer-control] unregister Esc failed:', err);
  }
}

async function startComputerControl({ targetHwnd = null, targetTitle = '', useVisionRelay = false }) {
  if (isControlling) await stopComputerControl();

  let hwnd = targetHwnd;
  if (!hwnd && targetTitle) {
    const found = await bridge.findWindow(targetTitle);
    hwnd = found.hwnd;
  }
  bridge.setActiveHwnd(hwnd);

  isControlling = true;
  controlState = {
    targetHwnd: hwnd,
    targetTitle,
    useVisionRelay,
    startTime: Date.now(),
    overlayWindow: null,
    trackingInterval: null
  };

  bridge.startNuphusMcp();
  registerEscapeHotkey();
  createOverlayWindow();

  controlState.trackingInterval = setInterval(async () => {
    if (!isControlling) return;
    const bounds = controlState.targetHwnd
      ? await bridge.getWindowBounds(controlState.targetHwnd)
      : { visible: false };
    if (controlState.overlayWindow && !controlState.overlayWindow.isDestroyed()) {
      controlState.overlayWindow.webContents.send('computer:overlay:state', {
        glow: true,
        text: 'Yan Agent 正在操控你的电脑，按 Esc 退出',
        bounds
      });
    }
  }, 500);

  sendToRenderer('computer:state-changed', getComputerControlStatus());
  return { ok: true };
}

async function stopComputerControl() {
  if (!isControlling) return { ok: true };
  isControlling = false;
  unregisterEscapeHotkey();
  closeOverlayWindow();
  if (controlState.trackingInterval) {
    clearInterval(controlState.trackingInterval);
    controlState.trackingInterval = null;
  }
  bridge.stopNuphusMcp();
  sendToRenderer('computer:state-changed', { active: false });
  return { ok: true };
}

function getComputerControlStatus() {
  return {
    active: isControlling,
    targetHwnd: controlState.targetHwnd,
    targetTitle: controlState.targetTitle,
    useVisionRelay: controlState.useVisionRelay,
    startTime: controlState.startTime
  };
}

// Overlay window management (used later by Task 3)
function createOverlayWindow() {
  closeOverlayWindow();
  const primary = screen.getPrimaryDisplay();
  const { width, height } = primary.workAreaSize;
  controlState.overlayWindow = new BrowserWindow({
    width,
    height,
    x: primary.workArea.x,
    y: primary.workArea.y,
    transparent: true,
    frame: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    resizable: false,
    movable: false,
    focusable: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });
  controlState.overlayWindow.loadFile(path.join(__dirname, '..', 'renderer', 'computer-control-overlay.html'));
  controlState.overlayWindow.setIgnoreMouseEvents(true, { forward: true });
  controlState.overlayWindow.on('ready-to-show', () => controlState.overlayWindow?.show());
  return controlState.overlayWindow;
}

function closeOverlayWindow() {
  if (controlState.overlayWindow && !controlState.overlayWindow.isDestroyed()) {
    controlState.overlayWindow.close();
  }
  controlState.overlayWindow = null;
}

async function ensureTargetForeground() {
  if (!controlState.targetHwnd) return { ok: false };
  return bridge.setForeground(controlState.targetHwnd);
}

function setupComputerControlIpc() {
  ipcMain.handle('computer:start', async (_event, opts) => startComputerControl(opts || {}));
  ipcMain.handle('computer:stop', async () => stopComputerControl());
  ipcMain.handle('computer:status', () => getComputerControlStatus());
  ipcMain.on('computer:overlay:bounds', (_event, bounds) => {
    if (controlState.overlayWindow && !controlState.overlayWindow.isDestroyed()) {
      controlState.overlayWindow.webContents.send('computer:overlay:bounds', bounds);
    }
  });
}

module.exports = {
  setMainWindow,
  setupComputerControlIpc,
  startComputerControl,
  stopComputerControl,
  getComputerControlStatus,
  createOverlayWindow,
  closeOverlayWindow,
  ensureTargetForeground,
  isControlling: () => isControlling
};

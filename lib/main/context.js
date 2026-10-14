'use strict';

// Injection contract for lib/main/* registration modules (plan T1.0).
//
// main.js owns every singleton (windows, stores, config); each registration
// module receives exactly one context object here and gets live getters for
// mutable state. Sibling lib/main modules must never be required for shared
// state — only for pure helpers.

const ELECTRON_KEYS = [
  'ipcMain',
  'app',
  'dialog',
  'shell',
  'session',
  'screen',
  'clipboard',
  'globalShortcut',
  'webContents',
  'BrowserWindow',
  'Menu',
  'Tray',
  'nativeImage'
];

// A state cell exposes one main.js-owned variable to a lib/main module without
// transferring ownership: reads go through get(), writes through set().
function stateCell(get, set) {
  if (typeof get !== 'function' || typeof set !== 'function') {
    throw new Error('stateCell requires get and set functions');
  }
  return Object.freeze({ get, set });
}

function createMainContext(parts = {}) {
  const electron = parts.electron || {};
  const missing = ELECTRON_KEYS.filter(key => !electron[key]);
  if (missing.length) {
    throw new Error(`main context: missing electron.${missing.join(', electron.')}`);
  }

  const windows = parts.windows || {};
  for (const key of ['getMainWindow', 'fromWebContents']) {
    if (typeof windows[key] !== 'function') {
      throw new Error(`main context: windows.${key} must be a function`);
    }
  }

  const config = parts.config || {};
  for (const key of ['load', 'save']) {
    if (typeof config[key] !== 'function') {
      throw new Error(`main context: config.${key} must be a function`);
    }
  }

  const state = parts.state || {};
  for (const [key, cell] of Object.entries(state)) {
    if (!cell || typeof cell.get !== 'function' || typeof cell.set !== 'function') {
      throw new Error(`main context: state.${key} must be a { get, set } cell`);
    }
  }

  return Object.freeze({
    ipcMain: electron.ipcMain,
    app: electron.app,
    dialog: electron.dialog,
    shell: electron.shell,
    session: electron.session,
    screen: electron.screen,
    clipboard: electron.clipboard,
    globalShortcut: electron.globalShortcut,
    webContents: electron.webContents,
    BrowserWindow: electron.BrowserWindow,
    Menu: electron.Menu,
    Tray: electron.Tray,
    nativeImage: electron.nativeImage,
    windows: Object.freeze({
      getMainWindow: windows.getMainWindow,
      getQuickInputWindow: typeof windows.getQuickInputWindow === 'function' ? windows.getQuickInputWindow : () => null,
      getPetWindow: typeof windows.getPetWindow === 'function' ? windows.getPetWindow : () => null,
      getTray: typeof windows.getTray === 'function' ? windows.getTray : () => null,
      fromWebContents: windows.fromWebContents
    }),
    config: Object.freeze({ load: config.load, save: config.save }),
    paths: Object.freeze({ ...(parts.paths || {}) }),
    services: parts.services || {},
    stores: parts.stores || {},
    state: Object.freeze({ ...state })
  });
}

module.exports = { createMainContext, stateCell };

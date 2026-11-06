const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yanBrowserWindow', {
  init: () => ipcRenderer.invoke('browser-window:init'),
  minimize: () => ipcRenderer.invoke('browser-window:minimize'),
  toggleMaximize: () => ipcRenderer.invoke('browser-window:toggle-maximize'),
  isMaximized: () => ipcRenderer.invoke('browser-window:is-maximized'),
  closeWindow: () => ipcRenderer.invoke('browser-window:close'),
  setPinned: pinned => ipcRenderer.invoke('browser-window:set-pinned', pinned === true),
  restore: tabs => ipcRenderer.invoke('browser-window:restore', { tabs: Array.isArray(tabs) ? tabs : [] }),
  updateMeta: meta => ipcRenderer.send('browser-window:meta', meta || {}),
  onMaximizeChanged: callback => {
    const handler = (_event, maximized) => callback(maximized === true);
    ipcRenderer.on('browser-window:maximize-changed', handler);
    return () => ipcRenderer.removeListener('browser-window:maximize-changed', handler);
  },
  onNewTab: callback => {
    const handler = (_event, detail) => callback(detail || {});
    ipcRenderer.on('browser-window:new-tab', handler);
    return () => ipcRenderer.removeListener('browser-window:new-tab', handler);
  },
  onRestoreRequest: callback => {
    const handler = () => callback();
    ipcRenderer.on('browser-window:restore-request', handler);
    return () => ipcRenderer.removeListener('browser-window:restore-request', handler);
  }
});

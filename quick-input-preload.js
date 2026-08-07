const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yanQuickInput', {
  submit: (text) => ipcRenderer.send('quick-input:submit', String(text || '')),
  close: () => ipcRenderer.send('quick-input:close')
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yanPet', {
  ready: () => ipcRenderer.send('pet:ready'),
  openTask: (sessionId) => ipcRenderer.send('pet:open-task', sessionId),
  stopTask: (sessionId) => ipcRenderer.send('pet:stop-task', sessionId),
  startDrag: () => ipcRenderer.send('pet:drag-start'),
  stopDrag: () => ipcRenderer.send('pet:drag-end'),
  close: () => ipcRenderer.send('pet:close'),
  onState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  },
  onConfig: (cb) => {
    const handler = (_event, config) => cb(config);
    ipcRenderer.on('pet:config', handler);
    return () => ipcRenderer.removeListener('pet:config', handler);
  }
});

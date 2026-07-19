const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yanPet', {
  ready: () => ipcRenderer.send('pet:ready'),
  setExpanded: (expanded) => ipcRenderer.invoke('pet:set-expanded', !!expanded),
  getMetrics: () => ipcRenderer.invoke('pet:get-metrics'),
  openTask: (sessionId) => ipcRenderer.send('pet:open-task', sessionId),
  stopTask: (sessionId) => ipcRenderer.send('pet:stop-task', sessionId),
  moveBy: (dx, dy) => ipcRenderer.send('pet:move-by', { dx, dy }),
  close: () => ipcRenderer.send('pet:close'),
  onState: (cb) => {
    const handler = (_event, state) => cb(state);
    ipcRenderer.on('pet:state', handler);
    return () => ipcRenderer.removeListener('pet:state', handler);
  }
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yanImageViewer', {
  read: (assetId) => ipcRenderer.invoke('image:generated-read', assetId),
  download: (assetId) => ipcRenderer.invoke('image:generated-download', assetId)
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yanImageViewer', {
  read: (assetId) => ipcRenderer.invoke('image:generated-read', assetId),
  download: (assetId) => ipcRenderer.invoke('image:generated-download', assetId),
  readFile: (filePath) => ipcRenderer.invoke('image:file-read', filePath),
  downloadFile: (filePath) => ipcRenderer.invoke('image:file-download', filePath)
});

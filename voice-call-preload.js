const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('voiceCall', {
  media: (method, payload) => ipcRenderer.invoke('voice-call:media', { method, payload }),
  utterance: (text, shareScreen = false) => ipcRenderer.invoke('voice-call:utterance', { text, shareScreen: shareScreen === true }),
  onTranscript: cb => { const listener = (_event, value) => cb(value); ipcRenderer.on('voice-call:transcript', listener); return () => ipcRenderer.removeListener('voice-call:transcript', listener); },
  action: action => ipcRenderer.invoke('voice-call:window-action', action),
  onMode: cb => { const listener = (_event, mode) => cb(mode); ipcRenderer.on('voice-call:mode', listener); return () => ipcRenderer.removeListener('voice-call:mode', listener); }
});

'use strict';
const { createVoiceInput } = require('../voice-input');
function registerVoiceInput({ app, ipcMain, getMainWindow, configStore, appRoot, dataDir }) {
  const service = createVoiceInput({ appRoot, dataDir, loadConfig: configStore.loadConfig, saveConfig: configStore.saveConfig,
    onChanged: value => { const win = getMainWindow(); if (win && !win.isDestroyed()) win.webContents.send('voice:changed', value); } });
  const wrap = fn => async (event, payload) => {
    try {
      const win = getMainWindow();
      if (!win || win.isDestroyed() || event.sender !== win.webContents || event.senderFrame !== win.webContents.mainFrame) throw new Error('仅主窗口可使用语音输入');
      return { ok: true, value: await fn(payload) };
    } catch (error) { console.warn('[voice]', error); return { ok: false, error: error.message || String(error) }; }
  };
  ipcMain.handle('voice:status', wrap(() => service.status()));
  ipcMain.handle('voice:configure', wrap(patch => service.configure(patch)));
  ipcMain.handle('voice:prepare', wrap(() => service.prepare()));
  ipcMain.handle('voice:cancel-preparation', wrap(() => service.cancelPreparation()));
  ipcMain.handle('voice:remove-models', wrap(() => service.removeModels()));
  ipcMain.handle('voice:transcribe', wrap(request => service.transcribe(request)));
  ipcMain.handle('voice:stream-start', wrap(request => service.streamStart(request)));
  ipcMain.handle('voice:stream-chunk', wrap(request => service.streamChunk(request)));
  ipcMain.handle('voice:stream-finish', wrap(request => service.streamFinish(request)));
  ipcMain.handle('voice:cancel', wrap(requestId => service.cancel(requestId)));
  app.once('before-quit', () => { void service.dispose().catch(error => console.warn('[voice] shutdown', error)); });
  return service;
}
module.exports = { registerVoiceInput };

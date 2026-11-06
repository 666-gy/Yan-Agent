'use strict';
const { createVoiceInput } = require('../voice-input');
const { createVoiceCallSpeech } = require('../voice-call-speech');
function registerVoiceInput({ app, ipcMain, getMainWindow, configStore, appRoot, dataDir }) {
  let callWindow;
  const service = createVoiceInput({ appRoot, dataDir, loadConfig: configStore.loadConfig, saveConfig: configStore.saveConfig,
    onChanged: value => { callWindow?.sync(value); const win = getMainWindow(); if (win && !win.isDestroyed()) win.webContents.send('voice:changed', value); require('./windows/session-windows').broadcast('voice:changed', value); } });
  let speech;
  const callRequests = new Set();
  let callGeneration = 0, startupAbort;
  const callSpeech = () => speech ||= createVoiceCallSpeech();
  callWindow = require('./voice-call-window').registerVoiceCallWindow({ app, ipcMain, getMainWindow, configStore, appRoot, getStatus: () => service.status(), onHangup: () => { callGeneration++; startupAbort?.abort(); speech?.dispose(); void service.releaseCall().catch(console.warn); for (const id of callRequests) service.cancel(id); callRequests.clear(); }, media: async (method, payload) => {
    const methods = { initialize: async () => { startupAbort = new AbortController(); try { await service.warmup(startupAbort.signal); } catch (error) { startupAbort.abort(); speech?.dispose(); await service.releaseCall(); throw error; } }, status: () => service.status(), transcribe: () => service.transcribe(payload), streamStart: () => service.streamStart(payload), streamChunk: () => service.streamChunk(payload), streamFinish: () => service.streamFinish(payload), cancel: () => service.cancel(payload), synthesize: () => callSpeech().synthesize(payload), cancelSpeech: () => speech?.cancel(payload) };
    if (!Object.hasOwn(methods, method)) throw Error('不支持的通话操作');
    const generation = callGeneration;
    const id = payload?.requestId;
    if (method === 'streamStart' || method === 'transcribe') callRequests.add(id);
    try {
      const result = await methods[method]();
      if (generation !== callGeneration) { if (id) service.cancel(id); throw Error('通话已结束'); }
      return result;
    }
    finally {
      if (method === 'transcribe' || method === 'streamFinish') callRequests.delete(id);
      if (method === 'cancel') callRequests.delete(payload);
    }
  } });
  const wrap = fn => async (event, payload) => {
    try {
      const win = require('./windows/session-windows').windowFor(event, getMainWindow());
      if (!win || win.isDestroyed()) throw new Error('仅应用窗口可使用语音输入');
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
  // Reserved for the call controller; normal chat replies never request audio.
  ipcMain.handle('voice-call:synthesize', wrap(async payload => {
    const status = await service.status();
    if (!status.preferences.callEnabled) throw new Error('语音通话已关闭');
    if (!status.ready) throw new Error('请先安装并启用语音输入模型');
    const result = await callSpeech().synthesize(payload);
    return result;
  }));
  ipcMain.handle('voice-call:cancel-speech', wrap(requestId => speech?.cancel(requestId) || false));
  app.once('before-quit', () => { speech?.dispose(); void service.dispose().catch(error => console.warn('[voice] shutdown', error)); });
  return service;
}
module.exports = { registerVoiceInput };

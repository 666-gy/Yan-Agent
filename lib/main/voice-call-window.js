'use strict';
const path = require('node:path');
const { BrowserWindow, screen, nativeTheme } = require('electron');
function registerVoiceCallWindow({ app, ipcMain, getMainWindow, configStore, appRoot, getStatus, onHangup, media }) {
  let sessionId = '', pending = null, connected = false;
  let win, loading, mode = 'expanded', closing = false, captions = false, resizeTimer;
  const isSender = (event, target) => target && !target.isDestroyed() && event.sender === target.webContents && event.senderFrame === target.webContents.mainFrame;
  const notify = () => {
    const main = getMainWindow();
    if (main && !main.isDestroyed()) main.webContents.send('voice-call:window-state', !!win && !win.isDestroyed());
  };
  function bounds(mini, old) {
    const area = (old ? screen.getDisplayMatching(old) : screen.getDisplayNearestPoint(screen.getCursorScreenPoint())).workArea;
    const width = Math.min(mini ? 328 : 304, area.width - 4), height = Math.min(mini ? 88 : captions ? 474 : 394, area.height - 4);
    const x = old ? old.x + old.width - width : area.x + area.width - width - 24;
    const y = old ? old.y : area.y + 64;
    return { x: Math.round(Math.max(area.x + 2, Math.min(x, area.x + area.width - width - 2))), y: Math.round(Math.max(area.y + 2, Math.min(y, area.y + area.height - height - 2))), width, height };
  }
  function changeMode(next) {
    if (!win || win.isDestroyed()) return;
    clearInterval(resizeTimer);
    mode = next;
    win.setBounds(bounds(mode === 'minimized', win.getBounds()));
    win.webContents.send('voice-call:mode', mode);
  }
  function close() { clearInterval(resizeTimer); if (win && !win.isDestroyed()) win.close(); }
  ipcMain.handle('voice-call:open', async (event, payload = {}) => {
    try {
      if (!isSender(event, getMainWindow())) throw Error('仅主窗口可打开通话');
      if (closing) throw Error('应用正在退出');
      const status = await getStatus();
      if (!status.ready || status.preferences.callEnabled === false) throw Error('请先安装语音模型并开启语音通话');
      if (!win || win.isDestroyed()) {
        if (!String(payload.sessionId || '').trim()) throw Error('请先选择一个任务');
        sessionId = String(payload.sessionId);
        captions = false; mode = 'minimized'; connected = false;
        const created = new BrowserWindow({ ...bounds(true), title: 'Yan 语音通话', show: false,
          frame: false, transparent: true, backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true,
          resizable: false, movable: true, minimizable: false, maximizable: false, fullscreenable: false, hasShadow: false,
          webPreferences: { preload: path.join(appRoot, 'voice-call-preload.js'), sandbox: true, contextIsolation: true, nodeIntegration: false }
        });
        win = created;
        created.setAlwaysOnTop(true, 'floating');
        created.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        created.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
        created.webContents.on('will-navigate', event => event.preventDefault());
        created.on('closed', () => { if (win === created) { clearInterval(resizeTimer); win = null; loading = null; if (pending) { getMainWindow()?.webContents.send('voice-call:interrupt', { id: pending.id, sessionId }); clearTimeout(pending.timer); pending.resolve({ ok: false, error: '通话已结束' }); pending = null; } onHangup?.(); if (!closing) getMainWindow()?.webContents.send('voice-call:sound', 'ding'); connected = false; notify(); } });
        const cfg = configStore.loadConfig();
        loading = created.loadFile(path.join(appRoot, 'renderer/voice-call-window.html'), { query: { theme: cfg.theme === 'light' ? 'light' : cfg.theme === 'dark' ? 'dark' : nativeTheme.shouldUseDarkColors ? 'dark' : 'light' } });
      }
      const target = win;
      try { await loading; } catch (error) { if (target && !target.isDestroyed()) target.destroy(); throw error; }
      if (!target || target.isDestroyed() || target !== win) throw Error('通话窗口已关闭');
      target.show(); target.focus(); notify();
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('voice-call:window-action', (event, action) => {
    if (!isSender(event, win)) return { ok: false };
    if (action === 'connected') {
      if (!connected) { connected = true; getMainWindow()?.webContents.send('voice-call:sound', 'arc'); }
    }
    else if (action === 'minimize') changeMode('minimized');
    else if (action === 'expand') changeMode('expanded');
    else if (action === 'captions-on' || action === 'captions-off') {
      captions = action === 'captions-on';
      if (mode === 'minimized') changeMode('expanded');
      else {
        clearInterval(resizeTimer);
        const start = win.getBounds(), target = bounds(false, start), began = Date.now();
        resizeTimer = setInterval(() => {
          if (!win || win.isDestroyed()) { clearInterval(resizeTimer); return; }
          const t = Math.min(1, (Date.now() - began) / 320), ease = 1 - Math.pow(1 - t, 3);
          const next = {};
          for (const key of ['x','y','width','height']) next[key] = Math.round(start[key] + (target[key] - start[key]) * ease);
          win.setBounds(next);
          if (t === 1) clearInterval(resizeTimer);
        }, 16);
      }
    }
    else if (action === 'interrupt') {
      if (pending) getMainWindow()?.webContents.send('voice-call:interrupt', { id: pending.id, sessionId });
    }
    else if (action === 'hangup') close();
    else return { ok: false };
    return { ok: true };
  });
  ipcMain.handle('voice-call:media', async (event, { method, payload } = {}) => {
    if (!isSender(event, win)) return { ok: false, error: '通话窗口已关闭' };
    try { return { ok: true, value: await media(method, payload) }; }
    catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('voice-call:utterance', (event, payload = {}) => {
    if (!isSender(event, win)) return { ok: false, error: '通话已结束' };
    if (pending) return { ok: false, error: 'Yan 正在回复，请稍候' };
    const text = String(payload.text || '').trim();
    if (!text || text.length > 16000) return { ok: false, error: '无效的语音文本' };
    const main = getMainWindow();
    if (!main || main.isDestroyed()) return { ok: false, error: '任务窗口不可用' };
    const id = require('node:crypto').randomUUID();
    return new Promise(resolve => {
      const timer = setTimeout(() => { if (pending?.id === id) { pending = null; resolve({ ok: false, error: '等待任务回复超时' }); } }, 15 * 60 * 1000);
      pending = { id, resolve, timer };
      const target = win;
      void (async () => {
        try {
          let screenshot;
          if (payload.shareScreen === true) {
            const display = screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
            const sources = await require('electron').desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1920, height: 1080 } });
            const source = sources.find(item => item.display_id === String(display.id));
            if (!source || source.thumbnail.isEmpty()) throw Error('无法截取当前屏幕，请检查屏幕录制权限');
            screenshot = source.thumbnail.toJPEG(85).toString('base64');
          }
          if (pending?.id !== id || win !== target || target.isDestroyed()) return;
          main.webContents.send('voice-call:turn', { id, sessionId, text, screenshot });
        } catch (error) {
          if (pending?.id === id) { clearTimeout(pending.timer); pending = null; resolve({ ok: false, error: error.message }); }
        }
      })();
    });
  });
  ipcMain.on('voice-call:turn-result', (event, value = {}) => {
    if (!isSender(event, getMainWindow()) || value.id !== pending?.id) return;
    if (value.partial === true) { win?.webContents.send('voice-call:transcript', { id: value.id, role: 'assistant', text: String(value.text || ''), html: typeof value.html === 'string' ? value.html : undefined, final: false }); return; }
    clearTimeout(pending.timer); const resolve = pending.resolve; pending = null;
    resolve({ id: value.id, ok: value.ok === true, text: String(value.text || ''), html: typeof value.html === 'string' ? value.html : undefined, error: String(value.error || '') });
  });
  const reposition = () => { if (win && !win.isDestroyed()) win.setBounds(bounds(mode === 'minimized', win.getBounds())); };
  app.whenReady().then(() => {
    screen.on('display-removed', reposition); screen.on('display-metrics-changed', reposition);
  });
  app.once('before-quit', () => { closing = true; close(); if (app.isReady()) { screen.removeListener('display-removed', reposition); screen.removeListener('display-metrics-changed', reposition); } });
  return { close, updateTranscript(value) { if (win && !win.isDestroyed()) win.webContents.send('voice-call:transcript', value); }, sync(status) { if (status.preferences.enabled === false || status.preferences.callEnabled === false) close(); } };
}
module.exports = { registerVoiceCallWindow };

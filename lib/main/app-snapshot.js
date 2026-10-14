'use strict';
const { normalize, SHORTCUTS } = require('../app-snapshot-settings');
const { createSnapshotMonitor } = require('./snapshot-monitor');
const { captureSnapshotText } = require('./snapshot-text');

function registerAppSnapshotIpc({ ipcMain, windows, app, config, BrowserWindow }, desktopCapturer, deps = {}) {
  let targets = [], ready = false, monitorError = '', busy = false, stopped = false;
  let cached = null, refreshing = null, revision = 0, selectionVersion = 0;
  const mainWindow = () => windows.getMainWindow();
  const authorized = event => {
    const main = mainWindow();
    return main && !main.isDestroyed() && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame;
  };
  const send = (channel, payload) => {
    const main = mainWindow();
    if (!stopped && main && !main.isDestroyed()) main.webContents.send(channel, payload);
  };
  function ownHandles() {
    return new Set((BrowserWindow?.getAllWindows?.() || [mainWindow()]).filter(win => win && !win.isDestroyed())
      .map(win => win.getMediaSourceId?.().split(':')[1]).filter(Boolean));
  }
  function select(sources) {
    const own = ownHandles();
    for (const target of targets) {
      if (own.has(target.handle) || target.pid === process.pid || /^Yan Agent(?:$|\s[—–-])/i.test(target.name)) continue;
      const source = sources.find(item => item.id.split(':')[1] === target.handle);
      if (source) return { source, target };
    }
    return null;
  }
  function metadata(selected) {
    if (!selected) return { available: false };
    const { source, target } = selected;
    return { available: true, name: target.name || source.name, handle: target.handle,
      icon: source.appIcon?.isEmpty() === false ? source.appIcon.toDataURL() : '' };
  }
  async function refreshTarget(force = false) {
    if (!force && cached && Date.now() - cached.time < 1000) return cached.value;
    if (refreshing) return refreshing;
    refreshing = (async () => {
      const version = revision;
      try {
        if (!targets.length) return { available: false };
        const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 }, fetchWindowIcons: true });
        const value = metadata(select(sources));
        if (version === revision) { cached = { time: Date.now(), value }; send('app-snapshot:target-changed', value); }
        return value;
      } catch (error) { return { available: false, error: error.message }; }
      finally { refreshing = null; }
    })();
    const result = await refreshing;
    // An immediately resolved empty-list branch must also release the slot.
    refreshing = null;
    return result;
  }
  async function capture(expectedHandle) {
    if (busy) return { error: '正在截取窗口，请稍候' };
    busy = true;
    try {
      if (!targets.length) throw new Error('没有可附加的应用窗口');
      const version = selectionVersion;
      const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 2560, height: 1600 }, fetchWindowIcons: true });
      const selected = select(sources);
      if (!selected) throw new Error('没有可附加的应用窗口');
      if (version !== selectionVersion || (expectedHandle && selected.target.handle !== expectedHandle)) throw new Error('目标应用已变化，请重新附加');
      const { source, target } = selected;
      if (source.thumbnail.isEmpty()) throw new Error('无法截取该窗口，请还原窗口后重试');
      const buffer = source.thumbnail.toPNG();
      if (buffer.length > 20 * 1024 * 1024) throw new Error('窗口截图超过 20MB，请缩小窗口后重试');
      const readText = deps.captureText || (typeof captureSnapshotText === 'function' ? captureSnapshotText : async () => '');
      let text = '', textError = '';
      try { text = await readText(target.handle); }
      catch { textError = '无法读取此应用的窗口文本。'; }
      if (stopped || version !== selectionVersion) throw new Error('目标应用已变化，请重新附加');
      return { name: `应用快照-${target.name || source.name}.png`, data: buffer.toString('base64'),
        snapshot: { name: target.name || source.name, text, textError, icon: metadata(selected).icon, preview: source.thumbnail.resize({ width: 560 }).toDataURL() },
        settings: normalize(config.load().appSnapshot) };
    } catch (error) { return { error: error.message }; }
    finally { busy = false; }
  }
  const monitor = (deps.createMonitor || createSnapshotMonitor)({
    onTargets(items) {
      const next = (Array.isArray(items) ? items : []).filter(item => item && /^\d+$/.test(item.handle) && typeof item.name === 'string').slice(0, 16);
      if (JSON.stringify(next) !== JSON.stringify(targets)) {
        if (next[0]?.handle !== targets[0]?.handle) selectionVersion++;
        targets = next; cached = null; revision++;
        // Clear a stale label immediately, then resolve the new app's icon.
        send('app-snapshot:target-changed', { available: false });
      }
      void refreshTarget();
    },
    onState(ok, error = '') { ready = ok; monitorError = error; },
    async onGesture(shortcut) {
      if (!ready || shortcut !== normalize(config.load().appSnapshot).shortcut || busy) return;
      const result = await capture();
      if (stopped) return;
      const main = mainWindow();
      if (!main || main.isDestroyed()) return;
      if (main.isMinimized()) main.restore(); main.show(); main.focus();
      send('app-snapshot:received', result);
    }
  });
  let monitorActive = false;
  const wakeMonitor = () => {
    if (!monitorActive) monitorActive = true;
    monitor.wake?.();  // Always call: resets the 8s sleep timer in the child
  };
  const sleepMonitor = () => { if (monitorActive) { monitorActive = false; monitor.sleep?.(); } };
  app.whenReady().then(() => { if (!stopped) { monitor.start(); } });
  app.once('will-quit', () => { stopped = true; monitor.stop(); });
  const runtime = () => ({ settings: normalize(config.load().appSnapshot), registered: ready, error: monitorError });
  ipcMain.handle('app-snapshot:target', event => {
    if (!authorized(event)) return { available: false, error: '无权读取应用窗口' };
    wakeMonitor();
    return refreshTarget(true);
  });
  ipcMain.handle('app-snapshot:capture', (event, expectedHandle) => {
    if (!authorized(event)) return { error: '无权截取应用窗口' };
    wakeMonitor();
    return capture(expectedHandle);
  });
  ipcMain.handle('app-snapshot:settings', event => authorized(event) ? runtime() : { error: '无权修改应用快照' });
  ipcMain.handle('app-snapshot:update', (event, partial = {}) => {
    if (!authorized(event)) return { error: '无权修改应用快照' };
    if (partial.shortcut !== undefined && !SHORTCUTS.includes(partial.shortcut)) return { ...runtime(), error: '请选择 Alt+Alt 或 Shift+Shift' };
    try {
      const cfg = config.load(); cfg.appSnapshot = normalize({ ...normalize(cfg.appSnapshot), ...partial });
      config.save(cfg); return runtime();
    } catch (error) { return { ...runtime(), error: error.message }; }
  });
}
module.exports = { registerAppSnapshotIpc };

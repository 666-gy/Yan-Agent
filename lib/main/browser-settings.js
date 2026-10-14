'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createDeferredJsonStore } = require('./deferred-json-store');
function registerBrowserSettings(ctx, { BROWSER_PARTITION, getMainWindow, configStore, hangGuard }) {
  const { app, ipcMain, session, shell, dialog } = ctx;
  const file = path.join(app.getPath('userData'), 'browser-history.json');
  let data;
  try { data = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { data = {}; }
  data.history = Array.isArray(data.history) ? data.history : [];
  data.downloads = Array.isArray(data.downloads) ? data.downloads : [];
  for (const item of data.downloads) if (['progressing', 'paused'].includes(item.status)) item.status = 'interrupted';
  const persistence = createDeferredJsonStore(file, () => data);
  const save = persistence.schedule;
  let flushedForQuit = false;
  app.on('before-quit', event => {
    if (flushedForQuit) return;
    event.preventDefault();
    persistence.flush().catch(error => console.error('[browser history save]', error)).finally(() => {
      flushedForQuit = true;
      app.quit();
    });
  });
  const bind = (name, fn) => ipcMain.handle(name, (event, payload) => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('无权管理浏览器');
    return fn(payload);
  });
  const valid = url => { try { return ['http:', 'https:', 'file:'].includes(new URL(url).protocol); } catch { return false; } };
  const downloadDirectory = () => configStore.loadConfig().browser?.downloadDirectory || app.getPath('downloads');
  const activeDownloads = new Map();
  bind('browser:download-control', ({ id, action } = {}) => {
    if (action === 'retry') {
      const entry = data.downloads.find(item => item.id === id);
      if (!entry || entry.status !== 'interrupted' || activeDownloads.has(id) || !valid(entry.url)) throw new Error('此下载不能重新开始');
      session.fromPartition(BROWSER_PARTITION).downloadURL(entry.url);
      return { ok: true };
    }
    const active = activeDownloads.get(id);
    if (!active) throw new Error('下载已结束');
    if (action === 'pause') { active.item.pause(); active.entry.status = 'paused'; active.entry.speed = 0; }
    else if (action === 'resume') {
      if (!active.item.canResume()) throw new Error('此下载无法继续，请重新下载');
      active.item.resume(); active.entry.status = 'progressing'; active.samples = [{ time: Date.now(), bytes: active.entry.received }]; active.lastProgress = Date.now();
    }
    else if (action === 'cancel') active.item.cancel();
    else throw new Error('无效的下载操作');
    save(); return { ok: true };
  });
  bind('browser:download-open-folder', () => shell.openPath(downloadDirectory()));
  bind('browser:download-location', () => downloadDirectory());
  bind('browser:download-choose-location', async () => {
    const result = await dialog.showOpenDialog(getMainWindow(), { title: '选择下载文件夹', defaultPath: downloadDirectory(), properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });
  bind('browser:downloads', () => data.downloads.map(item => {
    const active = activeDownloads.get(item.id), now = Date.now();
    let speed = 0, stalled = false, canResume = false;
    if (active) {
      canResume = active.item.canResume();
      stalled = item.status === 'progressing' && now - active.lastProgress >= 3000;
      const samples = active.samples;
      while (samples.length > 1 && samples[1].time < now - 3000) samples.shift();
      const first = samples[0];
      if (item.status === 'progressing' && !stalled && first && now > first.time) speed = Math.max(0, (item.received - first.bytes) * 1000 / (now - first.time));
    }
    return { ...item, speed, stalled, canResume, canRetry: item.status === 'interrupted' && !active, exists: !!item.path && fs.existsSync(item.path) };
  }));
  bind('browser:downloads-remove', async ids => {
    const selected = new Set(Array.isArray(ids) ? ids : []);
    for (const id of selected) {
      const active = activeDownloads.get(id);
      if (active && ['paused', 'interrupted'].includes(active.entry.status)) active.item.cancel();
    }
    data.downloads = data.downloads.filter(item => !selected.has(item.id)); save(); await persistence.flush(); return { ok: true };
  });
  bind('browser:download-file', async ({ id, action } = {}) => {
    const item = data.downloads.find(entry => entry.id === id);
    if (!item?.path || item.status !== 'completed' || !fs.existsSync(item.path)) throw new Error('文件已移动或删除');
    if (action === 'reveal') shell.showItemInFolder(item.path);
    else if (action === 'open') { const error = await shell.openPath(item.path); if (error) throw new Error(error); }
    else throw new Error('无效的文件操作');
    return { ok: true };
  });
  bind('browser:history', () => data.history);
  bind('browser:history-remove', async ids => {
    const selected = new Set(Array.isArray(ids) ? ids : []);
    data.history = data.history.filter(item => !selected.has(item.id)); save(); await persistence.flush(); return { ok: true };
  });
  bind('browser:open-link', async url => {
    if (!valid(url)) throw new Error('不支持的链接');
    const parsed = new URL(url), local = parsed.protocol === 'file:' || ['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) || parsed.hostname.endsWith('.localhost');
    const prefs = configStore.loadConfig().browser || {};
    const target = local ? (prefs.localTarget || 'builtin') : (prefs.webTarget || 'external');
    if (target === 'external' && parsed.protocol !== 'file:') await shell.openExternal(url);
    else return { target: 'builtin' };
    return { target: 'external' };
  });
  const durations = { hour: 3600000, day: 86400000, week: 604800000, month: 2419200000, all: Infinity };
  bind('browser:data-summary', async (range = 'hour') => {
    const cookies = await session.fromPartition(BROWSER_PARTITION).cookies.get({});
    const since = Date.now() - (durations[range] || durations.hour);
    return { history: data.history.filter(item => item.time >= since).length, downloads: data.downloads.filter(item => item.time >= since).length, sites: [...new Set(cookies.map(cookie => cookie.domain))] };
  });
  bind('browser:clear-selected', async ({ range = 'hour', types = [] } = {}) => {
    if (!Object.hasOwn(durations, range) || !Array.isArray(types) || types.some(type => !['history', 'sites', 'cache', 'downloads'].includes(type))) throw new Error('无效的清理选项');
    const since = Date.now() - durations[range];
    const partition = session.fromPartition(BROWSER_PARTITION);
    if (types.includes('sites')) await partition.clearStorageData();
    if (types.includes('cache')) await partition.clearCache();
    if (types.includes('history')) data.history = data.history.filter(item => item.time < since);
    if (types.includes('downloads')) data.downloads = data.downloads.filter(item => item.time < since);
    save(); await persistence.flush(); return { ok: true };
  });
  app.on('web-contents-created', (_event, contents) => {
    if (contents.getType() !== 'webview' || contents.session !== session.fromPartition(BROWSER_PARTITION)) return;
    let latest;
    const record = url => {
      if (!valid(url)) return;
      latest = { id: crypto.randomUUID(), url, title: contents.getTitle() || new URL(url).hostname, time: Date.now() };
      data.history.unshift(latest); data.history = data.history.slice(0, 10000); save();
    };
    contents.on('did-navigate', (_event, url) => record(url));
    contents.on('did-navigate-in-page', (_event, url, isMainFrame) => { if (isMainFrame) record(url); });
    contents.on('page-title-updated', (_event, title) => { if (latest) { latest.title = title; save(); } });
    contents.on('page-favicon-updated', (_event, icons) => {
      if (latest && icons?.[0] && /^https?:|^data:image\//i.test(icons[0])) { latest.favicon = icons[0]; save(); }
    });
  });
  const reservedPaths = new Set();
  app.whenReady().then(() => session.fromPartition(BROWSER_PARTITION).on('will-download', (event, item) => {
    const entry = { id: crypto.randomUUID(), url: item.getURL(), name: item.getFilename(), time: Date.now(), status: 'progressing', received: 0, total: item.getTotalBytes() };
    data.downloads.unshift(entry); data.downloads = data.downloads.slice(0, 10000);
    let destination;
    try {
      const directory = downloadDirectory();
      fs.mkdirSync(directory, { recursive: true });
      const name = path.basename(entry.name).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_') || 'download';
      destination = path.join(directory, name);
      if (configStore.loadConfig().browser?.askDownloadLocation === true) {
        // will-download 需要同步给出路径,只能用 Sync 对话框;告知哨兵这是预期阻塞。
        const ask = () => dialog.showSaveDialogSync(getMainWindow(), { title: '保存下载文件', defaultPath: destination });
        destination = hangGuard ? hangGuard.whileBlocking('download-save-dialog', ask) : ask();
        if (!destination) { event.preventDefault(); entry.status = 'cancelled'; save(); return; }
      } else {
        const ext = path.extname(name), base = name.slice(0, name.length - ext.length);
        let suffix = 1;
        while (fs.existsSync(destination) || reservedPaths.has(destination.toLowerCase())) destination = path.join(directory, `${base} (${suffix++})${ext}`);
      }
      reservedPaths.add(destination.toLowerCase());
      item.setSavePath(destination); entry.path = destination; entry.name = path.basename(destination); save();
      activeDownloads.set(entry.id, { item, entry, samples: [{ time: Date.now(), bytes: 0 }], lastProgress: Date.now() });
    } catch (error) { if (destination) reservedPaths.delete(destination.toLowerCase()); event.preventDefault(); entry.status = 'interrupted'; entry.error = error.message; save(); return; }
    item.on('updated', (_event, status) => {
      const now = Date.now(), received = item.getReceivedBytes();
      const active = activeDownloads.get(entry.id);
      if (active && received > entry.received) {
        active.lastProgress = now; active.samples.push({ time: now, bytes: received });
        while (active.samples.length > 2 && active.samples[1].time < now - 3000) active.samples.shift();
      }
      if (status !== 'completed') entry.status = status === 'interrupted' ? 'interrupted' : item.isPaused() ? 'paused' : status;
      entry.received = received; entry.total = item.getTotalBytes();
    });
    item.once('done', (_event, status) => {
      reservedPaths.delete(destination.toLowerCase());
      activeDownloads.delete(entry.id); entry.speed = 0;
      entry.status = status; entry.received = item.getReceivedBytes(); entry.total = item.getTotalBytes(); save();
    });
  }));
  async function queryAgentHistory(params = {}, isActive = () => true) {
    const query = String(params.query || '').trim().slice(0, 500);
    const limit = Number.isInteger(params.limit) ? Math.max(1, Math.min(100, params.limit)) : 30;
    const offset = Number.isInteger(params.offset) ? Math.max(0, params.offset) : 0;
    const prefs = () => configStore.loadConfig().browser || {};
    if (!isActive()) return { ok: false, code: 'BROWSER_RUN_NOT_ACTIVE', error: '任务已结束' };
    if (prefs().historyPolicy === 'deny') return { ok: false, code: 'BROWSER_HISTORY_DISABLED', error: '用户已禁用 Agent 访问浏览历史' };
    if (prefs().historyPolicy !== 'allow') {
      const main = getMainWindow();
      if (!main || main.isDestroyed()) return { ok: false, code: 'BROWSER_HISTORY_DENIED', error: '无法请求历史记录访问授权' };
      const result = await dialog.showMessageBox(main, {
        type: 'question', title: '允许访问浏览历史？', message: '允许当前 Agent 查询内置浏览器历史记录？',
        detail: `${query ? `搜索：${query}` : '查询最近访问的页面'}\n最多返回 ${limit} 条记录，包含网页标题、网址和访问时间。仅允许本次查询。`,
        buttons: ['不允许', '允许本次'], defaultId: 0, cancelId: 0, noLink: true
      });
      if (result.response !== 1) return { ok: false, code: 'BROWSER_HISTORY_DENIED', error: '用户未允许本次历史记录查询' };
    }
    if (!isActive() || prefs().historyPolicy === 'deny' || prefs().enabled === false) return { ok: false, code: 'BROWSER_HISTORY_DENIED', error: '访问权限已撤销或任务已结束' };
    const needle = query.toLocaleLowerCase();
    const matches = data.history.filter(item => `${item.title || ''} ${item.url || ''}`.toLocaleLowerCase().includes(needle)).sort((a, b) => b.time - a.time);
    return { ok: true, total: matches.length, offset, hasMore: offset + limit < matches.length,
      entries: matches.slice(offset, offset + limit).map(({ title, url, time }) => ({ title, url, visitedAt: new Date(time).toISOString() })) };
  }
  return { queryAgentHistory };
}
module.exports = { registerBrowserSettings };

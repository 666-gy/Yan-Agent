'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const sessionWindows = require('./windows/session-windows');

function registerBrowserLifecycle({ app, ipcMain, session, webContents, dialog }, { getMainWindow, BROWSER_PARTITION,
  idleMs = 10 * 60 * 1000, scanMs = 30000 }) {
  const tabs = new Map();
  function trusted(contents, host = null) {
    if (!contents || contents.isDestroyed() || contents.getType() !== 'webview'
      || contents.session !== session.fromPartition(BROWSER_PARTITION)) return false;
    const owner = contents.hostWebContents;
    if (!owner || (typeof owner.isDestroyed === 'function' && owner.isDestroyed())) return false;
    if (host) {
      if (owner !== host) return false;
      const main = getMainWindow();
      return (main && !main.isDestroyed() && host === main.webContents) || sessionWindows.ownsWebContents(host);
    }
    const main = getMainWindow();
    if (main && !main.isDestroyed() && owner === main.webContents) return true;
    return sessionWindows.ownsWebContents(owner);
  }
  function uiHost(event) {
    if (!event.sender || event.senderFrame !== event.sender.mainFrame) return null;
    const main = getMainWindow();
    if (main && !main.isDestroyed() && event.sender === main.webContents) return event.sender;
    return sessionWindows.ownsWebContents(event.sender) ? event.sender : null;
  }
  function fromUi(event, id) {
    const host = uiHost(event);
    if (!host) throw new Error('无权访问浏览器标签');
    const contents = webContents.fromId(Number(id));
    if (!trusted(contents, host)) throw new Error('浏览器标签已关闭');
    return contents;
  }
  function stateFor(contents) {
    let state = tabs.get(contents.id);
    if (state) return state;
    state = { contents, lastActive: Date.now(), active: true, protected: false, edited: false,
      downloads: 0, frozen: false, ownsDebugger: false, busy: false, revision: 0, exporting: false };
    tabs.set(contents.id, state);
    contents.once('destroyed', () => tabs.delete(contents.id));
    contents.on('did-start-navigation', (_event, _url, inPlace, mainFrame) => {
      if (mainFrame && !inPlace) { state.revision++; state.edited = false; state.lastActive = Date.now(); void wake(state); }
    });
    contents.on('media-started-playing', () => { state.lastActive = Date.now(); void wake(state); });
    return state;
  }
  async function wake(state) {
    if (state.ownsDebugger && !state.contents.isDestroyed()) {
      try { await state.contents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'active' }); }
      catch { /* Navigation or a destroyed guest already releases the old page. */ }
      finally { if (state.contents.debugger.isAttached()) state.contents.debugger.detach(); state.ownsDebugger = false; }
    }
    state.frozen = false;
  }
  ipcMain.handle('browser:tab-activity', async (event, value = {}) => {
    const state = stateFor(fromUi(event, value.id));
    state.active = value.active !== false;
    state.protected = value.protected === true;
    if (state.active || state.protected) { state.lastActive = Date.now(); await wake(state); }
    return { sleeping: state.frozen };
  });
  ipcMain.on('browser:tab-edited', event => {
    if (!trusted(event.sender)) return;
    const state = stateFor(event.sender);
    state.edited = true;
    void wake(state);
  });
  const eligible = state => trusted(state.contents) && !state.active && !state.protected && !state.edited
    && !state.downloads && !state.exporting && !state.capturing && Date.now() - state.lastActive >= idleMs
    && !state.contents.isLoading() && !state.contents.isCurrentlyAudible() && !state.contents.isBeingCaptured();
  async function sleep(state) {
    if (state.busy || state.frozen || !eligible(state) || state.contents.debugger.isAttached()) return;
    state.busy = true;
    const revision = state.revision;
    try {
      // Conservatively protect embedded applications, media (including muted
      // playback) and populated/editable forms. No user text leaves the guest.
      const safe = await state.contents.executeJavaScript(`!document.querySelector('iframe,frame,[contenteditable="true"]') &&
        ![...document.querySelectorAll('input,textarea')].some(e=>e.type!=='hidden'&&(e.value||e.checked)) &&
        ![...document.querySelectorAll('video,audio')].some(e=>!e.paused&&!e.ended)`);
      if (!safe || !eligible(state) || state.revision !== revision || state.contents.debugger.isAttached()) return;
      state.contents.debugger.attach('1.3'); state.ownsDebugger = true;
      await state.contents.debugger.sendCommand('Page.setWebLifecycleState', { state: 'frozen' });
      state.frozen = true;
      if (!eligible(state) || state.revision !== revision) await wake(state);
    } catch (error) { console.warn('[browser sleep]', error.message); await wake(state); }
    finally { state.busy = false; }
  }
  ipcMain.handle('browser:capture-page', async (event, id, options = {}) => {
    const state = stateFor(fromUi(event, id));
    if (state.capturing) {
      const busy = new Error('SCREENSHOT_BUSY');
      busy.code = 'SCREENSHOT_BUSY';
      throw busy;
    }
    state.capturing = true;
    let timer = null;
    try {
      await wake(state);
      // Keep the guest hidden; do not attach a debugger or change global throttling.
      // capturePage can never settle when the compositor stalls. Bound it, or
      // `capturing` stays true forever and every later screenshot fails with
      // SCREENSHOT_BUSY.
      const image = await Promise.race([
        state.contents.capturePage(undefined, { stayHidden: true, stayAwake: true }),
        new Promise((_resolve, reject) => {
          timer = setTimeout(() => {
            const error = new Error('SCREENSHOT_TIMEOUT');
            error.code = 'SCREENSHOT_TIMEOUT';
            reject(error);
          }, 10_000);
        })
      ]);
      if (image.isEmpty()) {
        const empty = new Error('SCREENSHOT_EMPTY');
        empty.code = 'SCREENSHOT_EMPTY';
        throw empty;
      }
      // Downscale before base64: a 1280px frame is enough for visual judgement
      // and cuts both the bridge payload and the model's image tokens.
      const source = typeof image.getSize === 'function' ? image.getSize() : null;
      if (!source || typeof image.resize !== 'function' || typeof image.toPNG !== 'function') {
        // Older/partial nativeImage doubles: keep the legacy single-frame path.
        return { unchanged: false, hash: '', width: 0, height: 0, downscaled: false, dataUrl: image.toDataURL() };
      }
      const maxEdge = options?.fullSize ? 0 : 1280;
      const scale = maxEdge ? Math.min(1, maxEdge / Math.max(source.width, source.height)) : 1;
      const frame = scale < 1
        ? image.resize({ width: Math.max(1, Math.round(source.width * scale)), height: Math.max(1, Math.round(source.height * scale)), quality: 'good' })
        : image;
      const buffer = frame.toPNG();
      const hash = crypto.createHash('sha1').update(buffer).digest('hex');
      const size = frame.getSize();
      const payload = { width: size.width, height: size.height, hash, downscaled: scale < 1 };
      // An unchanged frame is not new evidence: skip the base64 transfer.
      if (!options?.force && state.lastCaptureHash === hash) {
        state.lastActive = Date.now();
        return { ...payload, unchanged: true };
      }
      state.lastCaptureHash = hash;
      return { ...payload, unchanged: false, dataUrl: `data:image/png;base64,${buffer.toString('base64')}` };
    } finally {
      if (timer) clearTimeout(timer);
      state.capturing = false;
      state.lastActive = Date.now();
    }
  });
  ipcMain.handle('browser:export-pdf', async (event, id) => {
    const state = stateFor(fromUi(event, id)), contents = state.contents;
    if (state.exporting) throw new Error('此页面正在导出');
    state.exporting = true;
    try {
      await wake(state);
      const revision = state.revision;
      const name = (contents.getTitle() || '网页').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
      const host = contents.hostWebContents;
      const parent = host && !host.isDestroyed() ? require('electron').BrowserWindow.fromWebContents(host) : getMainWindow();
      const result = await dialog.showSaveDialog(parent, { title: '导出网页为 PDF',
        defaultPath: path.join(app.getPath('downloads'), `${name}.pdf`), filters: [{ name: 'PDF 文档', extensions: ['pdf'] }] });
      if (result.canceled || !result.filePath) return { canceled: true };
      if (!trusted(contents) || revision !== state.revision) throw new Error('页面已跳转，请重新导出');
      const data = await contents.printToPDF({ printBackground: true, preferCSSPageSize: true });
      if (!trusted(contents) || revision !== state.revision) throw new Error('页面已跳转，请重新导出');
      await fs.writeFile(result.filePath, data);
      return { canceled: false, path: result.filePath };
    } finally { state.exporting = false; state.lastActive = Date.now(); }
  });
  app.whenReady().then(() => {
    const partition = session.fromPartition(BROWSER_PARTITION);
    partition.registerPreloadScript({ type: 'frame', filePath: path.join(__dirname, 'browser-lifecycle-preload.js'), id: 'yan-browser-lifecycle' });
    partition.on('will-download', (_event, item, contents) => {
      if (!trusted(contents)) return;
      const state = stateFor(contents); state.downloads++; void wake(state);
      item.once('done', () => { state.downloads--; state.lastActive = Date.now(); });
    });
    const timer = setInterval(() => { for (const state of tabs.values()) void sleep(state); }, scanMs);
    timer.unref();
    app.once('will-quit', () => clearInterval(timer));
  });
  return { sleep, wake, tabs };
}
module.exports = { registerBrowserLifecycle };

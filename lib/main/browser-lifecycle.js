'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function registerBrowserLifecycle({ app, ipcMain, session, webContents, dialog }, { getMainWindow, BROWSER_PARTITION,
  idleMs = 10 * 60 * 1000, scanMs = 30000 }) {
  const tabs = new Map();
  function trusted(contents) {
    const main = getMainWindow();
    return main && !main.isDestroyed() && contents && !contents.isDestroyed()
      && contents.getType() === 'webview' && contents.hostWebContents === main.webContents
      && contents.session === session.fromPartition(BROWSER_PARTITION);
  }
  function fromUi(event, id) {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('无权访问浏览器标签');
    const contents = webContents.fromId(Number(id));
    if (!trusted(contents)) throw new Error('浏览器标签已关闭');
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
  ipcMain.handle('browser:capture-page', async (event, id) => {
    const state = stateFor(fromUi(event, id));
    if (state.capturing) throw new Error('SCREENSHOT_BUSY');
    state.capturing = true;
    try {
      await wake(state);
      // Keep the guest hidden; do not attach a debugger or change global throttling.
      const image = await state.contents.capturePage(undefined, { stayHidden: true, stayAwake: true });
      if (image.isEmpty()) throw new Error('SCREENSHOT_EMPTY');
      return image.toDataURL();
    } finally { state.capturing = false; state.lastActive = Date.now(); }
  });
  ipcMain.handle('browser:export-pdf', async (event, id) => {
    const state = stateFor(fromUi(event, id)), contents = state.contents;
    if (state.exporting) throw new Error('此页面正在导出');
    state.exporting = true;
    try {
      await wake(state);
      const revision = state.revision;
      const name = (contents.getTitle() || '网页').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120);
      const result = await dialog.showSaveDialog(getMainWindow(), { title: '导出网页为 PDF',
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

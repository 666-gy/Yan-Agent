'use strict';

const { isSafeSessionId } = require('../session-store');
const SCHEME = 'yanagent';

function parseTaskLink(value) {
  if (typeof value !== 'string' || value.length > 240) return null;
  const match = /^yanagent:\/\/tasks\/(sess_[A-Za-z0-9_-]{4,160})\/?$/i.exec(value);
  return match && isSafeSessionId(match[1]) ? match[1] : null;
}

function registerProtocol(app, appRoot, runtime = process) {
  if (runtime.env.YAN_E2E_MODE === '1') return;
  if (runtime.defaultApp) {
    return app.setAsDefaultProtocolClient(SCHEME, runtime.execPath, [appRoot]);
  }
  // A portable build's extracted Electron executable is temporary. The outer
  // launcher is the persistent executable Windows must associate with links.
  if (runtime.env.PORTABLE_EXECUTABLE_FILE) {
    return app.setAsDefaultProtocolClient(SCHEME, runtime.env.PORTABLE_EXECUTABLE_FILE);
  }
  return app.setAsDefaultProtocolClient(SCHEME);
}

function registerTaskDeepLinks(ctx, { store, createWindow, focusWindow, argv = process.argv }) {
  const { app, ipcMain, windows } = ctx;
  let pending = null;
  let readyContents = null;
  let initialized = false;
  const getWindow = () => windows.getMainWindow();
  function fromMain(event) {
    const win = getWindow();
    return win && !win.isDestroyed() && event.sender === win.webContents;
  }
  function acceptArgs(args, wake = true) {
    const link = args.find(value => typeof value === 'string' && /^yanagent:/i.test(value));
    if (!link) return false;
    const sessionId = parseTaskLink(link);
    pending = sessionId ? { sessionId } : { error: '无效的任务链接' };
    if (!wake || !app.isReady()) return true;
    let win = getWindow();
    if ((!win || win.isDestroyed()) && !initialized) return true;
    if (!win || win.isDestroyed()) { readyContents = null; createWindow(); win = getWindow(); }
    focusWindow();
    if (win && !win.isDestroyed() && readyContents === win.webContents && !readyContents.isLoadingMainFrame()) {
      readyContents.send('task-link:open', pending);
      pending = null;
    }
    return true;
  }
  acceptArgs(argv, false);
  app.on('open-url', (event, url) => { event.preventDefault(); acceptArgs([url]); });
  app.on('browser-window-created', (_event, win) => {
    win.webContents.on('did-start-navigation', (_e, _url, _inPlace, mainFrame) => {
      if (mainFrame && readyContents === win.webContents) readyContents = null;
    });
  });
  ipcMain.handle('task-link:ready', event => {
    if (!fromMain(event)) return null;
    readyContents = event.sender;
    initialized = true;
    const result = pending;
    pending = null;
    if (result) focusWindow();
    return result;
  });
  ipcMain.handle('session:deep-link', async (event, id) => {
    if (!fromMain(event) || !isSafeSessionId(id)) throw new Error('任务链接不可用');
    const session = await store.readSessionRecord(id, { messageLimit: 1 });
    if (!session) throw new Error('任务不存在或已删除');
    return `${SCHEME}://tasks/${id}`;
  });
  return { acceptArgs, registerProtocol: () => registerProtocol(app, ctx.paths.appRoot) };
}

module.exports = { parseTaskLink, registerProtocol, registerTaskDeepLinks };

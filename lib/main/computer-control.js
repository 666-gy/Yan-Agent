'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { createComputerControlStore } = require('../computer-control-store');
const { createExecutableIconReader } = require('./executable-icon');

function registerComputerControlIpc(ctx) {
  const { ipcMain, windows, app, dialog, paths } = ctx;
  if (process.platform === 'win32' && ctx.BrowserWindow && ctx.screen && ctx.globalShortcut) {
    require('./computer-control-desktop').registerComputerControlDesktop(ctx);
  }
  const store = createComputerControlStore(paths.dataDir);
  const readIcon = createExecutableIconReader(app);
  const authorized = event => {
    const main = windows.getMainWindow();
    return main && !main.isDestroyed() && event.sender === main.webContents && event.senderFrame === main.webContents.mainFrame;
  };
  async function identity(item) {
    return { ...item, icon: await readIcon(item.path) };
  }
  const snapshot = async () => ({ ...store.settings(), allowedApps: await Promise.all(store.settings().allowedApps.map(identity)), apps: await Promise.all(store.list().map(identity)) });
  const handle = action => async (event, value) => {
    if (!authorized(event)) return { error: '无权管理电脑操控' };
    try { return await action(value); } catch (error) { return { error: error.message }; }
  };
  ipcMain.handle('computer-control:settings', handle(snapshot));
  ipcMain.handle('computer-control:update', handle(async partial => { store.update(partial || {}); return snapshot(); }));
  ipcMain.handle('computer-control:add-app', handle(async () => {
    const result = await dialog.showOpenDialog(windows.getMainWindow(), { title: '选择始终允许的应用', properties: ['openFile'], filters: [{ name: '应用程序', extensions: ['exe'] }] });
    if (!result.canceled && result.filePaths[0]) {
      const file = result.filePaths[0];
      if (!fs.statSync(file).isFile()) throw new Error('请选择 EXE 文件');
      store.allow(file);
    }
    return snapshot();
  }));
  ipcMain.handle('computer-control:remove-allowed', handle(async id => { store.disallow(id); return snapshot(); }));
  ipcMain.handle('computer-control:experience', handle(async id => {
    const result = store.experience(id); return { ...result, app: await identity(result.app) };
  }));
  ipcMain.handle('computer-control:download-experience', handle(async id => {
    const { app: application, markdown } = store.experience(id);
    const content = String(markdown || '').trim();
    if (!content) throw new Error('该应用暂无使用经验，无法下载');
    const safeName = String(application.name || '').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').trim().slice(0, 60) || '应用';
    const owner = windows.getMainWindow();
    const result = await dialog.showSaveDialog(owner && !owner.isDestroyed() ? owner : undefined, {
      title: '下载使用经验',
      buttonLabel: '下载',
      defaultPath: path.join(app.getPath('downloads'), `Yan-Agent-${safeName}-使用经验.md`),
      filters: [{ name: 'Markdown', extensions: ['md'] }]
    });
    if (result.canceled || !result.filePath) return { canceled: true };
    await fs.promises.writeFile(result.filePath, content.endsWith('\n') ? content : `${content}\n`, 'utf8');
    return { ok: true, path: result.filePath };
  }));
  ipcMain.handle('computer-control:record-review', handle(async payload => {
    const executable = payload?.path || payload?.executable;
    if (!executable) throw new Error('缺少应用路径');
    const appItem = store.recordReview(executable, payload?.markdown || '', payload?.name);
    return await identity(appItem);
  }));
  ipcMain.handle('computer-control:delete-experience', handle(id => store.removeApp(id)));
}
module.exports = { registerComputerControlIpc };

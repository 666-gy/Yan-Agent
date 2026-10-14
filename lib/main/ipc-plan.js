'use strict';

// IPC: plan documents (plan T1.5). Handlers moved verbatim from main.js; the
// plan root and the stable data directory arrive through the injected context.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { plansRoot } = require('../plan-document');

function registerPlanIpc(ctx) {
  const { ipcMain, app, dialog, windows, paths } = ctx;
  const stableDataDir = paths.stableDataDir;

  ipcMain.handle('plan:read-file', async (_e, payload = {}) => {
    try {
      const root = plansRoot(stableDataDir);
      const target = path.resolve(String(payload?.path || ''));
      if (!target.startsWith(root + path.sep)) return { ok: false, error: '计划文件不在 Yan 计划目录内。' };
      const content = fs.readFileSync(target, 'utf8');
      return { ok: true, name: path.basename(target), content };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  ipcMain.handle('plan:download-file', async (_e, payload = {}) => {
    try {
      const root = plansRoot(stableDataDir);
      const target = path.resolve(String(payload?.path || ''));
      if (!target.startsWith(root + path.sep)) return { error: '计划文件不在 Yan 计划目录内。' };
      const stat = await fsp.stat(target);
      if (!stat.isFile() || !stat.size) return { error: '计划文件不存在或为空。' };
      const owner = windows.fromWebContents(_e.sender);
      const result = await dialog.showSaveDialog(owner && !owner.isDestroyed() ? owner : windows.getMainWindow(), {
        title: '下载计划文件',
        buttonLabel: '下载',
        defaultPath: path.join(app.getPath('downloads'), path.basename(target)),
        filters: [{ name: 'Markdown', extensions: ['md'] }]
      });
      if (result.canceled || !result.filePath) return { ok: false, canceled: true };
      await fsp.copyFile(target, result.filePath);
      return { ok: true, path: result.filePath };
    } catch (error) {
      return { error: error?.message || String(error) };
    }
  });
}

module.exports = { registerPlanIpc };

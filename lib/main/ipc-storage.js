'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { childReadablePath } = require('../provider-staging');
const { reviewOptions } = require('../storage-stats');

function registerStorageIpc(ctx) {
  const { ipcMain } = ctx;
  let pending;
  let reviewPending;
  ipcMain.handle('storage:review', async (_event, input) => {
    try {
      const options = reviewOptions(input);
      // Serialize scans without losing the latest filter request.
      while (reviewPending) await reviewPending;
      reviewPending = new Promise(resolve => {
        execFile(process.execPath, [childReadablePath(path.join(__dirname, '..', 'storage-stats-child.js')), JSON.stringify({ dataDir: ctx.paths.dataDir, review: true, options })], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 120000, maxBuffer: 16 * 1024 * 1024
        }, (error, stdout) => {
          try { resolve(JSON.parse(stdout)); }
          catch { resolve({ ok: false, error: error?.killed ? '旧聊天扫描超时，请重试。' : '无法读取旧聊天，请重试。' }); }
        });
      });
      const current = reviewPending;
      try { return await current; } finally { if (reviewPending === current) reviewPending = null; }
    } catch (error) { return { ok: false, error: error.message }; }
  });
  ipcMain.handle('storage:stats', async () => {
    if (pending) return pending;
    pending = new Promise(resolve => {
      execFile(process.execPath, [childReadablePath(path.join(__dirname, '..', 'storage-stats-child.js')), JSON.stringify({ dataDir: ctx.paths.dataDir })], {
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 120000, maxBuffer: 1024 * 1024
      }, (error, stdout) => {
        try { resolve(JSON.parse(stdout)); }
        catch { resolve({ ok: false, error: error?.killed ? '存储扫描超时，请稍后重试。' : '无法读取存储数据，请重试。' }); }
      });
    });
    try { return await pending; } finally { pending = null; }
  });
}
module.exports = { registerStorageIpc };

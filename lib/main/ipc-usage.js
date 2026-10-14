'use strict';
const path = require('node:path');
const { execFile } = require('node:child_process');
const { normalizeOptions } = require('../usage-stats');
const { childReadablePath } = require('../provider-staging');

function registerUsageIpc(ctx) {
  const { ipcMain } = ctx;
  let cached = null, pending = null;
  ipcMain.handle('usage:stats', async (_event, input) => {
    try {
      const options = normalizeOptions(input);
      const key = JSON.stringify(options);
      if (input?.force === true) cached = null;
      if (cached?.key === key && Date.now() - cached.at < 10000) return cached.result;
      // Serialize requests so rapid filter changes cannot spawn unbounded scans.
      while (pending) await pending;
      if (cached?.key === key && Date.now() - cached.at < 10000) return cached.result;
      const job = { file: path.join(ctx.paths.dataDir, 'opencode-runtime', 'data', 'opencode', 'opencode.db'), options };
      pending = new Promise(resolve => {
        execFile(process.execPath, [childReadablePath(path.join(__dirname, '..', 'usage-stats-child.js')), JSON.stringify(job)], {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 30000, maxBuffer: 16 * 1024 * 1024
        }, (error, stdout) => {
          let result;
          try { result = JSON.parse(stdout); } catch { result = { ok: false, error: error?.killed ? 'Usage query timed out. Please retry.' : 'Could not read usage data.' }; }
          if (result.ok) cached = { key, at: Date.now(), result };
          resolve(result);
        });
      });
      const current = pending;
      try { return await current; } finally { if (pending === current) pending = null; }
    } catch (error) { return { ok: false, error: error.message }; }
  });
}
module.exports = { registerUsageIpc };

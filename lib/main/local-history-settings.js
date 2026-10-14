'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const HISTORY_AGE_MS = 30 * 24 * 60 * 60 * 1000;

function createLocalHistorySettings({ app, shell, configStore, sessionsDir, isSessionRunActive,
  platform = process.platform, run = execFile }) {
  const supported = platform === 'win32';
  // Portable Electron runs from an extracted temporary directory. Register the
  // persistent launcher, never the temporary executable that disappears on exit.
  const loginOptions = {
    path: process.env.PORTABLE_EXECUTABLE_FILE || process.execPath,
    args: app.isPackaged ? [] : [app.getAppPath()] };
  let compression = { running: false, processed: 0, error: '' };
  let job = null;
  let timer;
  function status() {
    // Electron 44's Windows launchItems matcher needs a quoted executable
    // when its path contains spaces (openAtLogin alone does not expose this).
    const login = supported ? app.getLoginItemSettings({ ...loginOptions, path: `"${loginOptions.path}"` }) : {};
    const registered = !!login.openAtLogin;
    const enabled = login.executableWillLaunchAtLogin !== false;
    return { supported, launchAtLogin: registered && enabled,
      startupBlocked: registered && !enabled,
      compressLocalHistory: configStore.loadConfig().general?.compressLocalHistory === true,
      compression: { ...compression } };
  }
  function sweep() {
    if (job) return job;
    if (!supported || configStore.loadConfig().general?.compressLocalHistory !== true) return Promise.resolve();
    compression = { running: true, processed: 0, error: '' };
    job = (async () => {
      const names = await fs.readdir(sessionsDir);
      for (const name of names) {
        if (configStore.loadConfig().general?.compressLocalHistory !== true) break;
        if (!/^sess_[A-Za-z0-9_-]{4,160}\.json$/.test(name)) continue;
        if (isSessionRunActive(name.slice(0, -5))) continue;
        const file = path.join(sessionsDir, name);
        try {
          const stat = await fs.lstat(file);
          if (!stat.isFile() || stat.mtimeMs > Date.now() - HISTORY_AGE_MS) continue;
          // NTFS compression is transparent to every existing JSON reader and
          // atomic writer. No archive replacement or deletion of originals.
          await run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'compact.exe'),
            ['/C', '/Q', file], { windowsHide: true, timeout: 60000 });
          compression.processed++;
        } catch (error) {
          if (error.code === 'ENOENT') continue; // Session deleted during sweep.
          compression.error = `压缩失败（${name}）：${error.message}`;
        }
      }
    })().catch(error => { compression.error = error.message; }).finally(() => {
      compression.running = false;
      job = null;
    });
    return job;
  }
  function update(key, enabled) {
    if (!supported) throw new Error('此功能目前仅支持 Windows。');
    if (typeof enabled !== 'boolean') throw new Error('设置值必须为布尔值。');
    if (key === 'launchAtLogin') {
      app.setLoginItemSettings({ ...loginOptions, openAtLogin: enabled, enabled });
      const current = status();
      if (current.launchAtLogin !== enabled) throw new Error(current.startupBlocked
        ? 'Windows 已禁用此启动项，请在“启动应用”中启用 Yan Agent。' : '未能修改 Windows 启动项。');
    } else if (key === 'compressLocalHistory') {
      const config = configStore.loadConfig();
      config.general = { ...config.general, compressLocalHistory: enabled };
      configStore.saveConfig(config);
      if (enabled) void sweep();
    } else throw new Error('未知设置。');
    return status();
  }
  return { status, update, sweep,
    openStartupApps: () => { if (!supported) throw new Error('仅支持 Windows。'); return shell.openExternal('ms-settings:startupapps'); },
    start() { void sweep(); timer = setInterval(() => { void sweep(); }, 6 * 60 * 60 * 1000); timer.unref(); },
    stop() { clearInterval(timer); }
  };
}

module.exports = { createLocalHistorySettings, HISTORY_AGE_MS };

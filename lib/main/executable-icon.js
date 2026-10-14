'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const run = promisify(execFile);

function createExecutableIconReader(app) {
  const cache = new Map();
  return async executable => {
    let stamp;
    try { stamp = (await fs.promises.stat(executable)).mtimeMs; } catch { return ''; }
    const key = `${executable.toLowerCase()}:${stamp}`;
    if (!cache.has(key)) {
      if (cache.size > 128) cache.clear();
      cache.set(key, (async () => {
        if (process.platform === 'win32') {
          try {
            const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(__dirname, 'executable-icon.ps1')], {
              windowsHide: true, timeout: 15000, maxBuffer: 2 * 1024 * 1024,
              env: { ...process.env, YAN_ICON_EXECUTABLE: executable },
            });
            if (/^[A-Za-z0-9+/=]+$/.test(stdout.trim())) return `data:image/png;base64,${stdout.trim()}`;
          } catch { /* Fall back for executables without an extractable resource. */ }
        }
        try { return (await app.getFileIcon(executable, { size: 'large' })).toDataURL(); } catch { return ''; }
      })());
    }
    return cache.get(key);
  };
}
module.exports = { createExecutableIconReader };

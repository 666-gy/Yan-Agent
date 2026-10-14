'use strict';
const { execFile } = require('node:child_process');
const path = require('node:path');

function captureSnapshotText(handle) {
  if (process.platform !== 'win32' || !/^\d+$/.test(String(handle))) return Promise.resolve('');
  const directory = __dirname.replace(/([\\/])app\.asar(?=[\\/]|$)/, '$1app.asar.unpacked');
  const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
  return new Promise((resolve, reject) => {
    execFile(command, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(directory, 'snapshot-text.ps1'), '-WindowHandle', String(handle)],
      { windowsHide: true, timeout: 8000, maxBuffer: 2 * 1024 * 1024, encoding: 'utf8' }, (error, stdout) => {
        if (error) reject(error);
        else resolve(stdout.trim());
      });
  });
}
module.exports = { captureSnapshotText };

'use strict';
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');
if (process.platform !== 'win32') throw new Error('The desktop GUI bridge must be built on Windows');
const framework = path.join(process.env.SystemRoot || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'lib/native/yan-desktop-bridge.exe');
const temporary = path.join(path.dirname(output), `yan-desktop-bridge-${process.pid}.tmp`);
fs.mkdirSync(path.dirname(output), { recursive: true });
try {
  execFileSync(path.join(framework, 'csc.exe'), [
  '/nologo', '/target:exe', '/optimize+', '/platform:x64', `/out:${temporary}`,
  `/reference:${path.join(framework, 'WPF/UIAutomationClient.dll')}`,
  `/reference:${path.join(framework, 'WPF/UIAutomationTypes.dll')}`,
  `/reference:${path.join(framework, 'WPF/WindowsBase.dll')}`,
  '/reference:System.Web.Extensions.dll', '/reference:System.Windows.Forms.dll',
  path.join(root, 'lib/native/desktop-agent-bridge.cs')
], { stdio: 'inherit', windowsHide: true });
  for (let attempt = 0; ; attempt++) {
    try { fs.renameSync(temporary, output); break; }
    catch (error) {
      if (attempt >= 20 || !['EPERM', 'EACCES', 'EBUSY'].includes(error.code)) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 250);
    }
  }
} finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary); }
console.log('Built Windows desktop GUI bridge');

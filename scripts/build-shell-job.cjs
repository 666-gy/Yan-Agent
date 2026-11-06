'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
execFileSync(path.join(process.env.WINDIR || 'C:/Windows', 'Microsoft.NET/Framework64/v4.0.30319/csc.exe'),
  ['/nologo', '/target:exe', '/optimize+', '/platform:x64', `/out:${path.join(root, 'lib/native/yan-shell-job.exe')}`, path.join(root, 'lib/native/shell-job.cs')],
  { stdio: 'inherit', windowsHide: true });

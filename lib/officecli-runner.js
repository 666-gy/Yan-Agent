'use strict';

const path = require('path');
const { spawn } = require('child_process');
const { ensureOfficeCli } = require('./officecli-runtime');

async function main() {
  let executable;
  try {
    executable = await ensureOfficeCli({ appRoot: path.resolve(__dirname, '..') });
  } catch (error) {
    process.stderr.write(`[Yan OfficeCLI] ${error.message}\n`);
    process.exitCode = 1;
    return;
  }
  const child = spawn(executable, process.argv.slice(2), {
    stdio: 'inherit',
    windowsHide: true,
    shell: false
  });
  child.once('error', error => {
    process.stderr.write(`[Yan OfficeCLI] 启动失败：${error.message}\n`);
    process.exitCode = 1;
  });
  child.once('exit', code => {
    process.exitCode = Number.isInteger(code) ? code : 1;
  });
}

void main();

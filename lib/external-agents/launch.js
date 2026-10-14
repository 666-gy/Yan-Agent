'use strict';
const path = require('path');
const { spawn } = require('child_process');
const { read, atomic, TERMINAL } = require('./storage');
const { environment } = require('./adapters');

function launch(dir) {
  const worker = path.join(__dirname, 'worker.js').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
  const child = spawn(process.execPath, [worker, dir], {
    detached: true, windowsHide: true, stdio: 'ignore',
    env: { ...environment(), ELECTRON_RUN_AS_NODE: '1' }
  });
  child.on('error', error => {
    const file = path.join(dir, 'state.json');
    const state = read(file);
    if (!TERMINAL.has(state.status)) atomic(file, { ...state, status: 'uncertain', error: `桌面监听进程启动失败：${error.message}` });
  });
  child.unref();
  return child.pid;
}
module.exports = { launch };

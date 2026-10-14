'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const readline = require('node:readline');

const RELEASED = 'COMPUTER_CONTROL_RELEASED: 用户已按 Esc 接回电脑控制权。当前任务没有取消；请继续整理结果或处理不需要电脑操控的步骤。不要自动重新接管电脑。';

// A separate connection controls only the native input worker, never the model run.
function createControlLease(dataDir, onRelease, owner = '') {
  let socket, opening, pending, released = false;
  function release() {
    pending?.reject(new Error(RELEASED)); pending = null;
    if (released) return;
    released = true;
    onRelease();
  }
  async function connect() {
    const endpoint = JSON.parse(fs.readFileSync(path.join(dataDir, 'computer-control', 'desktop-bridge.json'), 'utf8'));
    if (!Number.isInteger(endpoint.port) || endpoint.port < 1 || endpoint.port > 65535) throw new Error('电脑操控桌面连接无效');
    socket = net.connect(endpoint.port, '127.0.0.1');
    socket.on('error', release);
    socket.on('close', release);
    readline.createInterface({ input: socket }).on('line', line => {
      let message; try { message = JSON.parse(line); } catch { return; }
      if (message.type === 'release') release();
      if (message.type === 'ready') { released = false; pending?.resolve(); pending = null; }
      if (message.type === 'error') { pending?.reject(new Error(message.message)); pending = null; }
    });
    await new Promise((resolve, reject) => {
      socket.once('connect', resolve); socket.once('error', reject);
    });
    socket.write(JSON.stringify({ type: 'auth', token: endpoint.token, owner }) + '\n');
  }
  return {
    async acquire() {
      if (!opening) opening = connect();
      await opening;
      if (socket.destroyed) throw new Error(RELEASED);
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { release(); reject(new Error('电脑操控桌面提示层启动超时')); }, 15000);
        pending = { resolve: () => { clearTimeout(timer); resolve(); }, reject: error => { clearTimeout(timer); reject(error); } };
        socket.write('{"type":"acquire"}\n');
      });
    },
    isReleased: () => released,
    end() { if (socket && !socket.destroyed) socket.write('{"type":"end"}\n'); },
    close() { socket?.destroy(); }
  };
}
module.exports = { createControlLease, RELEASED };

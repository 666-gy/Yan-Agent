'use strict';
const { spawn } = require('node:child_process');
const path = require('node:path');
function createSnapshotMonitor({ onTargets, onGesture, onState }) {
  let child, retry, stopped = false, attempts = 0, active = false;
  function start() {
    if (stopped || child) return;
    if (process.platform !== 'win32') { onState(false, '当前系统暂不支持应用快照快捷键'); return; }
    // The child stays resident for the life of the app; going dormant is a
    // stdin message, not a shutdown, so start() only ever runs once.

    const command = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    // The child holds the low-level keyboard hook for its whole life and scans
    // only while woken, so stdin is the wake channel: closing it would end the
    // process and the hook with it, hence 'pipe' and never child.kill().
    // PowerShell cannot read Electron's virtual ASAR filesystem.
    const scriptDirectory = __dirname.replace(/([\\/])app\.asar(?=[\\/]|$)/, '$1app.asar.unpacked');
    const running = spawn(command, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', path.join(scriptDirectory, 'snapshot-monitor.ps1'), '-OwnerProcessId', String(process.pid)], { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    child = running;
    let buffer = '';
    running.stdout.setEncoding('utf8');
    running.stdout.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 1000000) { buffer = ''; return; }
      let index;
      while ((index = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1);
        try {
          const message = JSON.parse(line);
          if (message.type === 'ready') { attempts = 0; onState(message.keyboard, message.keyboard ? '' : '快捷键监听启动失败'); }
          else if (message.type === 'targets') onTargets(message.items);
          else if (message.type === 'gesture') onGesture(message.shortcut);
        } catch { /* Ignore non-protocol startup output. */ }
      }
    });
    running.stderr.on('data', () => {});
    running.on('error', () => onState(false, '应用快照监听启动失败'));
    running.on('exit', () => {
      if (child !== running) return;
      child = null; onTargets([]); onState(false, active ? '应用快照监听已断开' : '');
      if (!stopped && active && attempts++ < 3) { retry = setTimeout(start, 1000 * attempts); retry.unref(); }
    });
  }
  let sleepTimer;
  return {
    start() { active = true; start(); },
    stop() {
      stopped = true; active = false; clearTimeout(retry); clearTimeout(sleepTimer);
      if (child?.stdin?.writable) { try { child.stdin.write('quit\n'); } catch {} }
      child?.kill(); child = null;
    },
    wake() {
      clearTimeout(sleepTimer);
      if (!active) { active = true; start(); }
      else if (child?.stdin?.writable) { try { child.stdin.write('wake\n'); } catch {} }
      sleepTimer = setTimeout(() => {
        if (child?.stdin?.writable) { try { child.stdin.write('sleep\n'); } catch {} }
      }, 8000);
    },
    sleep() {
      clearTimeout(sleepTimer);
      if (child?.stdin?.writable) { try { child.stdin.write('sleep\n'); } catch {} }
    }
  };
}
module.exports = { createSnapshotMonitor };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');
const readline = require('node:readline');
const { spawn } = require('node:child_process');

function registerComputerControlDesktop({ app, BrowserWindow, screen, globalShortcut, paths, spawnCursor = spawn }) {
  const peers = new Set();
  const owners = new Map();
  const releasedRuns = new Set();
  const lifecycle = require('../computer-control-lifecycle');
  function observe(runId, event) {
    const data = event?.data || event?.properties || {};
    const tool = data.tool || data.part?.tool || '';
    const match = /^yanp_([a-f0-9]{16})_/.exec(tool);
    if (match) owners.set(match[1], runId);
  }
  function settled(runId) {
    for (const peer of peers) if (owners.get(peer.owner) === runId) {
      peer.released = true; peer.active = false; send(peer, { type: 'release' });
    }
    for (const [owner, id] of owners) if (id === runId) owners.delete(owner);
    releasedRuns.delete(runId);
    if (![...peers].some(p => p.active || p.acquiring)) hide();
  }
  lifecycle.on('tool-event', observe); lifecycle.on('run-ended', settled);
  let overlays = [], cursor, starting, escapeRegistered = false, closed = false;
  let cursorStopped = Promise.resolve();
  const token = crypto.randomBytes(32).toString('hex');
  const endpoint = path.join(paths.dataDir, 'computer-control', 'desktop-bridge.json');
  const send = (peer, message) => { if (!peer.socket.destroyed) peer.socket.write(JSON.stringify(message) + '\n'); };
  function hide() {
    for (const win of overlays) if (!win.isDestroyed()) win.destroy();
    overlays = [];
    if (escapeRegistered) globalShortcut.unregister('Escape');
    escapeRegistered = false;
    if (cursor) {
      const previous = cursor;
      cursorStopped = new Promise(resolve => {
        if (previous.exitCode !== null) resolve(); else previous.once('close', resolve);
      });
      previous.stdin.end(); cursor = null;
    }
  }
  function release() {
    for (const peer of peers) if (peer.active || peer.acquiring) {
      if (peer.runId) releasedRuns.add(peer.runId);
      peer.released = true; peer.active = false; send(peer, { type: 'release' });
    }
    hide();
  }
  function pointerFeedback(message) {
    if (!['move', 'click'].includes(message?.type) || !Number.isFinite(message.x) || !Number.isFinite(message.y)) return;
    const point = screen.screenToDipPoint({ x: message.x, y: message.y });
    for (const win of overlays) {
      if (win.isDestroyed() || win.webContents.isLoading()) continue;
      const bounds = win.getBounds();
      const event = { type: message.type, x: point.x - bounds.x, y: point.y - bounds.y };
      void win.webContents.executeJavaScript(`window.controlPointerFeedback(${JSON.stringify(event)})`).catch(() => {});
    }
  }
  async function show() {
    if (starting) return starting;
    if (overlays.length) return;
    starting = (async () => {
      await app.whenReady();
      await cursorStopped;
      if (closed) throw new Error('电脑操控已关闭');
      if (!globalShortcut.register('Escape', release)) throw new Error('Esc 退出快捷键被占用，暂不能接管电脑');
      escapeRegistered = true;
      const helper = spawnCursor('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File',
        path.join(paths.appRoot.replace(/([\\/])app\.asar([\\/]|$)/, '$1app.asar.unpacked$2'), 'lib', 'native', 'computer-control-cursor.ps1'), '-ParentPid', String(process.pid)],
      { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
      cursor = helper;
      helper.stdin.on('error', () => {});
      helper.stderr.resume();
      await new Promise((resolve, reject) => {
        const timer = setTimeout(() => { helper.stdin.end(); reject(new Error('电脑操控光标启动超时')); }, 12000);
        helper.once('error', error => { clearTimeout(timer); reject(error); });
        helper.once('exit', () => { clearTimeout(timer); reject(new Error('电脑操控光标已退出')); if (cursor === helper) release(); });
        readline.createInterface({ input: helper.stdout }).on('line', line => {
          if (line.trim() === 'ready') { clearTimeout(timer); resolve(); }
          else { try { pointerFeedback(JSON.parse(line)); } catch {} }
        });
      });
      if (cursor !== helper || closed) throw new Error('电脑操控已释放');
      await Promise.all(screen.getAllDisplays().map(async display => {
        const win = new BrowserWindow({ ...display.bounds, show: false, frame: false, transparent: true,
          backgroundColor: '#00000000', alwaysOnTop: true, skipTaskbar: true, focusable: false,
          resizable: false, movable: false, hasShadow: false,
          title: 'Yan Agent 电脑操控',
          webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
        overlays.push(win);
        win.setIgnoreMouseEvents(true);
        win.setAlwaysOnTop(true, 'screen-saver');
        win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        await win.loadFile(path.join(paths.appRoot, 'renderer', 'computer-control-overlay', 'index.html'));
        if (!win.isDestroyed()) win.showInactive();
      }));
    })().catch(error => { hide(); throw error; }).finally(() => { starting = null; });
    return starting;
  }
  const server = net.createServer(socket => {
    const peer = { socket, authorized: false, active: false, acquiring: false, released: false };
    peers.add(peer);
    socket.on('error', () => socket.destroy());
    const authTimer = setTimeout(() => { if (!peer.authorized) socket.destroy(); }, 3000);
    let buffer = '';
    socket.setEncoding('utf8');
    socket.on('data', chunk => {
      buffer += chunk;
      if (buffer.length > 4096) return socket.destroy();
      let end;
      while ((end = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, end); buffer = buffer.slice(end + 1);
        let message; try { message = JSON.parse(line); } catch { socket.destroy(); return; }
        if (!peer.authorized) {
          if (message.type !== 'auth' || message.token !== token) { socket.destroy(); return; }
          peer.owner = typeof message.owner === 'string' ? message.owner : '';
          peer.authorized = true; clearTimeout(authTimer); continue;
        }
        if (message.type === 'acquire') {
          const runId = owners.get(peer.owner);
          if (releasedRuns.has(runId) || (peer.released && (!runId || runId === peer.runId))) { send(peer, { type: 'release' }); continue; }
          peer.runId = runId; peer.released = false;
          peer.acquiring = true;
          void show().then(() => {
            if (!peer.released && !socket.destroyed) { peer.active = true; send(peer, { type: 'ready' }); }
          }).catch(error => { send(peer, { type: 'error', message: error.message }); })
            .finally(() => { peer.acquiring = false; if (![...peers].some(p => p.active || p.acquiring)) hide(); });
        } else if (message.type === 'end') {
          peer.active = false;
          if (![...peers].some(p => p.active || p.acquiring)) hide();
        }
      }
    });
    socket.on('close', () => {
      clearTimeout(authTimer); peers.delete(peer);
      if (![...peers].some(p => p.active || p.acquiring)) hide();
    });
  });
  server.on('error', error => { release(); console.error('[computer-control] desktop bridge:', error.message); });
  server.listen(0, '127.0.0.1', () => {
    server.unref(); // An idle control bridge must not keep the host alive.
    fs.mkdirSync(path.dirname(endpoint), { recursive: true });
    fs.writeFileSync(endpoint, JSON.stringify({ port: server.address().port, token }), { mode: 0o600 });
  });
  // Display changes invalidate overlay geometry; release safely instead of leaving an uncovered screen.
  let watchingDisplays = false;
  void app.whenReady().then(() => {
    if (closed) return;
    screen.on('display-added', release); screen.on('display-removed', release); screen.on('display-metrics-changed', release);
    watchingDisplays = true;
  });
  app.once('before-quit', () => {
    if (watchingDisplays) {
      screen.off('display-added', release); screen.off('display-removed', release); screen.off('display-metrics-changed', release);
    }
    lifecycle.off('tool-event', observe); lifecycle.off('run-ended', settled);
    closed = true; release(); for (const peer of peers) peer.socket.destroy(); server.close();
    try { if (JSON.parse(fs.readFileSync(endpoint, 'utf8')).token === token) fs.unlinkSync(endpoint); } catch {}
  });
  return { release };
}
module.exports = { registerComputerControlDesktop };

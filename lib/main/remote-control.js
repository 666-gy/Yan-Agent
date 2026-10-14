'use strict';

// Remote-control panel support: own the LAN WebUI host and report the address
// shown to the user.
//
// The desktop app starts the WebUI host itself (scripts/preview-webui.cjs, run
// through Electron's Node) on a port that is actually free, so `npm start`
// yields a working address without a separate manual command. The host
// announces its real port through `webui-host.json`; a manually started host
// that announces the same way is reused instead of spawning a second one.
//
// A plain 0.0.0.0 bind is not enough on Windows to decide a port is free (it
// succeeds even when another process holds 127.0.0.1:port), so availability
// also probes the loopback and LAN interfaces for an existing listener.

const { spawn } = require('node:child_process');
const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const DEFAULT_WEBUI_PORT = 4317;
const PORT_SCAN_LIMIT = 50;
const HOST_ANNOUNCE_FILE = 'webui-host.json';
const HOST_SCRIPT_RELATIVE = path.join('scripts', 'preview-webui.cjs');

function readBasePort() {
  const raw = Number.parseInt(process.env.YAN_WEBUI_PORT || '', 10);
  return Number.isInteger(raw) && raw > 0 && raw < 65536 ? raw : DEFAULT_WEBUI_PORT;
}

function isPrivateLanIPv4(address) {
  const parts = String(address || '').split('.').map(Number);
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  if (parts[0] === 10) return true;
  if (parts[0] === 192 && parts[1] === 168) return true;
  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) return true;
  return false;
}

function detectLanAddress() {
  const interfaces = os.networkInterfaces();
  const candidates = [];
  for (const list of Object.values(interfaces)) {
    for (const info of list || []) {
      if (!info || info.internal) continue;
      if (info.family !== 'IPv4' && info.family !== 4) continue;
      const address = String(info.address || '');
      if (!address || address.startsWith('169.254.')) continue;
      candidates.push(address);
    }
  }
  return candidates.find(isPrivateLanIPv4) || candidates[0] || '';
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === 'EPERM';
  }
}

// A running LAN host writes { port, pid } next to the bridge file. A stale
// announcement (dead pid or bad payload) is ignored.
function readRunningHost(dataDir) {
  if (!dataDir) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(dataDir, HOST_ANNOUNCE_FILE), 'utf8'));
    const port = Number(parsed?.port);
    if (!Number.isInteger(port) || port <= 0 || port > 65535) return null;
    const pid = Number(parsed?.pid) || 0;
    if (pid && !isProcessAlive(pid)) return null;
    return { port, pid };
  } catch {
    return null;
  }
}

function canBind(port) {
  return new Promise(resolve => {
    const server = net.createServer();
    let settled = false;
    const finish = free => {
      if (settled) return;
      settled = true;
      server.removeAllListeners();
      try { server.close(() => resolve(free)); } catch { resolve(free); }
    };
    server.once('error', () => finish(false));
    server.once('listening', () => finish(true));
    try { server.listen({ port, host: '0.0.0.0', exclusive: true }); } catch { finish(false); }
  });
}

function canConnect(host, port) {
  return new Promise(resolve => {
    const socket = net.connect({ host, port });
    let settled = false;
    const finish = occupied => {
      if (settled) return;
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(occupied);
    };
    socket.setTimeout(400);
    socket.once('connect', () => finish(true));
    socket.once('timeout', () => finish(false));
    socket.once('error', () => finish(false));
  });
}

async function isPortFree(port) {
  if (!(await canBind(port))) return false;
  for (const host of ['127.0.0.1', detectLanAddress()].filter(Boolean)) {
    // eslint-disable-next-line no-await-in-loop
    if (await canConnect(host, port)) return false;
  }
  return true;
}

async function findFreePort(basePort) {
  for (let offset = 0; offset <= PORT_SCAN_LIMIT; offset += 1) {
    const port = basePort + offset;
    if (port > 65535) break;
    // eslint-disable-next-line no-await-in-loop
    if (await isPortFree(port)) return { port, changed: offset > 0 };
  }
  return { port: basePort, changed: false, exhausted: true };
}

function addressFor(host, port) {
  return `http://${host}:${port}`;
}

function waitForAnnounce(dataDir, timeoutMs) {
  return new Promise(resolve => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      const host = readRunningHost(dataDir);
      if (host) return resolve(host.port);
      if (Date.now() >= deadline) return resolve(0);
      setTimeout(tick, 150);
    };
    tick();
  });
}

function createRemoteControl({ ipcMain, dataDir, appRoot } = {}) {
  let child = null;
  let starting = null;
  let spawnAttempted = false;

  function hostScript() {
    if (!appRoot) return '';
    const packaged = path.join(appRoot, HOST_SCRIPT_RELATIVE);
    // In a packaged build the app root lives inside app.asar, which a spawned
    // process cannot execute; the scripts are unpacked next to it.
    const unpacked = packaged.replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
    const candidates = unpacked === packaged ? [packaged] : [unpacked, packaged];
    for (const candidate of candidates) {
      try { if (fs.existsSync(candidate)) return candidate; } catch { /* ignore */ }
    }
    return '';
  }

  function stop() {
    const running = child;
    child = null;
    if (!running || !isProcessAlive(running.pid)) return;
    try { running.kill(); } catch { /* ignore */ }
  }

  async function ensureHost() {
    const announced = readRunningHost(dataDir);
    if (announced) return { running: true, port: announced.port, managed: child?.pid === announced.pid };
    if (child && isProcessAlive(child.pid)) {
      const port = await waitForAnnounce(dataDir, 4000);
      if (port) return { running: true, port, managed: true };
    }
    if (starting) return starting;
    const script = hostScript();
    if (!script) return { running: false, port: 0, managed: false };
    starting = (async () => {
      const { port } = await findFreePort(readBasePort());
      const env = { ...process.env, ELECTRON_RUN_AS_NODE: '1', YAN_WEBUI_PORT: String(port) };
      if (dataDir) env.YAN_WEBUI_DATA_DIR = dataDir;
      const launched = spawn(process.execPath, [script], { cwd: path.dirname(script), env, stdio: 'ignore', windowsHide: true });
      child = launched;
      spawnAttempted = true;
      launched.once('exit', () => { if (child === launched) child = null; });
      launched.once('error', () => { if (child === launched) child = null; });
      const announcedPort = await waitForAnnounce(dataDir, 8000);
      if (!announcedPort) {
        try { launched.kill(); } catch { /* ignore */ }
        if (child === launched) child = null;
        return { running: false, port: 0, managed: false };
      }
      return { running: true, port: announcedPort, managed: true };
    })().finally(() => { starting = null; });
    return starting;
  }

  ipcMain.handle('remote-control:info', async () => {
    try {
      const ip = detectLanAddress();
      const host = ip || '127.0.0.1';
      const managed = await ensureHost();
      if (managed.running) {
        return {
          ok: true,
          ip,
          host,
          port: managed.port,
          changed: false,
          running: true,
          managed: !!managed.managed,
          address: addressFor(host, managed.port),
          lan: !!ip
        };
      }
      const { port, changed, exhausted } = await findFreePort(readBasePort());
      return {
        ok: true,
        ip,
        host,
        port,
        changed: !!changed,
        exhausted: !!exhausted,
        running: false,
        attempted: spawnAttempted,
        address: addressFor(host, port),
        lan: !!ip
      };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });

  return { stop };
}

module.exports = {
  createRemoteControl,
  detectLanAddress,
  findFreePort,
  isPortFree,
  isPrivateLanIPv4,
  readRunningHost
};

'use strict';

const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

let nuphusProcess = null;
let activeHwnd = null;
let initialized = false;
let initPromise = null;
let requestId = 0;
const pending = new Map();
let stdoutBuffer = '';

function defaultNuphusCli() {
  const candidate = path.join(__dirname, '..', 'node_modules', '@nuphus', 'nuphus-mcp', 'bin', 'cli.js');
  return fs.existsSync(candidate) ? candidate : null;
}

function onStdoutData(chunk) {
  stdoutBuffer += chunk.toString();
  const lines = stdoutBuffer.split('\n');
  stdoutBuffer = lines.pop();
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id != null && pending.has(msg.id)) {
        const cb = pending.get(msg.id);
        pending.delete(msg.id);
        cb(msg);
      }
    } catch (err) {
      // Ignore non-JSON lines (logs/debug).
    }
  }
}

async function handshake() {
  if (initialized) return true;
  if (!nuphusProcess) return false;
  return new Promise((resolve) => {
    const id = ++requestId;
    pending.set(id, (msg) => {
      if (msg.result) {
        initialized = true;
        // Complete the MCP initialization handshake.
        nuphusProcess.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
        resolve(true);
      } else {
        console.error('[computer-control-bridge] nuphus-mcp initialize failed:', msg.error);
        resolve(false);
      }
    });
    nuphusProcess.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: { protocolVersion: '2024-11-05', capabilities: {}, clientInfo: { name: 'yan-computer-control' } }
      }) + '\n'
    );
    setTimeout(() => {
      if (!initialized) {
        pending.delete(id);
        resolve(false);
      }
    }, 10000);
  });
}

function startNuphusMcp() {
  if (nuphusProcess) return nuphusProcess;

  const localCli = defaultNuphusCli();
  const nuphusCommand = process.env.NUPHUS_MCP_COMMAND || (localCli ? process.execPath : 'npx');
  const nuphusArgs = process.env.NUPHUS_MCP_ARGS
    ? process.env.NUPHUS_MCP_ARGS.split(' ')
    : (localCli ? [localCli] : ['-y', '@nuphus/nuphus-mcp']);

  try {
    // Quote the command on Windows so paths containing spaces (e.g. TRAE SOLO CN)
    // are handled correctly by cmd.exe.
    const command = process.platform === 'win32' ? `"${nuphusCommand}"` : nuphusCommand;
    nuphusProcess = spawn(command, nuphusArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    nuphusProcess.stderr.on('data', (d) => console.error('[nuphus-mcp]', d.toString()));
    nuphusProcess.stdout.on('data', onStdoutData);
    nuphusProcess.on('exit', (code) => {
      console.log('[nuphus-mcp] exited', code);
      nuphusProcess = null;
      initialized = false;
      initPromise = null;
      stdoutBuffer = '';
    });

    initPromise = handshake();
  } catch (err) {
    console.error('[computer-control-bridge] failed to start nuphus-mcp:', err);
  }

  return nuphusProcess;
}

function stopNuphusMcp() {
  if (nuphusProcess) {
    try { nuphusProcess.stdin.end(); } catch {}
    try { nuphusProcess.kill(); } catch {}
    nuphusProcess = null;
    initialized = false;
    initPromise = null;
    stdoutBuffer = '';
  }
}

async function callNuphus(toolName, args) {
  startNuphusMcp();
  if (!nuphusProcess) {
    throw new Error('nuphus-mcp process not available');
  }
  if (initPromise) {
    const ok = await initPromise;
    if (!ok) throw new Error('nuphus-mcp initialization failed');
    initPromise = null;
  }

  return new Promise((resolve, reject) => {
    const id = ++requestId;
    pending.set(id, (msg) => {
      if (msg.error) {
        return reject(new Error(msg.error.message || JSON.stringify(msg.error)));
      }
      const text = msg.result?.content?.[0]?.text;
      let parsed = null;
      if (text) {
        try {
          parsed = JSON.parse(text);
        } catch {
          parsed = text;
        }
      }
      if (parsed && parsed.isError) {
        return reject(new Error(parsed.message || String(text)));
      }
      resolve({ result: msg.result, text, parsed });
    });
    nuphusProcess.stdin.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: 'tools/call',
        params: { name: toolName, arguments: args || {} }
      }) + '\n'
    );
    setTimeout(() => {
      if (pending.has(id)) {
        pending.delete(id);
        reject(new Error(`nuphus-mcp timeout calling ${toolName}`));
      }
    }, 20000);
  });
}

function setActiveHwnd(hwnd) {
  activeHwnd = hwnd;
}

// nuphus-mcp does not expose a foreground-window query, so we conservatively
// return true. The host always calls setForeground before actions anyway.
async function isForeground() {
  return true;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function guardedExec(execFn) {
  if (!activeHwnd) return { ok: false, error: 'no active hwnd' };
  const foreground = await isForeground(activeHwnd);
  if (!foreground) {
    await setForeground(activeHwnd);
    await sleep(150);
  }
  return execFn();
}

async function findWindow(title) {
  try {
    const res = await callNuphus('desktop_windows_list', {});
    const list = Array.isArray(res.parsed) ? res.parsed : [];
    const needle = String(title).toLowerCase();
    const win = list.find((w) => String(w.title || '').toLowerCase().includes(needle));
    return { hwnd: win ? win.hwnd : null, title: win ? win.title : title };
  } catch (err) {
    console.error('[computer-control-bridge] findWindow failed:', err.message);
    return { hwnd: null, title };
  }
}

async function setForeground(hwnd) {
  try {
    const res = await callNuphus('desktop_window_activate', { hwnd: Number(hwnd) });
    const parsed = res.parsed || {};
    return { ok: parsed.activated === true };
  } catch (err) {
    console.error('[computer-control-bridge] setForeground failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function getWindowBounds(hwnd) {
  try {
    const res = await callNuphus('desktop_window_info', { hwnd: Number(hwnd) });
    const parsed = res.parsed || {};
    const w = parsed.window || {};
    return {
      x: typeof w.x === 'number' ? w.x : 0,
      y: typeof w.y === 'number' ? w.y : 0,
      width: typeof w.width === 'number' ? w.width : 0,
      height: typeof w.height === 'number' ? w.height : 0,
      visible: !!parsed.visible && !parsed.minimized
    };
  } catch (err) {
    console.error('[computer-control-bridge] getWindowBounds failed:', err.message);
    return { x: 0, y: 0, width: 0, height: 0, visible: false, error: err.message };
  }
}

async function sendClick(hwnd, x, y) {
  try {
    // desktop_mouse uses absolute screen coordinates. The host is expected to
    // activate the window first; we also activate here as a safety net.
    await setForeground(hwnd);
    const res = await callNuphus('desktop_mouse', {
      action: 'click',
      x: Math.round(x),
      y: Math.round(y),
      button: 'left'
    });
    return { ok: true, ...res.parsed };
  } catch (err) {
    console.error('[computer-control-bridge] sendClick failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendType(hwnd, text) {
  try {
    const res = await callNuphus('desktop_input', {
      mode: 'type',
      hwnd: Number(hwnd),
      text: String(text),
      send: 'none'
    });
    return { ok: true, ...res.parsed };
  } catch (err) {
    console.error('[computer-control-bridge] sendType failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function sendKey(hwnd, key) {
  try {
    const keys = String(key)
      .split('+')
      .map((k) => k.trim())
      .filter(Boolean);
    const res = await callNuphus('desktop_input', {
      mode: 'hotkey',
      hwnd: Number(hwnd),
      keys
    });
    return { ok: true, ...res.parsed };
  } catch (err) {
    console.error('[computer-control-bridge] sendKey failed:', err.message);
    return { ok: false, error: err.message };
  }
}

async function takeScreenshot(hwnd) {
  try {
    const res = hwnd
      ? await callNuphus('desktop_window_screenshot', { hwnd: Number(hwnd) })
      : await callNuphus('desktop_screenshot', {});
    const parsed = res.parsed || {};
    return {
      ok: !!parsed.data,
      image: parsed.data ? parsed : null
    };
  } catch (err) {
    console.error('[computer-control-bridge] takeScreenshot failed:', err.message);
    return { ok: false, image: null, error: err.message };
  }
}

module.exports = {
  startNuphusMcp,
  stopNuphusMcp,
  findWindow,
  setForeground,
  getWindowBounds,
  sendClick,
  sendType,
  sendKey,
  takeScreenshot,
  guardedExec,
  setActiveHwnd,
  isForeground
};

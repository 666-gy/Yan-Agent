'use strict';

const { spawn } = require('child_process');

let nuphusProcess = null;
let activeHwnd = null;

function startNuphusMcp() {
  if (nuphusProcess) return nuphusProcess;

  const nuphusCommand = process.env.NUPHUS_MCP_COMMAND || 'npx';
  const nuphusArgs = process.env.NUPHUS_MCP_ARGS
    ? process.env.NUPHUS_MCP_ARGS.split(' ')
    : ['-y', 'github:mrpulor-gh/nuphus-mcp'];

  try {
    nuphusProcess = spawn(nuphusCommand, nuphusArgs, {
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: process.platform === 'win32'
    });

    nuphusProcess.stderr.on('data', (d) => console.error('[nuphus-mcp]', d.toString()));
    nuphusProcess.on('exit', (code) => {
      console.log('[nuphus-mcp] exited', code);
      nuphusProcess = null;
    });
  } catch (err) {
    console.error('[computer-control-bridge] failed to start nuphus-mcp:', err);
  }

  return nuphusProcess;
}

function stopNuphusMcp() {
  if (nuphusProcess) {
    try { nuphusProcess.kill(); } catch {}
    nuphusProcess = null;
  }
}

function setActiveHwnd(hwnd) {
  activeHwnd = hwnd;
}

async function isForeground(hwnd) {
  // Placeholder: will call Windows API GetForegroundWindow in Task 7.
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

// Placeholders: real Windows API / nuphus-mcp calls will be wired in Task 7.
async function findWindow(title) { return { hwnd: null, title }; }
async function setForeground(hwnd) { return { ok: false }; }
async function getWindowBounds(hwnd) { return { x: 0, y: 0, width: 0, height: 0, visible: false }; }
async function sendClick(hwnd, x, y) { return { ok: false }; }
async function sendType(hwnd, text) { return { ok: false }; }
async function sendKey(hwnd, key) { return { ok: false }; }
async function takeScreenshot(hwnd) { return { ok: false, image: null }; }

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

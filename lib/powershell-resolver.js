const fs = require('fs');
const path = require('path');

const PREFERRED_POWERSHELL_VERSION = '7.6.5';
let cachedPowerShellResolution = null;

function detectPowerShellVersion(command) {
  try {
    const result = require('child_process').spawnSync(command, ['-NoLogo', '-NoProfile', '-Command', '$PSVersionTable.PSVersion.ToString()'], {
      encoding: 'utf8', windowsHide: true, timeout: 2_000
    });
    return String(result.stdout || '').trim().split(/\r?\n/).at(-1) || '';
  } catch {
    return '';
  }
}

function windowsPowerShellCandidates() {
  const candidates = [
    process.env.YAN_POWERSHELL_PATH,
    process.env.YAN_POWERSHELL_765_PATH,
    process.resourcesPath && path.join(process.resourcesPath, 'powershell', '7.6.5', 'pwsh.exe'),
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'PowerShell', '7', 'pwsh.exe')
  ].filter(Boolean);
  try {
    const result = require('child_process').spawnSync('where.exe', ['pwsh.exe'], { encoding: 'utf8', windowsHide: true, timeout: 2_000 });
    candidates.push(...String(result.stdout || '').split(/\r?\n/).map(value => value.trim()).filter(Boolean));
  } catch {
    // `where.exe` is unavailable only on non-standard Windows environments.
  }
  return [...new Set(candidates)];
}

/**
 * Resolve a usable system shell without bundling a PowerShell runtime.
 * Prefer 7.6.5 when installed, then any installed PowerShell 7.x, and
 * finally Windows PowerShell so the external terminal remains available
 * on clean PCs.
 */
function resolvePowerShell() {
  if (process.platform !== 'win32') {
    return { command: process.env.SHELL || 'bash', args: [], label: '终端', version: '' };
  }

  if (cachedPowerShellResolution) return cachedPowerShellResolution;
  const candidates = windowsPowerShellCandidates()
    .filter(candidate => fs.existsSync(candidate));
  const inspected = candidates.map(command => ({ command, version: detectPowerShellVersion(command) }));
  const preferred = inspected.find(item => item.version === PREFERRED_POWERSHELL_VERSION)
    || inspected.find(item => /^7\./.test(item.version));
  if (preferred) {
    cachedPowerShellResolution = { command: preferred.command, args: ['-NoProfile'], label: '终端', version: preferred.version };
    return cachedPowerShellResolution;
  }

  // Windows PowerShell ships with Windows and is a reliable final fallback.
  const legacy = `${process.env.SystemRoot || 'C:\\Windows'}\\System32\\WindowsPowerShell\\v1.0\\powershell.exe`;
  if (fs.existsSync(legacy)) {
    cachedPowerShellResolution = { command: legacy, args: ['-NoLogo', '-NoProfile'], label: '终端', version: detectPowerShellVersion(legacy) };
    return cachedPowerShellResolution;
  }
  throw new Error('未找到可用的系统终端。请安装 PowerShell 后重试。');
}

function resolveWindowsPowerShell() {
  return resolvePowerShell();
}

module.exports = {
  resolvePowerShell,
  resolveWindowsPowerShell
};

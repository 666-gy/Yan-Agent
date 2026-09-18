'use strict';

// Ghidra headless integration. Ghidra is NOT bundled: the tools probe for an
// installation (GHIDRA_INSTALL_DIR env, then common locations) and degrade to
// an actionable "not installed" result, so agents get a clean signal instead
// of a spawn crash.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');

const HEADLESS_TIMEOUT_MS = 10 * 60_000;

function headlessCommand(headless, args) {
  if (process.platform !== 'win32') return { command: headless, args, options: {} };
  const env = { ...process.env };
  const values = [headless, ...args];
  // Environment expansion avoids inserting user paths into cmd syntax.
  const quoted = values.map((value, index) => {
    if (/["\r\n\0]/.test(value)) throw new Error('Invalid quote or newline in Ghidra argument.');
    env[`YAN_GHIDRA_ARG_${index}`] = value;
    return `"%YAN_GHIDRA_ARG_${index}%"`;
  });
  return {
    command: process.env.ComSpec || 'C:\\Windows\\System32\\cmd.exe',
    args: ['/d', '/v:off', '/s', '/c', `"${quoted.join(' ')}"`],
    options: { env, windowsVerbatimArguments: true }
  };
}

function candidateInstallDirs() {
  const candidates = [];
  if (process.env.GHIDRA_INSTALL_DIR) candidates.push(process.env.GHIDRA_INSTALL_DIR);
  const roots = ['C:\\', 'C:\\Program Files', 'C:\\Program Files (x86)', path.join(os.homedir(), 'Downloads'), os.homedir(), 'D:\\'];
  for (const root of roots) {
    try {
      for (const entry of fs.readdirSync(root)) {
        if (/^ghidra[_-]?[\d_.]+/i.test(entry)) candidates.push(path.join(root, entry));
      }
    } catch {}
  }
  return candidates;
}

// Returns { ok, headless, projectSupport } or { ok: false, reason, hint }.
function detectGhidra() {
  for (const directory of candidateInstallDirs()) {
    try {
      if (!fs.statSync(directory).isDirectory()) continue;
    } catch { continue; }
    const headless = process.platform === 'win32'
      ? path.join(directory, 'support', 'analyzeHeadless.bat')
      : path.join(directory, 'support', 'analyzeHeadless');
    if (fs.existsSync(headless)) {
      return { ok: true, headless, projectSupport: directory };
    }
  }
  return {
    ok: false,
    reason: 'Ghidra installation not found.',
    hint: 'Install Ghidra (https://ghidra-sre.org/) and set GHIDRA_INSTALL_DIR, or place it under C:\\ / Program Files.'
  };
}

// Runs analyzeHeadless with the vendored DecompileAll script and reads the
// emitted decompilation text. projectId doubles as the on-disk project name.
function decompile(binaryPath, { timeoutMs = HEADLESS_TIMEOUT_MS, functions = '' } = {}) {
  return new Promise(resolve => {
    const detection = detectGhidra();
    if (!detection.ok) return resolve({ ok: false, ...detection });
    const source = path.resolve(String(binaryPath || ''));
    if (!fs.existsSync(source)) return resolve({ ok: false, reason: `binary not found: ${source}` });

    const labDir = path.dirname(source);
    const projectDir = path.join(labDir, '.ghidra-project');
    const projectName = 'yan-reverser';
    const outputFile = path.join(labDir, `.ghidra-decompile-${path.basename(source)}.txt`);
    fs.mkdirSync(projectDir, { recursive: true });

    const args = [
      projectDir, projectName,
      '-import', source,
      '-scriptPath', path.join(__dirname, 'ghidra-scripts'),
      '-postScript', 'DecompileAll.py', outputFile, String(functions || ''),
      '-deleteProject'
    ];
    const launch = headlessCommand(detection.headless, args);
    execFile(launch.command, launch.args, {
      ...launch.options,
      timeout: timeoutMs,
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true
    }, error => {
      try {
        if (!fs.existsSync(outputFile)) {
          return resolve({ ok: false, reason: error?.message || 'Ghidra produced no decompilation output.' });
        }
        const text = fs.readFileSync(outputFile, 'utf8');
        fs.rmSync(outputFile, { force: true });
        resolve({ ok: true, path: source, decompilation: text });
      } catch (readError) {
        resolve({ ok: false, reason: readError?.message || String(readError) });
      }
    });
  });
}

module.exports = { detectGhidra, decompile, headlessCommand };

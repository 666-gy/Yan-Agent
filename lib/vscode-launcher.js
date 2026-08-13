'use strict';

const { execFile, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

function isFile(candidate, fsImpl = fs) {
  try {
    return !!candidate && fsImpl.statSync(candidate).isFile();
  } catch {
    return false;
  }
}

function isDirectory(candidate, fsImpl = fs) {
  try {
    return !!candidate && fsImpl.statSync(candidate).isDirectory();
  } catch {
    return false;
  }
}

function getVsCodeCandidates(env = process.env, platform = process.platform) {
  if (platform === 'win32') {
    const roots = [
      env.LOCALAPPDATA && path.win32.join(env.LOCALAPPDATA, 'Programs', 'Microsoft VS Code'),
      env.PROGRAMFILES && path.win32.join(env.PROGRAMFILES, 'Microsoft VS Code'),
      env['PROGRAMFILES(X86)'] && path.win32.join(env['PROGRAMFILES(X86)'], 'Microsoft VS Code'),
    ].filter(Boolean);
    return roots.map(root => path.win32.join(root, 'Code.exe'));
  }
  if (platform === 'darwin') {
    return [
      '/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code',
      '/usr/local/bin/code',
      '/opt/homebrew/bin/code',
    ];
  }
  return ['/usr/bin/code', '/usr/local/bin/code', '/snap/bin/code'];
}

function normalizeVsCodeCliCandidate(candidate, platform = process.platform) {
  const input = String(candidate || '').trim().replace(/^"|"$/g, '');
  if (!input) return [];
  if (platform !== 'win32') return [input];

  const normalized = path.win32.normalize(input);
  const name = path.win32.basename(normalized).toLowerCase();
  const parent = path.win32.dirname(normalized);
  if (path.win32.basename(parent).toLowerCase() === 'bin' && ['code', 'code.cmd', 'code.exe'].includes(name)) {
    return [path.win32.join(path.win32.dirname(parent), 'Code.exe')];
  }
  return name === 'code.exe' ? [normalized] : [];
}

function lookupVsCodeCli(platform = process.platform, execFileImpl = execFile) {
  const command = platform === 'win32' ? 'where.exe' : 'which';
  return new Promise(resolve => {
    execFileImpl(command, ['code'], { windowsHide: true }, (error, stdout) => {
      if (error) {
        resolve([]);
        return;
      }
      resolve(String(stdout || '').split(/\r?\n/u).map(line => line.trim()).filter(Boolean));
    });
  });
}

async function detectVsCode(options = {}) {
  const platform = options.platform || process.platform;
  const fsImpl = options.fsImpl || fs;
  const candidates = options.candidates || getVsCodeCandidates(options.env || process.env, platform);
  for (const candidate of candidates) {
    if (isFile(candidate, fsImpl)) {
      return { available: true, executable: candidate, source: 'install' };
    }
  }

  const cliPaths = Array.isArray(options.cliPaths)
    ? options.cliPaths
    : await lookupVsCodeCli(platform, options.execFileImpl || execFile);
  for (const cliPath of cliPaths) {
    for (const candidate of normalizeVsCodeCliCandidate(cliPath, platform)) {
      if (isFile(candidate, fsImpl)) {
        return { available: true, executable: candidate, source: 'path' };
      }
    }
  }
  return { available: false, executable: '', source: '' };
}

function buildVsCodeLaunchArgs(workspace) {
  return ['--new-window', workspace];
}

function buildExternalAppEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.ELECTRON_NO_ATTACH_CONSOLE;
  delete env.ELECTRON_ENABLE_LOGGING;
  delete env.ELECTRON_ENABLE_STACK_DUMPING;
  return env;
}

function launchDetached(executable, args, spawnImpl = spawn, env = process.env) {
  return new Promise(resolve => {
    let settled = false;
    const finish = result => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    try {
      const child = spawnImpl(executable, args, {
        cwd: path.dirname(executable),
        detached: true,
        stdio: 'ignore',
        // Code.exe is a GUI process. Hiding the child startup window also
        // hides VS Code's application window on Windows.
        windowsHide: false,
        env: buildExternalAppEnv(env),
      });
      child.once('error', error => finish({ error: error?.message || '启动 VS Code 失败' }));
      child.once('spawn', () => {
        child.unref?.();
        finish({ ok: true, pid: child.pid || null });
      });
    } catch (error) {
      finish({ error: error?.message || '启动 VS Code 失败' });
    }
  });
}

async function launchVsCode(workspace, options = {}) {
  const fsImpl = options.fsImpl || fs;
  const requested = String(workspace || '').trim();
  if (!requested || !isDirectory(requested, fsImpl)) {
    return { error: '工作区路径无效，请先在 Agent 中选择工作区' };
  }
  const resolvedWorkspace = path.resolve(requested);
  const status = options.status || await detectVsCode(options);
  if (!status.available || !status.executable) {
    return { error: '未检测到 VS Code，请先安装 Visual Studio Code' };
  }
  const args = buildVsCodeLaunchArgs(resolvedWorkspace);
  const result = await launchDetached(status.executable, args, options.spawnImpl || spawn);
  if (result.error) return result;
  return { ...result, executable: status.executable, workspace: resolvedWorkspace };
}

module.exports = {
  buildVsCodeLaunchArgs,
  buildExternalAppEnv,
  detectVsCode,
  getVsCodeCandidates,
  isDirectory,
  isFile,
  launchDetached,
  launchVsCode,
  lookupVsCodeCli,
  normalizeVsCodeCliCandidate,
};

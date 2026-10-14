import { spawn, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

// Foreground waiting is independent of process lifetime. Desktop jobs yield
// without killing their process; explicit cancellation kills the process tree.
export const BASH_DEFAULT_TIMEOUT_MS = 10000;
// Upper bound on how long a tool call waits, never on desktop process lifetime.
export const BASH_MAX_TIMEOUT_MS = 600000;
export const BASH_MAX_CAPTURE_BYTES = 1048576;
// After the tracked process exits we wait at most this long for trailing output
// to flush. We never wait for the pipe to close, because a surviving grandchild
// would keep it open indefinitely.
export const BASH_DRAIN_MS = 250;
export const BASH_TIMEOUT_MARKER = 'Command exceeded timeout of';
export const BASH_TRUNCATION_MARKER = '[output capture truncated at the in-memory safety limit]';

export function resolveBashTimeout(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return BASH_DEFAULT_TIMEOUT_MS;
  return Math.min(Math.max(Math.floor(numeric), 1), BASH_MAX_TIMEOUT_MS);
}

// Detect runnable shells in priority order. Keep explicit overrides available.
function shellKindOf(command) {
  const base = path.win32.basename(String(command)).toLowerCase();
  if (['pwsh.exe', 'pwsh', 'powershell.exe', 'powershell'].includes(base)) {
    return { kind: 'powershell', legacy: base.startsWith('powershell') };
  }
  if (['cmd.exe', 'cmd'].includes(base)) return { kind: 'cmd', legacy: false };
  return { kind: 'posix', legacy: false };
}

function probeShell(file, args) {
  try {
    if (!fs.statSync(file).isFile()) return '';
    const result = spawnSync(file, args, { encoding: 'utf8', timeout: 2000, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    return result.status === 0 ? String(result.stdout || '') : '';
  } catch { return ''; }
}

export function resolveBashShell(env = process.env, platform = process.platform, probe = probeShell) {
  const preferred = String(env.YAN_KERNEL_SHELL_PREFERENCE || '').trim();
  if (platform === 'win32' && ['git-bash', 'pwsh', 'powershell', 'cmd'].includes(preferred)) {
    const baseEnv = { ...env, YAN_KERNEL_SHELL_PREFERENCE: '', YAN_KERNEL_SHELL: '' };
    // Probe the selected family first. A command failure is not a reason to
    // switch syntax; fallback happens only when no runnable executable exists.
    try {
      return resolveBashShell(baseEnv, platform, (file, args) => {
        const name = path.win32.basename(file).toLowerCase();
        const expected = { 'git-bash': 'bash.exe', pwsh: 'pwsh.exe', powershell: 'powershell.exe', cmd: 'cmd.exe' }[preferred];
        return name === expected ? probe(file, args) : '';
      });
    } catch (error) {
      if (!String(error.message).startsWith('No runnable shell')) throw error;
      return resolveBashShell(baseEnv, platform, probe);
    }
  }
  const configured = String(env.YAN_KERNEL_SHELL || '').trim();
  if (configured) return { command: configured, ...shellKindOf(configured) };
  if (platform !== 'win32') return { command: String(env.SHELL || '').trim() || '/bin/sh', kind: 'posix', legacy: false };
  const join = path.win32.join;
  const dirs = String(env.PATH || env.Path || env.path || '').split(';').map(dir => dir.trim().replace(/^"|"$/g, '')).filter(Boolean);
  const programs = [env.ProgramFiles || 'C:\\Program Files', env['ProgramFiles(x86)'], env.LOCALAPPDATA && join(env.LOCALAPPDATA, 'Programs')].filter(Boolean);
  const gitRoots = [...programs.map(dir => join(dir, 'Git')), ...dirs.map(dir => path.win32.resolve(dir, '..'))];
  const bashCandidates = [...dirs.map(dir => join(dir, 'bash.exe')), ...gitRoots.flatMap(dir => [join(dir, 'bin', 'bash.exe'), join(dir, 'usr', 'bin', 'bash.exe')])];
  for (const file of new Set(bashCandidates)) {
    // System32/bash.exe is the WSL launcher, not Git Bash.
    if (/\\(?:System32|SysWOW64)\\/i.test(file)) continue;
    if (/GNU bash/i.test(probe(file, ['--version']))) return { command: file, kind: 'posix', legacy: false };
  }
  const pwshCandidates = [...dirs.map(dir => join(dir, 'pwsh.exe'))];
  for (const base of programs) {
    const root = join(base, 'PowerShell');
    pwshCandidates.push(join(root, '7', 'pwsh.exe'));
    try {
      for (const entry of fs.readdirSync(root).filter(name => /^7(?:[.-]|$)/.test(name)).sort().reverse()) pwshCandidates.push(join(root, entry, 'pwsh.exe'));
    } catch {}
  }
  for (const file of new Set(pwshCandidates)) {
    if (/PowerShell 7\./i.test(probe(file, ['--version']))) return { command: file, kind: 'powershell', legacy: false };
  }
  const systemRoot = env.SystemRoot || env.SYSTEMROOT || env.windir || 'C:\\Windows';
  const legacyCandidates = [...dirs.map(dir => join(dir, 'powershell.exe')), join(systemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')];
  for (const file of new Set(legacyCandidates)) {
    if (/^5\./m.test(probe(file, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '$PSVersionTable.PSVersion.ToString()']))) return { command: file, kind: 'powershell', legacy: true };
  }
  const cmdCandidates = [env.COMSPEC || env.ComSpec, join(systemRoot, 'System32', 'cmd.exe')].filter(Boolean);
  for (const file of new Set(cmdCandidates)) {
    if (probe(file, ['/d', '/c', 'ver'])) return { command: file, kind: 'cmd', legacy: false };
  }
  throw new Error('No runnable shell found (Git Bash, PowerShell 7, Windows PowerShell, cmd).');
}

// Build the argv that runs one command string in the resolved shell.
export function buildShellInvocation(shell, command) {
  const script = String(command ?? '');
  if (shell.kind === 'powershell') {
    // Force UTF-8 in both PowerShell families and request plain text streams.
    // Capture $? before another statement resets it; preserve native exit codes.
    const prologue = '$OutputEncoding=[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new($false); $LASTEXITCODE=0; ';
    const epilogue = '\n$yanCommandSucceeded=$?; if (-not $yanCommandSucceeded) { if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }; exit 1 }; exit 0';
    return { file: shell.command, args: ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-Command', `${prologue}${script}${epilogue}`], windowsVerbatimArguments: false };
  }
  if (shell.kind === 'cmd') {
    // cmd needs the whole command quoted as one argument; Node's default
    // escaping would turn embedded quotes into `\"`, which cmd cannot parse.
    return { file: shell.command, args: ['/d', '/s', '/c', `"${script}"`], windowsVerbatimArguments: true };
  }
  return { file: shell.command, args: ['-c', script], windowsVerbatimArguments: false };
}

// Kill the whole process tree. Killing only the direct child is what let
// Windows grandchildren survive the timeout and keep holding the pipe.
export function killProcessTree(child) {
  if (!child || child.pid == null) return;
  if (child.exitCode !== null || child.signalCode !== null) return;
  try {
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
      killer.on('error', () => {});
      killer.unref?.();
    } else {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        try { child.kill('SIGKILL'); } catch {}
      }
    }
  } catch {}
}

export function formatBashOutput({ output = '', exit = null, signal = null, truncated = false, timedOut = false, background = false, error = '', cancelled = false, timeoutMs = 0 } = {}) {
  let text = String(output ?? '');
  const withLine = line => {
    const separator = text && !text.endsWith('\n') ? '\n' : '';
    text += `${separator}${text ? '\n' : ''}${line}`;
  };
  if (truncated) withLine(BASH_TRUNCATION_MARKER);
  if (background) {
    withLine('Command is running in the background. Continue other work; completion will resume this task. Do not rerun this command.');
  } else if (cancelled) {
    withLine('Command cancelled by the user.');
  } else if (error) {
    withLine('Command failed to start: ' + error);
  } else if (timedOut) {
    withLine(BASH_TIMEOUT_MARKER + ' ' + timeoutMs + ' ms.');
  } else if (signal) {
    withLine(`Command terminated by signal ${signal}.`);
  } else if (exit !== null && exit !== undefined) {
    withLine(`Command exited with code ${exit}.`);
  }
  return text || '(no output)';
}

// Spawn one shell command, capture combined output up to the capture cap, and
// resolve when the launched process exits. Never waits for a grandchild to
// close the pipe. `spawnImpl` is injectable for tests.
export function buildBashEnvironment(shell, source = process.env, platform = process.platform) {
  const env = { ...source, TERM: 'dumb' };
  for (const key of Object.keys(env)) {
    if (key.startsWith('YAN_BASH_') || ['YAN_SHELL_AUTONOMY', 'YAN_SHELL_RISK_GATE'].includes(key)) delete env[key];
  }
  if (platform === 'win32' && shell.kind === 'posix' && path.win32.basename(shell.command).toLowerCase() === 'bash.exe') {
    const bin = path.win32.dirname(shell.command);
    const root = path.win32.basename(path.win32.dirname(bin)).toLowerCase() === 'usr'
      ? path.win32.resolve(bin, '../..') : path.win32.resolve(bin, '..');
    const dirs = ['usr/bin', 'mingw64/bin', 'mingw32/bin', 'bin', 'cmd']
      .map(dir => path.win32.join(root, dir)).filter(dir => fs.existsSync(dir));
    // Windows keys are case-insensitive; Node otherwise forwards only one of
    // PATH/Path. Merge them before adding Git's non-login shell utilities.
    const keys = Object.keys(env).filter(key => key.toLowerCase() === 'path');
    const inherited = keys.flatMap(key => String(env[key] || '').split(';')).filter(Boolean);
    for (const key of keys) delete env[key];
    env.PATH = [...new Set([...dirs, ...inherited])].join(';');
  }
  return env;
}

export function runBashCommand({ command, cwd, timeout, signal, shell = resolveBashShell(), spawnImpl = spawn,
  backgroundOnTimeout = false, background = false, onControl, onBackgroundComplete } = {}) {
  return new Promise((resolve, reject) => {
    const timeoutMs = resolveBashTimeout(timeout);
    const abortError = () => Object.assign(new Error('Command aborted'), { name: 'AbortError' });
    if (signal?.aborted) { reject(abortError()); return; }
    let child;
    try {
      const invocation = buildShellInvocation(shell, command);
      const env = buildBashEnvironment(shell);
      child = spawnImpl(invocation.file, invocation.args, { cwd: path.resolve(cwd || process.cwd()),
        windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'], detached: process.platform !== 'win32', env,
        ...(invocation.windowsVerbatimArguments ? { windowsVerbatimArguments: true } : {}) });
    } catch (error) { reject(error); return; }
    const chunks = [];
    let bytes = 0, truncated = false, returned = false, ended = false, backgrounded = false;
    let waitTimer, drainTimer;
    const snapshot = () => ({ output: Buffer.concat(chunks).toString('utf8'), truncated, timeoutMs });
    const cleanup = () => {
      clearTimeout(waitTimer); clearTimeout(drainTimer);
      signal?.removeEventListener('abort', onAbort);
      child.stdout?.destroy(); child.stderr?.destroy();
    };
    const complete = result => {
      if (ended) return;
      ended = true;
      cleanup();
      const value = { ...snapshot(), exit: null, signal: null, timedOut: false, ...result };
      if (backgrounded) onBackgroundComplete?.(value);
      if (!returned) {
        returned = true;
        if (result.cancelled) reject(abortError()); else resolve(value);
      }
    };
    const moveToBackground = () => {
      if (ended || returned) return false;
      backgrounded = true; returned = true;
      clearTimeout(waitTimer);
      resolve({ ...snapshot(), exit: null, signal: null, timedOut: false, background: true });
      return true;
    };
    const onAbort = () => { killProcessTree(child); complete({ cancelled: true }); };
    const append = chunk => {
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const room = BASH_MAX_CAPTURE_BYTES - bytes;
      if (room > 0) { const slice = buffer.subarray(0, room); chunks.push(slice); bytes += slice.length; }
      if (buffer.length > room) truncated = true;
    };
    child.stdout?.on('data', append); child.stderr?.on('data', append);
    child.once('error', error => complete({ error: error.message }));
    child.once('close', (exit, exitSignal) => complete({ exit, signal: exitSignal }));
    child.once('exit', (exit, exitSignal) => {
      clearTimeout(waitTimer);
      if (!ended) drainTimer = setTimeout(() => complete({ exit, signal: exitSignal }), BASH_DRAIN_MS);
    });
    signal?.addEventListener('abort', onAbort, { once: true });
    if (signal?.aborted) { onAbort(); return; }
    onControl?.({ background: moveToBackground, snapshot, pid: child.pid });
    if (background) moveToBackground();
    if (!returned) waitTimer = setTimeout(() => {
      if (backgroundOnTimeout) moveToBackground();
      else { killProcessTree(child); complete({ timedOut: true }); }
    }, timeoutMs);
  });
}

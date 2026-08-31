const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const MAX_WRITE_LENGTH = 64 * 1024;
const DEFAULT_COLS = 120;
const DEFAULT_ROWS = 30;
const PREFERRED_POWERSHELL_VERSION = '7.6.5';
let cachedPowerShellResolution = null;

let pty = null;
try {
  pty = require('node-pty');
} catch (error) {
  pty = null;
  console.error('[terminal] node-pty unavailable:', error.message);
}

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
 * finally Windows PowerShell so the terminal remains available on clean PCs.
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

/**
 * Build a child environment that preserves the user's Windows language pack.
 * Critical for ipconfig / netsh / system utilities that honor system UI language.
 *
 * We intentionally do NOT set:
 * - LANG / LC_ALL / LANGUAGE to en_*
 * - POWERSHELL_TELEMETRY_OPTOUT culture overrides
 * - chcp / OutputEncoding force to UTF-8 that would desync legacy tools
 */
function buildShellEnv(baseEnv = process.env) {
  const env = { ...baseEnv };
  // Real terminal: allow colors. ConPTY + xterm handle ANSI correctly.
  delete env.NO_COLOR;
  // Ensure TERM is a modern type so apps emit proper escape sequences.
  if (!env.TERM) env.TERM = 'xterm-256color';
  if (!env.COLORTERM) env.COLORTERM = 'truecolor';
  // Help Python print Unicode without changing Windows system locale.
  if (!env.PYTHONIOENCODING) env.PYTHONIOENCODING = 'utf-8';
  if (!env.PYTHONUTF8) env.PYTHONUTF8 = '1';
  return env;
}

function clampSize(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, Math.floor(n)));
}

class TerminalManager {
  constructor(options = {}) {
    this.defaultCwd = options.defaultCwd || os.homedir();
    this.locale = options.locale || Intl.DateTimeFormat().resolvedOptions().locale || '';
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    this.sessions = new Map();
  }

  setLocale(locale) {
    // Locale is informational for UI only. Shell inherits OS language, not this value.
    if (typeof locale === 'string' && locale.trim()) this.locale = locale.trim();
  }

  setDefaultCwd(cwd) {
    if (typeof cwd === 'string' && cwd.trim() && fs.existsSync(cwd)) {
      this.defaultCwd = cwd;
    }
  }

  create(ownerId, options = {}) {
    if (!pty) {
      return { error: '真终端依赖 node-pty 未加载。请重新安装依赖后重启应用。' };
    }

    const id = crypto.randomUUID();
    let shell;
    try {
      shell = resolvePowerShell();
    } catch (error) {
      return { error: error?.message || '系统终端不可用。' };
    }
    const cols = clampSize(options.cols, DEFAULT_COLS, 20, 400);
    const rows = clampSize(options.rows, DEFAULT_ROWS, 5, 200);
    const preferredCwd = typeof options.cwd === 'string' && options.cwd.trim() ? options.cwd.trim() : this.defaultCwd;
    const cwd = fs.existsSync(preferredCwd) ? preferredCwd : this.defaultCwd;

    const session = {
      id,
      ownerId,
      shell,
      cwd,
      cols,
      rows,
      process: null,
      ready: false,
      destroyed: false,
      restartReason: '',
      locale: this.locale,
      title: shell.label
    };
    this.sessions.set(id, session);
    this._spawn(session);
    return {
      ok: true,
      id,
      cwd: session.cwd,
      shell: shell.label,
      cols: session.cols,
      rows: session.rows,
      mode: 'pty',
      status: 'starting'
    };
  }

  /**
   * Raw PTY write — keystrokes, paste, control chars. This is the real terminal path.
   */
  write(ownerId, sessionId, data) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { error: '终端会话不存在或已结束。' };
    if (!session.process) {
      this._spawn(session);
      if (!session.process) return { error: '终端尚未就绪。' };
    }
    const input = String(data ?? '');
    if (!input) return { ok: true };
    if (Buffer.byteLength(input, 'utf8') > MAX_WRITE_LENGTH) {
      return { error: '输入内容过长。' };
    }
    try {
      session.process.write(input);
      return { ok: true };
    } catch (error) {
      return { error: `输入发送失败：${error.message}` };
    }
  }

  /**
   * Compatibility helper: run a line as if the user pressed Enter.
   * Prefer write() for interactive use.
   */
  execute(ownerId, sessionId, command) {
    const source = String(command ?? '');
    if (!source.trim()) return { error: '请输入要执行的命令。' };
    const payload = source.endsWith('\r') || source.endsWith('\n') ? source : `${source}\r`;
    return this.write(ownerId, sessionId, payload);
  }

  resize(ownerId, sessionId, cols, rows) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { error: '终端会话不存在或已结束。' };
    const nextCols = clampSize(cols, session.cols, 20, 400);
    const nextRows = clampSize(rows, session.rows, 5, 200);
    session.cols = nextCols;
    session.rows = nextRows;
    if (session.process) {
      try {
        session.process.resize(nextCols, nextRows);
      } catch (error) {
        return { error: `调整终端尺寸失败：${error.message}` };
      }
    }
    return { ok: true, cols: nextCols, rows: nextRows };
  }

  interrupt(ownerId, sessionId) {
    // Real terminal interrupt: send Ctrl+C to the PTY, do not kill the shell.
    return this.write(ownerId, sessionId, '\x03');
  }

  restart(ownerId, sessionId) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { error: '终端会话不存在或已结束。' };
    if (!session.process) {
      this._spawn(session);
      return { ok: true };
    }
    session.restartReason = 'restart';
    session.ready = false;
    this._emit(session, { type: 'state', status: 'restarting', cwd: session.cwd });
    this._terminate(session);
    return { ok: true };
  }

  destroy(ownerId, sessionId) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { ok: true };
    this._destroySession(session);
    return { ok: true };
  }

  destroyOwner(ownerId) {
    for (const session of [...this.sessions.values()]) {
      if (session.ownerId === ownerId) this._destroySession(session);
    }
  }

  dispose() {
    for (const session of [...this.sessions.values()]) this._destroySession(session);
  }

  _ownedSession(ownerId, sessionId) {
    const session = this.sessions.get(String(sessionId || ''));
    return session && session.ownerId === ownerId && !session.destroyed ? session : null;
  }

  _spawn(session) {
    if (session.destroyed || session.process || !pty) return;

    const cwd = fs.existsSync(session.cwd) ? session.cwd : this.defaultCwd;
    const env = buildShellEnv(process.env);
    let child;
    try {
      child = pty.spawn(session.shell.command, session.shell.args, {
        name: 'xterm-256color',
        cols: session.cols,
        rows: session.rows,
        cwd,
        env,
        // Windows ConPTY is required for correct Chinese UI language + Unicode I/O.
        useConpty: process.platform === 'win32',
        // Keep ConPTY cursor inheritance off for cleaner embedded UI.
        conptyInheritCursor: false
      });
    } catch (error) {
      this._emit(session, { type: 'error', message: `无法启动终端：${error.message}` });
      return;
    }

    session.process = child;
    session.ready = false;
    session.cwd = cwd;

    child.onData((data) => {
      if (session.destroyed) return;
      // node-pty already delivers a UTF-16→UTF-8 JS string via ConPTY.
      // Do not re-decode with a code-page TextDecoder.
      this._emit(session, { type: 'output', data: String(data) });
    });

    child.onExit(({ exitCode, signal }) => {
      this._handleExit(session, child, exitCode, signal);
    });

    // Ready immediately once the PTY is open. Shell banner/prompt streams as output.
    session.ready = true;
    this._emit(session, {
      type: 'ready',
      status: 'ready',
      cwd: session.cwd,
      shell: session.shell.label,
      locale: session.locale || this.locale || '',
      // Informational only — ConPTY path does not re-encode by code page.
      codePage: 0,
      mode: 'pty',
      cols: session.cols,
      rows: session.rows
    });
  }

  _handleExit(session, child, code, signal) {
    if (session.process !== child) return;
    session.process = null;
    session.ready = false;
    if (session.destroyed) return;

    const restartReason = session.restartReason;
    session.restartReason = '';
    if (restartReason) {
      this._emit(session, { type: 'interrupted', reason: restartReason, cwd: session.cwd });
      setTimeout(() => this._spawn(session), 40);
      return;
    }
    this._emit(session, {
      type: 'exit',
      status: 'exited',
      code: Number(code) || 0,
      signal: signal || '',
      cwd: session.cwd
    });
  }

  _emit(session, payload) {
    if (session.destroyed) return;
    this.onEvent(session.ownerId, { sessionId: session.id, ...payload });
  }

  _destroySession(session) {
    session.destroyed = true;
    session.restartReason = '';
    this.sessions.delete(session.id);
    this._terminate(session);
    session.process = null;
  }

  _terminate(session) {
    const child = session.process;
    if (!child) return;
    try {
      child.kill();
    } catch {
      /* already stopped */
    }
  }
}

module.exports = {
  TerminalManager,
  buildShellEnv,
  resolvePowerShell,
  resolveWindowsPowerShell,
  clampSize
};

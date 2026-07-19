const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { TextDecoder } = require('util');

const MAX_COMMAND_LENGTH = 64 * 1024;
const MAX_SESSIONS_PER_OWNER = 4;

function toBase64(value) {
  return Buffer.from(String(value || ''), 'utf8').toString('base64');
}

function fromBase64(value) {
  try {
    return Buffer.from(String(value || ''), 'base64').toString('utf8');
  } catch {
    return '';
  }
}

function decoderLabelForCodePage(codePage) {
  const cp = Number(codePage) || 65001;
  if (cp === 65001) return 'utf-8';
  if (cp === 936 || cp === 54936) return 'gb18030';
  if (cp === 950) return 'big5';
  if (cp === 932) return 'shift_jis';
  if (cp === 949) return 'euc-kr';
  if (cp >= 1250 && cp <= 1258) return `windows-${cp}`;
  return 'utf-8';
}

function resolvePowerShell() {
  if (process.platform !== 'win32') {
    return { command: 'pwsh', label: 'PowerShell' };
  }

  const candidates = [
    process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'PowerShell', '7', 'pwsh.exe'),
    process.env.SystemRoot && path.join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe')
  ].filter(Boolean);
  const command = candidates.find(candidate => fs.existsSync(candidate)) || 'powershell.exe';
  return {
    command,
    label: path.basename(command).toLowerCase().startsWith('pwsh') ? 'PowerShell 7' : 'Windows PowerShell'
  };
}

class TerminalManager {
  constructor(options = {}) {
    this.defaultCwd = options.defaultCwd || os.homedir();
    this.locale = options.locale || Intl.DateTimeFormat().resolvedOptions().locale || '';
    this.onEvent = typeof options.onEvent === 'function' ? options.onEvent : () => {};
    this.sessions = new Map();
  }

  setLocale(locale) {
    if (typeof locale === 'string' && locale.trim()) this.locale = locale.trim();
  }

  create(ownerId) {
    const ownerSessions = [...this.sessions.values()].filter(session => session.ownerId === ownerId);
    if (ownerSessions.length >= MAX_SESSIONS_PER_OWNER) {
      return { error: '终端会话数量已达到上限。' };
    }

    const id = crypto.randomUUID();
    const token = crypto.randomBytes(12).toString('hex');
    const shell = resolvePowerShell();
    const session = {
      id,
      ownerId,
      token,
      shell,
      cwd: this.defaultCwd,
      process: null,
      busy: false,
      ready: false,
      destroyed: false,
      restartReason: '',
      stdoutBuffer: Buffer.alloc(0),
      stderrBuffer: Buffer.alloc(0),
      preReadyStdout: [],
      stdoutDecoder: null,
      stderrDecoder: null,
      outputCodePage: 65001,
      locale: this.locale,
      nextCommandId: 1,
      readyPrefix: `__YAN_TERMINAL_READY_${token}__`,
      donePrefix: `__YAN_TERMINAL_DONE_${token}__`
    };
    this.sessions.set(id, session);
    this._spawn(session);
    return { ok: true, id, cwd: session.cwd, shell: shell.label, status: 'starting' };
  }

  execute(ownerId, sessionId, command) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { error: '终端会话不存在或已结束。' };
    const source = String(command ?? '');
    if (!source.trim()) return { error: '请输入要执行的命令。' };
    if (Buffer.byteLength(source, 'utf8') > MAX_COMMAND_LENGTH) {
      return { error: '命令过长，请控制在 64 KB 以内。' };
    }
    if (session.busy) return { error: '终端正在运行命令，可直接发送输入或先中断当前命令。', busy: true };

    if (!session.process || session.process.killed) this._spawn(session);
    if (!session.process?.stdin?.writable) return { error: 'PowerShell 尚未就绪，请稍后重试。' };

    const commandId = session.nextCommandId++;
    const encoded = toBase64(source);
    const script = [
      `$__yan_source=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${encoded}'))`,
      '$__yan_exit=0',
      'try { & ([ScriptBlock]::Create($__yan_source)); if (-not $?) { $__yan_exit=if (($LASTEXITCODE -is [int]) -and ($LASTEXITCODE -ne 0)) { $LASTEXITCODE } else { 1 } } } catch { [Console]::Error.WriteLine($_.Exception.Message); $__yan_exit=1 }',
      '$__yan_cwd=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))',
      `[Console]::Out.WriteLine("\`n${session.donePrefix}${commandId}|$__yan_exit|$__yan_cwd")`
    ].join(';') + '\r\n';

    session.busy = true;
    this._emit(session, { type: 'state', status: 'running', commandId, cwd: session.cwd });
    try {
      session.process.stdin.write(script, 'utf8');
      return { ok: true, commandId };
    } catch (error) {
      session.busy = false;
      return { error: `命令发送失败：${error.message}` };
    }
  }

  write(ownerId, sessionId, data) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { error: '终端会话不存在或已结束。' };
    if (!session.process?.stdin?.writable) return { error: 'PowerShell 当前不可写入。' };
    const input = String(data ?? '');
    if (Buffer.byteLength(input, 'utf8') > MAX_COMMAND_LENGTH) return { error: '输入内容过长。' };
    try {
      session.process.stdin.write(input, 'utf8');
      return { ok: true };
    } catch (error) {
      return { error: `输入发送失败：${error.message}` };
    }
  }

  interrupt(ownerId, sessionId) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { error: '终端会话不存在或已结束。' };
    if (!session.process) {
      this._spawn(session);
      return { ok: true };
    }
    session.restartReason = 'interrupt';
    session.busy = false;
    session.ready = false;
    this._emit(session, { type: 'state', status: 'restarting', cwd: session.cwd });
    this._terminate(session.process);
    return { ok: true };
  }

  restart(ownerId, sessionId) {
    const session = this._ownedSession(ownerId, sessionId);
    if (!session) return { error: '终端会话不存在或已结束。' };
    if (!session.process) {
      this._spawn(session);
      return { ok: true };
    }
    session.restartReason = 'restart';
    session.busy = false;
    session.ready = false;
    this._emit(session, { type: 'state', status: 'restarting', cwd: session.cwd });
    this._terminate(session.process);
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
    if (session.destroyed || session.process) return;
    const cwd = fs.existsSync(session.cwd) ? session.cwd : this.defaultCwd;
    const env = {
      ...process.env,
      PYTHONIOENCODING: 'utf-8',
      PYTHONUTF8: '1',
      NO_COLOR: process.env.NO_COLOR || '1'
    };
    const child = spawn(session.shell.command, ['-NoLogo', '-NoProfile', '-NoExit', '-Command', '-'], {
      cwd,
      env,
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe']
    });
    session.process = child;
    session.stdoutBuffer = Buffer.alloc(0);
    session.stderrBuffer = Buffer.alloc(0);
    session.preReadyStdout = [];
    session.stdoutDecoder = null;
    session.stderrDecoder = null;
    session.ready = false;

    child.stdout.on('data', data => this._handleStdout(session, data));
    child.stderr.on('data', data => this._handleStderr(session, data));
    child.on('error', error => {
      this._emit(session, { type: 'error', message: `无法启动 PowerShell：${error.message}` });
    });
    child.on('exit', (code, signal) => this._handleExit(session, child, code, signal));

    const locale64 = toBase64(session.locale);
    const initScript = [
      '$__yan_utf8=New-Object System.Text.UTF8Encoding($false)',
      `$__yan_locale=[Text.Encoding]::UTF8.GetString([Convert]::FromBase64String('${locale64}'))`,
      'try { $__yan_culture=[Globalization.CultureInfo]::GetCultureInfo($__yan_locale); [Threading.Thread]::CurrentThread.CurrentCulture=$__yan_culture; [Threading.Thread]::CurrentThread.CurrentUICulture=$__yan_culture; [Globalization.CultureInfo]::DefaultThreadCurrentCulture=$__yan_culture; [Globalization.CultureInfo]::DefaultThreadCurrentUICulture=$__yan_culture } catch { $__yan_culture=[Globalization.CultureInfo]::CurrentCulture }',
      '$__yan_cp=$__yan_culture.TextInfo.ANSICodePage',
      'try { $__yan_native=[Text.Encoding]::GetEncoding($__yan_cp) } catch { $__yan_cp=65001; $__yan_native=$__yan_utf8 }',
      '[Console]::InputEncoding=$__yan_utf8',
      '[Console]::OutputEncoding=$__yan_native',
      '$OutputEncoding=$__yan_native',
      "$ProgressPreference='SilentlyContinue'",
      "if ($null -ne (Get-Variable PSStyle -ErrorAction SilentlyContinue)) { $PSStyle.OutputRendering='PlainText' }",
      '$__yan_version=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($PSVersionTable.PSVersion.ToString()))',
      '$__yan_cwd=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes((Get-Location).Path))',
      '$__yan_culture64=[Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($__yan_culture.Name))',
      `[Console]::Out.WriteLine('${session.readyPrefix}'+$__yan_version+'|'+$__yan_cwd+'|'+$__yan_cp+'|'+$__yan_culture64)`
    ].join(';') + '\r\n';
    child.stdin.write(initScript, 'utf8');
  }

  _handleStdout(session, data) {
    if (session.destroyed) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    session.stdoutBuffer = Buffer.concat([session.stdoutBuffer, chunk]);
    let newline = session.stdoutBuffer.indexOf(0x0a);
    while (newline >= 0) {
      let rawLine = session.stdoutBuffer.subarray(0, newline);
      if (rawLine.at(-1) === 0x0d) rawLine = rawLine.subarray(0, rawLine.length - 1);
      session.stdoutBuffer = session.stdoutBuffer.slice(newline + 1);
      this._handleStdoutLine(session, rawLine);
      newline = session.stdoutBuffer.indexOf(0x0a);
    }

    const doneMarker = Buffer.from(session.donePrefix, 'ascii');
    if (session.stdoutBuffer.length > 256 * 1024 && session.stdoutDecoder && session.stdoutBuffer.indexOf(doneMarker) < 0) {
      const flushLength = session.stdoutBuffer.length - 4096;
      const decoded = session.stdoutDecoder.decode(session.stdoutBuffer.subarray(0, flushLength), { stream: true });
      if (decoded) this._emit(session, { type: 'output', stream: 'stdout', data: decoded });
      session.stdoutBuffer = session.stdoutBuffer.slice(flushLength);
    }
  }

  _handleStderr(session, data) {
    if (session.destroyed) return;
    const chunk = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (!session.stderrDecoder) {
      session.stderrBuffer = Buffer.concat([session.stderrBuffer, chunk]);
      return;
    }
    const decoded = session.stderrDecoder.decode(chunk, { stream: true });
    if (decoded) this._emit(session, { type: 'output', stream: 'stderr', data: decoded });
  }

  _handleStdoutLine(session, lineBuffer) {
    const readyMarker = Buffer.from(session.readyPrefix, 'ascii');
    const readyAt = lineBuffer.indexOf(readyMarker);
    if (readyAt >= 0) {
      const protocol = lineBuffer.subarray(readyAt + readyMarker.length).toString('ascii');
      const [version64, cwd64, codePage, culture64] = protocol.split('|');
      session.outputCodePage = Number(codePage) || 65001;
      const decoderLabel = decoderLabelForCodePage(session.outputCodePage);
      session.stdoutDecoder = new TextDecoder(decoderLabel, { fatal: false });
      session.stderrDecoder = new TextDecoder(decoderLabel, { fatal: false });

      for (const buffered of session.preReadyStdout) {
        const decoded = session.stdoutDecoder.decode(buffered, { stream: true });
        if (decoded) this._emit(session, { type: 'output', stream: 'stdout', data: decoded });
      }
      session.preReadyStdout = [];
      if (readyAt > 0) {
        const decoded = session.stdoutDecoder.decode(lineBuffer.subarray(0, readyAt), { stream: true });
        if (decoded) this._emit(session, { type: 'output', stream: 'stdout', data: decoded });
      }
      if (session.stderrBuffer.length) {
        const decoded = session.stderrDecoder.decode(session.stderrBuffer, { stream: true });
        session.stderrBuffer = Buffer.alloc(0);
        if (decoded) this._emit(session, { type: 'output', stream: 'stderr', data: decoded });
      }

      session.cwd = fromBase64(cwd64) || session.cwd;
      session.locale = fromBase64(culture64) || session.locale;
      session.ready = true;
      this._emit(session, {
        type: 'ready',
        status: 'ready',
        cwd: session.cwd,
        shell: session.shell.label,
        version: fromBase64(version64),
        locale: session.locale,
        codePage: session.outputCodePage
      });
      return;
    }

    const doneMarker = Buffer.from(session.donePrefix, 'ascii');
    const doneAt = lineBuffer.indexOf(doneMarker);
    if (doneAt >= 0) {
      if (doneAt > 0 && session.stdoutDecoder) {
        const decoded = session.stdoutDecoder.decode(lineBuffer.subarray(0, doneAt), { stream: true });
        if (decoded) this._emit(session, { type: 'output', stream: 'stdout', data: decoded });
      }
      const protocol = lineBuffer.subarray(doneAt + doneMarker.length).toString('ascii');
      const [commandId, exitCode, cwd64] = protocol.split('|');
      session.cwd = fromBase64(cwd64) || session.cwd;
      session.busy = false;
      this._emit(session, {
        type: 'complete',
        status: 'ready',
        commandId: Number(commandId) || 0,
        exitCode: Number(exitCode) || 0,
        cwd: session.cwd
      });
      return;
    }

    const completeLine = Buffer.concat([lineBuffer, Buffer.from('\n')]);
    if (!session.stdoutDecoder) {
      session.preReadyStdout.push(completeLine);
      return;
    }
    const decoded = session.stdoutDecoder.decode(completeLine, { stream: true });
    if (decoded) this._emit(session, { type: 'output', stream: 'stdout', data: decoded });
  }

  _handleExit(session, child, code, signal) {
    if (session.process !== child) return;
    if (session.stdoutBuffer.length && session.stdoutDecoder) {
      const decoded = session.stdoutDecoder.decode(session.stdoutBuffer, { stream: false });
      if (decoded) this._emit(session, { type: 'output', stream: 'stdout', data: decoded });
      session.stdoutBuffer = Buffer.alloc(0);
    }
    if (session.stderrDecoder) {
      const decoded = session.stderrDecoder.decode(session.stderrBuffer, { stream: false });
      if (decoded) this._emit(session, { type: 'output', stream: 'stderr', data: decoded });
      session.stderrBuffer = Buffer.alloc(0);
    }
    session.process = null;
    session.ready = false;
    session.busy = false;
    if (session.destroyed) return;

    const restartReason = session.restartReason;
    session.restartReason = '';
    if (restartReason) {
      this._emit(session, { type: 'interrupted', reason: restartReason, cwd: session.cwd });
      setTimeout(() => this._spawn(session), 40);
      return;
    }
    this._emit(session, { type: 'exit', status: 'exited', code: Number(code) || 0, signal: signal || '', cwd: session.cwd });
  }

  _emit(session, payload) {
    if (session.destroyed) return;
    this.onEvent(session.ownerId, { sessionId: session.id, ...payload });
  }

  _destroySession(session) {
    session.destroyed = true;
    session.restartReason = '';
    this.sessions.delete(session.id);
    if (session.process) this._terminate(session.process);
    session.process = null;
  }

  _terminate(child) {
    if (!child || child.killed) return;
    if (process.platform === 'win32' && child.pid) {
      const taskkill = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'taskkill.exe');
      const killer = spawn(taskkill, ['/pid', String(child.pid), '/T', '/F'], {
        windowsHide: true,
        stdio: 'ignore'
      });
      killer.on('error', () => {
        try { child.kill(); } catch { /* already stopped */ }
      });
      const fallback = setTimeout(() => {
        try { child.kill(); } catch { /* already stopped */ }
      }, 800);
      fallback.unref?.();
      return;
    }
    try { child.kill('SIGTERM'); } catch { /* already stopped */ }
  }
}

module.exports = {
  TerminalManager,
  decoderLabelForCodePage,
  fromBase64,
  resolvePowerShell,
  toBase64
};

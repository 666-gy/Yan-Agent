'use strict';

const { spawn } = require('node:child_process');
const crypto = require('node:crypto');

// Owned by the desktop, so state survives idle kernel release between turns.
class PersistentShells {
  constructor() { this.sessions = new Map(); this.closed = false; }
  async execute(id, { command, cwd, shell, env, signal, timeout = 300000 }) {
    if (this.closed) throw new Error('Persistent shell service is closed.');
    if (signal?.aborted) throw new Error('Command cancelled.');
    let session = this.sessions.get(id);
    if (!session) {
      session = this.start(id, { cwd, shell, env });
      this.sessions.set(id, session);
    }
    const run = session.queue.then(() => this.command(session, command, signal, timeout));
    session.queue = run.catch(() => {});
    return run;
  }
  start(id, { cwd, shell, env }) {
    if (shell.kind === 'cmd') throw new Error('Persistent shell requires Bash or PowerShell; select one in terminal settings.');
    const marker = `YAN_${crypto.randomBytes(16).toString('hex')}`;
    const script = shell.kind === 'powershell'
      ? `$ErrorActionPreference='Continue'; [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); while ($null -ne ($__yanLine=[Console]::ReadLine())) { $global:LASTEXITCODE=0; try { . ([scriptblock]::Create([Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($__yanLine)))) 2>&1; $__yanOk=$?; $__yanCode=if ($LASTEXITCODE -ne 0) {$LASTEXITCODE} elseif ($__yanOk) {0} else {1} } catch { [Console]::Out.WriteLine($_.ToString()); $__yanCode=1 }; [Console]::Out.WriteLine("\n${marker}:$__yanCode"); [Console]::Out.Flush() }`
      : `while IFS= read -r __yan_line; do eval "$(printf '%s' "$__yan_line" | base64 -d)" 2>&1; __yan_code=$?; printf '\\n${marker}:%s\\n' "$__yan_code"; done`;
    const args = shell.kind === 'powershell'
      ? ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')]
      : ['-c', script];
    const child = spawn(shell.command, args, { cwd, env, windowsHide: true,
      detached: process.platform !== 'win32', stdio: ['pipe', 'pipe', 'pipe'] });
    const session = { child, id, marker, pending: null, queue: Promise.resolve(), dead: false };
    const collect = data => {
      const pending = session.pending;
      if (!pending) return;
      pending.tail += data;
      const match = pending.tail.match(new RegExp(`\\r?\\n${marker}:(-?\\d+)\\r?\\n`));
      if (match) {
        pending.append(pending.tail.slice(0, match.index));
        pending.finish(null, { output: pending.output, exit: Number(match[1]), truncated: pending.truncated });
      } else if (pending.tail.length > 512) {
        pending.append(pending.tail.slice(0, -256));
        pending.tail = pending.tail.slice(-256);
      }
    };
    child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
    child.stdout.on('data', collect); child.stderr.on('data', collect);
    child.stdin.on('error', error => session.pending?.finish(error));
    child.on('error', error => { session.dead = true; session.pending?.finish(error); this.remove(session); });
    child.on('exit', code => {
      session.dead = true;
      const pending = session.pending;
      if (pending) {
        pending.append(pending.tail);
        pending.finish(new Error(`Shell exited (${code}); state was reset.\n${pending.output}`));
      }
      this.remove(session);
    });
    return session;
  }
  command(session, command, signal, timeout) {
    if (signal?.aborted) return Promise.reject(new Error('Command cancelled before execution.'));
    if (session.dead) return Promise.reject(new Error('Shell state was reset; retry the command in a new shell.'));
    return new Promise((resolve, reject) => {
      let timer;
      const cancel = () => {
        pending.finish(new Error('Command cancelled; shell state was reset.'));
        this.stop(session.id);
      };
      const pending = {
        output: '', tail: '', truncated: false,
        append(text) {
          const remaining = Math.max(0, 1048576 - this.output.length);
          this.output += text.slice(0, remaining);
          if (text.length > remaining) this.truncated = true;
        },
        finish(error, result) {
          if (session.pending !== pending) return;
          session.pending = null;
          clearTimeout(timer); signal?.removeEventListener('abort', cancel);
          if (error) reject(error); else resolve(result);
        }
      };
      session.pending = pending;
      signal?.addEventListener('abort', cancel, { once: true });
      timer = setTimeout(() => {
        pending.finish(new Error('Command timed out; shell state was reset.'));
        this.stop(session.id);
      }, Math.min(600000, Math.max(1, Number(timeout) || 300000)));
      session.child.stdin.write(Buffer.from(command, 'utf8').toString('base64') + '\n', error => {
        if (error) pending.finish(error);
      });
    });
  }
  remove(session) { if (this.sessions.get(session.id) === session) this.sessions.delete(session.id); }
  stop(id) {
    const session = this.sessions.get(id);
    if (!session) return;
    session.dead = true; this.remove(session);
    session.pending?.finish(new Error('Shell stopped; state was reset.'));
    if (process.platform === 'win32') {
      const killer = spawn('taskkill', ['/PID', String(session.child.pid), '/T', '/F'], { windowsHide: true, stdio: 'ignore' });
      killer.on('error', () => session.child.kill());
    } else {
      try { process.kill(-session.child.pid, 'SIGKILL'); } catch { session.child.kill('SIGKILL'); }
    }
  }
  close() { this.closed = true; for (const id of this.sessions.keys()) this.stop(id); }
}
module.exports = { PersistentShells };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { execFile, spawn } = require('node:child_process');

async function openExternalTerminal(target) {
  try {
    // External UI actions always open Windows PowerShell. Agent shell selection
    // belongs exclusively to kernel-bash-tool and must never affect this path.
    const selected = { command: process.platform === 'win32'
      ? path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe')
      : (process.env.SHELL || '/bin/sh') };
    const requested = target && path.resolve(target);
    const cwd = requested && fs.existsSync(requested)
      ? (fs.statSync(requested).isDirectory() ? requested : path.dirname(requested))
      : (process.env.USERPROFILE || process.cwd());
    if (process.platform !== 'win32') {
      return await new Promise(resolve => {
        const child = spawn(selected.command, ['-i'], { cwd, detached: true, stdio: 'ignore' });
        child.once('error', error => resolve({ ok: false, error: error.message }));
        child.once('spawn', () => { child.unref(); resolve({ ok: true, cwd, shell: selected.command }); });
      });
    }
    const args = ['-NoLogo', '-NoProfile', '-NoExit'];
    // All paths travel as environment values, never interpolated shell code.
    const script = '$ErrorActionPreference = "Stop"; [string[]]$argsList = $env:YAN_TERMINAL_ARGS | ConvertFrom-Json; $params = @{ FilePath = $env:YAN_TERMINAL_EXE; WorkingDirectory = $env:YAN_TERMINAL_CWD; WindowStyle = "Normal"; PassThru = $true }; if ($argsList.Count) { $params.ArgumentList = $argsList }; $p = Start-Process @params; Start-Sleep -Milliseconds 600; $p.Refresh(); if ($p.HasExited -and $p.ExitCode -ne 0) { throw "Terminal exited with code $($p.ExitCode)" }; [Console]::Write($p.Id)';
    const launcher = path.join(process.env.SystemRoot || 'C:\\Windows', 'System32/WindowsPowerShell/v1.0/powershell.exe');
    return await new Promise(resolve => {
      execFile(launcher, ['-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')], {
        cwd, windowsHide: true, timeout: 15000,
        env: { ...process.env, CHERE_INVOKING: '1', YAN_TERMINAL_ARGS: JSON.stringify(args), YAN_TERMINAL_EXE: selected.command, YAN_TERMINAL_CWD: cwd }
      }, (error, stdout, stderr) => resolve(error
        ? { ok: false, error: String(stderr || error.message).trim() }
        : { ok: true, cwd, shell: selected.command, pid: Number.parseInt(stdout, 10) || null }));
    });
  } catch (error) { return { ok: false, error: error.message }; }
}
module.exports = { openExternalTerminal };

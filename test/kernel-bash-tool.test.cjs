'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');

const modPath = path.resolve(__dirname, '..', 'lib', 'kernel-bash-tool.mjs');
let mod = null;
async function load() {
  if (!mod) mod = await import(require('node:url').pathToFileURL(modPath).href);
  return mod;
}

const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-kernel-bash-tool-'));

function writeScript(name, source) {
  const file = path.join(directory, name);
  fs.writeFileSync(file, source);
  return file;
}

test.after(() => {
  fs.rmSync(directory, { recursive: true, force: true });
});

test('resolveBashTimeout applies the documented default and ceiling', async () => {
  const { resolveBashTimeout, BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS } = await load();
  assert.equal(resolveBashTimeout(undefined), BASH_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBashTimeout(0), BASH_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBashTimeout(-5), BASH_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBashTimeout('2500'), 2500);
  assert.equal(resolveBashTimeout(900000), BASH_MAX_TIMEOUT_MS);
});

test('Git Bash direct entry gets utilities before concurrent first calls', { skip: process.platform !== 'win32' }, async t => {
  const { resolveBashShell, buildBashEnvironment } = await load();
  const { spawn } = require('node:child_process');
  const shell = resolveBashShell();
  if (shell.kind !== 'posix') return t.skip('Git Bash not installed');
  const bin = path.dirname(shell.command);
  const root = path.basename(path.dirname(bin)).toLowerCase() === 'usr' ? path.resolve(bin, '../..') : path.resolve(bin, '..');
  const direct = { ...shell, command: path.join(root, 'usr/bin/bash.exe') };
  if (!fs.existsSync(direct.command)) return t.skip('Git Bash direct entry not installed');
  const source = { SystemRoot: process.env.SystemRoot, PATH: path.join(process.env.SystemRoot, 'System32'), Path: 'C:/custom-tools', YAN_BASH_BRIDGE_TOKEN: 'private' };
  const env = buildBashEnvironment(direct, source);
  assert.equal(env.Path, undefined);
  assert.equal(env.YAN_BASH_BRIDGE_TOKEN, undefined);
  assert.ok(env.PATH.includes('C:/custom-tools'));
  await Promise.all(Array.from({ length: 10 }, () => new Promise((resolve, reject) => {
    const child = spawn(direct.command, ['-c', 'command -v head && command -v tail && command -v mkdir && command -v grep'], { env, windowsHide: true });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject);
    child.on('close', code => { try { assert.equal(code, 0, output); resolve(); } catch (error) { reject(error); } });
  })));
});

test('formatBashOutput reports exit, timeout and truncation', async () => {
  const { formatBashOutput } = await load();
  assert.match(formatBashOutput({ output: 'hello', exit: 0 }), /hello[\s\S]*Command exited with code 0\./);
  assert.match(formatBashOutput({ output: '', exit: 1 }), /Command exited with code 1\./);
  assert.match(formatBashOutput({ output: '', timedOut: true, timeoutMs: 500 }), /Command exceeded timeout of 500 ms\./);
  assert.match(formatBashOutput({ output: 'x', truncated: true, exit: 0 }), /truncated at the in-memory safety limit/);
  assert.equal(formatBashOutput({ output: '' }), '(no output)');
});

test('runBashCommand returns output and exit code for a normal command', async () => {
  const { runBashCommand } = await load();
  const script = writeScript('ok.js', 'console.log("NORMAL_OK");');
  const result = await runBashCommand({ command: `node "${script.replaceAll("\\", "/")}"`, cwd: directory, timeout: 20000 });
  assert.equal(result.timedOut, false);
  assert.equal(result.exit, 0);
  assert.match(result.output, /NORMAL_OK/);
});

// Core regression: a finished command whose background grandchild keeps stdout
// open must NOT block the tool until the timeout.
test('runBashCommand returns promptly when a grandchild keeps the pipe open', async () => {
  const { runBashCommand } = await load();
  const script = writeScript('grandchild.js', [
    "const { spawn } = require('node:child_process');",
    "const child = spawn(process.execPath, ['-e', 'setTimeout(() => {}, 2500)'], { stdio: 'inherit' });",
    'child.unref();',
    "console.log('PARENT_DONE');"
  ].join('\n'));
  const startedAt = Date.now();
  const result = await runBashCommand({ command: `node "${script.replaceAll("\\", "/")}"`, cwd: directory, timeout: 20000 });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.timedOut, false);
  assert.match(result.output, /PARENT_DONE/);
  assert.ok(elapsed < 2500, `expected prompt return, took ${elapsed}ms`);
});

test('runBashCommand times out a long command', async () => {
  const { runBashCommand } = await load();
  const script = writeScript('sleeper.js', 'setTimeout(() => {}, 8000);');
  const startedAt = Date.now();
  const result = await runBashCommand({ command: `node "${script.replaceAll("\\", "/")}"`, cwd: directory, timeout: 700 });
  const elapsed = Date.now() - startedAt;
  assert.equal(result.timedOut, true);
  assert.equal(result.timeoutMs, 700);
  assert.ok(elapsed < 4000, `expected timeout near 700ms, took ${elapsed}ms`);
});

test('runBashCommand kills the process tree on timeout', async () => {
  const { runBashCommand } = await load();
  const marker = path.join(directory, `leak-${Date.now()}.txt`);
  const script = writeScript('leaker.js', [
    "const { spawn } = require('node:child_process');",
    "spawn(process.execPath, ['-e', \"setTimeout(() => require('node:fs').writeFileSync(process.argv[1], 'leak'), 1200)\", process.argv[2]], { stdio: 'ignore' });",
    'setTimeout(() => {}, 8000);'
  ].join('\n'));
  const result = await runBashCommand({ command: `node "${script.replaceAll("\\", "/")}" "${marker.replaceAll("\\", "/")}"`, cwd: directory, timeout: 500 });
  assert.equal(result.timedOut, true);
  await new Promise(resolve => setTimeout(resolve, 1800));
  assert.equal(fs.existsSync(marker), false, 'grandchild survived the timeout kill');
});

test('resolveBashShell honors an explicit shell and platform defaults', async () => {
  const { resolveBashShell } = await load();
  assert.equal(resolveBashShell({ YAN_KERNEL_SHELL: 'C:\\tools\\cmd.exe' }, 'win32').kind, 'cmd');
  assert.equal(resolveBashShell({ YAN_KERNEL_SHELL: 'C:\\Program Files\\PowerShell\\7\\pwsh.EXE' }, 'win32').kind, 'powershell');
  const posix = resolveBashShell({ SHELL: '/bin/zsh' }, 'linux');
  assert.deepEqual([posix.kind, posix.command], ['posix', '/bin/zsh']);
  assert.equal(resolveBashShell({}, 'linux').command, '/bin/sh');
});

test('buildShellInvocation builds a PowerShell command and quotes a cmd command', async () => {
  const { buildShellInvocation } = await load();
  const ps = buildShellInvocation({ command: 'pwsh.exe', kind: 'powershell', legacy: false }, 'Write-Output hi');
  assert.deepEqual(ps.args.slice(0, 6), ['-NoLogo', '-NoProfile', '-NonInteractive', '-OutputFormat', 'Text', '-Command']);
  const decoded = ps.args[6];
  assert.match(decoded, /Write-Output hi/);
  assert.match(decoded, /exit \$LASTEXITCODE/);
  const legacy = buildShellInvocation({ command: 'powershell.exe', kind: 'powershell', legacy: true }, 'Write-Output hi');
  assert.match(legacy.args[6], /UTF8/);
  const cmd = buildShellInvocation({ command: 'cmd.exe', kind: 'cmd' }, 'echo hi');
  assert.deepEqual(cmd.args, ['/d', '/s', '/c', '"echo hi"']);
  assert.equal(cmd.windowsVerbatimArguments, true);
});


test('shell detection prioritizes Git Bash, then verified PowerShell 7, then legacy, then cmd', async () => {
  const { resolveBashShell } = await load();
  const env = { PATH: 'C:\\tools', ProgramFiles: 'C:\\apps', SystemRoot: 'C:\\Windows' };
  const available = new Map([
    ['C:\\apps\\Git\\bin\\bash.exe', 'GNU bash, version 5'],
    ['C:\\tools\\pwsh.exe', 'PowerShell 7.6.0'],
    ['C:\\tools\\powershell.exe', '5.1.0'],
    ['C:\\Windows\\System32\\cmd.exe', 'Microsoft Windows']
  ]);
  for (const [file] of [...available]) {
    assert.equal(resolveBashShell(env, 'win32', candidate => available.get(candidate) || '').command, file);
    available.delete(file);
  }
  assert.throws(() => resolveBashShell(env, 'win32', () => ''), /No runnable shell/);
  assert.equal(resolveBashShell({ YAN_KERNEL_SHELL: 'C:\\Git\\bin\\bash.exe' }, 'win32').kind, 'posix');
  const selected = resolveBashShell(env, 'win32', candidate => candidate.endsWith('pwsh.exe') ? 'PowerShell 6.2.0' : candidate.endsWith('cmd.exe') ? 'Windows' : '');
  assert.equal(selected.kind, 'cmd');
});

test('Git Bash is preferred over the WSL launcher and over any non-GNU bash', async () => {
  const { resolveBashShell } = await load();
  const env = { PATH: 'C:\\Windows\\System32;C:\\tools', ProgramFiles: 'C:\\apps', SystemRoot: 'C:\\Windows' };
  // System32\bash.exe launches WSL, so it must be skipped even though it is a
  // bash.exe on PATH; a stub bash that does not report GNU bash must not be
  // accepted either. The chain then falls through to PowerShell 7.
  const probes = new Map([
    ['C:\\Windows\\System32\\bash.exe', 'usage: bash'],
    ['C:\\tools\\bash.exe', 'usage: bash'],
    ['C:\\tools\\pwsh.exe', 'PowerShell 7.6.0']
  ]);
  const selected = resolveBashShell(env, 'win32', file => probes.get(file) || '');
  assert.equal(selected.command, 'C:\\tools\\pwsh.exe');
  assert.equal(selected.kind, 'powershell');
});

test('explicit user shell outranks auto detection and only falls back when unavailable', async () => {
  const { resolveBashShell } = await load();
  const available = new Map([
    ['C:\\tools\\bash.exe', 'GNU bash, version 5'],
    ['C:\\tools\\pwsh.exe', 'PowerShell 7.6.0'],
    ['C:\\tools\\powershell.exe', '5.1.0'],
    ['C:\\Windows\\System32\\cmd.exe', 'Microsoft Windows']
  ]);
  const env = { PATH: 'C:\\tools', SystemRoot: 'C:\\Windows' };
  for (const [preference, executable] of [['git-bash', 'bash.exe'], ['pwsh', 'pwsh.exe'], ['powershell', 'powershell.exe'], ['cmd', 'cmd.exe']]) {
    const selected = resolveBashShell({ ...env, YAN_KERNEL_SHELL: 'ignored.exe', YAN_KERNEL_SHELL_PREFERENCE: preference }, 'win32', file => available.get(file) || '');
    assert.equal(path.win32.basename(selected.command), executable);
  }
  available.delete('C:\\tools\\pwsh.exe');
  assert.equal(path.win32.basename(resolveBashShell({ ...env, YAN_KERNEL_SHELL_PREFERENCE: 'pwsh' }, 'win32', file => available.get(file) || '').command), 'bash.exe');
});

test('already aborted calls never spawn', async () => {
  const { runBashCommand } = await load();
  const controller = new AbortController(); controller.abort();
  let spawned = false;
  await assert.rejects(runBashCommand({ command: 'noop', signal: controller.signal, shell: {kind:'posix',command:'sh'}, spawnImpl() { spawned = true; } }), { name: 'AbortError' });
  assert.equal(spawned, false);
});

test('a successful exit before timeout drains without becoming a timeout', async () => {
  const { runBashCommand } = await load();
  const { EventEmitter } = require('node:events');
  const { PassThrough } = require('node:stream');
  const result = await runBashCommand({ command:'noop', timeout:100, shell:{kind:'posix',command:'sh'}, spawnImpl() {
    const child = new EventEmitter(); child.stdout = new PassThrough(); child.stderr = new PassThrough();
    setTimeout(() => { child.emit('exit',0,null); child.stdout.write('trailing output'); }, 10);
    return child;
  }});
  assert.equal(result.exit, 0);
  assert.equal(result.timedOut, false);
  assert.equal(result.output, 'trailing output');
});

test('PowerShell families preserve failure status, Unicode and plain text streams', { skip: process.platform !== 'win32' }, async () => {
  const { runBashCommand, resolveBashShell } = await load();
  const shells = [
    resolveBashShell(process.env, 'win32', (file, args) => {
      if (!file.toLowerCase().endsWith('pwsh.exe')) return '';
      const r = require('node:child_process').spawnSync(file,args,{encoding:'utf8',windowsHide:true});
      return r.status === 0 ? r.stdout : '';
    }),
    { command: path.join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe'),kind:'powershell',legacy:true }
  ];
  for (const shell of shells) {
    for (const [command, exit] of [["Write-Error 'EXPECTED_FAILURE'",1], ['node -e "process.exit(7)"',7], ["Write-Output '中文正常'; Write-Warning 'EXPECTED_WARNING'",0]]) {
      const r = await runBashCommand({command,shell,timeout:10000});
      assert.equal(r.exit,exit,JSON.stringify(r));
      assert.doesNotMatch(r.output,/CLIXML/);
      if (exit === 0) assert.match(r.output,/中文正常/);
    }
  }
});

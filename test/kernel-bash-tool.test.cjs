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

test('Git Bash pipeline preserves upstream failure', async () => {
  const { runBashCommand, resolveBashShell } = await load();
  const shell = resolveBashShell();
  if (!/bash/i.test(shell.command)) return;
  const result = await runBashCommand({ command: 'exit 7 | cat', shell, cwd: directory, timeout: 5000 });
  assert.equal(result.exit, 7);
});

test('Windows supervisor kills descendants when its desktop pipe disappears', async () => {
  if (process.platform !== 'win32') return;
  const { spawn } = require('node:child_process');
  const marker = path.join(directory, 'host-crash-leak.txt');
  const sleeper = writeScript('host-crash-child.cjs', `setTimeout(()=>require('fs').writeFileSync(${JSON.stringify(marker)},'leak'),2500);`);
  const host = writeScript('host-crash.mjs', `import {runBashCommand} from ${JSON.stringify(require('node:url').pathToFileURL(modPath).href)};await runBashCommand({command:${JSON.stringify(`node "${sleeper}"`)},background:true});console.log('READY');setInterval(()=>{},1000);`);
  const child = spawn(process.execPath, [host], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('host startup timeout')), 5000);
      child.once('error', reject);
      child.stdout.on('data', data => { if (String(data).includes('READY')) { clearTimeout(timer); resolve(); } });
    });
    await new Promise(r => setTimeout(r, 400));
    child.kill();
    await new Promise(r => setTimeout(r, 2800));
    assert.equal(fs.existsSync(marker), false);
  } finally { child.kill(); }
});

test('output capture retains latest progress after reaching its memory cap', async () => {
  const { runBashCommand, BASH_MAX_CAPTURE_BYTES } = await load();
  const source = writeScript('large-output.cjs', `process.stdout.write('x'.repeat(${2 * 1048576})+'LATEST_PROGRESS');`);
  const result = await runBashCommand({ command: `node "${source}"`, timeout: 5000 });
  assert.equal(result.exit, 0); assert.equal(result.truncated, true);
  assert.equal(Buffer.byteLength(result.output), BASH_MAX_CAPTURE_BYTES);
  assert.match(result.output, /LATEST_PROGRESS$/);
});

test('supervised Windows descendants cannot survive explicit cancellation', async () => {
  if (process.platform !== 'win32') return;
  const { runBashCommand } = await load();
  const marker = path.join(directory, 'cancelled-grandchild.txt');
  const source = writeScript('cancel-tree.cjs', `const {spawn}=require('node:child_process');spawn(process.execPath,['-e',${JSON.stringify("setTimeout(()=>require('fs').writeFileSync(process.argv[1],'leak'),2500)")},process.argv[2]],{stdio:'ignore',detached:true}); console.log('CHILD_STARTED');setInterval(()=>{},1000);`);
  const controller = new AbortController();
  let completion;
  const done = new Promise(resolve => { completion = resolve; });
  await runBashCommand({ command: `node "${source}" "${marker}"`, cwd: directory, background: true,
    signal: controller.signal, onBackgroundComplete: completion });
  await new Promise(resolve => setTimeout(resolve, 600));
  controller.abort();
  const result = await done;
  assert.equal(result.cancelled, true);
  await new Promise(resolve => setTimeout(resolve, 2700));
  assert.equal(fs.existsSync(marker), false);
});

test('resolveBashTimeout applies the documented default and ceiling', async () => {
  const { resolveBashTimeout, BASH_DEFAULT_TIMEOUT_MS, BASH_MAX_TIMEOUT_MS } = await load();
  assert.equal(resolveBashTimeout(undefined), BASH_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBashTimeout(0), BASH_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBashTimeout(-5), BASH_DEFAULT_TIMEOUT_MS);
  assert.equal(resolveBashTimeout('2500'), 2500);
  assert.equal(resolveBashTimeout(900000), BASH_MAX_TIMEOUT_MS);
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

test('shell PATH exposes the OpenCode ripgrep binary when present', async () => {
  const { shellPathWithRipgrep } = await load();
  const cache = path.join(directory, 'cache');
  const bin = path.join(cache, 'opencode', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(path.join(bin, process.platform === 'win32' ? 'rg.exe' : 'rg'), '');
  const result = shellPathWithRipgrep({ XDG_CACHE_HOME: cache, PATH: 'base-path' });
  assert.equal(result, [bin, 'base-path'].join(path.delimiter));
});

test('system prompt never assumes PowerShell on Windows', () => {
  const { combineSystem } = require('../lib/kernel-policy');
  const system = combineSystem({ terminalShell: 'git-bash' });
  assert.match(system, /user selected Git Bash \(POSIX bash\)/);
  assert.match(system, /never assume PowerShell on Windows/);
  assert.match(system, /Select-Object/);
  assert.match(combineSystem({ terminalShell: 'pwsh' }), /user selected PowerShell 7\+/);
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

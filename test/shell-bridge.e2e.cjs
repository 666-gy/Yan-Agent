'use strict';
const assert = require('node:assert/strict'), fs = require('node:fs'), os = require('node:os'), path = require('node:path');
const libRoot = process.env.YAN_PACKAGED_SHELL_ROOT || path.resolve(__dirname, '../lib');
const { registerBackgroundBash } = require(path.join(libRoot, 'main/background-bash.js'));
(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-shell-bridge-'));
  const service = registerBackgroundBash({ ipcMain: { handle() {} }, getMainWindow: () => null,
    runContext: { openCodeActiveRuns: new Map(), openCodeRunAdmissions: new Map() } });
  const { acquireFiles } = require(path.join(libRoot, 'workspace/file-locks.js'));
  service.acquireLock = (files, options) => acquireFiles(files, { ...options, ledger: path.join(dir, 'locks.sqlite') });
  service.register('test', { yanSessionId: 'test' });
  service.observe('test', { type: 'yan.opencode.started', data: { sessionID: 'kernel' } });
  const { resolveBashShell } = await import(require('node:url').pathToFileURL(path.join(libRoot, 'kernel-bash-tool.mjs')).href);
  const shell = resolveBashShell();
  try {
    await service.ready;
    const call = async (route, body, signal) => {
      const response = await fetch(process.env.YAN_BASH_BRIDGE_URL + route, { method: 'POST', signal,
        headers: { authorization: 'Bearer ' + process.env.YAN_BASH_BRIDGE_TOKEN, 'content-type': 'application/json' },
        body: JSON.stringify({ sessionID: 'kernel', cwd: dir, shell, ...body }) });
      assert.equal(response.status, 200); return response.json();
    };
    fs.writeFileSync(path.join(dir, 'long.cjs'), "console.log('RUNNING');setInterval(()=>console.log('LIVE'),50)");
    fs.writeFileSync(path.join(dir, 'inspect.txt'), 'INSPECTION_OK');
    const first = await call('/execute', { command: 'node long.cjs', mutationPaths: [dir], callID: 'long', background: true });
    const version = await call('/execute', { command: 'node --version', callID: 'unrelated', timeout: 5000 });
    assert.equal(version.exit, 0); assert.match(version.output, /v\d/);
    const queued = await call('/execute', { command: 'node --version', mutationPaths: [dir], callID: 'queued', timeout: 25 });
    assert.equal(queued.background, true);
    assert.equal(queued.exit, null); assert.equal(queued.truncated, false);
    assert.equal((await call('/status', { jobId: queued.jobId })).phase, 'queued');
    if (shell.kind === 'posix') {
      const read = await call('/execute', { command: 'cat inspect.txt', callID: 'read', timeout: 5000 });
      assert.match(read.output, /INSPECTION_OK/);
    }
    await new Promise(r => setTimeout(r, 300));
    assert.match((await call('/status', { jobId: first.jobId })).output, /LIVE/);
    const abort = new AbortController();
    const disconnected = call('/execute', { command: 'node --version', mutationPaths: [dir], callID: 'disconnect', timeout: 10000 }, abort.signal);
    await new Promise(r => setTimeout(r, 100)); abort.abort();
    await assert.rejects(disconnected);
    await new Promise(r => setTimeout(r, 100));
    assert.equal([...service.jobs.values()].find(j => j.callID === 'disconnect').controller.signal.aborted, true);
    await call('/cancel', { jobId: queued.jobId });
    await call('/cancel', { jobId: first.jobId });
    for (let i = 0; i < 50 && service.list('test').some(j => j.status === 'running'); i++) await new Promise(r => setTimeout(r, 100));
    assert.equal(service.list('test').some(j => j.status === 'running'), false);
    console.log('PASS real HTTP bridge: queued budget, inspection concurrency, live output, disconnect cancellation and process cleanup');
  } finally { service.close(); await new Promise(r => setTimeout(r, 100)); fs.rmSync(dir, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });

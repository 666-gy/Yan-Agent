'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { once } = require('node:events');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeV2Sidecar } = require('../lib/kernel-v2/sidecar');

test('stale ownership recovers after both recorded processes exit; live orphan remains protected', { timeout: 30000 }, async () => {
  const { spawn } = require('node:child_process');
  const probe = spawn(process.execPath, ['-e', ''], { windowsHide: true });
  await once(probe, 'exit');
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-stale-'));
  const sidecar = new OpenCodeV2Sidecar({ appRoot: path.resolve(__dirname, '..'), dataDir });
  fs.mkdirSync(sidecar.paths.root);
  const orphan = JSON.stringify({ owner: 'old', hostPID: probe.pid, childPID: process.pid });
  fs.writeFileSync(sidecar.paths.lock, orphan);
  try {
    await assert.rejects(sidecar.start(), /already owned/);
    assert.equal(fs.readFileSync(sidecar.paths.lock, 'utf8'), orphan);
    fs.writeFileSync(sidecar.paths.lock, JSON.stringify({ owner: 'old', hostPID: probe.pid, childPID: probe.pid }));
    const recovery = `${sidecar.paths.lock}.recovery`;
    fs.writeFileSync(recovery, JSON.stringify({ owner: 'dead-launcher', hostPID: probe.pid }));
    const staleAt = new Date(Date.now() - 60000);
    fs.utimesSync(recovery, staleAt, staleAt);
    assert.equal((await sidecar.start()).ok, true);
    assert.equal(JSON.parse(fs.readFileSync(sidecar.paths.lock)).owner, sidecar.owner);
    assert.equal(fs.existsSync(recovery), false);
  } finally {
    await sidecar.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('real V2: private authenticated process, concurrent start, persisted session, restart and shutdown', { timeout: 90000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-lifecycle-'));
  const appRoot = path.resolve(__dirname, '..');
  const legacy = path.join(dataDir, 'opencode-runtime', 'data', 'opencode');
  fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'opencode.db'), 'V1 database sentinel: do not open');
  const sidecar = new OpenCodeV2Sidecar({ appRoot, dataDir });
  const other = new OpenCodeV2Sidecar({ appRoot, dataDir });
  const config = { plugins: [pathToFileURL(path.join(__dirname, 'fixtures', 'kernel-v2-probe')).href] };
  const projectPlugins = path.join(dataDir, '.opencode', 'plugins');
  fs.mkdirSync(projectPlugins, { recursive: true });
  fs.writeFileSync(path.join(projectPlugins, 'must-not-load.mjs'), 'throw new Error("PROJECT_PLUGIN_LEAKED");');
  fs.writeFileSync(path.join(dataDir, 'opencode.json'), JSON.stringify({ model: 'isolation/must-not-load' }));
  try {
    const [first, concurrent] = await Promise.all([sidecar.start(config), sidecar.start(config)]);
    assert.equal(first.version, '2.0.27');
    assert.equal(first.pid, concurrent.pid);
    assert.equal(first.runtimeRoot, path.join(dataDir, 'opencode-runtime-v2'));
    assert.equal((await fetch(`${first.url}/api/info`)).status, 401);
    assert.equal((await fetch(`${first.url}/api/info`, { headers: { authorization: 'Basic ' + Buffer.from('opencode:wrong').toString('base64') } })).status, 401);
    await assert.rejects(other.start(), /already owned/);
    await assert.rejects(sidecar.start({ model: 'different/model' }), /Stop V2/);
    const permissions = [{ action: '*', resource: '*', effect: 'deny' }];
    const session = await sidecar.client.session.create({ location: { directory: dataDir }, title: 'Yan V2 lifecycle probe', permissions });
    assert.ok(session.id.startsWith('ses_'));
    assert.deepEqual(session.permissions, permissions);
    const resolvedConfig = await sidecar.client.config.get({ location: { directory: dataDir } });
    assert.ok(!JSON.stringify(resolvedConfig).includes('isolation/must-not-load'));
    await sidecar.client.session.update({ sessionID: session.id, title: 'persisted' });
    const input = { sessionID: session.id, id: 'msg_yan_bootstrap_once', text: 'admission only; no provider execution', resume: false };
    const accepted = await sidecar.client.session.prompt(input);
    const retried = await sidecar.client.session.prompt(input);
    assert.equal(accepted.id, retried.id);
    assert.equal(accepted.payload.metadata.yanV2PromptHook, 'executed');
    assert.deepEqual(accepted.payload.metadata.yanRuntime, {
      node: '26.4.0', bun: null, executable: sidecar.paths.executable
    });
    assert.equal(first.runtime, 'node');
    const plugins = await sidecar.client.plugin.list({ location: { directory: dataDir } });
    assert.ok(plugins.data.some(plugin => plugin.id === 'yan.v2.lifecycle-probe' && plugin.state.status === 'active'), JSON.stringify(plugins));
    assert.ok(!JSON.stringify(plugins).includes('must-not-load'));
    await sidecar.stop();
    assert.equal(sidecar.status().ok, false);
    await assert.rejects(fetch(`${first.url}/api/info`, { signal: AbortSignal.timeout(1000) }));
    const second = await sidecar.start(config);
    assert.notEqual(first.pid, second.pid);
    const restored = await sidecar.client.session.get({ sessionID: session.id });
    assert.equal(restored.title, 'persisted');
    assert.deepEqual(restored.permissions, permissions);
    await sidecar.client.session.remove({ sessionID: session.id });
    await assert.rejects(sidecar.client.session.get({ sessionID: session.id }));
    const exited = once(sidecar.child, 'exit');
    sidecar.child.kill();
    await exited;
    assert.equal(sidecar.status().ok, false);
    assert.equal(fs.existsSync(sidecar.paths.lock), false);
    await sidecar.start(config);
    assert.equal(fs.readFileSync(path.join(legacy, 'opencode.db'), 'utf8'), 'V1 database sentinel: do not open');
    assert.deepEqual(fs.readdirSync(legacy), ['opencode.db']);
    console.log(JSON.stringify({ version: first.version, firstPID: first.pid, restartPID: second.pid, checks: ['authentication', 'one-owner', 'concurrent-start', 'session-permissions', 'plugin-active', 'prompt-hook', 'project-config-isolation', 'durable-admission', 'idempotent-input', 'restart-history', 'delete', 'crash-restart', 'v1-untouched'] }));
  } finally {
    await other.close();
    await sidecar.close();
    assert.equal(fs.existsSync(sidecar.paths.lock), false);
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('closing after spawn cancels startup without leaving a child or lock', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-cancel-'));
  const sidecar = new OpenCodeV2Sidecar({ appRoot: path.resolve(__dirname, '..'), dataDir });
  try {
    const started = sidecar.start();
    const rejected = assert.rejects(started, /cancelled/);
    const deadline = Date.now() + 10000;
    while (!sidecar.child && Date.now() < deadline) await delay(1);
    assert.ok(sidecar.child?.pid, 'exercise cancellation after a real process has spawned');
    await sidecar.close();
    await rejected;
    assert.equal(sidecar.status().pid, null);
    assert.equal(fs.existsSync(sidecar.paths.lock), false);
    await assert.rejects(sidecar.start(), /cancelled/);
  } finally {
    await sidecar.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('readiness timeout terminates the real child and releases ownership', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-timeout-'));
  const sidecar = new OpenCodeV2Sidecar({ appRoot: path.resolve(__dirname, '..'), dataDir, startupTimeoutMs: 1 });
  try {
    await assert.rejects(sidecar.start(), /Timed out/);
    assert.equal(sidecar.status().pid, null);
    assert.equal(fs.existsSync(sidecar.paths.lock), false);
  } finally {
    await sidecar.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('quit-time kill terminates the real child synchronously and releases ownership', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-quit-'));
  const sidecar = new OpenCodeV2Sidecar({ appRoot: path.resolve(__dirname, '..'), dataDir });
  try {
    await sidecar.start({});
    const pid = sidecar.status().pid;
    assert.ok(pid);
    // before-quit cannot await: the kill and the ownership release must both
    // complete before this call returns, or the app exits with a live kernel.
    assert.equal(sidecar.killNow(), true);
    assert.equal(sidecar.child, null);
    assert.equal(fs.existsSync(sidecar.paths.lock), false);
    assert.throws(() => process.kill(pid, 0), /ESRCH/);
  } finally {
    await sidecar.close().catch(() => {});
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

test('private Node starts without global runtimes and native Windows PTY works', { timeout: 30000 }, async () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'Yan Node 独立运行 '));
  const sidecar = new OpenCodeV2Sidecar({ appRoot: path.resolve(__dirname, '..'), dataDir });
  const old = { ...process.env };
  try {
    for (const key of Object.keys(process.env)) {
      if (/^(path|node_options|node_path)$/i.test(key)) delete process.env[key];
    }
    process.env.PATH = path.join(process.env.SystemRoot, 'System32');
    process.env.NODE_OPTIONS = '--require=missing-foreign-agent.cjs';
    process.env.NODE_PATH = 'missing-foreign-modules';
    await sidecar.start();
    const location = { directory: dataDir };
    const marker = path.join(dataDir, 'terminal-pid.txt');
    const pty = await sidecar.client.pty.create({ location, command: sidecar.paths.executable,
      args: ['-e', "require('node:fs').writeFileSync('terminal-pid.txt', String(process.pid)); setInterval(()=>{},1000)"], cwd: dataDir });
    const ready = Date.now() + 5000;
    while (!fs.existsSync(marker) && Date.now() < ready) await delay(25);
    assert.ok(fs.existsSync(marker), 'native PTY must execute the child program');
    const terminalPID = Number(fs.readFileSync(marker, 'utf8'));
    assert.ok(terminalPID > 0);
    process.kill(terminalPID, 0);
    await sidecar.client.pty.update({ location, ptyID: pty.data.id, size: { rows: 30, cols: 100 } });
    await sidecar.client.pty.remove({ location, ptyID: pty.data.id });
    const deadline = Date.now() + 3000;
    let running = true;
    while (running && Date.now() < deadline) {
      try { process.kill(terminalPID, 0); await delay(25); } catch { running = false; }
    }
    assert.equal(running, false, 'PTY removal must terminate its process');
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in old)) delete process.env[key];
    Object.assign(process.env, old);
    await sidecar.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

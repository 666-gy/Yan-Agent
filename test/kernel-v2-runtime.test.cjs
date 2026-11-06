'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { runtimePaths, validateStorage, verifyRuntime, environment, ensureRipgrep } = require('../lib/kernel-v2/runtime');

test('V2 ignores inherited OpenCode database/config/service overrides', () => {
  const paths = runtimePaths(path.resolve(__dirname, '..'), os.tmpdir());
  const env = environment(paths, 'probe-secret', { model: 'probe/model' }, {
    PATH: 'test-path', OPENCODE_DB: 'v1.db', OPENCODE_CONFIG: 'user-secrets.json',
    OPENCODE_CONFIG_DIR: 'global-config', OPENCODE_SERVER_PASSWORD: 'global-password',
    opencode_config_project_disable: 'false', node_options: '--require=foreign-agent.cjs',
    NODE_PATH: 'foreign-modules', ELECTRON_RUN_AS_NODE: '1', OTUI_ASSET_ROOT: 'foreign-assets', FFF_BINARY_PATH: 'foreign.dll'
  });
  assert.equal(env.PATH, [path.join(paths.cache, 'opencode', 'bin'), 'test-path'].join(path.delimiter));
  assert.equal(env.OPENCODE_DB, paths.database);
  assert.equal(env.YAN_PROVIDER_DIAGNOSTICS_DIR, path.join(paths.dataDir, 'opencode-runtime', 'diagnostics'));
  assert.equal(env.OPENCODE_PASSWORD, 'probe-secret');
  assert.equal(env.OPENCODE_CONFIG_PROJECT_DISABLE, 'true');
  assert.equal(env.OPENCODE_CONFIG, undefined);
  assert.equal(env.OPENCODE_CONFIG_DIR, undefined);
  assert.equal(env.OPENCODE_SERVER_PASSWORD, undefined);
  assert.equal(env.opencode_config_project_disable, undefined);
  for (const key of ['node_options', 'NODE_PATH', 'ELECTRON_RUN_AS_NODE', 'OTUI_ASSET_ROOT', 'FFF_BINARY_PATH']) {
    assert.equal(env[key], undefined);
  }
});

test('V2 seeds the native ripgrep binary from an existing cache', () => {
  if (process.platform !== 'win32') return;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-rg-'));
  const paths = runtimePaths(path.resolve(__dirname, '..'), dir);
  const source = path.join(dir, 'opencode-runtime', 'cache', 'opencode', 'bin', 'rg.exe');
  fs.mkdirSync(path.dirname(source), { recursive: true });
  fs.writeFileSync(source, 'rg');
  try {
    const target = ensureRipgrep(paths);
    assert.equal(target, path.join(paths.cache, 'opencode', 'bin', 'rg.exe'));
    assert.equal(fs.readFileSync(target, 'utf8'), 'rg');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V2 rejects a nested data junction to the legacy directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-junction-'));
  const paths = runtimePaths(path.resolve(__dirname, '..'), dir);
  const legacy = path.join(dir, 'opencode-runtime');
  fs.mkdirSync(legacy);
  fs.mkdirSync(paths.root);
  try {
    fs.symlinkSync(legacy, paths.data, 'junction');
    assert.throws(() => validateStorage(paths), /cannot use a link/);
    assert.deepEqual(fs.readdirSync(legacy), []);
  } finally {
    if (fs.existsSync(paths.data)) fs.unlinkSync(paths.data);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('V2 refuses altered executable bytes and mismatched client packages', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-integrity-'));
  const paths = { runtime: dir, executable: path.join(dir, 'node.exe'), clientPackage: path.join(dir, 'package.json') };
  try {
    fs.writeFileSync(paths.executable, 'not-the-pinned-runtime');
    fs.writeFileSync(paths.clientPackage, JSON.stringify({ version: '2.0.27' }));
    await assert.rejects(verifyRuntime(paths), /SHA-256 mismatch/);
    fs.writeFileSync(paths.clientPackage, JSON.stringify({ version: '1.18.11' }));
    await assert.rejects(verifyRuntime(paths), /client version mismatch/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('Node bundle and native assets are verified, not just node.exe', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-node-integrity-'));
  const original = runtimePaths(path.resolve(__dirname, '..'), dir);
  const runtime = path.join(dir, 'runtime');
  fs.cpSync(original.runtime, runtime, { recursive: true });
  const paths = { ...original, runtime, executable: path.join(runtime, 'node.exe') };
  try {
    const entry = path.join(runtime, 'opencode.mjs');
    fs.appendFileSync(entry, '\n// altered bundle\n');
    await assert.rejects(verifyRuntime(paths), /SHA-256 mismatch: opencode.mjs/);
    fs.copyFileSync(original.entrypoint, entry);
    const native = 'assets/@ff-labs/fff-bin-win32-x64/fff_c.dll';
    fs.writeFileSync(path.join(runtime, native), 'altered native library');
    await assert.rejects(verifyRuntime(paths), /SHA-256 mismatch.*fff_c.dll/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('same-version rebuild reads the current paired manifest without weakening integrity', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-manifest-refresh-'));
  const paths = runtimePaths(path.resolve(__dirname, '..'), dir);
  paths.manifest = path.join(dir, 'runtime.json');
  const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../vendor/opencode-v2/runtime.json'), 'utf8'));
  try {
    const stale = structuredClone(manifest); stale.files['opencode.mjs'] = '0'.repeat(64);
    fs.writeFileSync(paths.manifest, JSON.stringify(stale));
    await assert.rejects(verifyRuntime(paths), /SHA-256 mismatch: opencode.mjs/);
    fs.writeFileSync(paths.manifest, JSON.stringify(manifest));
    assert.ok(await verifyRuntime(paths));
    manifest.version = 'different';
    fs.writeFileSync(paths.manifest, JSON.stringify(manifest));
    await assert.rejects(verifyRuntime(paths), /restart Yan Agent/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

'use strict';

// Bun is a pinned upstream BUILD tool only; the delivered runtime is Node.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const vendor = path.join(root, 'vendor', 'opencode-v2');
const manifest = require('../vendor/opencode-v2/runtime.json');
const work = path.join(root, '.kernel-build');
const source = path.join(work, 'source');
const destination = path.join(vendor, 'node-runtime');
const registry = 'https://registry.npmjs.org';

function run(command, args, cwd = root, env = process.env) {
  const result = spawnSync(command, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${path.basename(command)} failed (${result.status})`);
}

function git(args) {
  const result = spawnSync('git', args, { cwd: source, encoding: 'utf8', windowsHide: true });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

function hash(file) {
  return crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function verify(directory) {
  for (const [file, expected] of Object.entries(manifest.files)) {
    if (hash(path.join(directory, file)) !== expected) throw new Error(`SHA-256 mismatch: ${file}`);
  }
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Windows x64 is required');
  const npm = process.env.npm_execpath;
  if (!npm || !fs.existsSync(npm)) throw new Error('Run this installer with npm run kernel:v2:install');
  if (process.argv.includes('--check') && fs.existsSync(destination) && fs.existsSync(path.join(vendor, 'node_modules', '@opencode', 'client', 'package.json'))) {
    await require('../lib/kernel-v2/runtime').verifyRuntime(require('../lib/kernel-v2/runtime').runtimePaths(root, work));
    console.log('Verified private Node V2 runtime.');
    return;
  }
  run(process.execPath, [npm, 'ci', '--prefix', vendor, '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${registry}`]);
  if (!process.argv.includes('--rebuild') && fs.existsSync(destination)) {
    verify(destination);
    console.log('Verified existing OpenCode 2.0.27 / Node 26.4.0 runtime.');
    return;
  }

  fs.mkdirSync(work, { recursive: true });
  const tools = path.join(work, 'tools');
  fs.mkdirSync(tools, { recursive: true });
  for (const file of ['package.json', 'package-lock.json']) {
    fs.copyFileSync(path.join(vendor, 'build-tools', file), path.join(tools, file));
  }
  run(process.execPath, [npm, 'ci', '--prefix', tools, '--ignore-scripts', '--no-audit', '--no-fund', `--registry=${registry}`]);
  if (!fs.existsSync(source)) {
    run('git', ['clone', '--depth', '1', '--branch', 'v2.0.27', 'https://github.com/anomalyco/opencode.git', source]);
  }
  if (git(['rev-parse', 'HEAD']) !== manifest.sourceCommit) throw new Error('Wrong OpenCode source commit');
  const patches = (manifest.patches || []).map(patch => {
    const file = path.join(vendor, patch.file);
    if (hash(file) !== patch.sha256) throw new Error(`Patch checksum mismatch: ${patch.file}`);
    return file;
  });
  // A previous build may already contain exactly our pinned patches. Verify
  // that reversing them leaves a clean checkout; never accept unrelated edits.
  if (git(['status', '--porcelain', '--untracked-files=no'])) {
    if (!patches.length) throw new Error('Build source has tracked modifications');
    git(['apply', '--reverse', '--check', ...patches]);
    git(['apply', '--reverse', ...patches]);
    if (git(['status', '--porcelain', '--untracked-files=no'])) {
      git(['apply', ...patches]);
      throw new Error('Build source has modifications beyond the pinned patches');
    }
  }
  if (patches.length) git(['apply', ...patches]);

  const archiveName = `node-v${manifest.nodeVersion}-win-x64`;
  const archive = path.join(work, `${archiveName}.zip`);
  if (!fs.existsSync(archive) || hash(archive) !== manifest.nodeArchiveSha256) {
    const response = await fetch(`https://nodejs.org/dist/v${manifest.nodeVersion}/${archiveName}.zip`, { signal: AbortSignal.timeout(120000) });
    if (!response.ok) throw new Error(`Node download failed: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (crypto.createHash('sha256').update(bytes).digest('hex') !== manifest.nodeArchiveSha256) throw new Error('Node archive checksum mismatch');
    fs.writeFileSync(archive, bytes);
  }
  run(path.join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'tar.exe'), ['-xf', archive, '-C', work]);
  const node = path.join(work, archiveName, 'node.exe');
  if (hash(node) !== manifest.files['node.exe']) throw new Error('Node executable checksum mismatch');
  const bun = path.join(tools, 'node_modules', '@oven', 'bun-windows-x64', 'bin', 'bun.exe');
  run(bun, ['install', '--frozen-lockfile', '--ignore-scripts', `--registry=${registry}`], source);
  const emptyApp = path.join(work, 'empty-app.bin');
  // Official AppArchive encoding of an empty index: API-only backend, Yan owns the UI.
  fs.writeFileSync(emptyApp, Buffer.from([2, 0, 0, 0, 123, 125]));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(OPENCODE_|NODE_OPTIONS$|NODE_PATH$|NODE_BIN$|ELECTRON_RUN_AS_NODE$)/i.test(key)));
  run(bun, ['packages/cli/script/build-node.ts', '--bundle-only', '--skip-install', '--target=windows-x64', `--app-archive=${emptyApp}`], source,
    { ...env, OPENCODE_VERSION: manifest.version, OPENCODE_CHANNEL: 'latest', NODE_BIN: node });

  const staged = path.join(work, 'node-runtime-staged');
  // Only clear this known build output, never user data or source directories.
  fs.rmSync(staged, { recursive: true, force: true });
  fs.mkdirSync(staged);
  fs.copyFileSync(node, path.join(staged, 'node.exe'));
  fs.copyFileSync(path.join(work, archiveName, 'LICENSE'), path.join(staged, 'NODE-LICENSE'));
  const bundle = path.join(source, 'packages', 'cli', 'dist-node');
  fs.copyFileSync(path.join(bundle, 'opencode.mjs'), path.join(staged, 'opencode.mjs'));
  fs.cpSync(path.join(bundle, 'assets'), path.join(staged, 'assets'), { recursive: true });
  verify(staged); // Do not silently bless a different build or overwrite the pinned hashes.
  fs.mkdirSync(destination, { recursive: true });
  fs.cpSync(staged, destination, { recursive: true });
  verify(destination);
  console.log('Installed verified OpenCode 2.0.27 / Node 26.4.0 runtime; no Bun runtime dependency.');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });

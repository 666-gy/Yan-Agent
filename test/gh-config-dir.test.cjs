// gh must read one config dir whether the GitHub panel (main process) or Yan's
// kernel terminal spawns it. 2026-09-30: `gh auth login` in Yan's terminal
// wrote hosts.yml under the kernel's XDG_CONFIG_HOME, so the panel showed
// "not connected" while the user's own shell was logged in.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { resolveGhConfigDir, defaultGhConfigDir, kernelGhConfigDir, adoptKernelGhConfig } = require('../lib/gh-config-dir');

const appRoot = path.join(__dirname, '..');
// Placeholder content only -- the real hosts.yml holds no token, but tests
// should not look like they copy one either.
const HOSTS = 'github.com:\n    user: example-user\n';

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'yan-gh-config-'));
}

test('resolves in gh\'s own order: GH_CONFIG_DIR, then XDG_CONFIG_HOME, then the platform default', () => {
  assert.equal(resolveGhConfigDir({ GH_CONFIG_DIR: 'C:\\explicit', XDG_CONFIG_HOME: 'C:\\xdg' }), 'C:\\explicit');
  assert.equal(resolveGhConfigDir({ XDG_CONFIG_HOME: 'C:\\xdg' }), path.join('C:\\xdg', 'gh'));
  const env = { APPDATA: 'C:\\Users\\example\\AppData\\Roaming', HOME: '/home/example' };
  assert.equal(resolveGhConfigDir(env), defaultGhConfigDir(env));
  assert.equal(resolveGhConfigDir({ GH_CONFIG_DIR: '   ', ...env }), defaultGhConfigDir(env));
});

test('the Windows default is %APPDATA%\\GitHub CLI', { skip: process.platform !== 'win32' }, () => {
  assert.equal(defaultGhConfigDir({ APPDATA: 'C:\\Roaming' }), path.join('C:\\Roaming', 'GitHub CLI'));
});

test('adopts a login that landed in the kernel dir, copying without touching the source', () => {
  const dataDir = tempDir();
  const target = path.join(tempDir(), 'GitHub CLI');
  try {
    const source = kernelGhConfigDir(dataDir);
    fs.mkdirSync(source, { recursive: true });
    fs.writeFileSync(path.join(source, 'hosts.yml'), HOSTS);
    fs.writeFileSync(path.join(source, 'config.yml'), 'version: 1\n');

    const result = adoptKernelGhConfig(dataDir, { env: { GH_CONFIG_DIR: target } });
    assert.deepEqual(result, { adopted: true, reason: 'copied', dir: target });
    assert.equal(fs.readFileSync(path.join(target, 'hosts.yml'), 'utf8'), HOSTS);
    assert.equal(fs.readFileSync(path.join(target, 'config.yml'), 'utf8'), 'version: 1\n');
    assert.ok(fs.existsSync(path.join(source, 'hosts.yml')), 'the source must be left in place');

    // Second start: target already has a login, nothing is copied again.
    assert.equal(adoptKernelGhConfig(dataDir, { env: { GH_CONFIG_DIR: target } }).reason, 'target-present');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(target), { recursive: true, force: true });
  }
});

test('never overwrites a login the user already has in the target dir', () => {
  const dataDir = tempDir();
  const target = tempDir();
  try {
    fs.mkdirSync(kernelGhConfigDir(dataDir), { recursive: true });
    fs.writeFileSync(path.join(kernelGhConfigDir(dataDir), 'hosts.yml'), 'kernel\n');
    fs.writeFileSync(path.join(target, 'hosts.yml'), HOSTS);

    const result = adoptKernelGhConfig(dataDir, { env: { GH_CONFIG_DIR: target } });
    assert.equal(result.adopted, false);
    assert.equal(result.reason, 'target-present');
    assert.equal(fs.readFileSync(path.join(target, 'hosts.yml'), 'utf8'), HOSTS);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(target, { recursive: true, force: true });
  }
});

test('does nothing when there is no kernel login to adopt', () => {
  const dataDir = tempDir();
  const target = path.join(tempDir(), 'GitHub CLI');
  try {
    const result = adoptKernelGhConfig(dataDir, { env: { GH_CONFIG_DIR: target } });
    assert.equal(result.reason, 'no-legacy');
    assert.equal(fs.existsSync(target), false, 'no empty target dir should be created');
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(target), { recursive: true, force: true });
  }
});

test('a failed copy is logged, never thrown', () => {
  const dataDir = tempDir();
  const blocker = path.join(tempDir(), 'not-a-dir');
  try {
    fs.mkdirSync(kernelGhConfigDir(dataDir), { recursive: true });
    fs.writeFileSync(path.join(kernelGhConfigDir(dataDir), 'hosts.yml'), HOSTS);
    fs.writeFileSync(blocker, 'a file where the target dir should go');

    const logged = [];
    const result = adoptKernelGhConfig(dataDir, { env: { GH_CONFIG_DIR: path.join(blocker, 'gh') }, log: line => logged.push(line) });
    assert.equal(result.reason, 'error');
    assert.equal(logged.length, 1);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
    fs.rmSync(path.dirname(blocker), { recursive: true, force: true });
  }
});

test('the kernel env pins GH_CONFIG_DIR so gh does not follow its XDG_CONFIG_HOME', () => {
  const source = fs.readFileSync(path.join(appRoot, 'lib', 'opencode-sidecar.js'), 'utf8');
  const envAt = source.indexOf('XDG_CONFIG_HOME: path.join(runtimeRoot, \'config\')');
  assert.ok(envAt > 0, 'kernel env block not found');
  const block = source.slice(envAt, source.indexOf('};', envAt));
  assert.match(block, /GH_CONFIG_DIR:\s*resolveGhConfigDir\(\)/);
});

test('main.js pins GH_CONFIG_DIR before any gh or kernel spawn is wired up', () => {
  const source = fs.readFileSync(path.join(appRoot, 'main.js'), 'utf8');
  const pinAt = source.indexOf('process.env.GH_CONFIG_DIR = ghConfigDir.resolveGhConfigDir()');
  const adoptAt = source.indexOf('ghConfigDir.adoptKernelGhConfig(dataDir)');
  assert.ok(adoptAt > 0 && pinAt > adoptAt, 'adopt the old login, then pin');
  for (const later of ['registerGhIpc(', 'new OpenCodeSidecar(']) {
    const at = source.indexOf(later);
    if (at >= 0) assert.ok(pinAt < at, `GH_CONFIG_DIR must be set before ${later}`);
  }
});

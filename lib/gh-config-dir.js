'use strict';

// Where the GitHub CLI (gh) keeps hosts.yml + config.yml, and how Yan keeps
// every gh spawn on the machine pointed at the same one.
//
// gh does not always read %APPDATA%\GitHub CLI: it honours GH_CONFIG_DIR first,
// then XDG_CONFIG_HOME, and only then the platform default. Yan's kernel sets
// XDG_CONFIG_HOME to its own runtime directory (lib/opencode-sidecar.js), so a
// `gh auth login` run inside Yan's terminal wrote hosts.yml into the kernel's
// private config dir, while the GitHub panel -- spawned from the main process,
// where XDG_CONFIG_HOME is unset -- looked in AppData and reported the account
// as disconnected. Verified on Windows against gh 2.101.0: with
// XDG_CONFIG_HOME on a dir holding hosts.yml, `gh auth status` is logged in;
// with it unset, it is not; and GH_CONFIG_DIR overrides XDG_CONFIG_HOME.
//
// The token itself lives in the OS keyring, keyed by host + account, not in
// these files -- hosts.yml only records which host and user that keyring entry
// belongs to. So a login made in one config dir is still valid in another once
// the hosts.yml is there.

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// What gh would use if Yan never touched the environment: %APPDATA%\GitHub CLI
// on Windows, $XDG_CONFIG_HOME/gh or ~/.config/gh elsewhere.
function defaultGhConfigDir(env = process.env) {
  if (process.platform === 'win32') {
    const appData = String(env.APPDATA || '').trim() || path.join(os.homedir(), 'AppData', 'Roaming');
    return path.join(appData, 'GitHub CLI');
  }
  const xdg = String(env.XDG_CONFIG_HOME || '').trim();
  if (xdg) return path.join(xdg, 'gh');
  const home = String(env.HOME || env.USERPROFILE || '').trim() || os.homedir();
  return path.join(home, '.config', 'gh');
}

// The private dir Yan's kernel hands to anything it spawns (see the
// XDG_CONFIG_HOME assignment in opencode-sidecar.js). Migration source only.
function kernelGhConfigDir(dataDir) {
  return dataDir ? path.join(dataDir, 'opencode-runtime', 'config', 'gh') : '';
}

// Same order gh itself uses, so an explicit choice always wins. Main.js runs
// this once and pins the result in GH_CONFIG_DIR for the whole process tree.
function resolveGhConfigDir(env = process.env) {
  const explicit = String(env.GH_CONFIG_DIR || '').trim();
  if (explicit) return explicit;
  const xdg = String(env.XDG_CONFIG_HOME || '').trim();
  if (xdg) return path.join(xdg, 'gh');
  return defaultGhConfigDir(env);
}

function hasHostsFile(root) {
  try { return Boolean(root) && fs.existsSync(path.join(root, 'hosts.yml')); } catch { return false; }
}

// One-time, non-destructive migration for profiles where a login already landed
// in the kernel's private dir before this fix. hosts.yml/config.yml are copied
// byte for byte (never parsed, never rewritten) so no secret passes through
// this code. Never overwrites an existing target and never deletes the source;
// any failure leaves the install exactly as it was.
function adoptKernelGhConfig(dataDir, { env = process.env, log = console.warn } = {}) {
  try {
    const target = resolveGhConfigDir(env);
    if (hasHostsFile(target)) return { adopted: false, reason: 'target-present', dir: target };
    const source = kernelGhConfigDir(dataDir);
    if (!hasHostsFile(source)) return { adopted: false, reason: 'no-legacy', dir: target };
    fs.mkdirSync(target, { recursive: true });
    for (const name of ['hosts.yml', 'config.yml']) {
      const from = path.join(source, name);
      if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, name));
    }
    return { adopted: true, reason: 'copied', dir: target };
  } catch (error) {
    try { log(`[gh] 迁移 GitHub CLI 配置失败（忽略）：${error.message}`); } catch {}
    return { adopted: false, reason: 'error', dir: '' };
  }
}

module.exports = { resolveGhConfigDir, defaultGhConfigDir, kernelGhConfigDir, adoptKernelGhConfig };

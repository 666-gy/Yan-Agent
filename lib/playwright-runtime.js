'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const MCP_VERSION = '0.0.83';
const DEFAULT_ARGS = ['--isolated', '--output-dir', '.yanagent/playwright'];
// Chromium is ~440 MB, far past what an installer should carry for a capability
// most sessions never use. Only the MCP service and the Playwright JS libraries
// ship; the browser is fetched from Playwright's own CDN when the user installs
// the Playwright plugin, by the pinned CLI in that same bundle, and then checked
// against the hashes recorded at build time.
const PLUGIN_ID = 'playwright';

function createPlaywrightServer() {
  return { id: 'mcp_default_playwright', name: 'Playwright',
    description: '隔离式网页自动化与端到端测试。由 Playwright 插件提供，Chromium 在安装插件时下载。',
    command: 'yan-playwright', args: [...DEFAULT_ARGS], enabled: true, builtin: true,
    runtime: 'playwright', sourceVersion: MCP_VERSION };
}

function resolveJsRoot(appRoot) {
  const appDirectory = path.resolve(String(appRoot || ''));
  const packaged = /^app\.asar(?:\.unpacked)?$/i.test(path.basename(appDirectory));
  return packaged ? path.join(path.dirname(appDirectory), 'playwright-runtime') : path.join(appDirectory, 'output/playwright-runtime');
}

function readJsManifest(jsRoot) {
  const manifest = JSON.parse(fs.readFileSync(path.join(jsRoot, 'runtime.json'), 'utf8'));
  if (manifest.mcpVersion !== MCP_VERSION || manifest.platform !== process.platform || manifest.arch !== process.arch) throw Error('运行时版本或平台不匹配');
  return manifest;
}

// Browser storage is user data, never the read-only application directory, so it
// survives updates and can be removed with the plugin.
function resolveDataRoot(dataDir) {
  const explicit = String(dataDir || process.env.YAN_PLAYWRIGHT_DATA_DIR || '').trim();
  if (explicit) return path.join(path.resolve(explicit), 'runtimes', 'playwright');
  const appData = String(process.env.APPDATA || '').trim();
  const base = appData ? path.join(appData, 'yan-agent', 'YanData') : path.join(os.homedir(), '.yan-agent', 'YanData');
  return path.join(base, 'runtimes', 'playwright');
}

function browsersDir(dataDir) { return path.join(resolveDataRoot(dataDir), 'browsers'); }
function markerFile(dataDir) { return path.join(resolveDataRoot(dataDir), 'installed.json'); }

function readMarker(dataDir) {
  try { return JSON.parse(fs.readFileSync(markerFile(dataDir), 'utf8')); } catch { return null; }
}

// Cheap enough for every configuration load: one small JSON read and one stat.
// The hash inventory is only replayed during installation.
function isInstalled(dataDir) {
  const marker = readMarker(dataDir);
  if (marker?.mcpVersion !== MCP_VERSION || !marker?.browserExecutable) return false;
  const browsers = browsersDir(dataDir);
  const browser = path.resolve(browsers, String(marker.browserExecutable));
  return browser.startsWith(browsers + path.sep) && fs.existsSync(browser);
}

function resolveRuntime(appRoot, dataDir) {
  try {
    const root = resolveJsRoot(appRoot);
    const manifest = readJsManifest(root);
    const entry = path.join(root, 'node_modules/@playwright/mcp/cli.js');
    if (!fs.existsSync(entry)) throw Error('缺少 MCP 服务文件');
    // Three distinct states, each with its own remedy: never installed, installed
    // for a different pinned revision (an app update moved Chromium), and
    // installed but with the browser files gone.
    const marker = readMarker(dataDir);
    if (marker?.mcpVersion !== MCP_VERSION || !marker?.browserExecutable) throw Error('尚未安装 Chromium 浏览器，请在扩展的「插件」中安装 Playwright');
    if (marker.browserExecutable !== manifest.browserExecutable) throw Error('Chromium 版本已随 Yan 更新，请在扩展的「插件」中重新安装 Playwright');
    const browsers = browsersDir(dataDir);
    const browser = path.resolve(browsers, manifest.browserExecutable);
    if (!browser.startsWith(browsers + path.sep)) throw Error('浏览器路径不合法');
    if (!fs.existsSync(browser)) throw Error('Chromium 浏览器文件缺失，请在扩展的「插件」中重新安装 Playwright');
    return { ok: true, root, browsers, command: process.execPath, entry, browser,
      args: [entry, '--executable-path', browser],
      // The MCP service runs on the Node built into Yan itself (Electron in
      // node mode), so there is no hidden dependency on another bundle's node.
      env: { ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: browsers, PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD: '1' } };
  } catch (error) {
    return { ok: false, error: `Playwright 运行时不可用：${error.message}。` };
  }
}

function resolveServer(server, appRoot, dataDir) {
  const runtime = resolveRuntime(appRoot, dataDir);
  if (!runtime.ok) return runtime;
  const args = Array.isArray(server.args) ? server.args.map(String) : [];
  const resolved = args.includes(runtime.entry);
  // Existing built-in npx definitions are migrated before first use, including
  // the deferred activation path that reads config directly from disk.
  const ownArgs = resolved ? args : args.some(value => value.startsWith('@playwright/mcp')) ? [...DEFAULT_ARGS] : args;
  return { ok: true, server: { ...server, runtime: 'playwright', command: runtime.command,
    args: resolved ? ownArgs : [...runtime.args, ...ownArgs], env: { ...(server.env || {}), ...runtime.env } } };
}

// Hashing is streamed and asynchronous on purpose: the browser tree is ~440 MB
// and a synchronous digest would stall the main process (and the UI) for seconds.
function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

// Playwright's CDN download is not content-addressed, so the extracted tree is
// compared against the inventory taken from the same pinned revision at build
// time. Extra files (.links bookkeeping) are ignored; every expected file must
// match exactly.
async function verifyBrowsers(root, expected, onProgress) {
  const base = path.resolve(root);
  let done = 0;
  for (const file of expected) {
    const target = path.resolve(base, file.path);
    if (!target.startsWith(base + path.sep)) throw Error('浏览器清单包含非法路径');
    const stat = fs.existsSync(target) ? await fsp.stat(target) : null;
    if (!stat?.isFile() || stat.size !== file.bytes) throw Error(`浏览器文件缺失或大小不符：${file.path}`);
    if (await hashFile(target) !== file.sha256) throw Error(`浏览器文件校验失败：${file.path}`);
    done += 1;
    if (onProgress && done % 25 === 0) onProgress({ phase: 'verify', percent: Math.round(done / expected.length * 100) });
  }
}

function runInstaller(jsRoot, target, onProgress) {
  const cli = path.join(jsRoot, 'node_modules/playwright/cli.js');
  if (!fs.existsSync(cli)) throw Error('缺少 Playwright 安装程序');
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, 'install', 'chromium', '--no-shell'], {
      env: { ...process.env, ELECTRON_RUN_AS_NODE: '1', PLAYWRIGHT_BROWSERS_PATH: target },
      stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true
    });
    let log = '';
    const watch = chunk => {
      const text = String(chunk);
      log = (log + text).slice(-4000);
      const percent = [...text.matchAll(/(\d{1,3})%/g)].pop();
      if (percent && onProgress) onProgress({ phase: 'download', percent: Math.min(100, Number(percent[1])) });
    };
    child.stdout.on('data', watch);
    child.stderr.on('data', watch);
    child.on('error', reject);
    child.on('close', code => code === 0 ? resolve() : reject(Error(`下载未完成（退出码 ${code}）：${log.trim().split('\n').pop() || '网络不可用'}`)));
  });
}

// Antivirus can hold a freshly written chrome.exe briefly; moving the staged
// directory into place retries instead of failing the whole installation.
async function renameWithRetry(from, to, attempts = 5) {
  for (let attempt = 1; ; attempt++) {
    try { return await fsp.rename(from, to); }
    catch (error) {
      if (attempt >= attempts) throw error;
      await new Promise(resolve => setTimeout(resolve, attempt * 250));
    }
  }
}

// Fills a staging directory, verifies it, then swaps it in as the live browser
// tree. Everything before the swap is throwaway, and the marker is the single
// authority on whether an installation is complete.
async function stageAndCommit(jsRoot, dataDir, { populate, onProgress } = {}) {
  const manifest = readJsManifest(jsRoot);
  if (!Array.isArray(manifest.browserFiles) || !manifest.browserFiles.length) throw Error('运行时缺少浏览器校验清单');
  const root = resolveDataRoot(dataDir);
  await fsp.mkdir(root, { recursive: true });
  const stage = path.join(root, `.stage-${crypto.randomUUID()}`);
  try {
    await populate(stage, manifest);
    onProgress?.({ phase: 'verify', percent: 0 });
    await verifyBrowsers(stage, manifest.browserFiles, onProgress);
    if (!fs.existsSync(path.join(stage, manifest.browserExecutable))) throw Error('下载结果缺少 Chromium 可执行文件');
    // The marker is removed first: a half-replaced directory must read as
    // "not installed" rather than as a working runtime.
    await fsp.rm(markerFile(dataDir), { force: true });
    const target = browsersDir(dataDir);
    await fsp.rm(target, { recursive: true, force: true });
    await renameWithRetry(stage, target);
    await fsp.writeFile(markerFile(dataDir), JSON.stringify({ mcpVersion: manifest.mcpVersion,
      browserExecutable: manifest.browserExecutable,
      browserRevision: manifest.browserRevision, browserVersion: manifest.browserVersion,
      playwrightVersion: manifest.playwrightVersion, installedAt: Date.now() }, null, 2) + '\n');
    return { installed: true, browserVersion: manifest.browserVersion };
  } finally {
    if (path.dirname(stage) === root && path.basename(stage).startsWith('.stage-')) await fsp.rm(stage, { recursive: true, force: true });
  }
}

async function install({ appRoot, dataDir, onProgress } = {}) {
  const jsRoot = resolveJsRoot(appRoot);
  return stageAndCommit(jsRoot, dataDir, {
    populate: async (stage, manifest) => {
      onProgress?.({ phase: 'download', percent: 0 });
      await runInstaller(jsRoot, stage, onProgress);
      if (!Array.isArray(manifest.browserFiles)) return;
    },
    onProgress
  });
}

// Installs from an already-downloaded browser tree (build staging, an offline
// copy, or another machine's cache). Same verification and swap as `install`,
// with no network access, which is what the packaging checks and offline
// environments use.
async function installFrom(directory, { appRoot, dataDir, onProgress } = {}) {
  const source = path.resolve(String(directory || ''));
  if (!fs.existsSync(source)) throw Error('本地浏览器目录不存在');
  const jsRoot = resolveJsRoot(appRoot);
  return stageAndCommit(jsRoot, dataDir, {
    populate: async (stage, manifest) => {
      onProgress?.({ phase: 'copy', percent: 0 });
      await fsp.cp(source, stage, { recursive: true });
      if (!manifest.browserFiles) return;
    },
    onProgress
  });
}

// Uninstall is authoritative through the marker: a browser still held open by a
// running MCP process cannot be deleted on Windows, and the leftover bytes are
// collected on the next launch instead of failing the user's action.
async function remove(dataDir) {
  const root = resolveDataRoot(dataDir);
  if (!fs.existsSync(root)) return { removed: true };
  await fsp.rm(markerFile(dataDir), { force: true });
  try { await fsp.rm(browsersDir(dataDir), { recursive: true, force: true }); }
  catch { return { removed: true, pending: true }; }
  return { removed: true };
}

async function sweep(dataDir) {
  const root = resolveDataRoot(dataDir);
  if (readMarker(dataDir) || !fs.existsSync(root)) return;
  for (const name of fs.readdirSync(root)) {
    try { await fsp.rm(path.join(root, name), { recursive: true, force: true }); } catch { /* retried next launch */ }
  }
}

module.exports = { MCP_VERSION, DEFAULT_ARGS, PLUGIN_ID, createPlaywrightServer, resolveRuntime, resolveServer,
  resolveJsRoot, resolveDataRoot, browsersDir, isInstalled, install, installFrom, remove, sweep };

'use strict';

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');
const http = require('http');
const { execFileSync } = require('child_process');

const OFFICECLI_VERSION = '1.0.138';
const OFFICECLI_REPOSITORY = 'iOfficeAI/OfficeCLI';

function binaryName() {
  return process.platform === 'win32' ? 'officecli.exe' : 'officecli';
}

function assetName() {
  if (process.platform === 'win32') {
    if (process.arch === 'x64') return 'officecli-win-x64.exe';
    if (process.arch === 'arm64') return 'officecli-win-arm64.exe';
  }
  if (process.platform === 'darwin') {
    if (process.arch === 'x64') return 'officecli-mac-x64';
    if (process.arch === 'arm64') return 'officecli-mac-arm64';
  }
  if (process.platform === 'linux') {
    if (process.arch === 'x64') return 'officecli-linux-x64';
    if (process.arch === 'arm64') return 'officecli-linux-arm64';
  }
  throw new Error(`当前平台没有可用的 OfficeCLI 运行时：${process.platform}/${process.arch}`);
}

function appUnpackedRoot(appRoot) {
  const root = String(appRoot || '').trim();
  return root.endsWith('app.asar') ? `${root}.unpacked` : root;
}

function resolveDataDirectory(explicit) {
  const configured = String(explicit || process.env.YAN_OFFICECLI_DATA_DIR || '').trim();
  if (configured) return path.resolve(configured);
  const appData = String(process.env.APPDATA || '').trim();
  if (appData) return path.join(appData, 'yan-agent', 'YanData', 'runtimes', 'officecli');
  return path.join(os.homedir(), '.yan-agent', 'YanData', 'runtimes', 'officecli');
}

function isFile(filePath) {
  try {
    return fs.statSync(filePath).isFile() && fs.statSync(filePath).size > 0;
  } catch {
    return false;
  }
}

function addCandidate(list, value) {
  const candidate = String(value || '').trim();
  if (!candidate || list.includes(candidate)) return;
  list.push(candidate);
}

function bundledCandidates(appRoot) {
  const list = [];
  const root = appUnpackedRoot(appRoot);
  const name = binaryName();
  if (root) addCandidate(list, path.join(root, 'node_modules', '@officecli', 'officecli', 'vendor', name));
  const resources = String(process.resourcesPath || '').trim();
  if (resources) addCandidate(list, path.join(resources, 'officecli-runtime', name));
  return list;
}

function installedCandidates() {
  const list = [];
  const name = binaryName();
  addCandidate(list, process.env.OFFICECLI_PATH);
  if (process.platform === 'win32') {
    addCandidate(list, path.join(String(process.env.LOCALAPPDATA || ''), 'OfficeCLI', name));
    addCandidate(list, path.join(String(process.env.USERPROFILE || ''), '.local', 'bin', name));
    addCandidate(list, path.join(String(process.env.ProgramFiles || ''), 'OfficeCLI', name));
    addCandidate(list, path.join(String(process.env['ProgramFiles(x86)'] || ''), 'OfficeCLI', name));
  } else {
    addCandidate(list, path.join(os.homedir(), '.local', 'bin', name));
    addCandidate(list, path.join('/usr', 'local', 'bin', name));
  }
  const pathCommand = process.platform === 'win32' ? 'where.exe' : 'which';
  try {
    const output = execFileSync(pathCommand, [name], { encoding: 'utf8', windowsHide: true });
    for (const line of String(output || '').replaceAll('\r', '').split('\n')) addCandidate(list, line);
  } catch {}
  return list;
}

function download(url, destination, redirects = 0) {
  if (redirects > 8) return Promise.reject(new Error('OfficeCLI 下载重定向次数过多。'));
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const client = parsed.protocol === 'http:' ? http : https;
    const request = client.get(parsed, { headers: { 'User-Agent': 'Yan-Agent-OfficeCLI' } }, response => {
      const status = Number(response.statusCode || 0);
      if (status >= 300 && status < 400 && response.headers.location) {
        response.resume();
        const next = new URL(response.headers.location, parsed).toString();
        download(next, destination, redirects + 1).then(resolve, reject);
        return;
      }
      if (status !== 200) {
        response.resume();
        reject(new Error(`OfficeCLI 下载失败，HTTP ${status}`));
        return;
      }
      const temporary = `${destination}.download`;
      const output = fs.createWriteStream(temporary);
      response.pipe(output);
      output.on('finish', () => {
        output.close(() => {
          try {
            fs.renameSync(temporary, destination);
            resolve(destination);
          } catch (error) {
            reject(error);
          }
        });
      });
      output.on('error', reject);
      response.on('error', reject);
    });
    request.setTimeout(300000, () => request.destroy(new Error('OfficeCLI 下载超时。')));
    request.on('error', reject);
  });
}

function downloadUrls() {
  const asset = assetName();
  const tag = `v${OFFICECLI_VERSION}`;
  return [
    `https://d.officecli.ai/releases/download/${tag}/${asset}`,
    `https://github.com/${OFFICECLI_REPOSITORY}/releases/download/${tag}/${asset}`
  ];
}

async function ensureOfficeCli(options = {}) {
  const appRoot = String(options.appRoot || '').trim();
  for (const candidate of bundledCandidates(appRoot)) {
    if (isFile(candidate)) return candidate;
  }

  const runtimeDir = resolveDataDirectory(options.dataDir);
  const managedPath = path.join(runtimeDir, binaryName());
  if (isFile(managedPath)) return managedPath;

  for (const candidate of installedCandidates()) {
    if (isFile(candidate)) return candidate;
  }

  fs.mkdirSync(runtimeDir, { recursive: true });
  let lastError = null;
  for (const url of downloadUrls()) {
    try {
      await download(url, managedPath);
      if (isFile(managedPath)) return managedPath;
    } catch (error) {
      lastError = error;
      try { fs.rmSync(`${managedPath}.download`, { force: true }); } catch {}
      try { fs.rmSync(managedPath, { force: true }); } catch {}
    }
  }
  throw new Error(`未找到 OfficeCLI 运行时，且自动下载失败：${lastError?.message || '未知网络错误'}。`);
}

module.exports = {
  OFFICECLI_VERSION,
  assetName,
  binaryName,
  ensureOfficeCli,
  resolveDataDirectory
};

'use strict';

// Restore the exact upstream Windows runtime. No installer, PATH changes,
// autostart task, SDK, or optional perception extension is required.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { VERSION, ARCHIVE_SHA256, ARCHIVE_URL } = require('../lib/cua-driver-runtime');
const root = path.resolve(__dirname, '..', 'lib', 'native', 'cua-driver');
const names = ['cua-driver.exe', 'cua-cursor-theme.exe', 'cua-driver-uia.exe'];
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('Cua Driver bundle targets Windows x64');
  let manifest;
  try { manifest = JSON.parse(fs.readFileSync(path.join(root, 'runtime.json'))); } catch {}
  if (manifest?.version === VERSION && manifest.archiveSha256 === ARCHIVE_SHA256
      && names.every(name => manifest.files?.some(file => file.path === name
        && fs.existsSync(path.join(root, name)) && hash(fs.readFileSync(path.join(root, name))) === file.sha256))) {
    console.log(`Cua Driver ${VERSION}: bundled file hashes verified.`);
    return;
  }
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-cua-build-'));
  try {
    const archivePath = path.join(staging, 'driver.zip');
    const extracted = path.join(staging, 'extracted');
    // PowerShell honors the user's Windows proxy configuration, unlike Node's
    // fetch when no HTTP(S)_PROXY environment variable is configured.
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      "$ErrorActionPreference = 'Stop'; Invoke-WebRequest -UseBasicParsing -Uri $env:YAN_CUA_URL -OutFile $env:YAN_CUA_ARCHIVE -TimeoutSec 120"], {
      windowsHide: true, timeout: 150_000,
      env: { ...process.env, YAN_CUA_URL: ARCHIVE_URL, YAN_CUA_ARCHIVE: archivePath }
    });
    if (hash(fs.readFileSync(archivePath)) !== ARCHIVE_SHA256) throw new Error('Cua Driver archive SHA-256 mismatch');
    execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command',
      'Expand-Archive -LiteralPath $env:YAN_CUA_ARCHIVE -DestinationPath $env:YAN_CUA_EXTRACTED'], {
      windowsHide: true, env: { ...process.env, YAN_CUA_ARCHIVE: archivePath, YAN_CUA_EXTRACTED: extracted }
    });
    fs.mkdirSync(root, { recursive: true });
    const files = names.map(name => {
      const bytes = fs.readFileSync(path.join(extracted, name));
      fs.writeFileSync(path.join(root, name), bytes);
      return { path: name, bytes: bytes.length, sha256: hash(bytes) };
    });
    fs.writeFileSync(path.join(root, 'runtime.json'), JSON.stringify({
      version: VERSION, platform: 'win32', arch: 'x64', license: 'MIT',
      source: 'https://github.com/trycua/cua', archiveUrl: ARCHIVE_URL,
      archiveSha256: ARCHIVE_SHA256, files
    }, null, 2) + '\n');
    console.log(`Bundled Cua Driver ${VERSION}: ${files.length} pinned Windows binaries.`);
  } finally {
    if (path.dirname(staging) !== path.resolve(os.tmpdir())) throw new Error('Invalid Cua staging path');
    fs.rmSync(staging, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

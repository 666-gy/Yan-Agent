'use strict';

// Builds the shipped half of the Playwright runtime: the MCP service and the
// Playwright JS libraries only. Chromium is installed here as well, but solely
// to record the hashes of the pinned revision -- those bytes stay out of the
// application package and are downloaded from Playwright's CDN when the user
// installs the Playwright plugin (lib/playwright-runtime.js).

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const source = path.join(root, 'vendor/playwright');
const output = path.join(root, 'output/playwright-runtime');
const browsers = path.join(root, 'output/playwright-browsers');
function removeGenerated(base, relative) {
  const target = path.resolve(base, relative);
  if (!target.startsWith(base + path.sep)) throw Error('Refusing cleanup outside generated Playwright staging');
  fs.rmSync(target, { recursive: true, force: true });
}
if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('This Playwright runtime build targets Windows x64');
const npmCli = process.env.npm_execpath;
if (!npmCli || !fs.existsSync(npmCli)) throw Error('Run this script through npm run build:playwright');
execFileSync(process.execPath, [npmCli, 'ci', '--prefix', source, '--ignore-scripts', '--no-audit', '--no-fund'], { stdio: 'inherit', windowsHide: true });
const modules = path.join(source, 'node_modules');
fs.mkdirSync(output, { recursive: true });
fs.mkdirSync(browsers, { recursive: true });
execFileSync(process.execPath, [path.join(modules, 'playwright/cli.js'), 'install', 'chromium', '--no-shell'], {
  env: { ...process.env, PLAYWRIGHT_BROWSERS_PATH: browsers }, stdio: 'inherit', windowsHide: true
});
// These are exclusively generated staging directories, never user storage.
removeGenerated(output, 'node_modules');
removeGenerated(output, 'browsers');
fs.cpSync(modules, path.join(output, 'node_modules'), { recursive: true });
for (const name of ['package.json', 'package-lock.json']) fs.copyFileSync(path.join(source, name), path.join(output, name));
const core = require(path.join(modules, 'playwright-core/package.json'));
const mcp = require(path.join(modules, '@playwright/mcp/package.json'));
const browserSpec = require(path.join(modules, 'playwright-core/browsers.json')).browsers.find(item => item.name === 'chromium');
const browserExecutable = `chromium-${browserSpec.revision}/chrome-win64/chrome.exe`;
if (!fs.existsSync(path.join(browsers, browserExecutable))) throw Error(`Missing Chromium executable: ${browserExecutable}`);
// Remove only stale generated browser revisions, not the matching runtime or
// ffmpeg/winldd supporting executables installed by the pinned Playwright CLI.
for (const item of fs.readdirSync(browsers)) {
  if (/^chromium(?:_headless_shell)?-/.test(item) && item !== `chromium-${browserSpec.revision}`) removeGenerated(browsers, item);
}
removeGenerated(browsers, '.links');
function inventory(base, skip = () => false) {
  const files = [];
  (function walk(dir, prefix = '') {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix + entry.name;
      if (skip(relative)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full, relative + '/');
      else if (entry.isFile()) files.push({ path: relative, bytes: fs.statSync(full).size, sha256: crypto.createHash('sha256').update(fs.readFileSync(full)).digest('hex') });
    }
  })(base);
  return files;
}
const files = inventory(output, relative => relative === 'runtime.json');
// The download is verified against this list at install time, so it is pinned
// to the same revision the CLI in this bundle resolves.
const browserFiles = inventory(browsers, relative => relative === '.links');
fs.writeFileSync(path.join(output, 'runtime.json'), JSON.stringify({ platform: process.platform, arch: process.arch,
  mcpVersion: mcp.version, playwrightVersion: core.version, browserRevision: browserSpec.revision,
  browserVersion: browserSpec.browserVersion, browserExecutable, files, browserFiles }, null, 2) + '\n');
const browserBytes = browserFiles.reduce((sum, file) => sum + file.bytes, 0);
console.log(`Bundled Playwright MCP ${mcp.version}: ${files.length} files. Chromium ${browserSpec.browserVersion} stays on demand: ${browserFiles.length} files, ${(browserBytes / 1024 / 1024).toFixed(0)} MB pinned by hash.`);

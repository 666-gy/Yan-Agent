'use strict';

// Packaging guard: every local asset referenced by renderer/index.html (plus a
// small required-runtime manifest) must resolve inside app.asar or its
// app.asar.unpacked companion. Run after electron-builder so a partial package
// fails the build instead of shipping a renderer that dies on a missing script.

const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const asar = require('@electron/asar');
const crypto = require('node:crypto');
const vm = require('node:vm');

const appRoot = path.resolve(__dirname, '..');
const resourcesRoot = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(appRoot, 'dist', 'win-unpacked', 'resources');
const archive = path.join(resourcesRoot, 'app.asar');
const unpackedRoot = path.join(resourcesRoot, 'app.asar.unpacked');

if (!fs.existsSync(archive)) {
  console.error(`[verify-packaged-runtime] app.asar not found: ${archive}`);
  process.exit(1);
}

const header = asar.getRawHeader(archive).header;

function headerNode(rel) {
  let node = header;
  for (const part of String(rel).split('/')) {
    node = node && node.files ? node.files[part] : null;
    if (!node) return null;
  }
  return node;
}

function unpackedPath(rel) {
  return path.join(unpackedRoot, ...String(rel).split('/'));
}

function exists(rel) {
  const node = headerNode(rel);
  if (!node) return false;
  return node.unpacked ? fs.existsSync(unpackedPath(rel)) : true;
}

function readAsarText(rel) {
  const node = headerNode(rel);
  if (!node) return '';
  if (node.unpacked) return fs.readFileSync(unpackedPath(rel), 'utf8');
  return asar.extractFile(archive, String(rel).split('/').join(path.sep)).toString('utf8');
}

const html = readAsarText('renderer/index.html');
if (!html) {
  console.error('[verify-packaged-runtime] renderer/index.html is missing from the package');
  process.exit(1);
}

const refs = new Set();
for (const match of html.matchAll(/<script[^>]+src="([^"]+)"/g)) refs.add(match[1]);
for (const match of html.matchAll(/<link[^>]+href="([^"]+)"/g)) refs.add(match[1]);

function resolveRef(ref) {
  const value = String(ref || '').trim();
  if (!value || /^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(value)) return '';
  const resolved = path.posix.normalize(path.posix.join('renderer', value));
  return resolved.startsWith('..') ? '' : resolved;
}

const required = [
  'renderer/vendor/katex/katex.min.js',
  'renderer/vendor/katex/katex.min.css',
  'renderer/vendor/katex/LICENSE',
  'renderer/markdown-math.js',
  'renderer/markdown-math.css',
  'lib/intelligent-ui/openui-library.cjs',
  'renderer/vendor/openui/intelligent-ui-runtime.js',
  'renderer/vendor/openui/LICENSES.txt',
  'main.js',
  'preload.js',
  'renderer/renderer.js',
  'renderer/i18n.js',
  'renderer/subagent-panel.js',
  'renderer/assets/logo-light.ico',
  'renderer/assets/logo-light.png',
  'renderer/assets/logo-dark.ico',
  'renderer/assets/logo-dark.png',
  'lib/subagent/workflow-state.js',
  'lib/subagent/event-bridge.js',
  'lib/external-agents/worker.js',
  'lib/external-agents/desktop.js',
  'lib/external-agents/launch.js',
  'lib/external-agents/payload.js',
  'lib/external-agents/journal.js',
  'lib/external-agents/detect-desktop.ps1',
  'lib/native/yan-desktop-bridge.exe',
  'lib/yan-computer-mcp.js',
  'lib/cua-driver-runtime.js',
  'lib/plugins/mcp-client.js',
    'lib/plugins/computer-use.js',
    'lib/plugins/gateway.js',
  'lib/native/cua-driver/cua-driver.exe',
  'lib/native/cua-driver/cua-cursor-theme.exe',
  'lib/native/cua-driver/cua-driver-uia.exe',
  'lib/native/cua-driver/runtime.json',
  'lib/native/cua-driver/LICENSE.txt',
  'lib/main/app-snapshot.js',
  'lib/main/voice-input.js',
  'lib/voice-input.js',
  'lib/vendor/dsh-voice/lib/provider.mjs',
  'lib/vendor/dsh-voice/lib/worker.js',
  'lib/vendor/dsh-voice/runtime/assets.json',
  'node_modules/sherpa-onnx-node/package.json',
  'node_modules/sherpa-onnx-win-x64/package.json',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node',
  'node_modules/sherpa-onnx-win-x64/onnxruntime.dll',
  'node_modules/sherpa-onnx-win-x64/onnxruntime_providers_shared.dll',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx-c-api.dll',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx-cxx-api.dll',
  'lib/main/snapshot-monitor.js',
  'lib/app-snapshot-settings.js',
  'renderer/app-snapshot.js',
  'renderer/app-snapshot.css',
  'renderer/notify-sounds.js',
  'lib/main/snapshot-monitor.cs',
  'lib/main/snapshot-monitor.ps1',
  'lib/plugins/catalog/index.json',
  'lib/plugins/remote-catalog.json',
  'renderer/release-notes.js'
];

const missing = [];
// Font URLs are relative to the bundled stylesheet, not node_modules.
const katexStylesheet = 'renderer/vendor/katex/katex.min.css';
if (exists(katexStylesheet)) {
  const css = readAsarText(katexStylesheet);
  for (const match of css.matchAll(/url\((?:["'])?(fonts\/[^\s)"']+)/g)) {
    const font = `renderer/vendor/katex/${match[1]}`;
    if (!exists(font)) missing.push(`${font} (required KaTeX font)`);
  }
}
for (const ref of refs) {
  const resolved = resolveRef(ref);
  if (resolved && !exists(resolved)) missing.push(`${resolved} (referenced by renderer/index.html as ${ref})`);
}
for (const rel of required) {
  if (!exists(rel)) missing.push(`${rel} (required runtime file)`);
}
for (const rel of ['lib/main/snapshot-monitor.ps1', 'lib/main/snapshot-monitor.cs']) {
  if (!headerNode(rel)?.unpacked || !fs.existsSync(unpackedPath(rel))) {
    missing.push(`${rel} (PowerShell requires a physical unpacked file)`);
  }
}

for (const rel of [
  'lib/vendor/dsh-voice/lib/provider.mjs',
  'lib/vendor/dsh-voice/lib/worker.js',
  'lib/vendor/dsh-voice/runtime/assets.json',
  'node_modules/sherpa-onnx-node/sherpa-onnx.js',
  'node_modules/sherpa-onnx-win-x64/package.json',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx.node',
  'node_modules/sherpa-onnx-win-x64/onnxruntime.dll',
  'node_modules/sherpa-onnx-win-x64/onnxruntime_providers_shared.dll',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx-c-api.dll',
  'node_modules/sherpa-onnx-win-x64/sherpa-onnx-cxx-api.dll'
]) {
  if (!headerNode(rel)?.unpacked || !fs.existsSync(unpackedPath(rel))) {
    missing.push(`${rel} (voice worker requires a physical unpacked file)`);
  }
}

// Compare the current application tree, including untracked feature files,
// with the actual archive. Git's tracked-file list is not a release manifest.
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const builderIgnoredNames = new Set(['.git', '.hg', '.svn', 'node_modules', '__pycache__',
  '.DS_Store', 'thumbs.db', '.gitignore', '.gitkeep', '.gitattributes', '.npmignore',
  'package-lock.json', 'yarn.lock', '.github', '.idea', '.vs']);
function ignored(rel, name) {
  return builderIgnoredNames.has(name)
    || /\.(?:iml|hprof|orig|pyc|pyo|rbc|swp|csproj|sln|suo|xproj|cc|d\.ts|mk|a|o|forge-meta|pdb)$/.test(name)
    || /^lib\/native\/.*\.cs$/.test(rel);
}
function walk(directory, visit, prefix = '', filter = false) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const rel = prefix + entry.name;
    if (filter && ignored(rel, entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, visit, `${rel}/`, filter);
    else if (entry.isFile()) visit(full, rel);
  }
}
let applicationFiles = 0;
function verifySource(full, rel) {
  if (!exists(rel)) { missing.push(`${rel} (current application file)`); return; }
  const packaged = headerNode(rel).unpacked
    ? fs.readFileSync(unpackedPath(rel))
    : asar.extractFile(archive, rel.split('/').join(path.sep));
  if (hash(fs.readFileSync(full)) !== hash(packaged)) missing.push(`${rel} (content differs from source)`);
  applicationFiles++;
}
for (const rel of ['main.js', 'preload.js', 'quick-input-preload.js', 'tokens.css']) verifySource(path.join(appRoot, rel), rel);
for (const rel of ['lib', 'renderer', '.pets', 'vendor/opencode', 'node_modules/monaco-editor/min']) {
  walk(path.join(appRoot, rel), verifySource, `${rel}/`, true);
}
let unpackedFiles = 0;
function verifyUnpacked(node, prefix = '') {
  for (const [name, child] of Object.entries(node.files || {})) {
    const rel = prefix + name;
    if (child.files) verifyUnpacked(child, `${rel}/`);
    else if (child.unpacked) {
      unpackedFiles++;
      if (!fs.existsSync(unpackedPath(rel))) missing.push(`${rel} (missing physical unpacked file)`);
    }
  }
}
verifyUnpacked(header);
const sourcePackage = JSON.parse(fs.readFileSync(path.join(appRoot, 'package.json'), 'utf8'));
const playwrightRoot = path.join(resourcesRoot, 'playwright-runtime');
let playwrightManifest;
try {
  playwrightManifest = JSON.parse(fs.readFileSync(path.join(playwrightRoot, 'runtime.json'), 'utf8'));
  const pin = require('../vendor/playwright/package.json').dependencies['@playwright/mcp'];
  if (playwrightManifest.mcpVersion !== pin || !playwrightManifest.files?.length) missing.push('playwright-runtime (invalid manifest or version)');
  for (const file of playwrightManifest.files || []) {
    const full = path.resolve(playwrightRoot, file.path);
    if (!full.startsWith(playwrightRoot + path.sep) || !fs.existsSync(full)) missing.push(`playwright-runtime/${file.path} (missing runtime file)`);
    else if (fs.statSync(full).size !== file.bytes || hash(fs.readFileSync(full)) !== file.sha256) missing.push(`playwright-runtime/${file.path} (runtime integrity mismatch)`);
  }
  // Chromium is downloaded on demand, so only its hash inventory ships. The
  // inventory is what the installer replays, which makes it release-critical:
  // a truncated list would verify a partial browser as complete.
  const browserFiles = playwrightManifest.browserFiles;
  const browserBytes = (browserFiles || []).reduce((sum, file) => sum + (Number(file.bytes) || 0), 0);
  if (!Array.isArray(browserFiles) || browserFiles.length < 100) missing.push('playwright-runtime (browser hash inventory is missing or truncated)');
  else {
    const exe = browserFiles.find(file => file.path === playwrightManifest.browserExecutable);
    if (!exe) missing.push('playwright-runtime (browser inventory does not cover the executable)');
    if (!/^[0-9a-f]{64}$/.test(String(exe?.sha256 || ''))) missing.push('playwright-runtime (browser executable has no valid hash)');
    if (browserBytes < 200 * 1024 * 1024) missing.push(`playwright-runtime (browser inventory covers only ${(browserBytes / 1048576).toFixed(0)} MB)`);
    for (const file of browserFiles) {
      // Zero-byte files are legitimate (Playwright's DEPENDENCIES_VALIDATED marker).
      if (!file.path || !Number.isInteger(file.bytes) || file.bytes < 0 || !/^[0-9a-f]{64}$/.test(String(file.sha256 || ''))) { missing.push(`playwright-runtime (invalid browser inventory entry: ${file.path})`); break; }
      if (file.path.startsWith('/') || file.path.includes('..')) { missing.push(`playwright-runtime (browser inventory escapes the data directory: ${file.path})`); break; }
    }
  }
  // Nothing below the inventory may ship: a packaged browsers/ tree would put the
  // 440 MB back into the installer and hide a broken download path.
  if (fs.existsSync(path.join(playwrightRoot, 'browsers'))) missing.push('playwright-runtime/browsers (Chromium must not be packaged)');
  // The runtime must report "not installed" on a machine that never installed
  // the plugin. Without this, a build machine's own browser download could mask
  // an installer that ships an unusable command.
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-playwright-probe-'));
  const previousProbe = process.env.YAN_PLAYWRIGHT_DATA_DIR;
  process.env.YAN_PLAYWRIGHT_DATA_DIR = probeDir;
  try {
    const runtime = require('../lib/playwright-runtime').resolveRuntime(path.join(resourcesRoot, 'app.asar'));
    if (runtime.ok) missing.push('playwright-runtime (resolved as installed on a machine with no browser download)');
    else if (!/Chromium|浏览器/.test(runtime.error)) missing.push(`playwright-runtime (unexpected not-installed error: ${runtime.error})`);
  } finally {
    if (previousProbe === undefined) delete process.env.YAN_PLAYWRIGHT_DATA_DIR; else process.env.YAN_PLAYWRIGHT_DATA_DIR = previousProbe;
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
} catch (error) { missing.push(`playwright-runtime (missing or invalid: ${error.message})`); }
for (const icon of ['renderer/assets/logo-light.ico', 'renderer/assets/logo-light.png', 'renderer/assets/logo-dark.ico', 'renderer/assets/logo-dark.png']) {
  if (!headerNode(icon)?.unpacked || !fs.existsSync(unpackedPath(icon))) missing.push(`${icon} (Windows shell icon must be a physical file)`);
}
const wallpaperFiles = ['【哲风壁纸】夜空-天体-天空.jpg', '【哲风壁纸】下雨天-中式建筑.mp4'];
const wallpaperNode = headerNode('renderer/assets/wallpapers');
const wallpaperOriginals = Object.entries(wallpaperNode?.files || {}).filter(([, node]) => !node.files).map(([name]) => name).sort();
if (JSON.stringify(wallpaperOriginals) !== JSON.stringify([...wallpaperFiles].sort())) missing.push('wallpapers (must contain exactly the two release originals)');
const thumbnailNames = Object.keys(wallpaperNode?.files?.thumbs?.files || {}).sort();
if (JSON.stringify(thumbnailNames) !== JSON.stringify(['night-sky.jpg', 'rainy-architecture.jpg'])) missing.push('wallpapers (unexpected or missing thumbnails)');
const packagedPackage = JSON.parse(readAsarText('package.json'));
if (packagedPackage.version !== sourcePackage.version) missing.push('package.json (version mismatch)');
const displayVersion = sourcePackage.version.replace(/-beta\.(\d+)(-rc(?:\.(\d+))?)?$/, (_, beta, rc, candidate) => ` Beta${beta}${rc ? `-RC${candidate || ''}` : ''}`);
if (!html.includes(`Yan Agent v${displayVersion}`)) missing.push('renderer/index.html (About version mismatch)');
const releaseContext = { window: {} };
vm.runInNewContext(readAsarText('renderer/release-notes.js'), releaseContext, { timeout: 1000 });
if (!releaseContext.window.YanReleaseNotes?.title.includes(displayVersion)) missing.push('renderer/release-notes.js (version mismatch)');
for (const [index, page] of (releaseContext.window.YanReleaseNotes?.pages || []).entries()) {
  if (!page.title || !Array.isArray(page.paragraphs)) missing.push(`release guide page ${index + 1} (invalid renderer data contract)`);
}
let extraResourceFiles = 0;
for (const resource of sourcePackage.build.extraResources) {
  walk(path.join(appRoot, resource.from), (full, rel) => {
    const target = path.join(resourcesRoot, resource.to, ...rel.split('/'));
    if (!fs.existsSync(target)) missing.push(`${resource.to}/${rel} (extra resource)`);
    else if (hash(fs.readFileSync(full)) !== hash(fs.readFileSync(target))) missing.push(`${resource.to}/${rel} (extra resource differs)`);
    extraResourceFiles++;
  });
}
// Catalog packages are immutable: all hidden metadata and referenced skill
// resources must survive packaging without invalidating the stored digest.
const catalogRoot = unpackedPath('lib/plugins/catalog');
const { inventory, readManifest } = require(unpackedPath('lib/plugins/manifest.js'));
const pluginIds = [];
for (const item of JSON.parse(readAsarText('lib/plugins/catalog/index.json'))) {
  const root = path.join(catalogRoot, item.id);
  readManifest(root);
  if (inventory(root).digest !== item.digest) missing.push(`plugin ${item.id} (catalog digest mismatch)`);
  pluginIds.push(item.id);
}

if (missing.length) {
  console.error('[verify-packaged-runtime] missing packaged files:');
  for (const item of missing) console.error(`  - ${item}`);
  process.exit(1);
}
console.log(`[verify-packaged-runtime] ok: ${refs.size} renderer references and ${required.length} runtime files present in ${archive}`);
console.log(JSON.stringify({ version: packagedPackage.version, applicationFiles, unpackedFiles, extraResourceFiles, verifiedPlugins: pluginIds, wallpapers: wallpaperFiles,
  playwright: { mcpVersion: playwrightManifest?.mcpVersion, browserVersion: playwrightManifest?.browserVersion, files: playwrightManifest?.files?.length,
    browserFiles: playwrightManifest?.browserFiles?.length, browserDelivery: 'on-demand' } }));

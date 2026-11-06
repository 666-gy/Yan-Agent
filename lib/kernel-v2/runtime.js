'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { pathToFileURL } = require('node:url');
const manifest = require('../../vendor/opencode-v2/runtime.json');
const { childReadablePath } = require('../provider-staging');
const { deferredServers, deferredConfig } = require('./mcp-capabilities');

function runtimePaths(appRoot, dataDir) {
  if (!path.isAbsolute(appRoot) || !path.isAbsolute(dataDir)) throw new Error('V2 requires absolute appRoot and dataDir');
  const root = path.join(dataDir, 'opencode-runtime-v2');
  const vendor = childReadablePath(path.join(appRoot, 'vendor', 'opencode-v2'));
  const runtime = path.join(vendor, 'node-runtime');
  return {
    root,
    dataDir,
    home: path.join(root, 'home'),
    data: path.join(root, 'data'),
    config: path.join(root, 'config'),
    cache: path.join(root, 'cache'),
    state: path.join(root, 'state'),
    database: path.join(root, 'data', 'opencode', 'opencode.db'),
    lock: path.join(root, 'owner.json'),
    runtime,
    manifest: path.join(vendor, 'runtime.json'),
    executable: path.join(runtime, 'node.exe'),
    entrypoint: path.join(runtime, 'opencode.mjs'),
    client: path.join(vendor, 'node_modules', '@opencode', 'client', 'dist', 'promise', 'index.js'),
    clientPackage: path.join(vendor, 'node_modules', '@opencode', 'client', 'package.json')
  };
}

function validateStorage(paths) {
  // Check children too: data/opencode may otherwise be a junction into V1.
  for (const target of [paths.root, paths.home, paths.data, paths.config, paths.cache, paths.state,
    paths.lock, path.join(paths.data, 'opencode'), paths.database, `${paths.database}-wal`, `${paths.database}-shm`]) {
    for (let item = target; ; item = path.dirname(item)) {
      try {
        if (fs.lstatSync(item).isSymbolicLink()) throw new Error(`V2 storage cannot use a link: ${item}`);
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
      if (path.dirname(item) === item) break;
    }
  }
}

async function verifyRuntime(paths) {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw new Error('The pinned V2 runtime supports Windows x64 only');
  if (!fs.existsSync(paths.executable) || !fs.existsSync(paths.clientPackage)) {
    throw new Error('OpenCode V2 runtime missing. Run npm run kernel:v2:install');
  }
  // Development builds may replace a same-version bundle while the desktop
  // stays open. Read its paired manifest now rather than Node's require cache.
  const current = JSON.parse(fs.readFileSync(paths.manifest || require.resolve('../../vendor/opencode-v2/runtime.json'), 'utf8'));
  if (current.version !== manifest.version || current.nodeVersion !== manifest.nodeVersion
    || JSON.stringify(current.nodeArgs) !== JSON.stringify(manifest.nodeArgs)) {
    throw new Error('OpenCode V2 runtime version changed; restart Yan Agent');
  }
  const client = JSON.parse(fs.readFileSync(paths.clientPackage, 'utf8'));
  if (client.version !== current.version) throw new Error('OpenCode V2 client version mismatch');
  if (!current.files?.['node.exe'] || !current.files?.['opencode.mjs']) throw new Error('OpenCode V2 runtime manifest is incomplete');
  for (const relative of Object.keys(manifest.files)) {
    if (!current.files[relative]) throw new Error(`OpenCode V2 runtime manifest is incomplete: ${relative}`);
  }
  for (const [relative, expected] of Object.entries(current.files)) {
    const filename = path.join(paths.runtime, relative);
    const hash = crypto.createHash('sha256');
    for await (const chunk of fs.createReadStream(filename)) hash.update(chunk);
    if (hash.digest('hex') !== expected) throw new Error(`OpenCode V2 SHA-256 mismatch: ${relative}`);
  }
  const { OpenCode } = await import(pathToFileURL(paths.client).href);
  return OpenCode;
}

function ensureRipgrep(paths, inherited = process.env, dataDir = paths.dataDir) {
  if (process.platform !== 'win32') return '';
  const target = path.join(paths.cache, 'opencode', 'bin', 'rg.exe');
  if (fs.existsSync(target)) return target;
  const candidates = [
    path.join(dataDir || '', 'opencode-runtime', 'cache', 'opencode', 'bin', 'rg.exe'),
    path.join(dataDir || '', 'opencode-runtime-v2', 'cache', 'opencode', 'bin', 'rg.exe'),
    path.join(inherited.USERPROFILE || '', '.cache', 'opencode', 'bin', 'rg.exe'),
    path.join(inherited.LOCALAPPDATA || '', 'opencode', 'Cache', 'bin', 'rg.exe'),
    path.join(inherited.LOCALAPPDATA || '', 'opencode', 'bin', 'rg.exe')
  ].filter(Boolean);
  const source = candidates.find(file => fs.existsSync(file));
  if (!source) return '';
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  return target;
}

function environment(paths, password, config, inherited = process.env) {
  const [providerID, ...modelParts] = String(config.model || '').split('/');
  const model = config.providers?.[providerID]?.models?.[modelParts.join('/')];
  const imageInput = model?.capabilities?.input?.includes('image') === true;
  const env = Object.fromEntries(Object.entries(inherited).filter(([key]) =>
    !/^(OPENCODE_|OTUI_|FFF_)/i.test(key) && !/^(NODE_OPTIONS|NODE_PATH|ELECTRON_RUN_AS_NODE)$/i.test(key)));
  const pathKey = Object.keys(env).find(key => key.toLowerCase() === 'path') || 'PATH';
  const rgDir = path.join(paths.cache, 'opencode', 'bin');
  return {
    ...env,
    [pathKey]: [rgDir, String(env[pathKey] || '')].filter(Boolean).join(path.delimiter),
    // The plugin gateway must use the same modality declaration as the V2
    // provider. Never inherit a stale flag from another model or process.
    YAN_COMPUTER_IMAGE_INPUT: String(imageInput),
    YAN_PROVIDER_DIAGNOSTICS_DIR: path.join(paths.dataDir, 'opencode-runtime', 'diagnostics'),
    OPENCODE_TEST_HOME: paths.home,
    OPENCODE_DB: paths.database,
    XDG_DATA_HOME: paths.data,
    XDG_CONFIG_HOME: paths.config,
    XDG_CACHE_HOME: paths.cache,
    XDG_STATE_HOME: paths.state,
    OPENCODE_CONFIG_PROJECT_DISABLE: 'true',
    OPENCODE_DISABLE_MODELS_FETCH: 'true',
    OPENCODE_PASSWORD: password,
    YAN_DEFERRED_MCP_SERVERS: JSON.stringify(deferredServers(config)),
    OPENCODE_CONFIG_CONTENT: JSON.stringify(deferredConfig(config))
  };
}

module.exports = { runtimePaths, validateStorage, verifyRuntime, environment, ensureRipgrep, VERSION: manifest.version,
  NODE_VERSION: manifest.nodeVersion, NODE_ARGS: manifest.nodeArgs };

'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { childReadablePath } = require('./provider-staging');
const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const checked = new Map();

// Build-time only. Use each server's real tools/list function, not a second schema.
function emitCatalog(definitions) {
  const tools = definitions();
  const dependencies = Object.fromEntries(Object.keys(require.cache)
    .filter(file => file.startsWith(__dirname + path.sep) && file !== __filename)
    .sort().map(file => [path.relative(__dirname, file).replaceAll('\\', '/'), digest(fs.readFileSync(file))]));
  fs.writeSync(1, JSON.stringify({ tools, dependencies }));
  process.exit(0);
}

function bundledCatalog(name, server) {
  if (server?.disabled || server?.type !== 'local') return null;
  let catalogs;
  try { catalogs = require('./kernel-v2/mcp-catalogs.json'); } catch { return null; }
  const entry = catalogs[name];
  if (!entry || !Array.isArray(server.command) || server.command.length !== 2) return null;
  // Only exact bundled entrypoints qualify; user services with the same ID do not.
  const expected = path.join(__dirname, entry.entrypoint);
  if (childReadablePath(server.command[1]) !== childReadablePath(expected)) return null;
  try {
    for (const [relative, hash] of Object.entries(entry.dependencies)) {
      const file = path.resolve(__dirname, relative);
      if (!file.startsWith(__dirname + path.sep)) return null;
      const stat = fs.statSync(file);
      const stamp = `${stat.size}:${stat.mtimeMs}:${stat.ctimeMs}`;
      let check = checked.get(file);
      if (check?.stamp !== stamp) { check = { stamp, hash: digest(fs.readFileSync(file)) }; checked.set(file, check); }
      if (check.hash !== hash) return null;
    }
    return entry.tools;
  } catch { return null; }
}
function undiscoveredConfig(config) {
  const { deferredServers } = require('./kernel-v2/mcp-capabilities');
  const deferred = deferredServers(config);
  return { ...config, mcp: { ...config.mcp, servers: Object.fromEntries(Object.entries(config.mcp?.servers || {})
    .filter(([name]) => !deferred[name])) } };
}
module.exports = { emitCatalog, bundledCatalog, undiscoveredConfig };

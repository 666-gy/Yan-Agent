'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const names = ['skills', 'browser', 'session', 'harness', 'analysis', 'workspace', 'web', 'mcp', 'plugin', 'provider'];
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mcp-catalog-'));
const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^YAN_|^ELECTRON_RUN_AS_NODE$/.test(key)));
const catalogs = {};
for (const name of names) {
  const entrypoint = `yan-${name}-mcp.js`;
  const raw = execFileSync(process.execPath, [path.join(root, 'lib', entrypoint)], {
    cwd: directory, env: { ...env, YAN_MCP_CATALOG_ONLY: '1' }, timeout: 30000, windowsHide: true, maxBuffer: 4 * 1024 * 1024
  });
  catalogs[`yan_${name}`] = { entrypoint, ...JSON.parse(raw.toString()) };
}
fs.writeFileSync(path.join(root, 'lib/kernel-v2/mcp-catalogs.json'), JSON.stringify(catalogs, null, 2) + '\n');
console.log(`Built ${Object.keys(catalogs).length} bundled MCP catalogs`);

'use strict';
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../dist/win-unpacked/resources/app.asar.unpacked'));
const runtime = path.join(root, 'vendor/opencode-v2/node-runtime/node.exe');
const entry = path.join(root, 'lib/yan-session-mcp.js');
// Run with the shipped standalone Node, and reject dependencies accidentally
// resolved from the development checkout above the packaged application.
const probe = `const {createRequire}=require('node:module');
const path=require('node:path');
const req=createRequire(${JSON.stringify(entry)});
for(const name of ['@openuidev/lang-core','zod/v4','ci-info']) {
 const loader=name==='ci-info'?createRequire(req.resolve('@openuidev/lang-core')):req;
 const resolved=loader.resolve(name);
 const relative=path.relative(${JSON.stringify(root)},resolved);
 if(relative.startsWith('..')||path.isAbsolute(relative)) throw Error('Dependency escaped package: '+name);
 loader(name);
}`;
const env = { ...process.env, NODE_PATH: '', NODE_OPTIONS: '', YAN_SESSION_BRIDGE_PORT: '', YAN_SESSION_BRIDGE_TOKEN: '' };
const options = { cwd: os.tmpdir(), env, encoding: 'utf8', timeout: 20000, windowsHide: true };
const dependencies = spawnSync(runtime, ['-e', probe], options);
assert.equal(dependencies.status, 0, dependencies.stderr || String(dependencies.error));
const requests = [
 { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-03-26', capabilities: {}, clientInfo: { name: 'packaging-check', version: '1' } } },
 { jsonrpc: '2.0', method: 'notifications/initialized' },
 { jsonrpc: '2.0', id: 2, method: 'tools/list' },
 { jsonrpc: '2.0', id: 3, method: 'ping' }
];
const result = spawnSync(runtime, [entry], { ...options, input: requests.map(x => JSON.stringify(x)).join('\n') + '\n' });
assert.equal(result.status, 0, result.stderr || String(result.error));
const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(replies.find(x => x.id === 1)?.result?.serverInfo?.name, 'Yan Session');
const names = replies.find(x => x.id === 2)?.result?.tools?.map(x => x.name) || [];
for (const name of ['create_handoff', 'read_source_context', 'intelligent_ui_creator']) assert(names.includes(name), `Missing tool: ${name}`);
assert.deepEqual(replies.find(x => x.id === 3)?.result, {});
console.log('[verify-packaged-session] dependencies, initialize, tools/list and ping passed');

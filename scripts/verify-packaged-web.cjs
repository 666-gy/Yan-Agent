'use strict';
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const root = path.resolve(process.argv[2] || path.join(__dirname, '../dist/win-unpacked/resources/app.asar.unpacked'));
const runtime = path.join(root, 'vendor/opencode-v2/node-runtime/node.exe');
const entry = path.join(root, 'lib/yan-web-mcp.js');
// Guard the entire transitive dependency graph, not just the two entry modules.
// A package inside the development checkout must not borrow its node_modules.
const probe = `const Module=require('node:module'),path=require('node:path');
const original=Module._resolveFilename;
Module._resolveFilename=function(...args){const resolved=original.apply(this,args);
 if(path.isAbsolute(resolved)) {const relative=path.relative(${JSON.stringify(root)},resolved);
  if(relative.startsWith('..')||path.isAbsolute(relative)) throw Error('Dependency escaped package: '+resolved);}
 return resolved;};
const req=Module.createRequire(${JSON.stringify(entry)});
const Turndown=req('turndown'); const {convert}=req('html-to-text');
if(!new Turndown().turndown('<h1>Web probe</h1>').includes('Web probe'))throw Error('Markdown conversion failed');
if(!convert('<p>Web probe</p>').includes('Web probe'))throw Error('Text conversion failed');
require(${JSON.stringify(entry)});`;
const input = [
  { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} },
  { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} },
  { jsonrpc: '2.0', id: 3, method: 'ping', params: {} }
].map(x => JSON.stringify(x)).join('\n') + '\n';
const result = spawnSync(runtime, ['-e', probe], { cwd: os.tmpdir(), input, encoding: 'utf8', timeout: 20000,
  windowsHide: true, env: { ...process.env, NODE_PATH: '', NODE_OPTIONS: '' } });
assert.equal(result.status, 0, result.stderr || String(result.error));
const replies = result.stdout.trim().split(/\r?\n/).map(line => JSON.parse(line));
assert.equal(replies.find(x => x.id === 1)?.result?.serverInfo?.name, 'Yan Web');
assert.ok(replies.find(x => x.id === 2)?.result?.tools?.some(tool => tool.name === 'fetch'));
assert.deepEqual(replies.find(x => x.id === 3)?.result, {});
console.log('[verify-packaged-web] isolated dependencies, HTML conversion, initialize, tools/list and ping passed');

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { PluginMcpClient } = require('../lib/plugins/mcp-client');

test('releasing the input worker preserves an application it launched', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-control-process-'));
  const fixture = path.join(dir, 'worker.cjs');
  const marker = path.join(dir, 'heartbeat');
  fs.writeFileSync(fixture, `const {spawn}=require('child_process');
    const app=spawn(process.execPath,['-e', 'const fs=require("fs");setInterval(()=>fs.writeFileSync(process.argv[1],String(Date.now())),30)', process.argv[2]],{stdio:'ignore',windowsHide:true,detached:true});
    require('readline').createInterface({input:process.stdin}).on('line',line=>{
      const m=JSON.parse(line);if(m.id===undefined)return;
      const result=m.method==='initialize'?{protocolVersion:'2025-03-26'}:m.method==='tools/list'?{tools:[]}:{pid:app.pid};
      console.log(JSON.stringify({jsonrpc:'2.0',id:m.id,result}));
    });`);
  const client = new PluginMcpClient({ id: 'control-preserve', type: 'local', command: process.execPath,
    args: [fixture, marker], killTree: false, timeoutMs: 5000 });
  let appPid;
  try {
    await client.start();
    appPid = (await client.request('tools/call', {})).pid;
    await new Promise(resolve => setTimeout(resolve, 150));
    await client.close();
    const before = fs.readFileSync(marker, 'utf8');
    await new Promise(resolve => setTimeout(resolve, 150));
    assert.notEqual(fs.readFileSync(marker, 'utf8'), before, 'target keeps running after worker exit');
    process.kill(appPid, 0);
  } finally {
    await client.close();
    if (appPid) { try { process.kill(appPid); } catch {} }
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

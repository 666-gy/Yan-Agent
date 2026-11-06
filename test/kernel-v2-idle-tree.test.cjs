'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

test('real V2 idle cleanup ends kernel and MCP child, then restores the session', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-v2-idle-tree-'));
  const marker = path.join(root, 'mcp.pid');
  const script = path.join(root, 'probe.cjs');
  fs.writeFileSync(script, `const fs=require('node:fs');
    fs.writeFileSync(${JSON.stringify(marker)},String(process.pid));
    require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
      const r=JSON.parse(line); if(r.id===undefined)return;
      const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'idle-probe',version:'1'}}:r.method==='tools/list'?{tools:[]}:{};
      process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n');
    });`);
  const adapter = new OpenCodeV2Adapter({ appRoot: path.resolve(__dirname, '..'), dataDir: root, instanceIdleMs: 100 });
  t.after(async () => { await adapter.close(); fs.rmSync(root, { recursive: true, force: true }); });
  const config = { mcp: { probe: { type: 'local', command: [process.execPath, script], enabled: true } } };
  let session, kernelPID, mcpPID;
  await adapter.resources.use(async () => {
    await adapter.start(config);
    kernelPID = adapter.status().pid;
    session = await adapter.client.session.create({ location: { directory: root }, title: 'persist across idle' });
    await adapter.client.mcp.list({ location: { directory: root } });
    const deadline = Date.now() + 5000;
    while (!fs.existsSync(marker) && Date.now() < deadline) await delay(20);
    assert.ok(fs.existsSync(marker), 'MCP process was started');
    mcpPID = Number(fs.readFileSync(marker, 'utf8'));
    assert.equal(alive(mcpPID), true);
    await delay(200);
    assert.equal(alive(kernelPID), true, 'live lease prevents idle teardown');
  });
  const deadline = Date.now() + 5000;
  while (alive(kernelPID) && Date.now() < deadline) await delay(25);
  assert.equal(alive(kernelPID), false);
  assert.equal(alive(mcpPID), false);
  await adapter.resources.use(async () => {
    await adapter.start(config);
    assert.notEqual(adapter.status().pid, kernelPID);
    assert.equal((await adapter.client.session.get({ sessionID: session.id })).title, 'persist across idle');
  });
});

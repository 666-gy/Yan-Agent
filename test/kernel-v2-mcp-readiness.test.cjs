'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { waitForMcp } = require('../lib/kernel-v2/mcp-readiness');
const { translateConfig } = require('../lib/kernel-v2/config');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');
const config = { mcp: { servers: { yan_browser: {}, optional: { disabled: true } } } };

test('MCP barrier waits for pending catalogs, skips deferred servers and fails honestly', async () => {
  let reads = 0;
  await waitForMcp({ mcp: { list: async () => ({ data: [{ name: 'yan_browser', status: { status: ++reads > 1 ? 'connected' : 'pending' } }] }) } }, config, os.tmpdir());
  assert.equal(reads, 2);
  await assert.rejects(waitForMcp({ mcp: { list: async () => ({ data: [{ name: 'yan_browser', status: { status: 'failed' } }] }) } }, config, os.tmpdir()), /yan_browser.*failed/);
  await assert.rejects(waitForMcp({ mcp: { list: async () => ({ data: [] }) } }, config, os.tmpdir(), () => false, { timeoutMs: 10 }), /启动超时/);
  await waitForMcp({}, config, os.tmpdir(), () => true);
  assert.deepEqual(translateConfig({ mcp: { browser: { timeout: 90000 } } }).mcp.servers.browser.timeout,
    { startup: 90000, catalog: 90000, execution: 90000 });
});

test('real V2 prewarm connects delayed MCP before admission without calling the provider', { timeout: 30000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-mcp-ready-'));
  const script = path.join(root, 'slow.cjs');
  fs.writeFileSync(script, `require('node:readline').createInterface({input:process.stdin}).on('line',line=>{
    const r=JSON.parse(line);if(r.id===undefined)return;
    const result=r.method==='initialize'?{protocolVersion:'2024-11-05',capabilities:{tools:{}},serverInfo:{name:'slow',version:'1'}}:r.method==='tools/list'?{tools:[{name:'ready_probe',description:'Readiness probe',inputSchema:{type:'object',properties:{}}}]}:{};
    setTimeout(()=>process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:r.id,result})+'\\n'),r.method==='initialize'?1500:0);
  });`);
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    for (const [delta, finish_reason] of [[{role:'assistant',content:'Ready'},null],[{},'stop']]) res.write(`data: ${JSON.stringify({id:'fixture',model:'fixture',object:'chat.completion.chunk',choices:[{index:0,delta,finish_reason}]})}\n\n`);
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({appRoot,dataDir:root}), dsml:false, accessMode:'full', enableSubagents:false };
  const openCodeConfig = buildOpenCodeConfig(options);
  openCodeConfig.mcp = { yan_browser: { type: 'local', command: [process.execPath, script], enabled: true } };
  const warmed = await adapter.prewarm(openCodeConfig, root);
  assert.equal(requests.length, 0);
  const catalog = await adapter.client.mcp.list({ location: { directory: root } });
  assert.equal(catalog.data.find(server => (server.name || server.id) === 'yan_browser').status.status, 'connected');
  const result = await adapter.run({...options,openCodeConfig,workspace:root,hasUserWorkspace:true,prompt:'Say ready'});
  assert.equal(adapter.status().pid, warmed.pid);
  console.log(JSON.stringify({ prewarmedMcp: true, kernelWaitMs: result.performance.kernelWaitMs, admission: result.performance.admission }));
  assert.equal(result.status, 'done');
  assert.ok(requests[0].tools.some(tool => tool.function.name.includes('ready_probe')), JSON.stringify(requests[0].tools.map(t => t.function.name)));
});

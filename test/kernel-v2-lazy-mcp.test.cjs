'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');
const { bundledCatalog, undiscoveredConfig } = require('../lib/mcp-tool-catalog');
const appRoot = path.resolve(__dirname, '..');

test('bundled catalogs never substitute for unknown, disabled or changed entrypoints', () => {
  const command = [process.execPath, path.join(appRoot, 'lib/yan-plugin-mcp.js')];
  assert.equal(bundledCatalog('yan_plugin', { type: 'local', command }).length, 3);
  assert.equal(bundledCatalog('yan_plugin', { type: 'local', command, disabled: true }), null);
  assert.equal(bundledCatalog('yan_plugin', { type: 'local', command: [process.execPath, 'different.js'] }), null);
  assert.equal(bundledCatalog('third_party', { type: 'local', command }), null);
  const entry = require('../lib/kernel-v2/mcp-catalogs.json').yan_plugin;
  const previous = entry.dependencies['yan-plugin-mcp.js'];
  try {
    entry.dependencies['yan-plugin-mcp.js'] = 'stale';
    assert.equal(bundledCatalog('yan_plugin', { type: 'local', command }), null);
  } finally { entry.dependencies['yan-plugin-mcp.js'] = previous; }
  assert.deepEqual(Object.keys(undiscoveredConfig({ mcp: { servers: {
    yan_plugin: { type: 'local', command }, external: { type: 'remote', url: 'https://example.invalid' }
  } } }).mcp.servers), ['external']);
});

for (const scenario of ['allow', 'reject', 'hello', 'cancel', 'parallel']) test(`lazy MCP real-kernel flow: ${scenario}`, { timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-lazy-mcp-'));
  const marker = path.join(root, 'ready');
  const executed = path.join(root, 'executed');
  const spawned = path.join(root, 'spawned');
  const slow = path.join(root, 'slow.cjs');
  fs.writeFileSync(slow, `require('fs').appendFileSync(${JSON.stringify(spawned)},process.pid+'\\n');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2500);require('fs').writeFileSync(${JSON.stringify(marker)},'ready');let pending='';process.stdin.on('data',chunk=>{pending+=chunk;let end;while((end=pending.indexOf('\\n'))>=0){const line=pending.slice(0,end);pending=pending.slice(end+1);if(line.includes('tools/call'))require('fs').appendFileSync(${JSON.stringify(executed)},'call\\n');}});`);
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const requests = []; let beforeReady = false;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const first = requests.length === 1;
    if (first) beforeReady = !fs.existsSync(marker);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'probe', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const calling = requests.length <= 2 && scenario !== 'hello';
    const toolCalls = Array.from({ length: scenario === 'parallel' ? 2 : 1 }, (_, index) => ({ index, id: `step-${requests.length}-${index}`, type: 'function', function: { name: first ? 'yan_plugin_connect' : 'yan_plugin_list_plugins', arguments: '{}' } }));
    send(calling ? { role: 'assistant', tool_calls: toolCalls }
      : { role: 'assistant', content: 'DONE' });
    send({}, calling ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
    if (first && scenario === 'cancel') setTimeout(() => void adapter.cancel('lazy'), 100);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false, accessMode: 'full' };
  const openCodeConfig = buildOpenCodeConfig(options);
  openCodeConfig.mcp = { yan_plugin: { type: 'local', command: [process.execPath, path.join(appRoot, 'lib/yan-plugin-mcp.js')],
    environment: { YAN_PLUGIN_DATA_DIR: root, NODE_OPTIONS: `--require="${slow.replaceAll('\\', '/')}"` }, enabled: true } };
  let approvals = 0;
  const result = await adapter.run({ ...options, runId: 'lazy', openCodeConfig, workspace: root, hasUserWorkspace: true, prompt: 'List installed plugins.' }, event => {
    if (event.type === 'permission.asked') {
      approvals++;
      void adapter.replyPermission({ runId: 'lazy', requestID: event.properties.id, reply: scenario === 'reject' ? 'reject' : 'once' });
    }
  });
  assert.equal(beforeReady, true, 'the model request must not wait for the 2.5s MCP startup');
  assert.ok(requests[0].tools.some(tool => tool.function.name === 'yan_plugin_connect'));
  assert.ok(!requests[0].tools.some(tool => tool.function.name === 'yan_plugin_list_plugins'));
  if (['reject', 'hello', 'cancel'].includes(scenario)) {
    assert.equal(result.status, scenario === 'hello' ? 'done' : scenario === 'cancel' ? 'interrupted' : 'error', result.error);
    assert.equal(fs.existsSync(executed), false, 'no tool may execute on rejection, cancellation or plain chat');
    assert.equal(approvals, scenario === 'reject' ? 1 : 0);
    if (scenario === 'hello') {
      await require('node:timers/promises').setTimeout(2800);
      assert.equal(fs.existsSync(marker), false, 'plain chat must never spawn MCP, even after startup would have finished');
      assert.equal(fs.existsSync(spawned), false);
    }
    if (scenario === 'cancel') {
      const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
      const pids = () => fs.existsSync(spawned) ? fs.readFileSync(spawned, 'utf8').trim().split('\n').map(Number) : [];
      const deadline = Date.now() + 10000;
      while (pids().some(alive) && Date.now() < deadline) await require('node:timers/promises').setTimeout(25);
      assert.equal(pids().some(alive), false, 'cancellation must not leave a partially connected child alive');
    }
    return;
  }
  assert.equal(result.status, 'done', result.error);
  assert.equal(approvals, scenario === 'parallel' ? 2 : 1, 'one native permission check per call');
  assert.ok(requests[1].tools.some(tool => tool.function.name === 'yan_plugin_list_plugins'), 'native tool schemas must appear on the step after connect');
  const toolReply = requests[2]?.messages.findLast(message => message.role === 'tool');
  assert.ok(toolReply, JSON.stringify(requests[2]?.messages));
  assert.match(JSON.stringify(toolReply), /installationAvailable/);
  assert.doesNotMatch(JSON.stringify(toolReply), /not registered|Unable to execute|error/);
  assert.equal(fs.readFileSync(executed, 'utf8').trim().split('\n').length, scenario === 'parallel' ? 2 : 1);
  assert.equal(result.performance.admission.mcpReadyMs < 100, true);
  console.log(JSON.stringify({ firstRequestBeforeMcpReady: beforeReady, admission: result.performance.admission }));
});

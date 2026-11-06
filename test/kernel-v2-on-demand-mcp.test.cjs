'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const { capabilities } = require('../lib/kernel-v2/mcp-capabilities');
const staging = require('../lib/provider-staging');
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };
async function until(check, message) {
  const deadline = Date.now() + 10000;
  while (!await check() && Date.now() < deadline) await delay(25);
  assert.ok(await check(), message);
}

test('nine builtins prewarm without processes; explicit connection, session isolation and idle reconnect use native tools', { timeout: 45000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-demand-mcp-'));
  const appRoot = path.resolve(__dirname, '..');
  const marker = path.join(root, 'processes.jsonl');
  const probe = path.join(root, 'probe.cjs');
  fs.writeFileSync(probe, `require('node:fs').appendFileSync(${JSON.stringify(marker)},JSON.stringify({name:process.env.YAN_MCP_PROBE_NAME,pid:process.pid})+'\\n');`);
  const processes = () => fs.existsSync(marker) ? fs.readFileSync(marker, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [];
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root, instanceIdleMs: 60000, mcpIdleMs: 400 });
  let phase = 'hello', step = 0, release, holding = false;
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    const current = step++;
    bodies.push({ phase, body });
    if (phase === 'hold' && current === 2) {
      holding = true;
      await new Promise(resolve => { release = resolve; });
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    const call = phase !== 'hello' && current < 2;
    send(call ? { role: 'assistant', tool_calls: [{ index: 0, id: `call-${bodies.length}`, type: 'function',
      function: { name: current === 0 ? 'yan_plugin_connect' : 'yan_plugin_list_plugins', arguments: '{}' } }] }
      : { role: 'assistant', content: 'DONE' });
    send({}, call ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    release?.(); await adapter.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', dsml: false, accessMode: 'full',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }) };
  const config = buildOpenCodeConfig(options);
  config.mcp = Object.fromEntries(Object.keys(capabilities).map(name => [name, {
    type: 'local', command: [process.execPath, path.join(appRoot, 'lib', `yan-${name.slice(4)}-mcp.js`)], enabled: true,
    environment: { YAN_PLUGIN_DATA_DIR: root, YAN_MCP_PROBE_NAME: name, NODE_OPTIONS: `--require="${probe.replaceAll('\\', '/')}"` }
  }]));
  const request = { ...options, openCodeConfig: config, workspace: root, hasUserWorkspace: true, prompt: 'List plugins.' };
  const emit = event => {
    if (event.type === 'permission.asked') void adapter.replyPermission({ runId: 'demand', requestID: event.properties.id, reply: 'once' });
  };
  const warmed = await adapter.prewarm(config, root);
  assert.ok(warmed.pid);
  const status = () => adapter.client.mcp.list({ location: { directory: root } });
  await until(async () => (await status()).data.filter(server => server.status.status === 'disabled').length === 10,
    'all ten registered servers must remain disabled during prewarm');
  await delay(700);
  assert.deepEqual(processes(), [], 'quiet prewarm must spawn zero builtin MCP children');
  const hello = await adapter.run({ ...request, runId: 'hello', prompt: 'What can you do?' });
  assert.equal(hello.status, 'done', hello.error);
  const initial = bodies[0].body.tools.map(tool => tool.function.name);
  assert.equal(initial.filter(name => /^yan_.*_connect$/.test(name)).length, 10);
  assert.equal(initial.includes('yan_plugin_list_plugins'), false);
  assert.deepEqual(processes(), []);

  phase = 'hold'; step = 0;
  const running = adapter.run({ ...request, runId: 'demand', openCodeSessionId: hello.openCodeSessionId }, emit);
  running.catch(() => {});
  await until(() => holding, 'native list_plugins must finish and the following model request must arrive');
  assert.equal(processes().length, 1, 'one connection must not start the other nine services');
  const pid = processes()[0].pid;
  assert.equal(processes()[0].name, 'yan_plugin');
  await delay(1000);
  assert.equal(alive(pid), true, 'a model request still in flight protects the MCP beyond its idle timeout');
  release();
  const used = await running;
  assert.equal(used.status, 'done', used.error);
  assert.ok(bodies.find(item => item.phase === 'hold' && item.body.tools.some(tool => tool.function.name === 'yan_plugin_list_plugins')));
  assert.ok(used.toolCalls.some(call => /list_plugins/.test(call.name) && call.ok));

  phase = 'hello'; step = 0;
  const peer = await adapter.run({ ...request, runId: 'peer', prompt: 'Hello.' });
  assert.equal(peer.status, 'done', peer.error);
  assert.equal(bodies.at(-1).body.tools.some(tool => tool.function.name === 'yan_plugin_list_plugins'), false,
    'a different native session must opt in even when its sibling connected the service');
  await until(() => !alive(pid), 'idle release must terminate the MCP process');
  assert.equal(alive(warmed.pid), true, 'the warm kernel remains reusable');
  await until(async () => (await status()).data.find(server => server.name === 'yan_plugin').status.status === 'disabled',
    'disconnect must finish publishing the released state');

  phase = 'use'; step = 0;
  const offset = bodies.length;
  const resumed = await adapter.run({ ...request, runId: 'demand', openCodeSessionId: hello.openCodeSessionId }, emit);
  assert.equal(resumed.status, 'done', resumed.error);
  assert.equal(resumed.openCodeSessionId, hello.openCodeSessionId);
  assert.equal(adapter.status().pid, warmed.pid);
  assert.equal(bodies[offset].body.tools.some(tool => tool.function.name === 'yan_plugin_list_plugins'), false,
    'released tool definitions must disappear while their connector remains');
  assert.equal(processes().length, 2);
  assert.notEqual(processes()[1].pid, pid);
  assert.ok(resumed.toolCalls.some(call => /list_plugins/.test(call.name) && call.ok));

  phase = 'use'; step = 0;
  const customOffset = bodies.length;
  const custom = await adapter.run({ ...request, runId: 'demand', customAgent: {
    id: 'custom-probe', name: 'Plugin reader', tools: ['yan_plugin_list_plugins'], systemPrompt: 'List installed plugins.'
  } }, emit);
  assert.equal(custom.status, 'done', custom.error);
  assert.deepEqual(bodies[customOffset].body.tools.map(tool => tool.function.name), ['yan_plugin_connect']);
  assert.deepEqual(bodies[customOffset + 1].body.tools.map(tool => tool.function.name).sort(),
    ['yan_plugin_connect', 'yan_plugin_list_plugins']);
  assert.equal(processes().length, 2, 'a new permitted native session reuses the connection without another child');
  console.log(JSON.stringify({ coldBuiltinProcesses: 0, initialCapabilityTools: 10, connectedBuiltinProcesses: 1,
    idleChildReleased: true, warmKernelReused: true, reconnected: true }));
});

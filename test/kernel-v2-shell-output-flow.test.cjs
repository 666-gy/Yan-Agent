'use strict';
// Verify the actual next provider request through the shipped kernel. Local
// fixtures only: no external models, desktop user DB or shell commands.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');
const listen = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));

test('real V2 bounds successful, failed and status shell outputs before model replay', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-shell-output-flow-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const { SHELL_OUTPUT_BYTES, SHELL_OUTPUT_LINES } = await import('../lib/kernel-v2/plugin/shell-output.js');
  const originalEnv = Object.fromEntries(['YAN_BASH_BRIDGE_URL', 'YAN_BASH_BRIDGE_TOKEN', 'YAN_SHELL_AUTONOMY'].map(key => [key, process.env[key]]));
  let scenario, calls = 0, requests = [], sent = false;
  const bridge = http.createServer(async (req, res) => {
    for await (const _chunk of req) { /* drain */ }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    if (req.url === '/context-usage') { res.end('{"ok":true}'); return; }
    calls++; res.end(JSON.stringify(scenario.payload));
  });
  const provider = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    if (!body.tools?.length) { send({ role: 'assistant', content: 'fixture' }); send({}, 'stop'); }
    else {
      requests.push(body);
      if (!sent) {
        sent = true;
        send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_output', type: 'function', function: {
          name: scenario.tool || 'bash', arguments: JSON.stringify(scenario.tool === 'bash_status' ? { jobId: 'fixture-job' } : { command: 'fixture-command' })
        } }] }); send({}, 'tool_calls');
      } else { send({ role: 'assistant', content: 'OUTPUT_FLOW_DONE' }); send({}, 'stop'); }
    }
    res.end('data: [DONE]\n\n');
  });
  await listen(bridge); await listen(provider);
  process.env.YAN_BASH_BRIDGE_URL = `http://127.0.0.1:${bridge.address().port}`;
  process.env.YAN_BASH_BRIDGE_TOKEN = 'fixture'; process.env.YAN_SHELL_AUTONOMY = 'full';
  t.after(async () => {
    await adapter.close(); bridge.closeAllConnections(); provider.closeAllConnections();
    await Promise.all([new Promise(r => bridge.close(r)), new Promise(r => provider.close(r))]);
    for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false, accessMode: 'full', enableSubagents: false };
  const big = 'HEAD_SENTINEL\n' + '界🙂 diagnostic line\n'.repeat(12000) + 'TAIL_SENTINEL';
  for (const next of [
    { name: 'success', payload: { exit: 0, output: big, truncated: false } },
    { name: 'failure', payload: { exit: 7, output: big, truncated: false } },
    { name: 'capture-limit', payload: { exit: 0, output: big.repeat(3), truncated: true } },
    { name: 'status', tool: 'bash_status', payload: { id: 'fixture-job', status: 'failed', exit: 7, output: big, truncated: true } },
    { name: 'small', payload: { exit: 0, output: 'SMALL_OUTPUT', truncated: false } },
    { name: 'persistent-success', agentPreset: 'minimal', payload: { exit: 0, output: big, truncated: false } },
    { name: 'persistent-failure', agentPreset: 'minimal', payload: { exit: 7, output: big, truncated: true } }
  ]) {
    scenario = next; calls = 0; requests = []; sent = false;
    const result = await adapter.run({ ...options, agentPreset: next.agentPreset, runId: next.name, workspace: root, hasUserWorkspace: false,
      prompt: `OUTPUT_TEST_${next.name}`, openCodeConfig: buildOpenCodeConfig(options) }, event => {
      if (event.type === 'permission.asked') void adapter.replyPermission({ runId: next.name, requestId: (event.properties || event.data).id, reply: 'once' });
    });
    assert.equal(result.status, 'done', JSON.stringify(result));
    assert.equal(calls, 1, 'command/status must not be executed again');
    const results = requests.flatMap(body => body.messages.filter(message => message.role === 'tool'));
    assert.equal(results.length, 1, next.name + ': result reaches next provider call');
    const output = typeof results[0].content === 'string' ? results[0].content : results[0].content.map(part => part.text || '').join('\n');
    assert.ok(Buffer.byteLength(output) <= SHELL_OUTPUT_BYTES + 1024, `${next.name}: provider error framing is bounded`);
    assert.ok(output.split('\n').length <= SHELL_OUTPUT_LINES + 5);
    if (next.name === 'small') { assert.match(output, /SMALL_OUTPUT/); assert.doesNotMatch(output, /Output shortened/); continue; }
    assert.match(output, /HEAD_SENTINEL/); assert.match(output, /TAIL_SENTINEL/);
    assert.doesNotMatch(output, /\uFFFD/);
    if (next.tool !== 'bash_status') assert.match(output, new RegExp(`Command ${next.agentPreset ? 'finished with exit' : 'exited with'} code ${next.payload.exit}`));
    if (next.payload.truncated) assert.match(output, /not the complete command output/);
    const file = output.match(/Captured output saved to (.+?)\. Read selected ranges/)?.[1];
    assert.ok(file, next.name + ': recoverable output reference');
    assert.ok(path.resolve(file).startsWith(path.resolve(root) + path.sep));
    const saved = fs.readFileSync(file, 'utf8');
    assert.ok(saved.includes(next.tool === 'bash_status' ? JSON.stringify(big).slice(1, -1) : next.payload.output));
    const call = result.toolCalls.find(call => call.name === (next.tool || 'bash'));
    assert.equal(call.ok, next.tool === 'bash_status' || next.payload.exit === 0, 'exit failure semantics remain intact');
  }
});

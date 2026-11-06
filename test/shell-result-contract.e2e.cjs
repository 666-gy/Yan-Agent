'use strict';
// Isolated local provider + bridge, real bundled V2 kernel. No user DB or API.
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');
const { DatabaseSync } = require('node:sqlite');
const assert = require('node:assert/strict');
const appRoot = path.resolve(process.env.YAN_SHELL_TEST_APP_ROOT || path.join(__dirname, '..'));
const serve = server => new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
async function probe(label, payload, invalid = false) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-shell-contract-'));
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  const requests = [], events = [], bridgeCalls = [], diagnostics = [];
  const start = adapter.transport.start.bind(adapter.transport);
  const invalidDirectory = path.join(root, 'invalid-plugin');
  fs.mkdirSync(invalidDirectory);
  fs.writeFileSync(path.join(invalidDirectory, 'package.json'), JSON.stringify({name:'fixture-invalid-result',type:'module',exports:{'.':'./index.mjs'}}));
  const invalidPlugin = path.join(invalidDirectory, 'index.mjs');
  if (invalid) fs.writeFileSync(invalidPlugin, `import { z } from ${JSON.stringify(require('node:url').pathToFileURL(path.join(appRoot, 'node_modules/zod/index.js')).href)};
    export default { id: 'fixture.invalid-result', async setup(ctx) {
      await ctx.aisdk.hook('sdk', async event => { if (!event.package.startsWith('file:')) return; const module = await import(event.package); const factory = Object.entries(module).find(([name, value]) => name.startsWith('create') && typeof value === 'function')[1]; event.sdk = factory({ ...event.options, name: event.model.providerID }); });
      await ctx.tool.transform(editor => { editor.remove('shell'); editor.remove('opencode.shell'); editor.add({ name: 'shell', description: 'Regression fixture', input: z.object({command:z.string()}), options:{codemode:false,permission:'shell'}, execute: async () => ({content:'fixture',metadata:{exit:undefined}}) }); });
    } };`);
  adapter.transport.start = async config => {
    if (invalid) config = { ...config, plugins: [require('node:url').pathToFileURL(invalidDirectory).href] };
    const result = await start(config); adapter.transport.child?.stderr.on('data', c => diagnostics.push(String(c))); return result;
  };
  const bridge = http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    bridgeCalls.push(JSON.parse(raw)); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(payload));
  }); });
  const provider = http.createServer((req, res) => { let raw = ''; req.on('data', c => raw += c); req.on('end', () => {
    const body = JSON.parse(raw); requests.push(body);
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason: finish }] })}\n\n`);
    if (body.tools?.length && !requests.some((r, i) => i < requests.length - 1 && r.tools?.length)) {
      send({ role: 'assistant', tool_calls: [{ index: 0, id: 'call_shell', type: 'function', function: { name: 'shell', arguments: JSON.stringify({ command: 'node -v' }) } }] }); send({}, 'tool_calls');
    } else { send({ role: 'assistant', content: 'CONTRACT_FINISHED' }); send({}, 'stop'); }
    res.end('data: [DONE]\n\n');
  }); });
  await serve(bridge); await serve(provider);
  process.env.YAN_BASH_BRIDGE_URL = `http://127.0.0.1:${bridge.address().port}`;
  process.env.YAN_BASH_BRIDGE_TOKEN = 'isolated-fixture';
  process.env.YAN_SHELL_AUTONOMY = 'full';
  let result, failure;
  const guard = setTimeout(() => { void adapter.cancel('contract'); }, 25000);
  try {
    const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${provider.address().port}/v1`, deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false, accessMode: 'full', enableSubagents: false };
    result = await adapter.run({ ...options, runId: 'contract', workspace: root, hasUserWorkspace: false, prompt: 'Execute node -v once, then finish.', openCodeConfig: buildOpenCodeConfig(options) }, event => {
      events.push(event);
      if (event.type === 'permission.asked') void adapter.replyPermission({ runId: 'contract', requestId: (event.properties || event.data).id, reply: 'always' });
    });
  } catch (e) { failure = e.stack; }
  finally { clearTimeout(guard); await adapter.close(); bridge.closeAllConnections(); provider.closeAllConnections(); await Promise.all([new Promise(r => bridge.close(r)), new Promise(r => provider.close(r))]); }
  const db = new DatabaseSync(path.join(root, 'opencode-runtime-v2/data/opencode/opencode.db'), { readOnly: true });
  const parts = db.prepare('select data from session_message').all().flatMap(r => JSON.parse(r.data).content || []).filter(p => p.type === 'tool'); db.close();
  const summary = { label, root, payload, failure, status: result?.status, calls: bridgeCalls.length, parts, diagnostics, modelToolResults: requests.flatMap(r => (r.messages || []).filter(m => m.role === 'tool')), eventTypes: [...new Set(events.map(e => e.type))] };
  fs.writeFileSync(path.join(root, 'result.json'), JSON.stringify(summary, null, 2));
  if (invalid) {
    assert.notEqual(result?.status, 'done', 'durable publication failure cannot complete successfully');
    assert.equal(parts.length, 1); assert.equal(parts[0].state.status, 'error');
    assert.doesNotMatch(diagnostics.join(''), /Tool result missing/);
    console.log('PASS real kernel compensates invalid metadata and reports failure');
    return;
  }
  assert.equal(failure, undefined, label);
  assert.equal(result?.status, 'done', label);
  assert.equal(bridgeCalls.length, 1, label + ': must not rerun');
  assert.equal(parts.length, 1, label);
  assert.equal(parts[0].state.status, payload.exit && payload.exit !== 0 ? 'error' : 'completed', label);
  assert.ok(summary.modelToolResults.length > 0, label + ': durable result must reach next model call');
  assert.doesNotMatch(diagnostics.join(''), /Expected JSON value|Tool result missing/, label);
  console.log('PASS real kernel durable result: ' + label);
}
(async () => {
  if (process.argv.includes('--invalid-only')) { await probe('invalid-metadata-compensation', { exit: 0, output: 'fixture' }, true); return; }
  await probe('background-budget-shape', { background: true, jobId: 'isolated-job', output: 'Waiting for another command.' });
  await probe('background-full-shape', { background: true, jobId: 'isolated-job', output: 'Waiting for another command.', exit: null, truncated: false });
  await probe('background-missing-exit', { background: true, jobId: 'isolated-job', output: 'Waiting for another command.', truncated: false });
  await probe('background-missing-truncated', { background: true, jobId: 'isolated-job', output: 'Waiting for another command.', exit: null });
  await probe('timeout', { exit: null, timedOut: true, truncated: false, output: 'time budget reached', background: true, jobId: 'isolated-job' });
  await probe('foreground', { exit: 0, truncated: false, output: 'v24.fixture', jobId: 'isolated-job' });
  await probe('invalid-metadata-compensation', { exit: 0, output: 'fixture' }, true);
})().catch(e => { console.error(e); process.exitCode = 1; });

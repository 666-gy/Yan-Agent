'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('non-Git writes publish live and completed changes while todo remains available', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-file-bash-flow-'));
  const appRoot = path.resolve(__dirname, '..');

  fs.writeFileSync(path.join(root, 'sample.txt'), 'before\n');
  fs.writeFileSync(path.join(root, 'probe.cjs'), "console.log('TESTER_BASH_OK');\n");

  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: path.join(root, 'data') });
  const events = [], childOutputs = [];
  let parentStep = 0, childStep = 0;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    if (body.tools?.length && !JSON.stringify(body.messages).includes('DIAGNOSTIC_CHILD')) assert.ok(body.tools.some(t => t.function?.name === 'todowrite'), 'main catalog includes todos');
    const child = (body.messages || []).some(m => m.role === 'user' && JSON.stringify(m.content).includes('DIAGNOSTIC_CHILD'));
    let call;
    if (body.tools?.length) {
      if (child && childStep++ === 0) call = { name: 'bash', arguments: JSON.stringify({ command: 'node probe.cjs' }) };
      else if (!child && parentStep++ === 0) call = { name: 'read', arguments: JSON.stringify({ path: path.join(root, 'sample.txt') }) };
      else if (!child && parentStep === 2) call = { name: 'write', arguments: JSON.stringify({ path: path.join(root, 'sample.txt'), content: 'after\n' }) };
      else if (!child && parentStep === 3) {
        await delay(600); // Give the live manifest time to arrive before finalization.
        call = { name: 'spawn_agent', arguments: JSON.stringify({ name: 'Run diagnostic', prompt: 'DIAGNOSTIC_CHILD: run node probe.cjs and report.' }) };
      }
      if (child) childOutputs.push(...body.messages.filter(m => m.role === 'tool').map(m => m.content));
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send(call ? { role: 'assistant', tool_calls: [{ index: 0, id: `call_${child ? 'child' : 'parent'}_${child ? childStep : parentStep}`, type: 'function', function: call }] } : { role: 'assistant', content: 'FLOW_DONE' });
    send({}, call ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false, accessMode: 'full', enableSubagents: true };
  const result = await adapter.run({ ...options, runId: 'flow', workspace: root, hasUserWorkspace: true, prompt: 'Edit sample then run a tester diagnostic.', openCodeConfig: buildOpenCodeConfig(options) }, event => {
    events.push(event);
    if (event.type === 'permission.asked') void adapter.replyPermission({ runId: 'flow', requestId: (event.data || event.properties).id, reply: 'once' });
  });
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.equal(fs.readFileSync(path.join(root, 'sample.txt'), 'utf8'), 'after\n', JSON.stringify(result.toolCalls));
  assert.ok(events.some(e => e.type === 'session.diff' && e.properties.diff.some(f => (f.file || f.path).endsWith('sample.txt'))), 'file snapshot must arrive during execution');
  assert.ok(result.changes.some(f => (f.file || f.path).endsWith('sample.txt')), 'completion preserves non-Git changes');
  assert.deepEqual(await adapter.runChanges('flow'), result.changes, 'completed review remains available');
  const history = await adapter.sessionChanges({ sessionId: adapter.completed.get('flow').sessionID, directory: root });
  assert.ok(history.some(f => (f.file || f.path).endsWith('sample.txt')), 'history review uses the IPC directory field');
  assert.deepEqual(await adapter.sessionChanges({ sessionId: adapter.completed.get('flow').sessionID, directory: root, startTime: Date.now() + 1000 }), [], 'history excludes other turns');
  assert.deepEqual(await adapter.sessionChanges({ sessionId: adapter.completed.get('flow').sessionID, directory: root, paths: ['unrelated.txt'] }), [], 'single-file review remains scoped');
  assert.match(JSON.stringify(childOutputs), /TESTER_BASH_OK/);
  assert.doesNotMatch(JSON.stringify(childOutputs), /Permission denied/);
});

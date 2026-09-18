'use strict';
// Real OpenCode kernel + shipped bundle against a strict local API. No keys
// or user sessions; verifies native parent/child tool loops on the wire.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { OpenCodeSidecar, buildOpenCodeConfig, stageDeepSeekProviderModule } = require('../lib/opencode-sidecar');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-reasoning-replay-'));
const workspace = path.join(root, 'workspace');
fs.mkdirSync(workspace);
const file = path.join(workspace, 'fixture.txt');
fs.writeFileSync(file, 'reasoning replay fixture');
const parentMarker = 'YAN_PARENT_REPLAY';
const childMarker = 'YAN_CHILD_REPLAY';
const thought = '  Exact parent reasoning.\n保留空白与换行。\n';
const failures = [];
const counts = { parent: 0, child: 0, replay: 0, empty: 0 };
const server = http.createServer((req, res) => {
  let raw = '';
  req.setEncoding('utf8');
  req.on('data', chunk => { raw += chunk; });
  req.on('end', () => {
    try {
      const body = JSON.parse(raw);
      const lastUser = body.messages.findLastIndex(message => message.role === 'user');
      const userText = JSON.stringify(body.messages[lastUser]?.content || '');
      const child = userText.includes(childMarker);
      const childThought = body.model.startsWith('deepseek') ? '  Child reasoning\n精确回传。\n' : '';
      const active = body.tools?.length && (child || userText.includes(parentMarker));
      if (active) {
        counts[child ? 'child' : 'parent']++;
        assert.ok(counts.parent + counts.child < 35, 'bounded tool loop');
        for (const message of body.messages.filter(message => message.role === 'assistant')) {
          assert.equal(typeof message.reasoning_content, 'string', 'The reasoning_content in the thinking mode must be passed back to the API');
          assert.equal(message.reasoning_content, child ? childThought : thought, 'replay must preserve actual reasoning, not replace it with an empty marker');
          counts.replay++;
          if (!message.reasoning_content) counts.empty++;
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const emit = (delta, finish = null) => res.write('data: ' + JSON.stringify({ id: 'fixture', object: 'chat.completion.chunk',
        model: body.model, choices: [{ index: 0, delta, finish_reason: finish }] }) + '\n\n');
      if (!active) { emit({ content: 'fixture' }); emit({}, 'stop'); }
      else {
        const step = body.messages.slice(lastUser + 1).filter(message => message.role === 'tool').length;
        // Child's zero-length reasoning is deliberately omitted by SDKs.
        if (!child) for (const piece of [thought.slice(0, 9), thought.slice(9)]) emit({ reasoning_content: piece });
        else if (childThought) emit({ reasoning_content: childThought });
        if (step === 0 || (!child && step === 1)) {
          const name = step === 0 ? 'read' : 'task';
          const args = name === 'read' ? { filePath: file } : { subagent_type: 'explorer', description: 'Inspect fixture',
            prompt: childMarker + ': read ' + file + '\nyan-plan: {"id":"inspect","acceptance":"fixture read"}' };
          emit({ tool_calls: [{ index: 0, id: `${child ? 'child' : 'parent'}-${step}-${counts.parent + counts.child}`,
            type: 'function', function: { name, arguments: JSON.stringify(args) } }] });
          emit({}, 'tool_calls');
        } else { emit({ content: child ? 'Child verified fixture.' : 'Parent and child finished.' }); emit({}, 'stop'); }
      }
      res.end('data: [DONE]\n\n');
    } catch (error) {
      failures.push(error.message);
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: error.message, type: 'invalid_request_error' } }));
    }
  });
});
(async () => {
  const sidecar = new OpenCodeSidecar({ appRoot, dataDir: path.join(root, 'data') });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    const deepSeekProviderModule = stageDeepSeekProviderModule({ appRoot, dataDir: path.join(root, 'data') });
    for (const modelId of ['deepseek-v4-flash', 'gpt-5.2']) {
      const providerId = 'replay-fixture';
      const config = buildOpenCodeConfig({ providerId, modelId, dsml: true, deepSeekProviderModule,
        apiKey: 'local-fixture', baseUrl: `http://127.0.0.1:${server.address().port}/v1`, workMode: 'normal',
        enableSubagents: true, mcpServers: [], capabilities: { maxOutputTokens: 4096 } });
      const request = { runId: 'replay-' + modelId, workspace, hasUserWorkspace: true, prompt: parentMarker + ': inspect',
        providerId, modelId, openCodeConfig: config, enableSubagents: true, workMode: 'normal' };
      const result = await sidecar.run(request);
      assert.deepEqual(failures, []);
      assert.equal(result.status, 'done', result.error);
      assert.ok(result.toolCalls.some(call => call.name === 'task' && call.status === 'completed'), 'native child must finish');
      const followup = await sidecar.run({ ...request, runId: request.runId + '-next',
        openCodeSessionId: result.openCodeSessionId, prompt: parentMarker + ': inspect again' });
      assert.equal(followup.status, 'done', followup.error);
      assert.deepEqual(failures, []);
    }
    assert.ok(counts.child >= 8 && counts.empty > 0 && counts.replay > 0, JSON.stringify(counts));
    console.log(JSON.stringify({ ok: true, counts, exactParentReasoning: true, emptyChildReasoning: true, followup: true, aliases: true }));
  } finally {
    const child = sidecar.server?.child;
    const stopped = child && child.exitCode === null ? new Promise(resolve => child.once('exit', resolve)) : Promise.resolve();
    sidecar.close();
    await stopped;
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    assert.equal(path.dirname(root), os.tmpdir());
    assert.ok(path.basename(root).startsWith('yan-reasoning-replay-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('shipped kernel obeys threshold and distinguishes overflow recovery with actual context reads', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-compaction-flow-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  let usage = 1000, overflow = false, summaries = 0, lastModel, refuseSummary = false;
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push(body);
    lastModel = body.model;
    const summary = body.messages.some(m => JSON.stringify(m.content).includes('You MUST use this format for your response'));
    if (overflow && !summary && body.tools?.length) {
      overflow = false;
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'maximum context length is 100000 tokens', type: 'invalid_request_error', code: 'context_length_exceeded' } }));
      return;
    }
    if (summary) summaries++;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const chunk = { id: 'fixture', model: 'fixture', object: 'chat.completion.chunk' };
    const send = value => res.write(`data: ${JSON.stringify({ ...chunk, ...value })}\n\n`);
    send({ choices: [{ index: 0, delta: { role: 'assistant', content: summary ? (refuseSummary ? 'I cannot summarize this conversation.' : '## Objective\n- Continue the test.\n## Next Move\n1. Reply.') : 'DONE' }, finish_reason: null }] });
    send({ choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] });
    send({ choices: [], usage: { prompt_tokens: summary ? 60000 : usage, completion_tokens: 20, total_tokens: (summary ? 60000 : usage) + 20 } });
    res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false,
    contextWindow: 100000, compactionThreshold: 70000, accessMode: 'full', enableSubagents: false };
  const openCodeConfig = buildOpenCodeConfig(options);
  const events = [];
  const results = [];
  const run = async (sessionID, prompt) => {
    const result = await adapter.run({ ...options, openCodeConfig, openCodeSessionId: sessionID, workspace: root, hasUserWorkspace: true, prompt }, event => events.push(event));
    assert.equal(result.status, 'done', JSON.stringify(result));
    results.push(result);
    return result;
  };
  const first = await run(undefined, 'Reply DONE.');
  const sessionID = first.openCodeSessionId;
  assert.ok(sessionID, JSON.stringify(first));
  // Leave room for Yan's per-turn guidance, which is also part of the prompt.
  usage = 68000;
  await run(sessionID, 'Reply again.');
  assert.equal(summaries, 0, 'previous 1000-token context must not compact below 70000');
  usage = 71000;
  await run(sessionID, 'x');
  assert.equal(summaries, 0, 'a measured context just below the threshold must remain intact');
  usage = 1000;
  await run(sessionID, 'Continue after the high usage response.');
  assert.equal(summaries, 1);
  const started = events.filter(e => e.type === 'yan.context.compression.started').at(-1).data;
  assert.equal(started.reason, 'auto');
  assert.equal(started.threshold, 70000);
  assert.ok(started.beforeTokens >= 70000);
  const completed = events.filter(e => e.type === 'yan.context.compression.completed').at(-1).data;
  assert.ok(completed.afterTokens > 0 && completed.afterTokens < 10000, JSON.stringify(completed));
  const active = await adapter.activeContext(sessionID);
  assert.ok(Array.isArray(active) && active.some(m => m.type === 'compaction'));
  overflow = true;
  await run(sessionID, 'Recover from a simulated provider rejection.');
  const recovered = events.filter(e => e.type === 'yan.context.compression.started').at(-1).data;
  assert.equal(recovered.reason, 'overflow');
  assert.ok(recovered.beforeTokens < recovered.threshold, JSON.stringify(recovered));
  assert.equal(summaries, 2);
  assert.ok(events.some(e => e.type === 'yan.context.budget' && e.data.softThreshold === 70000));
  assert.equal(results.at(-1).contextCompressionCount, 1);
  const checkpoint = (await adapter.activeContext(sessionID)).find(m => m.type === 'compaction');
  assert.equal(checkpoint.metadata.yanContext.reason, 'overflow', 'reason must survive in the durable checkpoint');
  const summariesBeforeManual = summaries;
  const manual = await adapter.compressSession({ ...options, openCodeConfig, openCodeSessionId: sessionID });
  assert.equal(manual.compacted, true, JSON.stringify(manual));
  assert.equal(summaries, summariesBeforeManual + 1, 'manual compression must send a model summary request');
  const manualCheckpoint = (await adapter.activeContext(sessionID)).find(m => m.type === 'compaction');
  assert.equal(manualCheckpoint?.status, 'completed');
  assert.match(JSON.stringify(manualCheckpoint), /Continue the test/);
  assert.ok(manual.beforeTokens > 0 && manual.afterTokens > 0, JSON.stringify(manual));
  assert.equal(manual.budget.softThreshold, 70000);
  const nothing = await adapter.compressSession({ ...options, openCodeConfig, openCodeSessionId: sessionID });
  assert.equal(nothing.compacted, false);
  assert.match(nothing.error, /没有可压缩的早期对话/);
  // Restart with only a replacement model configured. The saved session still
  // names the removed model; compaction must switch it before resolving it.
  const replacement = { ...options, modelId: 'replacement' };
  await run(sessionID, 'More conversation before switching the model.');
  assert.match(JSON.stringify(requests.at(-1).messages), /Continue the test/, 'the next model request must consume the generated summary');
  const replacementConfig = buildOpenCodeConfig(replacement);
  const switched = await adapter.compressSession({ ...replacement, openCodeConfig: replacementConfig, openCodeSessionId: sessionID });
  assert.equal(switched.compacted, true, JSON.stringify(switched));
  assert.equal(lastModel, 'replacement');
  const continued = await adapter.run({ ...replacement, openCodeConfig: replacementConfig,
    openCodeSessionId: sessionID, workspace: root, prompt: 'More conversation before summarizing.' }, () => {});
  assert.equal(continued.status, 'done');
  refuseSummary = true;
  const refused = await adapter.compressSession({ ...replacement, openCodeConfig: replacementConfig, openCodeSessionId: sessionID });
  assert.equal(refused.compacted, false);
  assert.match(refused.error, /模型未生成有效/);
});

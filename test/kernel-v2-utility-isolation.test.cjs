'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { OpenCodeV2Pool } = require('../lib/kernel-v2/pool');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('targeted prewarm and suggestions preserve the primary kernel PID and history', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-utility-isolation-'));
  const appRoot = path.resolve(__dirname, '..');
  const pool = new OpenCodeV2Pool({ appRoot, dataDir: root, instanceIdleMs: 60000 });
  const bodies = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    bodies.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'deepseek-flash', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant', content: 'OK' }); send({}, 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await pool.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); });
  const options = { providerId: 'fixture', modelId: 'deepseek-flash', apiKey: 'local',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`, dsml: true, accessMode: 'full',
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }) };
  const primaryConfig = buildOpenCodeConfig(options);
  const utilityConfig = buildOpenCodeConfig({ ...options, reasoningSpeed: 'low' });
  // Ensure distinct valid configs even if this fixture model ignores reasoning options.
  utilityConfig.agent = { build: { prompt: 'Only suggest a next message.' } };
  const common = { ...options, yanSessionId: 'desktop-task', workspace: root, hasUserWorkspace: true };
  const warmed = await pool.prewarm(primaryConfig, root, { yanSessionId: common.yanSessionId });
  assert.ok(warmed.pid, 'targeted prewarm must actually start the owner');
  assert.equal(bodies.length, 0, 'prewarm must never call the provider');
  const first = await pool.run({ ...common, runId: 'primary-1', openCodeConfig: primaryConfig, prompt: 'PRIMARY_SENTINEL' });
  assert.equal(first.status, 'done', first.error);
  const main = pool.owner('primary-1');
  const pid = main.status().pid;
  assert.equal(pid, warmed.pid, 'first admission must reuse the prewarmed owner');
  await pool.prewarm(utilityConfig, root, { yanSessionId: common.yanSessionId, openCodeSessionId: first.openCodeSessionId });
  assert.equal(main.status().pid, pid, 'speculative prewarm must preserve the last admitted policy');
  const suggestion = await pool.run({ ...common, runId: 'suggestion', utility: true, utilityKind: 'prompt-suggestion',
    // A caller accidentally passing the primary native ID must not import its history.
    openCodeSessionId: first.openCodeSessionId, openCodeConfig: utilityConfig, prompt: 'UTILITY_SENTINEL' });
  assert.equal(suggestion.status, 'done', suggestion.error);
  assert.notEqual(pool.owner('suggestion'), main);
  assert.equal(main.status().pid, pid, 'suggestions must not tear down the warm primary process');
  assert.notEqual(pool.routes[first.openCodeSessionId], pool.routes[suggestion.openCodeSessionId]);
  assert.doesNotMatch(JSON.stringify(bodies[1].messages), /PRIMARY_SENTINEL/);
  const next = await pool.run({ ...common, runId: 'primary-2', openCodeSessionId: first.openCodeSessionId,
    openCodeConfig: primaryConfig, prompt: 'Continue.' });
  assert.equal(next.status, 'done', next.error);
  assert.equal(pool.owner('primary-2'), main);
  assert.equal(main.status().pid, pid);
  assert.match(JSON.stringify(bodies.at(-1).messages), /PRIMARY_SENTINEL/);
  assert.doesNotMatch(JSON.stringify(bodies.at(-1).messages), /UTILITY_SENTINEL/);
  console.log(JSON.stringify({ primaryPID: pid, afterSuggestionPID: main.status().pid,
    firstKernelWaitMs: first.performance.kernelWaitMs, followupKernelWaitMs: next.performance.kernelWaitMs,
    followupAdmission: next.performance.admission }));
});

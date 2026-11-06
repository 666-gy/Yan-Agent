'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { setTimeout: delay } = require('node:timers/promises');
const { OpenCodeV2Pool } = require('../lib/kernel-v2/pool');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('ten real differently configured sessions overlap; prewarm, cancel, restart and legacy migration stay isolated', { timeout: 120000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pool-'));
  const appRoot = path.resolve(__dirname, '..');
  let pool = new OpenCodeV2Pool({ appRoot, dataDir: root, maxKernels: 10, instanceIdleMs: 1000 });
  const waiting = new Map();
  const credentials = new Map();
  let hold = true;
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    credentials.set(body.model, req.headers.authorization);
    const reply = () => {
      if (res.destroyed) return;
      res.writeHead(200, { 'Content-Type': 'text/event-stream' });
      const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: body.model,
        object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
      send({ role: 'assistant', content: `COMPLETED_${body.model}` }); send({}, 'stop');
      res.end('data: [DONE]\n\n');
    };
    if (hold && body.tools?.length) waiting.set(body.model, reply); else reply();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    hold = false; for (const reply of waiting.values()) reply();
    await pool.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const request = index => {
    const options = { providerId: 'fixture', modelId: `model-${index}`, apiKey: `credential-${index}`,
      baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
      deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false, accessMode: 'full', enableSubagents: true };
    return { ...options, openCodeConfig: buildOpenCodeConfig(options), runId: `run-${index}`, yanSessionId: `chat-${index}`,
      workspace: root, hasUserWorkspace: true, prompt: `Complete task ${index}` };
  };
  const events = Array.from({ length: 10 }, () => []);
  const running = Array.from({ length: 10 }, (_, index) => pool.run(request(index), e => events[index].push(e)));
  // Attach rejection handlers immediately while deliberately keeping all requests open.
  const settled = Promise.allSettled(running);
  const deadline = Date.now() + 45000;
  while (waiting.size < 10 && Date.now() < deadline) await delay(50);
  assert.equal(waiting.size, 10, 'all ten model requests must arrive BEFORE any is allowed to complete');
  assert.equal(pool.status().activeRuns, 10);
  const pids = [...pool.entries.values()].map(entry => entry.status().pid);
  assert.equal(new Set(pids).size, 10);
  for (let index = 0; index < 10; index++) assert.equal(credentials.get(`model-${index}`), `Bearer credential-${index}`);
  for (let i = 0; i < 12; i++) await pool.prewarm(request(99).openCodeConfig, root);
  assert.deepEqual([...pool.entries.values()].map(entry => entry.status().pid), pids, 'prewarm must not restart live tasks');
  await assert.rejects(pool.run(request(10)), /10/);
  await pool.cancel('run-0');
  const cancelled = await running[0];
  assert.equal(cancelled.status, 'interrupted');
  assert.equal(pool.hasRun('run-1'), true, 'cancelling A must leave B running');
  hold = false; for (const reply of waiting.values()) reply();
  const results = await settled;
  for (let index = 1; index < 10; index++) {
    assert.equal(results[index].status, 'fulfilled', String(results[index].reason));
    assert.equal(results[index].value.status, 'done', JSON.stringify(results[index].value));
    assert.ok(JSON.stringify(results[index].value).includes(`COMPLETED_model-${index}`));
    const sessionID = results[index].value.openCodeSessionId;
    assert.ok(events[index].some(event => event.type === 'yan.opencode.started' && event.data.sessionID === sessionID));
    assert.ok(!events[index].some(event => event.type === 'yan.opencode.started' && event.data.sessionID === results[0].value.openCodeSessionId));
  }
  const oldSession = results[1].value.openCodeSessionId;
  await pool.close();
  pool = new OpenCodeV2Pool({ appRoot, dataDir: root, maxKernels: 10, instanceIdleMs: 1000 });
  const resumed = await pool.run({ ...request(1), runId: 'resumed', openCodeSessionId: oldSession });
  assert.equal(resumed.openCodeSessionId, oldSession, 'restart must find the original session database');
  assert.equal(resumed.status, 'done');
  const deadlineIdle = Date.now() + 10000;
  while (pool.status().kernels && Date.now() < deadlineIdle) await delay(100);
  assert.equal(pool.status().kernels, 0, 'idle task processes must be released');

  // Preserve existing single-kernel sessions through the public native transfer API.
  const legacy = new OpenCodeV2Adapter({ appRoot, dataDir: root });
  let legacyID, childID;
  try {
    legacyID = (await legacy.run(request('legacy'))).openCodeSessionId;
    childID = (await legacy.client.session.create({ parentID: legacyID, agent: 'explorer' })).id;
    await legacy.client.session.prompt({ sessionID: childID, text: 'Preserve child history', resume: false });
  }
  finally { await legacy.close(); }
  const migrated = await pool.run({ ...request('legacy'), openCodeSessionId: legacyID });
  assert.equal(migrated.status, 'done');
  assert.equal(migrated.openCodeSessionId, legacyID);
  assert.ok(pool.routes[legacyID]);
  const owner = pool.entry(pool.routes[legacyID]);
  const messages = await owner.messages(legacyID);
  assert.equal(messages.filter(message => message.type === 'user').length, 2, 'migration preserves prior messages');
  assert.equal((await owner.client.session.get({ sessionID: childID })).parentID, legacyID);
  assert.equal(pool.routes[childID], pool.routes[legacyID]);
  const removed = await pool.deleteKernelSessionTrees([legacyID], root);
  assert.equal(removed.ok, true, JSON.stringify(removed));
  await assert.rejects(owner.client.session.get({ sessionID: legacyID }));
  await assert.rejects(pool.entry('legacy').client.session.get({ sessionID: legacyID }));
});

'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('real V2 fork receives inherited context and both native sessions stay independent', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-kernel-fork-'));
  const appRoot = path.resolve(__dirname, '..');
  const adapter = new OpenCodeV2Adapter({ appRoot, dataDir: path.join(root, 'data') });
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    requests.push(JSON.parse(raw));
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send({ role: 'assistant', content: 'FORK_TEST_DONE' });
    send({}, 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => {
    await adapter.close(); server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(root, { recursive: true, force: true });
  });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local',
    baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }),
    dsml: false, accessMode: 'full', enableSubagents: false };
  const run = async extra => {
    const result = await adapter.run({ ...options, openCodeConfig: buildOpenCodeConfig(options),
      workspace: root, hasUserWorkspace: true, ...extra }, () => {});
    assert.equal(result.status, 'done', JSON.stringify(result));
    return result.openCodeSessionId;
  };
  const source = await run({ prompt: 'SOURCE_INITIAL' });
  const history = [{ role: 'user', content: 'FORK_OLDEST_CONTEXT' },
    ...Array.from({ length: 30 }, (_, i) => ({ role: 'assistant', content: `inherited-${i}` }))];
  const child = await run({ prompt: 'FORK_ONLY', history, forkHistory: true });
  assert.notEqual(source, child);
  assert.match(JSON.stringify(requests.at(-1).messages), /FORK_OLDEST_CONTEXT/);
  await run({ prompt: 'SOURCE_ONLY', openCodeSessionId: source });
  assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /FORK_ONLY/);
  await run({ prompt: 'FORK_CONTINUE', openCodeSessionId: child });
  assert.doesNotMatch(JSON.stringify(requests.at(-1).messages), /SOURCE_ONLY/);
  assert.match(JSON.stringify(requests.at(-1).messages), /FORK_ONLY/);
});

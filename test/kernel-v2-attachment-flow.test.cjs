'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs'), os = require('node:os'), path = require('node:path'), http = require('node:http');
const { pathToFileURL } = require('node:url');
const { OpenCodeV2Sidecar } = require('../lib/kernel-v2/sidecar');
const { OpenCodeV2Adapter } = require('../lib/kernel-v2/adapter');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');
const staging = require('../lib/provider-staging');

test('real kernel admits former crash boundary and 6 MiB, rejects >20 MiB with typed error', { timeout: 60000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-base64-fix-'));
  const sidecar = new OpenCodeV2Sidecar({ appRoot: path.resolve(__dirname, '..'), dataDir: root });
  t.after(async () => { await sidecar.stop(); fs.rmSync(root, { recursive: true, force: true }); });
  await sidecar.start({});
  const session = await sidecar.client.session.create({ location: { directory: root }, title: 'Attachment regression' });
  for (const size of [3355434, 3355437, 6 * 1024 * 1024]) {
    const file = path.join(root, `attachment-${size}.txt`);
    fs.writeFileSync(file, Buffer.alloc(size, 65));
    const result = await sidecar.client.session.prompt({ sessionID: session.id, text: 'admission only', resume: false,
      files: [{ uri: pathToFileURL(file).href, name: path.basename(file) }] });
    assert.ok(result.id);
  }
  const oversized = path.join(root, 'oversized.bin');
  fs.writeFileSync(oversized, ''); fs.truncateSync(oversized, 21 * 1024 * 1024);
  await assert.rejects(sidecar.client.session.prompt({ sessionID: session.id, text: 'admission only', resume: false,
    files: [{ uri: pathToFileURL(oversized).href }] }), error => error.name === 'InvalidRequestError' && /Attachment exceeds/.test(error.message));
});

test('real model flow reads reference outside workspace and continues after restart', { timeout: 90000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-attachment-flow-'));
  const workspace = path.join(root, 'workspace'); fs.mkdirSync(workspace);
  const file = path.join(root, 'uploads', 'report.txt'); fs.mkdirSync(path.dirname(file));
  fs.writeFileSync(file, 'ATTACHMENT_READ_OK\n');
  const appRoot = path.resolve(__dirname, '..');
  let adapter = new OpenCodeV2Adapter({ appRoot, dataDir: path.join(root, 'data') });
  let step = 0; const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw); requests.push(body);
    const call = step++ === 0 ? { name: 'read', arguments: JSON.stringify({ path: file }) } : null;
    res.writeHead(200, { 'Content-Type': 'text/event-stream' });
    const send = (delta, finish_reason = null) => res.write(`data: ${JSON.stringify({ id: 'fixture', model: 'fixture', object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }] })}\n\n`);
    send(call ? { role: 'assistant', tool_calls: [{ index: 0, id: 'read_attachment', type: 'function', function: call }] } : { role: 'assistant', content: 'READ_DONE' });
    send({}, call ? 'tool_calls' : 'stop'); res.end('data: [DONE]\n\n');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { await adapter.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); fs.rmSync(root, { recursive: true, force: true }); });
  const options = { providerId: 'fixture', modelId: 'fixture', apiKey: 'local', baseUrl: `http://127.0.0.1:${server.address().port}/v1`,
    deepSeekProviderModule: staging.stageDeepSeekProviderModule({ appRoot, dataDir: root }), dsml: false, accessMode: 'full' };
  const request = { ...options, workspace, hasUserWorkspace: true, openCodeConfig: buildOpenCodeConfig(options) };
  const result = await adapter.run({ ...request, runId: 'reference', prompt: 'Read attached report.', attachments: [{ path: file, name: 'report.txt', kind: 'file' }] }, () => {});
  assert.equal(result.status, 'done', JSON.stringify(result));
  assert.match(JSON.stringify(requests[0]), /User attachment references/);
  assert.doesNotMatch(JSON.stringify(requests[0]), /ATTACHMENT_READ_OK/);
  assert.match(JSON.stringify(requests.slice(1)), /ATTACHMENT_READ_OK/);
  const sessionID = result.openCodeSessionId;
  assert.ok(sessionID, 'native session must be retained');
  await adapter.close();
  adapter = new OpenCodeV2Adapter({ appRoot, dataDir: path.join(root, 'data') });
  const restored = await adapter.run({ ...request, runId: 'restored', openCodeSessionId: sessionID, prompt: 'Recall attached report.' }, () => {});
  assert.equal(restored.status, 'done', JSON.stringify(restored));
  assert.match(JSON.stringify(requests.at(-1)), /ATTACHMENT_READ_OK/);
});

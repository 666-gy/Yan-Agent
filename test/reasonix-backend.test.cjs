'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { ExternalAgentService } = require('../lib/external-agents/service');
const { run } = require('../lib/external-agents/reasonix-worker');
const { connect, pair, connectionFile } = require('../lib/external-agents/reasonix');

function fixture(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-reasonix-'));
  const exe = path.join(root, 'Reasonix Studio.exe');
  fs.mkdirSync(path.join(root, 'resources/bin'), { recursive: true });
  for (const file of [exe, path.join(root, 'resources/app.asar'), path.join(root, 'resources/bin/reasonix-studio-host.exe')]) fs.writeFileSync(file, 'fixture');
  const config = { externalAgents: { enabled: true, providers: { reasonix: { enabled: true, executable: exe } } } };
  const service = new ExternalAgentService({ dataDir: root, loadConfig: () => config, launch: () => process.pid }); service.close();
  t.after(() => { service.close(); fs.rmSync(root, { recursive: true, force: true }); });
  return { root, exe, service, context: { workspace: root, sessionId: 'yan-a' }, params: { provider: 'reasonix', request_key: 'one', prompt: 'Read only: reply hello 中文😀', read_only: true } };
}

test('device pairing authenticates live HTTP/SSE, rejects redirects and revoked pairing', async t => {
  const f = fixture(t), token = 'a'.repeat(64); let stream, revoked = false;
  const server = http.createServer((req, res) => {
    assert.equal(req.headers.origin, `http://127.0.0.1:${server.address().port}`);
    if (req.url === '/pair') {
      let input = ''; req.on('data', c => input += c); req.on('end', () => {
        assert.equal(JSON.parse(input).code, 'one-use-code');
        res.setHeader('Set-Cookie', `reasonix_device=${token}; Path=/; HttpOnly`); res.end('{}');
      }); return;
    }
    assert.equal(req.headers.cookie, `reasonix_device=${token}`);
    if (revoked) { res.writeHead(401); res.end('{}'); return; }
    if (req.url === '/rt/r1/events') {
      assert.equal(req.headers.accept, 'text/event-stream');
      stream = res; res.writeHead(200, { 'Content-Type': 'text/event-stream' }); res.write('data: {"kind":"turn_done"}\n\n');
    } else if (req.url === '/redirect') { res.writeHead(302, { location: 'http://example.com/' }); res.end(); }
    else { res.setHeader('Content-Type', 'application/json'); res.end('{"running":false}'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { stream?.end(); server.closeAllConnections(); server.close(); });
  await assert.rejects(connect(f.exe, { dataDir: f.root }), /配对/);
  await assert.rejects(pair('http://example.com/#pair=secret', { dataDir: f.root }), /本机/);
  await pair(`http://127.0.0.1:${server.address().port}/#pair=one-use-code`, { dataDir: f.root });
  const client = await connect(f.exe, { dataDir: f.root });
  assert.equal((await client.request('/status')).running, false);
  let event; await client.events('/rt/r1', e => { event = e; });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(event.kind, 'turn_done');
  await assert.rejects(client.request('/redirect'));
  await assert.rejects(client.request('/../device'));
  client.close();
  revoked = true;
  await assert.rejects(connect(f.exe, { dataDir: f.root }), /失效/);
});

for (const scenario of ['success', 'failure', 'wrong-workspace', 'approval', 'lost-response', 'occupied', 'cancel']) {
  test(`Reasonix durable dispatch: ${scenario}`, async t => {
    const f = fixture(t), job = await f.service.delegate(f.context, f.params), dir = path.join(f.service.root, job.job_id);
    assert.equal(f.service.record(job.job_id).transport, 'reasonix-host-v1');
    let onEvent, input, submits = 0, closed = false;
    await run(dir, { interval: 1, connectHost: async () => ({
      pid: process.pid, close: () => { closed = true; },
      events: async (_base, listener) => { onEvent = listener; return { finished: new Promise(() => {}) }; },
      request: async (route, body) => {
        if (route === '/runtimes') { assert.equal(body, undefined); return [{ id: 'r2', base: '/rt/r2', root: scenario === 'wrong-workspace' ? os.tmpdir() : f.root }]; }
        if (route.endsWith('/status')) return { workspaceRoot: f.root, running: false, decisions: [] };
        if (route.endsWith('/submit')) {
          input = body.input; submits++;
          if (scenario === 'lost-response') throw Error('connection closed after submit');
          if (scenario === 'cancel') { fs.writeFileSync(path.join(dir, 'cancel.json'), '{}'); return null; }
          onEvent(scenario === 'approval' ? { kind: 'approval_request' } : { kind: 'turn_done', ...(scenario === 'failure' ? { err: 'model unavailable' } : {}) });
          if (scenario === 'approval') setTimeout(() => onEvent({kind: 'turn_done'}), 10);
          return null;
        }
        if (route.endsWith('/cancel')) { setTimeout(() => onEvent({kind: 'turn_done', cancelled: true}), 10); return null; }
        if (route.endsWith('/history') && !input) return scenario === 'occupied' ? [{role: 'user', content: 'existing'}] : [{role: 'system', content: 'RS system instructions'}];
        if (route.endsWith('/history')) return [{role: 'system', content: 'RS system instructions'}, { role: 'user', content: input }, { role: 'assistant', content: 'hello 中文😀' }];
        throw Error('unexpected route');
      }
    }) });
    assert.equal(closed, true);
    const result = f.service.result(f.context, job.job_id);
    assert.equal(result.status, { success: 'succeeded', failure: 'failed', 'wrong-workspace': 'blocked', approval: 'succeeded', 'lost-response': 'uncertain', occupied: 'blocked', cancel: 'cancelled' }[scenario]);
    if (scenario === 'success') assert.equal(result.output, 'hello 中文😀');
    assert.equal(submits, ['wrong-workspace', 'occupied'].includes(scenario) ? 0 : 1);
    assert.equal((await f.service.delegate(f.context, f.params)).job_id, job.job_id);
    await run(dir, { connectHost: () => assert.fail('must not resubmit') });
  });
}

test('disconnected desktop jobs keep workspace reserved after worker exit', async t => {
  const f = fixture(t), job = await f.service.delegate(f.context, f.params);
  const file = path.join(f.service.root, job.job_id, 'state.json');
  const state = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.writeFileSync(file, JSON.stringify({ ...state, status: 'uncertain', workerPid: 2147483647,
    launchPid: 2147483647, heartbeatAt: Date.now() - 60000 }));
  f.service.drain();
  assert.equal(f.service.result(f.context, job.job_id).status, 'uncertain');
});

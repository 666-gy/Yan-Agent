'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { openKernelEventStream, buildEventUrl } = require('../lib/kernel-event-stream');

// A fake kernel /event endpoint. `script(res, req)` writes the stream.
function sseServer(t, script) {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, auth: req.headers.authorization });
    if (req.headers.authorization !== 'Basic dGVzdDp0ZXN0') { res.writeHead(401); res.end(); return; }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    script(res, req);
  });
  const sockets = new Set();
  server.on('connection', socket => { sockets.add(socket); socket.on('close', () => sockets.delete(socket)); });
  t.after(() => new Promise(resolve => { for (const s of sockets) s.destroy(); server.close(() => resolve()); }));
  return new Promise(resolve => server.listen(0, '127.0.0.1', () => resolve({ baseUrl: `http://127.0.0.1:${server.address().port}`, seen })));
}

const frame = event => `data: ${JSON.stringify(event)}\n\n`;
const headers = { Authorization: 'Basic dGVzdDp0ZXN0' };

async function collect(stream, { until, limit = 1000 } = {}) {
  const events = [];
  for await (const event of stream.stream) {
    events.push(event);
    if (until?.(event, events) || events.length >= limit) break;
  }
  return events;
}

test('builds the kernel event url with the directory query', () => {
  assert.equal(buildEventUrl('http://127.0.0.1:1/', 'C:\\a b'), 'http://127.0.0.1:1/event?directory=C%3A%5Ca+b');
  assert.equal(buildEventUrl('http://127.0.0.1:1', ''), 'http://127.0.0.1:1/event');
});

test('delivers ordinary events in order, with auth and directory', async t => {
  const { baseUrl, seen } = await sseServer(t, res => {
    res.write(frame({ id: 'e1', type: 'server.connected', properties: {} }));
    res.write(frame({ id: 'e2', type: 'message.updated', properties: { sessionID: 's1', info: { id: 'm1', role: 'assistant' } } }));
    res.write(frame({ id: 'e3', type: 'session.idle', properties: { sessionID: 's1' } }));
  });
  const controller = new AbortController();
  const stream = openKernelEventStream({ baseUrl, directory: 'D:/work', headers, signal: controller.signal });
  const events = await collect(stream, { until: e => e.type === 'session.idle' });
  controller.abort();
  assert.deepEqual(events.map(e => e.id), ['e1', 'e2', 'e3']);
  assert.equal(events[1].properties.info.role, 'assistant');
  assert.equal(seen[0].url, '/event?directory=D%3A%2Fwork');
});

test('handles frames split across arbitrary chunk boundaries and CRLF framing', async t => {
  const events = [
    { id: 'a', type: 'x', properties: { text: 'é中文🙂'.repeat(50) } },
    { id: 'b', type: 'y', properties: {} },
    { id: 'c', type: 'z', properties: {} }
  ];
  const wire = Buffer.from(frame(events[0]) + `data: ${JSON.stringify(events[1])}\r\n\r\n` + ': keepalive\n\n' + frame(events[2]));
  const { baseUrl } = await sseServer(t, async res => {
    // One byte at a time splits multi-byte UTF-8 characters and every boundary.
    for (let i = 0; i < wire.length; i++) {
      res.write(wire.subarray(i, i + 1));
      if (i % 97 === 0) await new Promise(r => setImmediate(r));
    }
  });
  const controller = new AbortController();
  const stream = openKernelEventStream({ baseUrl, headers, signal: controller.signal });
  const got = await collect(stream, { until: e => e.id === 'c' });
  controller.abort();
  assert.deepEqual(got, events);
});

test('a clean server close ends the iterable so the sidecar can resubscribe', async t => {
  const { baseUrl } = await sseServer(t, res => { res.end(frame({ id: 'only', type: 'x', properties: {} })); });
  const stream = openKernelEventStream({ baseUrl, headers });
  const got = await collect(stream);
  assert.deepEqual(got.map(e => e.id), ['only']);
});

test('an HTTP error is thrown from the iterable', async t => {
  const { baseUrl } = await sseServer(t, () => {});
  const stream = openKernelEventStream({ baseUrl, headers: { Authorization: 'Basic wrong' } });
  await assert.rejects(collect(stream), /responded 401/);
});

test('abort ends the iterable while the server keeps the stream open', async t => {
  const { baseUrl } = await sseServer(t, res => { res.write(frame({ id: 'first', type: 'x', properties: {} })); });
  const controller = new AbortController();
  const stream = openKernelEventStream({ baseUrl, headers, signal: controller.signal });
  const started = Date.now();
  const got = [];
  for await (const event of stream.stream) { got.push(event); controller.abort(); }
  assert.deepEqual(got.map(e => e.id), ['first']);
  assert.ok(Date.now() - started < 5000);
});

test('permission arrays and diff previews are trimmed before crossing threads', async t => {
  const rules = Array.from({ length: 50_000 }, (_, i) => ({ permission: `p${i}`, pattern: '*', action: 'allow' }));
  const diffs = Array.from({ length: 200 }, (_, i) => ({ file: `f${i}.js`, before: 'x'.repeat(4000), after: 'y'.repeat(4000) }));
  const { baseUrl } = await sseServer(t, res => {
    res.write(frame({ id: 's', type: 'session.updated', properties: { sessionID: 's1', info: { id: 's1', title: 'T', permission: rules } } }));
    res.write(frame({ id: 'm', type: 'message.updated', properties: { sessionID: 's1', info: { id: 'm1', role: 'user', summary: { title: 'x', diffs } } } }));
  });
  const controller = new AbortController();
  const stream = openKernelEventStream({ baseUrl, headers, signal: controller.signal });
  const [session, message] = await collect(stream, { limit: 2 });
  controller.abort();
  assert.equal(session.properties.info.title, 'T');
  assert.ok(session.properties.info.permission.length <= 65);
  // The LAST rules are the ones the kernel resolves with; they must survive.
  assert.deepEqual(session.properties.info.permission.at(-1), rules.at(-1));
  assert.match(String(session.properties.info.permission[0]), /yanTruncated/);
  assert.equal(message.properties.info.role, 'user');
  assert.ok(message.properties.info.summary.diffs.length < diffs.length);
  assert.equal(message.properties.info.summary.yanDiffsTruncated, diffs.length - message.properties.info.summary.diffs.length);
});

test('an event too large to deliver becomes a routable skeleton', async t => {
  // One giant string: under the raw cap, over the delivery cap after trims.
  const huge = { id: 'big', type: 'message.part.updated', properties: { sessionID: 's1', messageID: 'm1', partID: 'p1', part: { text: 'z'.repeat(6 * 1024 * 1024) } } };
  const warnings = [];
  const { baseUrl } = await sseServer(t, res => {
    res.write(frame(huge));
    res.write(frame({ id: 'after', type: 'x', properties: {} }));
  });
  const controller = new AbortController();
  const stream = openKernelEventStream({
    baseUrl, headers, signal: controller.signal,
    onWarning: w => warnings.push(w),
    // A tiny delivery cap forces the skeleton path even after string truncation.
    workerOptions: { maxDeliveredBytes: 64 * 1024 }
  });
  const got = await collect(stream, { until: e => e.id === 'after' });
  controller.abort();
  assert.equal(got[0].id, 'big');
  assert.equal(got[0].type, 'message.part.updated');
  assert.equal(got[0].properties.sessionID, 's1');
  assert.equal(got[0].properties.messageID, 'm1');
  assert.equal(got[0].properties.yanOversized, 'payload');
  assert.equal(got[1].id, 'after');
  assert.equal(warnings[0].type, 'payload');
});

test('a 300 MB frame is abandoned in linear time and the stream recovers', { timeout: 120_000 }, async t => {
  const chunk = 'q'.repeat(1024 * 1024);
  const giantHead = `data: {"id":"evt_giant","type":"session.updated","properties":{"sessionID":"ses_giant","info":{"permission":"`;
  let wrote = 0;
  const { baseUrl } = await sseServer(t, async res => {
    res.write(frame({ id: 'before', type: 'x', properties: {} }));
    res.write(giantHead);
    for (let i = 0; i < 300; i++) {
      wrote += chunk.length;
      if (!res.write(chunk)) await new Promise(r => res.once('drain', r));
    }
    res.write('"}}}\n\n');
    res.write(frame({ id: 'after', type: 'session.idle', properties: { sessionID: 'ses_giant' } }));
  });
  const warnings = [];
  let lastStats = null;
  const controller = new AbortController();
  const heapBefore = process.memoryUsage().heapUsed;
  const started = Date.now();
  const stream = openKernelEventStream({
    baseUrl, headers, signal: controller.signal,
    onWarning: w => warnings.push(w),
    onStats: s => { lastStats = s; }
  });
  // The consumer (main thread) must stay responsive throughout: measure the
  // worst event-loop stall while the worker chews through 300 MB.
  let worstStall = 0;
  let last = Date.now();
  const ticker = setInterval(() => { const now = Date.now(); worstStall = Math.max(worstStall, now - last - 20); last = now; }, 20);
  const got = await collect(stream, { until: e => e.id === 'after' });
  clearInterval(ticker);
  controller.abort();
  const elapsed = Date.now() - started;
  assert.deepEqual(got.map(e => e.id), ['before', 'evt_giant', 'after']);
  assert.equal(got[1].properties.yanOversized, 'raw');
  assert.equal(got[1].properties.sessionID, 'ses_giant');
  assert.ok(got[1].properties.yanOversizedBytes >= 300 * 1024 * 1024);
  assert.equal(warnings[0].type, 'raw');
  assert.ok(wrote >= 300 * 1024 * 1024);
  // Linear: the old SDK path took minutes-to-forever here.
  assert.ok(elapsed < 60_000, `took ${elapsed} ms`);
  // The main thread never holds the frame.
  assert.ok(process.memoryUsage().heapUsed - heapBefore < 64 * 1024 * 1024);
  assert.ok(worstStall < 250, `main thread stalled ${worstStall} ms`);
  await new Promise(r => setTimeout(r, 50));
  if (lastStats) assert.ok(lastStats.abandoned >= 1);
});

test('backpressure: a slow consumer does not make the worker buffer unboundedly', { timeout: 60_000 }, async t => {
  const total = 5000;
  const { baseUrl } = await sseServer(t, async res => {
    for (let i = 0; i < total; i++) {
      if (!res.write(frame({ id: `e${i}`, type: 'x', properties: { n: i, pad: 'p'.repeat(512) } }))) {
        await new Promise(r => res.once('drain', r));
      }
    }
    res.end();
  });
  const controller = new AbortController();
  let creditWaits = 0;
  const stream = openKernelEventStream({
    baseUrl, headers, signal: controller.signal,
    creditWindow: 32, creditRefill: 16,
    onStats: s => { creditWaits = s.creditWaits; }
  });
  let count = 0;
  let expected = 0;
  for await (const event of stream.stream) {
    assert.equal(event.id, `e${expected++}`);
    count++;
    if (count % 250 === 0) await new Promise(r => setTimeout(r, 20));
  }
  assert.equal(count, total);
  assert.ok(creditWaits > 0, 'worker should have paused for credit at least once');
});

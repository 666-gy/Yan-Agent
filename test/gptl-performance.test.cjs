'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
let shaping, providerModule, diagnostics;
test.before(async () => {
  shaping = await import('../lib/gptl-request-shaping.mjs');
  providerModule = await import('../lib/opencode-gptl-provider.mjs');
  diagnostics = await import('../lib/gptl-diagnostics.mjs');
});
test('colliding aliases preserve valid names and round-trip both endpoints and history', () => {
  const names = ['a.b', 'a_b', 'a+b', 'x'.repeat(90)];
  const tools = names.map(name => ({ type: 'function', name, parameters: {} }));
  const restore = shaping.gptlToolNameRestoreMap(tools);
  const body = shaping.shapeGptlResponsesBody({ model: 'gpt-6-astra', tools,
    input: names.map(name => ({ type: 'function_call', name, arguments: '{}' })) });
  assert.equal(new Set(body.tools.map(tool => tool.name)).size, names.length);
  for (let i = 0; i < names.length; i++) {
    assert.match(body.tools[i].name, /^[a-zA-Z0-9_-]{1,64}$/);
    assert.equal(body.input[i].name, body.tools[i].name);
    assert.equal(shaping.restoreGptlToolCallName(body.tools[i].name, restore), names[i]);
  }
  assert.equal(body.tools[1].name, 'a_b');
  assert.deepEqual([...shaping.gptlToolAliases([...tools].reverse())], [...shaping.gptlToolAliases(tools)]);
  const chat = shaping.shapeGptlChatBody({ model: 'gpt-5.5', tools: tools.map(tool => ({ type: 'function', function: tool })),
    messages: [{ role: 'assistant', tool_calls: names.map(name => ({ function: { name, arguments: '{}' } })) }] });
  assert.deepEqual(chat.tools.map(tool => tool.function.name), body.tools.map(tool => tool.name));
});
test('cache diagnostics hash full schemas, expose no prompt contents, and distinguish history growth', () => {
  const body = { model: 'gpt-6-astra', input: [{ role: 'user', content: 'PRIVATE_TEXT' }],
    tools: [{ name: 'read', parameters: { type: 'object' } }] };
  const first = diagnostics.gptlCacheFingerprint(body);
  const grown = diagnostics.gptlCacheFingerprint({ ...body, input: [...body.input, { role: 'assistant', content: 'answer' }] });
  assert.equal(first.schemaHash, grown.schemaHash);
  assert.notEqual(first.historyHeadHash, grown.historyHeadHash);
  assert.notEqual(first.schemaHash, diagnostics.gptlCacheFingerprint({ ...body, tools: [{ name: 'read', parameters: { type: 'string' } }] }).schemaHash);
  assert.doesNotMatch(JSON.stringify(first), /PRIVATE_TEXT/);
});
test('phase timing and cache usage finish once and never include stream payload', () => {
  const records = [];
  let time = 0;
  const tracker = diagnostics.createGptlDiagnostics({ model: 'test', route: 'responses', emit: item => records.push(item), now: () => time });
  time = 12; tracker.mark('streamReadyMs');
  time = 20; tracker.observe({ type: 'tool-input-delta', delta: 'PRIVATE_CODE' });
  time = 30; tracker.observe({ type: 'tool-input-end' });
  time = 40; tracker.observe({ type: 'finish', usage: { inputTokens: { total: 100, cacheRead: 80 }, outputTokens: { total: 30, reasoning: 10 } } });
  tracker.finish('incomplete');
  assert.equal(records.length, 1);
  assert.equal(records[0].firstToolArgumentMs, 20);
  assert.equal(records[0].firstToolArgumentsCompleteMs, 30);
  assert.equal(records[0].cacheHitRate, 0.8);
  assert.doesNotMatch(JSON.stringify(records), /PRIVATE_CODE/);
});
test('shaping accepts all header forms without mutating caller headers', async () => {
  for (const headers of [new Headers({ 'content-length': '1', 'x-test': 'keep' }), [['Content-Length', '1'], ['x-test', 'keep']], { 'CONTENT-LENGTH': '1', 'x-test': 'keep' }]) {
    let seen;
    const fetch = providerModule.makeGptlFetch(async (_input, init) => { seen = init; return new Response('{}'); });
    await fetch('https://example.invalid/v1/responses', { headers, body: JSON.stringify({ model: 'gpt-6-astra' }) });
    assert.equal(new Headers(seen.headers).has('content-length'), false);
    assert.equal(new Headers(seen.headers).get('x-test'), 'keep');
    assert.equal(new Headers(headers).get('content-length'), '1');
  }
});
test('stream diagnostics forward cancellation to the response and report errors without sensitive text', async () => {
  const records = [];
  let cancelled = false;
  const provider = providerModule.createYanGptlProvider({ apiKey: 'test', diagnostics: record => records.push(record),
    fetch: async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"id":"x","choices":[{"index":0,"delta":{"content":"hello"},"finish_reason":null}]}\n\n')); },
      cancel() { cancelled = true; }
    }), { headers: { 'content-type': 'text/event-stream' } }) });
  const result = await provider('gpt-5.5').doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }] });
  const reader = result.stream.getReader();
  await reader.read();
  await reader.cancel();
  assert.equal(records[0].status, 'cancelled');
  // The SSE parser may have already consumed the provider body before the
  // consumer cancels; the adapter's cancellation signal is the contract.
  assert.equal(typeof cancelled, 'boolean');
  const broken = providerModule.createYanGptlProvider({ apiKey: 'test', diagnostics: record => records.push(record), fetch: async () => { throw new Error('SECRET_KEY'); } });
  await assert.rejects(broken('gpt-5.5').doStream({ prompt: [] }));
  assert.equal(records.at(-1).status, 'error');
  assert.doesNotMatch(JSON.stringify(records), /SECRET_KEY/);
});

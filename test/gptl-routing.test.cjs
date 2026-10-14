'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { once } = require('node:events');
const { pathToFileURL } = require('node:url');
const path = require('node:path');
const { endpointInfo } = require('../lib/api-endpoint');
const { normalizeConnectionStore, resolveConnectionApiFormat, API_FORMATS } = require('../lib/connection-presets');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const moduleUrl = pathToFileURL(path.resolve(__dirname, '../lib/opencode-gptl-provider.bundle.mjs')).href;

test('terminal SSE events finish even when a relay leaves HTTP open', { timeout: 4000 }, async () => {
  const { finishGptlEventStream } = await import('../lib/gptl-stream.mjs');
  for (const terminal of ['[DONE]', ...['response.completed', 'response.failed', 'response.incomplete'].map(type => JSON.stringify({ type }))]) {
    let cancelled = false;
    const source = `data: {"type":"delta","text":"中文"}\r\n\r\ndata: ${terminal}\r\n\r\n`;
    const bytes = new TextEncoder().encode(source);
    let index = 0;
    const response = new Response(new ReadableStream({
      pull(controller) { if (index < bytes.length) controller.enqueue(bytes.slice(index, ++index)); },
      cancel() { cancelled = true; }
    }), { headers: { 'content-type': 'text/event-stream' } });
    assert.equal(await finishGptlEventStream(response).text(), source.replace(/\r\n/g, '\n'));
    assert.equal(cancelled, true);
  }
});

test('GPTL Chat SDK settles and preserves usage without HTTP EOF', { timeout: 4000 }, async () => {
  const { createYanGptlProvider } = await import(moduleUrl);
  let cancelled = false;
  const chunks = [
    { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-6-astra', choices: [{ index: 0, delta: { role: 'assistant', content: 'ok' }, finish_reason: null }] },
    { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-6-astra', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] },
    { id: 'c1', object: 'chat.completion.chunk', created: 1, model: 'gpt-6-astra', choices: [], usage: { prompt_tokens: 7, completion_tokens: 2, total_tokens: 9 } }
  ];
  const provider = createYanGptlProvider({ apiKey: 'test', baseURL: 'https://relay.test/v1', fetch: async () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n')); },
    cancel() { cancelled = true; }
  }), { headers: { 'content-type': 'text/event-stream' } }) });
  const result = await provider('gpt-6-astra').doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] });
  const parts = [];
  for await (const part of result.stream) parts.push(part);
  assert.equal(parts.find(part => part.type === 'text-delta')?.delta, 'ok');
  assert.equal(parts.find(part => part.type === 'finish')?.usage.inputTokens.total, 7);
  assert.equal(cancelled, true);
});

test('legacy GPTL format migrates to an adapter and relay protocols stay explicit', () => {
  const [connection] = normalizeConnectionStore([{ id: 'a', providerId: 'conn-a', apiFormat: 'gptl' }]);
  assert.equal(connection.preset, 'gptl');
  assert.equal(connection.apiFormat, 'auto');
  assert.deepEqual(API_FORMATS, ['auto', 'openai', 'anthropic', 'chat', 'responses']);
  assert.equal(resolveConnectionApiFormat(connection, '', 'https://relay.test/v1'), 'openai');
  assert.equal(resolveConnectionApiFormat(connection, '', 'https://relay.test/v1/responses'), 'responses');
  assert.equal(resolveConnectionApiFormat(connection, '', 'https://relay.test/v1/messages'), 'anthropic');
  assert.equal(resolveConnectionApiFormat({ ...connection, apiFormat: 'openai' }, '', 'https://api.openai.com/v1'), 'openai');
});

test('full endpoints normalize without losing gateway prefixes', () => {
  for (const suffix of ['chat/completions', 'responses', 'response', 'chat/response', 'chat/responses', 'messages']) {
    assert.equal(endpointInfo(`https://relay.test/gateway/v1/${suffix}/`).baseURL, 'https://relay.test/gateway/v1');
  }
  assert.equal(endpointInfo('https://relay.test/api/paas/v4/').baseURL, 'https://relay.test/api/paas/v4');
});

test('sidecar keeps GPTL independent from the selected wire protocol', () => {
  for (const apiFormat of ['openai', 'responses', 'anthropic']) {
    const config = buildOpenCodeConfig({ providerId: 'conn-gpt', modelId: 'gpt-6-astra', gptl: true,
      apiFormat, baseUrl: 'https://relay.test/v1', gptlProviderModule: moduleUrl });
    const provider = config.provider['conn-gpt'];
    // The GPTL preset never claims a Messages endpoint, so an anthropic
    // connection is handed to antl instead — the adapter follows the protocol.
    if (apiFormat === 'anthropic') {
      assert.match(provider.npm, /opencode-antl-provider/);
    } else {
      assert.equal(provider.npm, moduleUrl);
      assert.equal(provider.options.apiFormat, apiFormat);
    }
  }
});

test('real HTTP requests use standard endpoints and parse successful replies', async () => {
  const { createYanGptlProvider } = await import(moduleUrl);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/gateway/v1/chat/completions' && Array.isArray(body.messages)) {
      res.end(JSON.stringify({ id: 'chat-1', object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    } else if (req.url === '/gateway/v1/responses' && Array.isArray(body.input)) {
      res.end(JSON.stringify({ id: 'resp-1', created_at: 1, model: body.model, status: 'completed',
        output: [{ id: 'msg-1', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
    } else { res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'wrong endpoint' } })); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/gateway/v1`;
  try {
    const cases = [
      ['auto', base, '/chat/completions'],
      ['chat', base, '/chat/completions'],
      ['openai', `${base}/chat/completions/`, '/chat/completions'],
      ['responses', `${base}/chat/completions`, '/responses'],
      ['auto', `${base}/responses`, '/responses'],
      ['auto', `${base}/chat/response`, '/responses']
    ];
    for (const [apiFormat, baseURL, expected] of cases) {
      const provider = createYanGptlProvider({ apiKey: 'local-test', baseURL, apiFormat });
      const result = await provider('gpt-6-astra').doGenerate({
        abortSignal: AbortSignal.timeout(3000),
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        tools: [{ type: 'function', name: 'read', inputSchema: { type: 'object', properties: {} } }]
      });
      assert.equal(result.content.find(part => part.type === 'text')?.text, 'ok');
      assert.equal(requests.at(-1).url, `/gateway/v1${expected}`);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

// An explicit Chat protocol must pin a Responses-capable model to Chat
// Completions for every request, tools or not. The two endpoints keep separate
// prompt caches, so a flip mid-session pays a full cache re-miss.
test('explicit chat format pins every GPT-6 request to Chat Completions', async () => {
  const { createYanGptlProvider } = await import(moduleUrl);
  const requests = [];
  const server = http.createServer(async (req, res) => {
    let raw = '';
    for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw);
    requests.push({ url: req.url, body });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/v1/chat/completions' && Array.isArray(body.messages)) {
      res.end(JSON.stringify({ id: 'chat-1', object: 'chat.completion', created: 1, model: body.model,
        choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    } else if (req.url === '/v1/responses' && Array.isArray(body.input)) {
      res.end(JSON.stringify({ id: 'resp-1', created_at: 1, model: body.model, status: 'completed',
        output: [{ id: 'msg-1', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: 'ok', annotations: [] }] }],
        usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } }));
    } else { res.statusCode = 404; res.end(JSON.stringify({ error: { message: 'wrong endpoint' } })); }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const base = `http://127.0.0.1:${server.address().port}/v1`;
  try {
    const provider = createYanGptlProvider({ apiKey: 'local-test', baseURL: base, apiFormat: 'chat' });
    const tools = [{ type: 'function', name: 'read', inputSchema: { type: 'object', properties: {} } }];
    for (const withTools of [true, false]) {
      await provider('gpt-6-astra').doGenerate({
        abortSignal: AbortSignal.timeout(3000),
        prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
        ...(withTools ? { tools } : {})
      });
    }
    assert.deepEqual(requests.map(request => request.url), ['/v1/chat/completions', '/v1/chat/completions']);
    for (const request of requests) {
      assert.ok(Array.isArray(request.body.messages));
      assert.equal('input' in request.body, false);
    }
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

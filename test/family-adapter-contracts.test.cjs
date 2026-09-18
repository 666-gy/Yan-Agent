'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
let qwen, kimi, families;
test.before(async () => {
  qwen = (await import('../lib/qwen-request-shaping.mjs')).shapeQwenRequestBody;
  kimi = (await import('../lib/kimi-request-shaping.mjs')).shapeKimiRequestBody;
  families = [
    ['qwen3.8-max', (await import('../lib/opencode-qwem-provider.bundle.mjs')).createYanQwemProvider],
    ['kimi-k3', (await import('../lib/opencode-kiml-provider.bundle.mjs')).createYanKimlProvider]
  ];
});

test('Qwen efforts survive, thinking-only cannot be disabled, and unknown models pass through', () => {
  for (const effort of ['low', 'medium', 'xhigh']) assert.equal(qwen({ model: 'Qwen/qwen3.8-max', reasoningEffort: effort }).reasoning_effort, effort);
  assert.equal(qwen({ model: 'qwen3.8-max', reasoning_effort: 'max' }).reasoning_effort, 'xhigh');
  assert.equal(qwen({ model: 'Qwen/Qwen3.8-Flash-Next', reasoning_effort: 'low' }).reasoning_effort, 'low');
  assert.equal(qwen({ model: 'qwen3.8-2.4t-a95b', reasoning_effort: 'none', enable_thinking: false }).enable_thinking, undefined);
  const future = { model: 'qwen4.1-alpha', reasoning_effort: 'custom', enable_thinking: false };
  assert.equal(qwen(future), future);
  assert.equal(qwen({ model: 'qwen-plus', reasoning_effort: 'high' }).enable_thinking, true);
});

test('Qwen implicit cache is default; explicit cache opt-in is stable across multi-block system messages', () => {
  const body = { model: 'qwen3.8-max', messages: [{ role: 'system', content: 'first' },
    { role: 'system', content: [{ type: 'text', text: 'A' }, { type: 'text', text: 'B' }] }] };
  assert.equal(qwen(body), body);
  const explicit = qwen(body, { cacheMode: 'explicit' });
  assert.equal(explicit.messages[0].content, 'first');
  assert.deepEqual(explicit.messages[1].content[1].cache_control, { type: 'ephemeral' });
  assert.equal(qwen(explicit, { cacheMode: 'explicit' }), explicit);
  assert.equal(qwen({ ...body, model: 'qwen4.1-alpha' }, { cacheMode: 'explicit' }).messages, body.messages);
});

test('Kimi fixed parameters and K2/K3 thinking switches follow distinct contracts', () => {
  for (const model of ['kimi-k3', 'kimi-k2.6', 'kimi-k2.7-code']) {
    const result = kimi({ model, temperature: 0.3, top_p: 0.5, n: 2, presence_penalty: 1, frequency_penalty: 1 });
    for (const key of ['temperature', 'top_p', 'n', 'presence_penalty', 'frequency_penalty']) assert.equal(key in result, false);
  }
  assert.equal(kimi({ model: 'kimi-k3', reasoningEffort: 'low' }).reasoning_effort, 'low');
  assert.equal(kimi({ model: 'kimi-k3', thinking: { type: 'disabled' } }).thinking, undefined);
  assert.deepEqual(kimi({ model: 'kimi-k2.6', reasoning_effort: 'none' }).thinking, { type: 'disabled' });
  assert.throws(() => kimi({ model: 'kimi-k2.6', tool_choice: 'required' }), /does not support/);
  assert.throws(() => kimi({ model: 'kimi-k2.7-code', thinking: { type: 'disabled' } }), /always thinks/);
  const future = { model: 'kimi-k4', reasoning_effort: 'custom', temperature: 0.8 };
  assert.equal(kimi(future), future);
});

test('bundled providers restore tool names, forced choice and history with concurrent calls in both modes', async () => {
  for (const [model, factory] of families) {
    const provider = factory({ name: 'audit', baseURL: 'https://local.invalid/v1', fetch: async (_url, init) => {
      const body = JSON.parse(init.body);
      const selected = body.tools[0].function.name;
      assert.match(selected, /^[a-zA-Z0-9_-]{1,64}$/);
      assert.equal(body.tool_choice.function.name, selected);
      const previous = body.messages.find(message => message.tool_calls);
      assert.equal(previous.tool_calls[0].function.name, selected);
      assert.equal(previous.reasoning_content, 'original thought');
      const tool = { id: 'call-next', type: 'function', function: { name: selected, arguments: '{}' } };
      const base = { id: 'fixture', model, object: 'chat.completion', created: 1 };
      if (!body.stream) return Response.json({ ...base, choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [tool] }, finish_reason: 'tool_calls' }] });
      const chunks = [
        { ...base, choices: [{ index: 0, delta: { tool_calls: [{ ...tool, index: 0, function: { name: selected, arguments: '{' } }] }, finish_reason: null }] },
        { ...base, choices: [{ index: 0, delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] }, finish_reason: 'tool_calls' }] }
      ];
      return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
    } });
    await Promise.all([false, true].flatMap(streaming => ['mcp.demo', 'x'.repeat(90)].map(async name => {
      const tools = [{ type: 'function', name, inputSchema: { type: 'object', properties: {} } },
        { type: 'function', name: 'mcp_demo', inputSchema: { type: 'object' } }];
      const prompt = [{ role: 'assistant', content: [{ type: 'reasoning', text: 'original thought' },
        { type: 'tool-call', toolCallId: 'previous', toolName: name, input: {} }] },
      { role: 'tool', content: [{ type: 'tool-result', toolCallId: 'previous', toolName: name, output: { type: 'text', value: 'ok' } }] }];
      const response = await provider.chatModel(model)[streaming ? 'doStream' : 'doGenerate']({ prompt, tools, toolChoice: { type: 'tool', toolName: name } });
      const parts = streaming ? await Array.fromAsync(response.stream) : response.content;
      assert.equal(parts.find(part => part.type === 'tool-call')?.toolName, name);
      if (streaming) assert.equal(parts.find(part => part.type === 'tool-input-start')?.toolName, name);
    })));
  }
});

test('Qwen cache creation accounting is retained in stream and JSON results', async () => {
  const factory = families[0][1];
  const usage = { prompt_tokens: 2000, completion_tokens: 20, total_tokens: 2020,
    prompt_tokens_details: { cached_tokens: 800, cache_creation_input_tokens: 1000 } };
  const provider = factory({ name: 'audit', baseURL: 'https://local.invalid/v1', fetch: async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.reasoning_effort, 'low');
    const payload = { id: 'fixture', model: body.model, created: 1, usage,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] };
    if (!body.stream) return Response.json(payload);
    const chunks = [{ ...payload, usage: undefined, choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] }, { ...payload, choices: [] }];
    return new Response(chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
  } });
  for (const stream of [false, true]) {
    const result = await provider('qwen3.8-max')[stream ? 'doStream' : 'doGenerate']({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], providerOptions: { audit: { reasoningEffort: 'low' } } });
    const record = stream ? (await Array.fromAsync(result.stream)).find(part => part.type === 'finish') : result;
    assert.equal(record.usage.inputTokens.cacheWrite, 1000);
    assert.equal(record.usage.inputTokens.cacheRead, 800);
    assert.equal(record.usage.inputTokens.noCache, 200);
  }
});

test('namespaced IDs and explicit alias connections select their family module', () => {
  for (const [modelId, adapter] of [['Qwen/Qwen3.8-Flash-Next', 'qwem'], ['qwen-plus', 'qwem'], ['moonshotai/kimi-k3', 'kiml']]) {
    const config = buildOpenCodeConfig({ providerId: 'relay', modelId, baseUrl: 'https://relay.invalid/v1' });
    assert.ok(config.provider.relay.npm.endsWith(`opencode-${adapter}-provider.mjs`));
    assert.equal(config.provider.relay.models[modelId].interleaved.field, 'reasoning_content');
  }
  assert.match(buildOpenCodeConfig({ providerId: 'relay', modelId: 'custom-alias', kiml: true }).provider.relay.npm, /kiml-provider/);
  for (const [modelId, requested, actual] of [['qwen3.8-max', 'high', 'xhigh'], ['kimi-k3', 'medium', 'high']]) {
    const config = buildOpenCodeConfig({ providerId: 'relay', modelId, reasoningSpeed: requested });
    assert.equal(config.provider.relay.models[modelId].options.reasoningEffort, actual);
    assert.equal(config.provider.relay.models[modelId].options.reasoningEffortAdjusted.requested, requested);
  }
});

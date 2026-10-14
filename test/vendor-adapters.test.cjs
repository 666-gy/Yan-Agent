'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const prompt = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
const tools = [{ type: 'function', name: 'mcp.read', inputSchema: { type: 'object', properties: {} } }];
const chunk = (delta, finish_reason = null) => ({ id: 'test', model: 'fixture', choices: [{ index: 0, delta, finish_reason }] });
const sse = rows => new Response(rows.map(row => 'data: ' + JSON.stringify(row) + '\n\n').join('') + 'data: [DONE]\n\n', { headers: { 'content-type': 'text/event-stream' } });
const drain = async stream => { const rows = []; for await (const row of stream) rows.push(row); return rows; };

test('vendor shaping respects explicit native controls and unknown models', async () => {
  const { shapeAgnlRequestBody: a, shapeGemlRequestBody: g, shapeGrolRequestBody: x } = await import('../lib/vendor-request-shaping.mjs');
  assert.equal(a({ model: 'agnes-2.5-flash', reasoning_effort: 'none' }).chat_template_kwargs.enable_thinking, false);
  assert.equal(a({ model: 'agnes-2.5-flash', reasoning_effort: 'high', chat_template_kwargs: { enable_thinking: false } }).chat_template_kwargs.enable_thinking, false);
  assert.equal(a({ model: 'agnes-3.0-flash', reasoning_effort: 'high' }).chat_template_kwargs.enable_thinking, true);
  assert.equal(a({ model: 'agnes-2.0-flash-latest', reasoning_effort: 'medium' }).chat_template_kwargs.enable_thinking, true);
  assert.equal(a({ model: 'agnes-2.5-pro', reasoning_effort: 'high' }).reasoning_effort, undefined);
  assert.equal(a({ model: 'agnes-2.5-pro-alpha', reasoning_effort: 'low' }).reasoning_effort, undefined);
  assert.equal(g({ model: 'gemini-2.5-flash', reasoning_effort: 'none' }).reasoning_effort, 'none');
  assert.equal(g({ model: 'gemini-3-pro-preview', reasoning_effort: 'none' }).reasoning_effort, 'low');
  assert.equal(g({ model: 'gemini-3-pro-preview', reasoning_effort: 'high', extra_body: { google: { thinking_config: { thinking_budget: 100 } } } }).reasoning_effort, undefined);
  assert.equal(x({ model: 'grok-3-mini', reasoning_effort: 'medium' }).reasoning_effort, 'high');
  assert.equal(x({ model: 'grok-4.6', reasoning_effort: 'max', stop: ['x'], presence_penalty: 1 }).reasoning_effort, 'xhigh');
  assert.equal(x({ model: 'grok-4', reasoning_effort: 'high', stop: ['x'] }).stop, undefined);
  for (const shape of [a, g, x]) assert.deepEqual(shape({ model: 'future-99', reasoning_effort: 'custom', reasoningEffortAdjusted: true }), { model: 'future-99', reasoning_effort: 'custom' });
});

test('shipped vendor bundles expose one constructor and normalize JSON usage', async () => {
  for (const id of ['agnl', 'geml', 'grol']) {
    const module = await import(`../lib/opencode-${id}-provider.bundle.mjs`);
    const factories = Object.keys(module).filter(key => key.startsWith('create'));
    assert.equal(factories.length, 1);
    let wire;
    const provider = module[factories[0]]({ name: 'custom', baseURL: 'https://local.test/v1', fetch: async (_url, init) => {
      wire = JSON.parse(init.body);
      return Response.json({ id: 'test', model: 'fixture', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }], usage: id === 'agnl' ? { input_tokens: 12, output_tokens: 3 } : { prompt_tokens: 12, completion_tokens: 3 } });
    } });
    const result = await provider('fixture').doGenerate({ prompt });
    assert.equal(result.content[0].text, 'ok');
    assert.equal(result.usage.inputTokens.total, 12);
    assert.equal(result.usage.outputTokens.total, 3);
    assert.equal(wire.model, 'fixture');
  }
});

test('GEML preserves late parallel tool signatures with custom provider names and replay', async () => {
  const { createYanGemlProvider } = await import('../lib/opencode-geml-provider.bundle.mjs');
  await Promise.all(['alpha', 'beta'].map(async label => {
    const requests = [];
    const provider = createYanGemlProvider({ name: label, baseURL: 'https://local.test/v1', fetch: async (_url, init) => {
      const body = JSON.parse(init.body); requests.push(body);
      const name = body.tools[0].function.name;
      return sse([
        chunk({ tool_calls: [0, 1].map(index => ({ index, id: `${label}-${index}`, type: 'function', function: { name, arguments: '{}' } })) }),
        chunk({ tool_calls: [0, 1].map(index => ({ index, extra_content: { google: { thought_signature: `${label}-signature-${index}` } } })) }),
        chunk({}, 'tool_calls')
      ]);
    } });
    const rows = await drain((await provider('gemini-3-pro-preview').doStream({ prompt, tools })).stream);
    assert.deepEqual(rows.filter(row => row.type === 'error'), []);
    const calls = rows.filter(row => row.type === 'tool-call');
    assert.equal(calls.length, 2);
    for (let i = 0; i < calls.length; i++) {
      assert.equal(calls[i].toolName, 'mcp.read');
      assert.equal(calls[i].providerMetadata.google.thoughtSignature, `${label}-signature-${i}`);
    }
    await drain((await provider('gemini-3-pro-preview').doStream({ tools, prompt: [...prompt,
      { role: 'assistant', content: calls.map(call => ({ type: 'tool-call', toolCallId: call.toolCallId, toolName: call.toolName, input: {}, providerOptions: call.providerMetadata })) },
      { role: 'tool', content: calls.map(call => ({ type: 'tool-result', toolCallId: call.toolCallId, toolName: call.toolName, output: { type: 'text', value: 'ok' } })) }
    ] })).stream);
    const replay = requests[1].messages.find(message => message.tool_calls)?.tool_calls;
    assert.deepEqual(replay.map(call => call.extra_content.google.thought_signature), [`${label}-signature-0`, `${label}-signature-1`]);
  }));
});

test('GLMM requests stream usage by default and respects opt-out', async () => {
  const { createYanGlmmProvider } = await import('../lib/opencode-glmm-provider.bundle.mjs');
  for (const includeUsage of [undefined, false]) {
    let wire;
    const provider = createYanGlmmProvider({ name: 'glm', baseURL: 'https://local.test/v1', ...(includeUsage === undefined ? {} : { includeUsage }), fetch: async (_url, init) => { wire = JSON.parse(init.body); return sse([chunk({ content: 'ok' }), chunk({}, 'stop')]); } });
    await drain((await provider('glm-5.3').doStream({ prompt })).stream);
    assert.equal(wire.stream_options?.include_usage, includeUsage === false ? undefined : true);
  }
});

test('shared stream cancellation reaches upstream', { timeout: 3000 }, async () => {
  const { createYanProviderFetch } = await import('../lib/opencode-dsml-provider.mjs');
  let reason;
  const response = await createYanProviderFetch(async () => new Response(new ReadableStream({ cancel(value) { reason = value; } }), { headers: { 'content-type': 'text/event-stream' } }))('https://local.test/v1', {});
  await response.body.cancel('user-stop');
  assert.equal(reason, 'user-stop');
});

test('GPTL aliases forced choice and keeps explicit completion token cap', async () => {
  const { shapeGptlChatBody, shapeGptlResponsesBody } = await import('../lib/gptl-request-shaping.mjs');
  const chat = shapeGptlChatBody({ model: 'gpt-5', max_tokens: 10, max_completion_tokens: 20, tools: [{ type: 'function', function: { name: 'mcp.read', parameters: {} } }], tool_choice: { type: 'function', function: { name: 'mcp.read' } } });
  assert.equal(chat.max_completion_tokens, 20);
  assert.equal(chat.tool_choice.function.name, chat.tools[0].function.name);
  assert.notEqual(chat.tool_choice.function.name, 'mcp.read');
  const responses = shapeGptlResponsesBody({ model: 'gpt-5', tools: [{ type: 'function', name: 'mcp.read', parameters: {} }], tool_choice: { type: 'function', name: 'mcp.read' } });
  assert.equal(responses.tool_choice.name, responses.tools[0].name);
});

test('KIML and QWEM remove UI receipts without altering future vendor controls', async () => {
  for (const [file, fn] of [['kimi', 'shapeKimiRequestBody'], ['qwen', 'shapeQwenRequestBody']]) {
    const module = await import(`../lib/${file}-request-shaping.mjs`);
    assert.deepEqual(module[fn]({ model: 'future-99', reasoningEffortAdjusted: true, native_option: 1 }), { model: 'future-99', native_option: 1 });
  }
});

test('vendor selection supports model inference, explicit aliases and protocol overrides', () => {
  for (const [flag, model] of [['agnl', 'agnes-2.5-flash'], ['geml', 'gemini-3-pro-preview'], ['grol', 'grok-4.6']]) {
    for (const explicit of [false, true]) {
      const config = buildOpenCodeConfig({ providerId: 'custom', modelId: explicit ? 'gpt-6' : model, baseUrl: 'https://api.openai.com/v1', ...(explicit ? { [flag]: true } : {}) });
      assert.match(config.provider.custom.npm, new RegExp(`opencode-${flag}-provider`));
    }
    // An anthropic connection speaks Messages, not Chat Completions, so the
    // vendor adapter does not apply even when the vendor flag is set. ANTL owns
    // that endpoint now, and it wraps the same SDK rather than replacing it.
    const config = buildOpenCodeConfig({ providerId: 'custom', modelId: model, [flag]: true, apiFormat: 'anthropic' });
    assert.match(config.provider.custom.npm, /opencode-antl-provider/);
    assert.notEqual(config.provider.custom.npm, '@ai-sdk/anthropic');
  }
  // A Claude model on an anthropic connection resolves to antl by model id
  // alone, with no explicit flag — this is the path that used to fall through
  // to a raw SDK import and therefore never placed a cache breakpoint.
  for (const model of ['claude-fable-5', 'claude-fable-5-1', 'claude-sonnet-5', 'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5']) {
    const config = buildOpenCodeConfig({ providerId: 'custom', modelId: model, baseUrl: 'https://api.anthropic.com/v1', apiFormat: 'anthropic' });
    assert.match(config.provider.custom.npm, /opencode-antl-provider/, model);
  }
});

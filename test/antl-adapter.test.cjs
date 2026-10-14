'use strict';
// ANTL — the Anthropic Messages native preset.
//
// The assertion this file exists for is the last one: a Claude model on an
// anthropic connection must actually carry cache breakpoints on the wire.
// Everything else is the machinery that makes those breakpoints correct,
// byte-stable, and no more numerous than the API accepts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');

const prompt = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];
const tool = name => ({ type: 'function', name, inputSchema: { type: 'object', properties: {} } });

// Models are the point of the roster: Fable, Sonnet and Opus, current and not
// yet released. Adding a version must not require touching the adapter.
const ROSTER = [
  'claude-fable-5', 'claude-fable-5-1', 'claude-fable-6',
  'claude-sonnet-5', 'claude-sonnet-5-2', 'claude-sonnet-6',
  'claude-opus-4-8', 'claude-opus-5', 'claude-opus-5-5', 'claude-opus-6'
];

const usageBody = extra => JSON.stringify({
  id: 'msg_1', type: 'message', role: 'assistant', model: 'fixture',
  content: [{ type: 'text', text: 'ok' }], stop_reason: 'end_turn',
  usage: { input_tokens: 10, output_tokens: 7, cache_creation_input_tokens: 900, ...extra }
});

// Drive the shipped bundle, not the source, so the test covers the artifact the
// app actually stages and loads.
async function providerWith({ body = {}, sse = false, options = {} } = {}) {
  const module = await import('../lib/opencode-antl-provider.bundle.mjs');
  const factories = Object.keys(module).filter(key => key.startsWith('create'));
  const seen = { calls: [] };
  const provider = module[factories[0]]({
    name: 'antl', baseURL: 'https://api.anthropic.com/v1', apiKey: 'fixture', ...options,
    fetch: async (url, init) => {
      seen.url = String(url);
      seen.headers = new Headers(init.headers);
      seen.body = JSON.parse(init.body);
      seen.calls.push(seen.body);
      if (!sse) return Response.json({ ...JSON.parse(usageBody(body)), ...body });
      const rows = [
        { type: 'message_start', message: { id: 'm', usage: { input_tokens: 10, output_tokens: 0, cache_creation_input_tokens: 900, cache_read_input_tokens: 2000 } } },
        { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
        { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
        { type: 'content_block_stop', index: 0 },
        { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 7 } },
        { type: 'message_stop' }
      ];
      return new Response(rows.map(row => `event: ${row.type}\ndata: ${JSON.stringify(row)}\n\n`).join(''),
        { headers: { 'content-type': 'text/event-stream' } });
    }
  });
  return { provider, seen, create: module[factories[0]], factories };
}

test('ANTL exposes exactly one constructor and speaks the Messages endpoint', async () => {
  const { create, factories } = await providerWith();
  assert.deepEqual(factories, ['createYanAntlProvider']);
  assert.equal(typeof create, 'function');
  const { provider, seen } = await providerWith();
  const result = await provider('claude-opus-5').doGenerate({ prompt });
  assert.equal(result.content[0].text, 'ok');
  // The SDK owns the path; antl must not have appended a Chat Completions route.
  assert.equal(seen.url, 'https://api.anthropic.com/v1/messages');
  assert.match(seen.headers.get('anthropic-version') || '', /^\d{4}-\d{2}-\d{2}$/);
});

test('ANTL places bounded breakpoints and never exceeds the API cap', async () => {
  const { placeAntlCacheBreakpoints } = await import('../lib/antl-request-shaping.mjs');
  const body = {
    model: 'claude-opus-5',
    system: [{ type: 'text', text: 'rules' }],
    tools: [tool('beta'), tool('alpha')],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'two' }] },
      { role: 'user', content: [{ type: 'text', text: 'three' }] }
    ]
  };
  const marks = value => [
    ...(value.tools || []).filter(item => item.cache_control).map(() => 'tools'),
    ...(value.system || []).filter(item => item.cache_control).map(() => 'system'),
    ...(value.messages || []).flatMap(message => (message.content || []).filter(item => item.cache_control).map(() => 'messages'))
  ];
  const shaped = placeAntlCacheBreakpoints(body, {});
  const placed = marks(shaped);
  // Longest-lived prefix first, and exactly one conversation breakpoint: a
  // second one would write a fresh cache entry for tokens already covered.
  assert.deepEqual(placed, ['tools', 'system', 'messages']);
  assert.ok(placed.length <= 4);
  // The newest turn is volatile by definition and must stay unmarked.
  assert.equal(shaped.messages.at(-1).content.some(item => item.cache_control), false);
  // The input is not mutated; callers re-shape the same object on later turns.
  assert.equal(body.tools.some(item => item.cache_control), false);
  // A caller who placed their own breakpoints keeps control.
  const explicit = { ...body, system: [{ type: 'text', text: 'rules', cache_control: { type: 'ephemeral', ttl: '1h' } }] };
  assert.deepEqual(placeAntlCacheBreakpoints(explicit, {}), explicit);
  // Tools and system alone are enough; no conversation is required.
  assert.ok(marks(placeAntlCacheBreakpoints({ model: 'x', tools: [tool('a')] }, {})).length === 1);
});

test('ANTL shaping is idempotent and key-order stable', async () => {
  const { shapeAntlRequestBody, stabilizeAntlTools } = await import('../lib/antl-request-shaping.mjs');
  const body = {
    model: 'claude-fable-5-1', max_tokens: 100,
    system: [{ type: 'text', text: 'rules' }],
    tools: [tool('zeta'), tool('alpha')],
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'user', content: [{ type: 'text', text: 'two' }] }
    ]
  };
  const once = shapeAntlRequestBody(body, {});
  const twice = shapeAntlRequestBody(once, {});
  // Anthropic matches a byte-identical prefix, so a body that serializes
  // differently on the second pass is a silent cache miss.
  assert.equal(JSON.stringify(once), JSON.stringify(twice));
  // Parallel MCP discovery can reorder the same tools between turns.
  const shuffled = { ...body, tools: [tool('alpha'), tool('zeta')] };
  assert.equal(JSON.stringify(shapeAntlRequestBody(shuffled, {}).tools), JSON.stringify(once.tools));
  assert.deepEqual(stabilizeAntlTools([tool('b'), tool('a')]).map(item => item.name), ['a', 'b']);
  assert.deepEqual(stabilizeAntlTools([]), []);
  assert.deepEqual(stabilizeAntlTools(null), null);
});

test('ANTL honors the cache TTL it was asked for and rejects the rest', async () => {
  const { shapeAntlRequestBody } = await import('../lib/antl-request-shaping.mjs');
  const body = { model: 'claude-opus-5', tools: [tool('a')], messages: prompt };
  for (const key of ['ttl', 'cacheTtl', 'cache_ttl']) {
    assert.equal(shapeAntlRequestBody(body, { [key]: '1h' }).tools[0].cache_control.ttl, '1h');
    assert.equal(shapeAntlRequestBody(body, { [key]: '5m' }).tools[0].cache_control.ttl, '5m');
  }
  // The default carries no ttl field: the shorter window is the cheaper write.
  assert.deepEqual(shapeAntlRequestBody(body, {}).tools[0].cache_control, { type: 'ephemeral' });
  // Silently defaulting an unrecognized TTL would look identical to caching
  // working, right up until a long session expired mid-conversation.
  assert.throws(() => shapeAntlRequestBody(body, { ttl: '2h' }), /unsupported cache TTL/);
  // Breakpoint budget is respected when a caller lowers it.
  assert.equal(shapeAntlRequestBody(body, { cacheBreakpoints: 1 }).messages[0].content.some(item => item.cache_control), false);
});

test('ANTL maps reasoning effort onto the closed output_config enum', async () => {
  const { shapeAntlRequestBody } = await import('../lib/antl-request-shaping.mjs');
  const effort = value => shapeAntlRequestBody({ model: 'claude-opus-5', reasoningEffort: value, messages: prompt }, {});
  assert.equal(effort('high').output_config.effort, 'high');
  assert.equal(effort('MAX').output_config.effort, 'max');
  assert.equal(effort('xhigh').output_config.effort, 'xhigh');
  // A Yan tier with no Anthropic counterpart maps to the nearest level, and an
  // unrecognized word maps to the neutral middle rather than 400-ing the request.
  assert.equal(effort('minimal').output_config.effort, 'low');
  assert.equal(effort('custom').output_config.effort, 'medium');
  assert.equal(effort(undefined).output_config, undefined);
  // 'none' means "do not send the field", not "send an empty level".
  assert.equal(effort('none').output_config, undefined);
  // Yan's UI receipt must never reach the wire.
  const shaped = shapeAntlRequestBody({ model: 'claude-opus-5', reasoning_effort: 'high', reasoningEffortAdjusted: true, messages: prompt }, {});
  assert.equal('reasoningEffortAdjusted' in shaped, false);
  assert.equal('reasoning_effort' in shaped, false);
  assert.deepEqual(shapeAntlRequestBody({ model: 'future-99', reasoningEffortAdjusted: true }, {}), { model: 'future-99' });
});

test('ANTL totals input from all three fields and streams without a Done sentinel', async () => {
  const { provider, seen } = await providerWith();
  const result = await provider('claude-fable-5').doGenerate({ prompt, tools: [tool('a')] });
  // Anthropic reports the uncached remainder in input_tokens. Reading that field
  // alone under-reports the prompt by the entire cached prefix.
  assert.deepEqual(result.usage.inputTokens, { total: 910, noCache: 10, cacheRead: 0, cacheWrite: 900 });
  assert.equal(result.usage.outputTokens.total, 7);
  assert.equal(seen.body.stream, undefined);

  const streamed = await providerWith({ sse: true });
  const rows = [];
  for await (const row of (await streamed.provider('claude-opus-5-5').doStream({ prompt, tools: [tool('a')] })).stream) rows.push(row);
  assert.deepEqual(rows.filter(row => row.type === 'error'), []);
  assert.equal(rows.filter(row => row.type === 'text-delta').map(row => row.delta).join(''), 'ok');
  assert.equal(rows.at(-1).type, 'finish');
  // The SDK normalizes the vendor's stop reason, so the raw value is preserved
  // alongside the unified one rather than replacing it.
  assert.equal(rows.at(-1).finishReason.unified, 'stop');
  assert.equal(rows.at(-1).finishReason.raw, 'end_turn');
  assert.equal(rows.at(-1).usage.inputTokens.total, 2910);
});

test('ANTL reports the cached share of the prompt for the speed readout', async () => {
  const { usageMetrics } = await import('../lib/provider-telemetry.mjs');
  const metrics = usageMetrics({ input_tokens: 10, output_tokens: 7, cache_read_input_tokens: 2000, cache_creation_input_tokens: 900 });
  assert.equal(metrics.inputTokens, 2910);
  assert.equal(metrics.cachedInputTokens, 2000);
  assert.equal(metrics.cacheWriteTokens, 900);
  assert.equal(metrics.cacheReported, true);
  assert.equal(Math.round(metrics.cacheHitRate * 1000) / 1000, 0.687);
  // A non-Anthropic vendor must still take the shared path unchanged.
  const openai = usageMetrics({ prompt_tokens: 100, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 40 } });
  assert.equal(openai.inputTokens, 100);
  assert.equal(openai.cachedInputTokens, 40);
  assert.equal(openai.cacheWriteTokens, undefined);
});

test('ANTL recognizes every Claude family and leaves other vendors alone', async () => {
  const { isAntlModel, antlFamily } = await import('../lib/antl-request-shaping.mjs');
  for (const model of ROSTER) {
    assert.equal(isAntlModel(model), true, model);
    assert.match(antlFamily(model), /^(fable|sonnet|opus)$/, model);
  }
  assert.equal(antlFamily('claude-fable-5-1'), 'fable');
  assert.equal(antlFamily('anthropic/claude-opus-5-5'), 'opus');
  assert.equal(antlFamily('claude-sonnet-5'), 'sonnet');
  assert.equal(antlFamily('claude-3-5-haiku-20241022'), 'haiku');
  // Future arrivals match on the pattern, not on a version list.
  assert.equal(isAntlModel('claude-opus-7-2-20270101'), true);
  for (const other of ['gpt-5', 'gptl-4o', 'glm-5.3', 'qwen3-max', 'gemini-3-pro', 'grok-4.6', 'deepseek-v4', '']) {
    assert.equal(isAntlModel(other), false, other);
  }
});

test('every Claude model on an anthropic connection ships with cache breakpoints', async () => {
  const { provider, seen } = await providerWith();
  await provider('claude-opus-5').doGenerate({
    prompt: [
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
      { role: 'assistant', content: [{ type: 'text', text: 'two' }] },
      { role: 'user', content: [{ type: 'text', text: 'three' }] }
    ],
    tools: [tool('zeta'), tool('alpha')]
  });
  // This is the whole point of the preset: without a breakpoint on the wire the
  // API reuses nothing and the cached prefix is never written.
  assert.equal(seen.body.tools.at(-1).cache_control.type, 'ephemeral');
  assert.equal(seen.body.messages.some(message => (message.content || []).some(block => block.cache_control)), true);
  assert.equal(JSON.stringify(seen.body).split('cache_control').length - 1 <= 4, true);
  // Tools arrive sorted, so a rediscovery that reorders them cannot move the
  // prefix the model is being cached against.
  assert.deepEqual(seen.body.tools.map(item => item.name), ['alpha', 'zeta']);

  // Opting out leaves the body untouched for callers who manage caching themselves.
  const { provider: raw, seen: untouched } = await providerWith({ options: { yanAntlCompatibility: false } });
  await raw('claude-opus-5').doGenerate({ prompt, tools: [tool('zeta'), tool('alpha')] });
  assert.equal(JSON.stringify(untouched.body).includes('cache_control'), false);
  assert.deepEqual(untouched.body.tools.map(item => item.name), ['zeta', 'alpha']);
});

test('routing sends anthropic connections to antl rather than a bare SDK import', async () => {
  const config = buildOpenCodeConfig({ providerId: 'custom', modelId: 'claude-opus-5', baseUrl: 'https://api.anthropic.com/v1', apiFormat: 'anthropic' });
  assert.match(config.provider.custom.npm, /opencode-antl-provider/);
  // A relay that hosts both vendors must follow the selected model, not the
  // connection: a GPT model on the same anthropic relay stays on its own adapter.
  const relayed = buildOpenCodeConfig({ providerId: 'custom', modelId: 'claude-opus-5', baseUrl: 'https://relay.test/v1', apiFormat: 'anthropic', antl: true });
  assert.match(relayed.provider.custom.npm, /opencode-antl-provider/);
  // Every family resolves to the same adapter, because the Messages wire format
  // is a property of the API and not of the model generation.
  for (const model of ROSTER) {
    const next = buildOpenCodeConfig({ providerId: 'custom', modelId: model, baseUrl: 'https://api.anthropic.com/v1', apiFormat: 'anthropic' });
    assert.match(next.provider.custom.npm, /opencode-antl-provider/, model);
  }
});

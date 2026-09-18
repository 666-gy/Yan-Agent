'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { fileURLToPath, pathToFileURL } = require('node:url');
const gptProfile = require('../lib/gpt-model-profile');
const { buildOpenCodeConfig, stageGptlProviderModule } = require('../lib/opencode-sidecar');

const appRoot = path.resolve(__dirname, '..');
const gptlBundle = path.join(appRoot, 'lib', 'opencode-gptl-provider.bundle.mjs');
const responsesBundle = path.join(appRoot, 'lib', 'opencode-openai-responses-provider.bundle.mjs');

let shaping;
test.before(async () => {
  shaping = await import('../lib/gptl-request-shaping.mjs');
});

// Capability table verified against developers.openai.com model pages.
// Compatibility policy: active shaping starts at GPT-5.6; pre-5.6 reasoning
// models share the always-valid low/medium/high ladder.
test('profile carries the verified effort ladders of every shipping family', () => {
  assert.deepEqual(gptProfile.profileFor('gpt-6-astra').efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(gptProfile.profileFor('gpt-5.6-sol').efforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  assert.deepEqual(gptProfile.profileFor('5.6-sol').efforts, gptProfile.profileFor('gpt-5.6').efforts);
  assert.deepEqual(gptProfile.profileFor('gpt-5.5').efforts, ['low', 'medium', 'high']);
  assert.deepEqual(gptProfile.profileFor('gpt-5.1').efforts, ['low', 'medium', 'high']);
  assert.deepEqual(gptProfile.profileFor('gpt-5').efforts, ['low', 'medium', 'high']);
  assert.deepEqual(gptProfile.profileFor('o3').efforts, ['low', 'medium', 'high']);
  // o1-mini accepts no reasoning_effort value at all: an empty ladder tells
  // shaping to strip the key entirely (see the o1-mini regression test).
  assert.deepEqual(gptProfile.profileFor('o1-mini').efforts, []);
  assert.equal(gptProfile.profileFor('gpt-4o').reasoning, false);
  assert.equal(gptProfile.profileFor('gpt-4-turbo').vision, true);
  assert.equal(gptProfile.profileFor('gpt-4').vision, false);
  assert.equal(gptProfile.profileFor('gpt-image-2.5-sunburst').kind, 'media');
});

test('a future GPT id inherits the newest rule set without code changes', () => {
  for (const id of ['gpt-7-preview', 'gpt-6.2-whatever']) {
    const profile = gptProfile.profileFor(id);
    assert.equal(profile.kind, 'gpt');
    assert.equal(profile.requiresResponsesForTools, true);
    assert.deepEqual(profile.efforts, ['low', 'medium', 'high', 'xhigh', 'max']);
    assert.equal(profile.vision, true);
    assert.equal(profile.maxOutputTokens, 128_000);
  }
  // A future 5.x minor inherits the 5.6 tier, including its 'none' rung.
  const futureMinor = gptProfile.profileFor('gpt-5.7-candidate');
  assert.deepEqual(futureMinor.efforts, ['none', 'low', 'medium', 'high', 'xhigh', 'max']);
  const pre56 = gptProfile.profileFor('gpt-5.3-turbo');
  assert.deepEqual(pre56.efforts, ['low', 'medium', 'high']);
  assert.equal(pre56.requiresResponsesForTools, false);
});

test('effort clamping follows the addressed model, not a global whitelist', () => {
  assert.equal(gptProfile.clampEffort('gpt-5', 'max').effort, 'high');
  assert.equal(gptProfile.clampEffort('gpt-5.5', 'max').effort, 'high');
  assert.equal(gptProfile.clampEffort('gpt-5.5', 'max').adjusted, true);
  assert.equal(gptProfile.clampEffort('gpt-5.1', 'none').effort, 'low');
  assert.equal(gptProfile.clampEffort('gpt-5.6-sol', 'max').effort, 'max');
  assert.equal(gptProfile.clampEffort('gpt-6-astra', 'none').effort, 'low');
  assert.equal(gptProfile.clampEffort('gpt-4o', 'high').effort, '');
});

test('unspecified GPTL effort uses the profile default without forcing high', () => {
  assert.equal(shaping.shapeGptlChatBody({ model: 'gpt-5.5' }).reasoning_effort, 'medium');
  assert.equal(shaping.shapeGptlResponsesBody({ model: 'gpt-6-astra' }).reasoning.effort, 'medium');
  const explicit = shaping.shapeGptlResponsesBody({ model: 'gpt-6-astra', reasoning_effort: 'high' });
  assert.equal(explicit.reasoning.effort, 'high');
  assert.equal('reasoning_effort' in explicit, false);
});

test('unnamed GPTL providers also disable Responses storage by default', async () => {
  const { createYanGptlProvider } = await import(pathToFileURL(gptlBundle).href);
  let body;
  const provider = createYanGptlProvider({ apiKey: 'test', fetch: async (_input, init) => {
    body = JSON.parse(init.body);
    return new Response('{}', { status: 400, headers: { 'content-type': 'application/json' } });
  } });
  await assert.rejects(provider('gpt-6-astra').doGenerate({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello' }] }]
  }));
  assert.equal(body.store, false);
  assert.equal(body.reasoning.effort, 'medium');
});

// Regression: o1-mini is a reasoning model; it must receive
// max_completion_tokens (never max_tokens) and no sampling parameters.
test('o1-mini receives the reasoning-model parameter contract', () => {
  const shaped = shaping.shapeGptlChatBody({
    model: 'o1-mini',
    max_tokens: 4096,
    temperature: 0.7,
    top_p: 0.9,
    reasoning_effort: 'high'
  });
  assert.equal(shaped.max_completion_tokens, 4096);
  assert.equal('max_tokens' in shaped, false);
  for (const key of ['temperature', 'top_p', 'reasoning_effort']) {
    assert.equal(key in shaped, false, key);
  }
});

test('tool-bearing turns route around Chat Completions when the model requires it', () => {
  assert.equal(gptProfile.routeFor('gpt-6-astra', { hasTools: true }), 'responses');
  assert.equal(gptProfile.routeFor('gpt-5.6-sol', { hasTools: true }), 'responses');
  // Responses-pinned models stay on Responses for tool-less turns too: the
  // two endpoints keep separate prompt caches, so flipping would re-miss.
  assert.equal(gptProfile.routeFor('gpt-5.6-sol', { hasTools: false }), 'responses');
  assert.equal(gptProfile.routeFor('gpt-6-astra', { hasTools: false }), 'responses');
  assert.equal(gptProfile.routeFor('gpt-5.5', { hasTools: true }), 'chat');
  assert.equal(gptProfile.routeFor('gpt-4o', { hasTools: true }), 'chat');
  assert.equal(gptProfile.routeFor('gpt-5.5', { hasTools: false }), 'chat');
  assert.equal(gptProfile.routeFor('gpt-5.6-cyber', { hasTools: false }), 'responses');
  assert.equal(gptProfile.routeFor('gpt-5.5', { hasTools: true, apiFormat: 'responses' }), 'responses');
});

test('chat shaping keeps served tiers and drops parameters the model rejects', () => {
  const shaped = shaping.shapeGptlChatBody({
    model: 'gpt-5.6-sol',
    max_tokens: 4096,
    temperature: 0.7,
    top_p: 0.9,
    stop: ['\n'],
    seed: 7,
    reasoning_effort: 'xhigh',
    tools: [{ type: 'function', function: { name: 'mcp_default_playwright.browser_click', parameters: {} } }],
    messages: [
      { role: 'assistant', tool_calls: [{ id: 'c1', function: { name: 'mcp_default_playwright.browser_click', arguments: '{}' } }] },
      { role: 'tool', tool_call_id: 'c1', name: 'mcp_default_playwright.browser_click', content: 'ok' }
    ]
  });
  assert.equal(shaped.reasoning_effort, 'xhigh');
  assert.equal(shaped.max_completion_tokens, 4096);
  assert.equal('max_tokens' in shaped, false);
  for (const key of ['temperature', 'top_p', 'stop', 'seed']) {
    assert.equal(key in shaped, false, key);
  }
  assert.equal(shaped.tools[0].function.name, 'mcp_default_playwright_browser_click');
  assert.equal(shaped.messages[0].tool_calls[0].function.name, 'mcp_default_playwright_browser_click');
  assert.equal(shaped.messages[1].name, 'mcp_default_playwright_browser_click');
});

test('chat shaping clamps tiers and leaves non-GPT providers untouched', () => {
  assert.equal(shaping.shapeGptlChatBody({ model: 'gpt-5', reasoning_effort: 'max' }).reasoning_effort, 'high');
  const chat = shaping.shapeGptlChatBody({ model: 'gpt-4o', temperature: 0.3, reasoning_effort: 'high' });
  assert.equal(chat.temperature, 0.3);
  assert.equal('reasoning_effort' in chat, false);
  const foreign = { model: 'deepseek-v4-flash', max_tokens: 10 };
  assert.equal(shaping.shapeGptlChatBody(foreign), foreign);
});

test('responses shaping clamps effort, strips unsupported controls and caps output', () => {
  const clamped = shaping.shapeGptlResponsesBody({
    model: 'gpt-5.5',
    reasoning: { effort: 'max', mode: 'pro', context: 'all_turns' },
    max_output_tokens: 999_999
  });
  assert.equal(clamped.reasoning.effort, 'high');
  assert.equal('mode' in clamped.reasoning, false);
  assert.equal('context' in clamped.reasoning, false);
  assert.equal(clamped.max_output_tokens, 128_000);

  const kept = shaping.shapeGptlResponsesBody({
    model: 'gpt-5.6-sol',
    reasoning: { effort: 'max', mode: 'pro', context: 'all_turns' }
  });
  assert.deepEqual({ ...kept.reasoning }, { effort: 'max', mode: 'pro', context: 'all_turns' });
});

test('responses shaping aliases tool names in tools and replayed calls', () => {
  const shaped = shaping.shapeGptlResponsesBody({
    model: 'gpt-6-astra',
    tools: [{ type: 'function', name: 'mcp_default_playwright.browser_click', parameters: {} }],
    input: [{ type: 'function_call', name: 'mcp_default_playwright.browser_click', call_id: 'c1', arguments: '{}' }]
  });
  assert.equal(shaped.tools[0].name, 'mcp_default_playwright_browser_click');
  assert.equal(shaped.input[0].name, 'mcp_default_playwright_browser_click');
});

test('tool-name aliases round-trip back to the registered tool name', () => {
  const tools = [
    { type: 'function', name: 'mcp_default_playwright.browser_click' },
    { type: 'function', name: 'read' }
  ];
  const restore = shaping.gptlToolNameRestoreMap(tools);
  const alias = gptProfile.sanitizeToolName('mcp_default_playwright.browser_click', 64);
  assert.equal(restore.get(alias), 'mcp_default_playwright.browser_click');
  assert.equal(shaping.restoreGptlToolCallName('read', restore), 'read');
  const generated = shaping.restoreGptlGenerateResult(
    { content: [{ type: 'tool-call', toolCallId: 'c1', toolName: alias, input: '{}' }] },
    restore
  );
  assert.equal(generated.content[0].toolName, 'mcp_default_playwright.browser_click');
  const part = shaping.restoreGptlStreamPart({ type: 'tool-input-start', id: 'c1', toolName: alias }, restore);
  assert.equal(part.toolName, 'mcp_default_playwright.browser_click');
});

test('GPTL provider routes the real request per model capability', async () => {
  const { createYanGptlProvider } = await import(pathToFileURL(gptlBundle).href);
  const requests = [];
  const fakeFetch = async (input, init) => {
    requests.push({ url: String(input), body: init?.body ? String(init.body) : '' });
    return new Response(JSON.stringify({ error: { message: 'stop', type: 'invalid_request_error' } }), {
      status: 400,
      headers: { 'content-type': 'application/json' }
    });
  };
  const provider = createYanGptlProvider({
    name: 'conn-gptl',
    apiKey: 'test-key',
    baseURL: 'https://api.openai.com/v1',
    fetch: fakeFetch
  });
  const tools = [{
    type: 'function',
    name: 'mcp_default_playwright.browser_click',
    description: 'Click an element',
    inputSchema: { type: 'object', properties: {}, additionalProperties: true }
  }];
  const prompt = [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }];

  await provider('gpt-5.6-sol').doGenerate({
    prompt,
    tools,
    providerOptions: { 'conn-gptl': { reasoningEffort: 'max' } }
  }).catch(() => {});

  assert.match(requests[0].url, /\/v1\/responses$/u);
  const responsesBody = JSON.parse(requests[0].body);
  assert.equal(responsesBody.reasoning.effort, 'max');
  assert.equal(responsesBody.store, false);
  assert.equal(responsesBody.tools[0].name, 'mcp_default_playwright_browser_click');

  await provider('gpt-5.5').doGenerate({
    prompt,
    tools,
    providerOptions: { 'conn-gptl': { reasoningEffort: 'max' } }
  }).catch(() => {});

  assert.match(requests[1].url, /\/v1\/chat\/completions$/u);
  const chatBody = JSON.parse(requests[1].body);
  assert.equal(chatBody.reasoning_effort, 'high');
  assert.equal(chatBody.tools[0].function.name, 'mcp_default_playwright_browser_click');
  assert.equal('temperature' in chatBody, false);
});

test('GPTL streams restore aliased tool names for the kernel tool registry', async () => {
  const { createYanGptlProvider } = await import(pathToFileURL(gptlBundle).href);
  const sse = [
    { id: 'chat-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { tool_calls: [{ index: 0, id: 'call-1', type: 'function', function: { name: 'mcp_default_playwright_browser_click', arguments: '{}' } }] }, finish_reason: null }] },
    { id: 'chat-1', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] }
  ].map(payload => `data: ${JSON.stringify(payload)}\n\n`).join('');
  const provider = createYanGptlProvider({
    name: 'conn-gptl',
    apiKey: 'test-key',
    baseURL: 'https://api.openai.com/v1',
    fetch: async () => new Response(`${sse}data: [DONE]\n\n`, {
      headers: { 'content-type': 'text/event-stream' }
    })
  });
  const result = await provider('gpt-5.5').doStream({
    prompt: [{ role: 'user', content: [{ type: 'text', text: 'click' }] }],
    tools: [{
      type: 'function',
      name: 'mcp_default_playwright.browser_click',
      description: 'Click an element',
      inputSchema: { type: 'object', properties: {}, additionalProperties: true }
    }]
  });
  const parts = [];
  for await (const part of result.stream) parts.push(part);
  const call = parts.find(part => part.type === 'tool-call');
  assert.equal(call.toolName, 'mcp_default_playwright.browser_click');
});

test('sidecar selects the GPTL module explicitly and only auto-upgrades official hosts', () => {
  const gptlModuleUrl = pathToFileURL(gptlBundle).href;
  const explicit = buildOpenCodeConfig({
    providerId: 'conn-gptl',
    providerName: 'GPTL 中转',
    modelId: 'gpt-5.6-sol',
    apiFormat: 'gptl',
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'test-key',
    gptlProviderModule: gptlModuleUrl
  });
  assert.equal(explicit.provider['conn-gptl'].npm, gptlModuleUrl);
  assert.equal(explicit.provider['conn-gptl'].options.apiFormat, 'openai');
  assert.equal('yanDsmlCompatibility' in explicit.provider['conn-gptl'].options, false);

  const auto = buildOpenCodeConfig({
    providerId: 'openai',
    modelId: 'gpt-5.6-sol',
    apiFormat: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    gptlProviderModule: gptlModuleUrl,
    responsesProviderModule: pathToFileURL(responsesBundle).href
  });
  assert.equal(auto.provider.openai.npm, gptlModuleUrl);

  const relayUntouched = buildOpenCodeConfig({
    providerId: 'conn-relay',
    modelId: 'gpt-5.6-sol',
    apiFormat: 'openai',
    baseUrl: 'https://relay.example.com/v1',
    apiKey: 'test-key',
    gptlProviderModule: gptlModuleUrl
  });
  assert.notEqual(relayUntouched.provider['conn-relay'].npm, gptlModuleUrl);

  const olderModel = buildOpenCodeConfig({
    providerId: 'openai',
    modelId: 'gpt-5.5',
    apiFormat: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: 'test-key',
    gptlProviderModule: gptlModuleUrl
  });
  assert.notEqual(olderModel.provider.openai.npm, gptlModuleUrl);
});

test('stages the GPTL bundle outside the application directory', () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-gptl-stage-'));
  try {
    const moduleUrl = stageGptlProviderModule({ appRoot, dataDir });
    const stagedPath = fileURLToPath(moduleUrl);
    assert.equal(stagedPath.startsWith(path.join(dataDir, 'opencode-runtime', 'providers')), true);
    assert.equal(fs.readFileSync(stagedPath).equals(fs.readFileSync(gptlBundle)), true);
    assert.equal(stageGptlProviderModule({ appRoot, dataDir }), moduleUrl);
  } finally {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
});

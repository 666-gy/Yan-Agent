'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const test = require('node:test');

const qwenProfile = require('../lib/qwen-model-profile');
const kimiProfile = require('../lib/kimi-model-profile');
const alias = require('../lib/provider-tool-alias');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');

let qwenShaping;
let kimiShaping;
let qwemBundle;
let kimlBundle;
test.before(async () => {
  qwenShaping = await import('../lib/qwen-request-shaping.mjs');
  kimiShaping = await import('../lib/kimi-request-shaping.mjs');
  qwemBundle = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'opencode-qwem-provider.bundle.mjs')).href);
  kimlBundle = await import(pathToFileURL(path.join(__dirname, '..', 'lib', 'opencode-kiml-provider.bundle.mjs')).href);
});

test('qwen profile: known families have contracts; future ids are unknown', () => {
  for (const id of ['qwen3.8-max', 'qwen3.6-plus', 'qwen3.5-flash']) {
    const profile = qwenProfile.profileFor(id);
    assert.equal(profile.kind, 'qwen', id);
    assert.equal(profile.hybridThinking, true, id);
    assert.equal(profile.explicitCache, true, id);
  }
  const future = qwenProfile.profileFor('qwen4.1-alpha');
  assert.equal(future.kind, 'unknown');
  assert.equal(future.hybridThinking, false);
  assert.equal(future.explicitCache, false);
  assert.equal(qwenProfile.profileFor('qwen2.5-max').kind, 'qwen-legacy');
  assert.equal(qwenProfile.profileFor('qwen3.8-2.4t-a95b').thinkingOnly, true);
});

test('kimi profile: K3 and K2.6 differ; future releases are unknown', () => {
  const k3 = kimiProfile.profileFor('kimi-k3');
  assert.equal(k3.kind, 'kimi');
  assert.equal(k3.alwaysThinking, true);
  assert.deepEqual(k3.efforts, ['low', 'high', 'max']);
  assert.equal(k3.multiTurnReasoningReplay, true);
  assert.equal(k3.vision, true);
  const k26 = kimiProfile.profileFor('kimi-k2.6');
  assert.equal(k26.kind, 'kimi');
  assert.deepEqual(k26.efforts, []);
  assert.equal(k26.stripSampling, true);
  const k4 = kimiProfile.profileFor('kimi-k4-preview');
  assert.deepEqual(k4.efforts, []);
  assert.equal(k4.multiTurnReasoningReplay, false);
});

test('kimi effort clamping follows the K3 ladder and ties round up', () => {
  assert.equal(kimiProfile.clampEffort('kimi-k3', 'max').effort, 'max');
  assert.equal(kimiProfile.clampEffort('kimi-k3', 'medium').effort, 'high');
  assert.equal(kimiProfile.clampEffort('kimi-k3', 'xhigh').effort, 'max');
  assert.equal(kimiProfile.clampEffort('kimi-k3', 'none').effort, 'low');
  assert.equal(kimiProfile.clampEffort('kimi-k2.6', 'high').effort, '');
});

test('qwen shaping: enable_thinking only appears when the caller asked for non-thinking', () => {
  const on = qwenShaping.shapeQwenRequestBody({ model: 'qwen3.8-max', messages: [] });
  assert.equal('enable_thinking' in on, false, 'family default (thinking on) must not add the key');
  const off = qwenShaping.shapeQwenRequestBody({ model: 'qwen3.8-max', messages: [], reasoning_effort: 'none' });
  assert.equal(off.enable_thinking, false);
  assert.equal('reasoning_effort' in off, false);
  const legacyBody = { model: 'qwen2.5-max', messages: [] };
  assert.equal(qwenShaping.shapeQwenRequestBody(legacyBody), legacyBody, 'qwen2-era ids pass through untouched');
});

test('qwen shaping maps high to the supported xhigh effort', () => {
  const shaped = qwenShaping.shapeQwenRequestBody({ model: 'qwen3.8-max', reasoning_effort: 'high' });
  assert.equal(shaped.reasoning_effort, 'xhigh');
  assert.equal('enable_thinking' in shaped, false);
});

test('qwen shaping injects one deterministic explicit cache marker on the system block', () => {
  const shaped = qwenShaping.shapeQwenRequestBody({
    model: 'qwen3.8-max',
    messages: [{ role: 'system', content: 'Yan system prompt' }, { role: 'user', content: 'hi' }]
  }, { cacheMode: 'explicit' });
  const system = shaped.messages[0];
  assert.equal(system.content[0].type, 'text');
  assert.deepEqual(system.content[0].cache_control, { type: 'ephemeral' });
  assert.equal(shaped.messages[1].content, 'hi');
  const again = qwenShaping.shapeQwenRequestBody(shaped);
  assert.equal(again, shaped, 'an already-marked body must come back as the same reference');
});

test('qwen shaping aliases dotted tool names with collision-safe restore', () => {
  const tools = [
    { type: 'function', function: { name: 'mcp_x.tool_a', parameters: {} } },
    { type: 'function', function: { name: 'mcp_x_tool_a', parameters: {} } },
    { type: 'function', function: { name: 'read', parameters: {} } }
  ];
  const shaped = qwenShaping.shapeQwenRequestBody({ model: 'qwen3.8-max', tools, messages: [] });
  const names = shaped.tools.map(tool => tool.function.name);
  assert.equal(new Set(names).size, names.length, 'aliases must stay unique');
  const { restore } = alias.buildToolAliasMap(tools.map(tool => tool.function.name));
  for (let index = 0; index < names.length; index += 1) {
    if (names[index] !== tools[index].function.name) {
      assert.ok(restore.has(names[index]), `restore map must cover aliased wire name ${names[index]}`);
      assert.equal(restore.get(names[index]), tools[index].function.name, 'restore must round-trip to the original');
    }
  }
  assert.equal(shaped.tools[2].function.name, 'read', 'already-legal names pass through');
});

test('qwen shaping is byte-stable and leaves foreign providers untouched', () => {
  const body = { model: 'qwen3.8-max', messages: [{ role: 'system', content: 's' }, { role: 'user', content: 'u' }], tools: [{ type: 'function', function: { name: 'read' } }] };
  const once = JSON.stringify(qwenShaping.shapeQwenRequestBody(JSON.parse(JSON.stringify(body))));
  const twice = JSON.stringify(qwenShaping.shapeQwenRequestBody(JSON.parse(JSON.stringify(body))));
  assert.equal(once, twice);
  const foreign = { model: 'deepseek-v4-flash', messages: [] };
  assert.equal(qwenShaping.shapeQwenRequestBody(foreign), foreign);
});

test('kimi shaping clamps reasoning_effort to the K3 ladder and preserves replay fields', () => {
  const clamped = kimiShaping.shapeKimiRequestBody({ model: 'kimi-k3', reasoning_effort: 'medium', messages: [{ role: 'assistant', content: 'x', reasoning_content: 'kept thinking' }] });
  assert.equal(clamped.reasoning_effort, 'high');
  assert.equal(clamped.messages[0].reasoning_content, 'kept thinking', 'the K3 replay contract must survive shaping');
  const absent = kimiShaping.shapeKimiRequestBody({ model: 'kimi-k3', messages: [] });
  assert.equal('reasoning_effort' in absent, false, 'absent effort stays absent so request bytes remain stable');
  const off = kimiShaping.shapeKimiRequestBody({ model: 'kimi-k3', reasoning_effort: 'none', messages: [] });
  assert.equal(off.reasoning_effort, 'low', 'K3 has no off switch: clamp to the lightest legal rung');
});

test('kimi shaping strips sampling and stray effort keys on k2.6', () => {
  const shaped = kimiShaping.shapeKimiRequestBody({ model: 'kimi-k2.6', temperature: 0.7, top_p: 0.9, reasoning_effort: 'high', messages: [] });
  for (const key of ['temperature', 'top_p', 'reasoning_effort']) assert.equal(key in shaped, false, key);
  const foreign = { model: 'gpt-5.6-sol', messages: [] };
  assert.equal(kimiShaping.shapeKimiRequestBody(foreign), foreign);
});

test('provider bundles expose exactly one create* factory and route real requests', async () => {
  for (const [bundle, createName] of [[qwemBundle, 'createYanQwemProvider'], [kimlBundle, 'createYanKimlProvider']]) {
    const createExports = Object.keys(bundle).filter(key => /^create/.test(key));
    assert.deepEqual(createExports, [createName], 'the kernel resolves the first create* export');
  }
  const requests = [];
  const fakeFetch = async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body || '') });
    return new Response(JSON.stringify({ error: { message: 'stop' } }), { status: 400, headers: { 'content-type': 'application/json' } });
  };
  const qwem = qwemBundle.createYanQwemProvider({ name: 'conn-qwem', apiKey: 'k', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', fetch: fakeFetch });
  await qwem('qwen3.8-max').doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }).catch(() => {});
  const qwemBody = JSON.parse(requests.at(-1).body);
  assert.match(requests.at(-1).url, /\/chat\/completions$/u);
  assert.equal(qwemBody.messages[0].content[0].cache_control, undefined, 'no system block means no cache marker');
  const kiml = kimlBundle.createYanKimlProvider({ name: 'conn-kiml', apiKey: 'k', baseURL: 'https://api.moonshot.ai/v1', fetch: fakeFetch });
  await kiml('kimi-k3').doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], reasoningEffort: 'medium' }).catch(() => {});
  const kimlBody = JSON.parse(requests.at(-1).body);
  assert.match(requests.at(-1).url, /\/chat\/completions$/u);
});

test('qwen/kimi streaming requests ask for the usage chunk', async () => {
  const requests = [];
  const fakeFetch = async (input, init) => {
    requests.push({ url: String(input), body: String(init?.body || '') });
    return new Response('data: [DONE]\n\n', { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const drain = async (stream) => {
    if (!stream?.getReader) return;
    const reader = stream.getReader();
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
    }
  };

  const qwem = qwemBundle.createYanQwemProvider({
    name: 'conn-qwem', apiKey: 'k', baseURL: 'https://dashscope.aliyuncs.com/compatible-mode/v1', fetch: fakeFetch
  });
  await drain((await qwem('qwen3.8-max').doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })).stream);
  const qwenBody = JSON.parse(requests.at(-1).body);
  assert.deepEqual(qwenBody.stream_options, { include_usage: true }, 'without this flag the gateway sends no usage chunk');

  const kiml = kimlBundle.createYanKimlProvider({
    name: 'conn-kiml', apiKey: 'k', baseURL: 'https://api.moonshot.ai/v1', fetch: fakeFetch
  });
  await drain((await kiml('kimi-k3').doStream({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })).stream);
  const kimiBody = JSON.parse(requests.at(-1).body);
  assert.deepEqual(kimiBody.stream_options, { include_usage: true }, 'moonshot only reports usage when the stream asks for it');
  assert.equal('stream_options' in qwenBody, true);
});

test('sidecar wiring: qwen/kimi presets select their adapters with reasoning replay', () => {
  const qwem = buildOpenCodeConfig({
    providerId: 'conn-qwem', providerName: 'Qwen 中转', modelId: 'qwen3.8-max',
    apiKey: 'k', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  });
  assert.match(qwem.provider['conn-qwem'].npm, /opencode-qwem-provider\.mjs$/);
  assert.equal(qwem.provider['conn-qwem'].options.yanQwemCompatibility, true);
  assert.equal(qwem.provider['conn-qwem'].models['qwen3.8-max'].interleaved.field, 'reasoning_content');

  const kiml = buildOpenCodeConfig({
    providerId: 'conn-kiml', modelId: 'kimi-k3',
    apiKey: 'k', baseUrl: 'https://api.moonshot.ai/v1'
  });
  assert.match(kiml.provider['conn-kiml'].npm, /opencode-kiml-provider\.mjs$/);
  assert.equal(kiml.provider['conn-kiml'].options.yanKimlCompatibility, true);

  // A vendor-named relay hosting a foreign model keeps the generic adapter.
  const foreign = buildOpenCodeConfig({
    providerId: 'conn-x', providerName: 'Qwen Gateway', modelId: 'gpt-5.6-sol',
    apiKey: 'k', baseUrl: 'https://relay.example.com/v1'
  });
  assert.doesNotMatch(foreign.provider['conn-x'].npm, /opencode-qwem-provider\.mjs$/);
});

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { recoverDsmlToolCalls } = require('../lib/dsml-tool-call');
const { resolveModelCapabilities } = require('../lib/model-capabilities');

test('packaged DSML provider carries max effort through the actual SDK', async () => {
  const { createYanDsmlProvider } = await import('../lib/opencode-dsml-provider.bundle.mjs');
  let sent;
  const provider = createYanDsmlProvider({ name: 'deepseek', baseURL: 'https://api.deepseek.com', fetch: async (_, init) => {
    sent = JSON.parse(init.body);
    return new Response(JSON.stringify({ id: 'test', model: 'deepseek-flash', created: 1,
      choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 }
    }), { headers: { 'content-type': 'application/json' } });
  } });
  await provider('deepseek-flash').doGenerate({ prompt: [{ role: 'user', content: [{ type: 'text', text: 'test' }] }],
    providerOptions: { deepseek: { reasoningEffort: 'max' } }, maxOutputTokens: 393216 });
  assert.equal(sent.reasoning_effort, 'max');
  assert.equal(sent.max_tokens, 393216);
});

test('Flash 1017 controls reach the wire with complete reasoning replay', async () => {
  const { createYanProviderFetch } = await import('../lib/opencode-dsml-provider.mjs');
  let sent;
  const fetch = createYanProviderFetch(async (_, init) => {
    sent = JSON.parse(init.body);
    return new Response('{}', { headers: { 'content-type': 'application/json' } });
  }, { deepSeekReasoningReplay: true });
  await fetch('https://api.deepseek.com/chat/completions', { body: JSON.stringify({
    model: 'deepseek-flash', reasoning_effort: 'max', temperature: 0.2,
    tools: [{ type: 'function', function: { name: 'read', parameters: { type: 'object' } } }],
    messages: [{ role: 'assistant', content: 'done', reasoning_content: ' prior thought\n' },
      { role: 'assistant', content: 'legacy' }]
  }) });
  assert.equal(sent.reasoning_effort, 'max');
  assert.equal(sent.top_p, 0.95);
  assert.equal(sent.temperature, undefined);
  assert.equal(sent.messages[0].reasoning_content, ' prior thought\n');
  assert.equal(sent.messages[1].reasoning_content, '');
});

test('DeepSeek controls follow documented mapping and respect disabled thinking', async () => {
  const { shapeDeepSeekRequestBody: shape } = await import('../lib/deepseek-request-shaping.mjs');
  for (const [input, expected] of Object.entries({ minimal: 'low', low: 'low', medium: 'high', high: 'high', xhigh: 'high', max: 'max', ultra: 'max' })) {
    assert.equal(shape({ model: 'deepseek-flash', reasoning_effort: input }).reasoning_effort, expected);
  }
  const original = { model: 'custom-model', temperature: 0.2 };
  assert.equal(shape(original), original);
  const disabled = shape({ model: 'deepseek-flash', thinking: { type: 'disabled' }, temperature: 0.2, top_p: 0.8 });
  assert.equal(disabled.thinking.type, 'disabled');
  assert.equal(disabled.temperature, 0.2);
  assert.equal(disabled.top_p, undefined);
  assert.equal(shape({ model: 'deepseek-flash', top_p: 0.2 }).top_p, 0.95);
  assert.equal(shape({ model: 'deepseek-flash', top_p: 0.99 }).top_p, 0.99);
});

test('DSML file-edit strings preserve indentation, trailing spaces and final newline', () => {
  const content = '    indented\n  trailing  \n';
  const result = recoverDsmlToolCalls(`<｜｜DSML｜｜tool_calls><｜｜DSML｜｜invoke name="write"><｜｜DSML｜｜parameter name="content" string="true">${content}</｜｜DSML｜｜parameter></｜｜DSML｜｜invoke></｜｜DSML｜｜tool_calls>`, new Set(['write']));
  assert.equal(result.error, null);
  assert.equal(result.calls[0].args.content, content);
});

test('Flash version and compatible aliases expose vision and full budgets', () => {
  for (const id of ['deepseek-flash', 'deepseek-v4-flash', 'deepseek-v4.1-flash-1017', 'deepseek-ai/DeepSeek-V4.1-Flash-1017']) {
    const capabilities = resolveModelCapabilities('deepseek', { id });
    assert.equal(capabilities.vision, true, id);
    assert.equal(capabilities.contextWindow, 1_048_576, id);
    assert.equal(capabilities.maxOutputTokens, 393_216, id);
  }
  assert.equal(resolveModelCapabilities('deepseek', { id: 'deepseek-v4-pro' }).vision, false);
  assert.equal(resolveModelCapabilities('deepseek', { id: 'deepseek-flash', capabilities: { vision: false } }).vision, false);
});

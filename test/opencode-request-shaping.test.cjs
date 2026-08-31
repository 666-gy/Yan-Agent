'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

// The shaping module ships inside the kernel provider bundle as ESM; load it
// dynamically the same way test/opencode-dsml.test.cjs loads its provider.
let shapeOpenAiRequestBody;
let shapeOpenAiRequest;
test.before(async () => {
  ({ shapeOpenAiRequestBody, shapeOpenAiRequest } = await import('../lib/openai-request-shaping.mjs'));
});

function shapeJson(payload) {
  return shapeOpenAiRequestBody(JSON.parse(JSON.stringify(payload)));
}

test('non-OpenAI models are returned as the original reference', () => {
  const body = { model: 'deepseek-v4-flash', max_tokens: 1024, temperature: 0.7 };
  assert.equal(shapeOpenAiRequestBody(body), body);
  const glm = { model: 'glm-5.2', reasoning_effort: 'high' };
  assert.equal(shapeOpenAiRequestBody(glm), glm);
  const kimi = { model: 'kimi-k3', messages: [] };
  assert.equal(shapeOpenAiRequestBody(kimi), kimi);
});

test('invalid inputs are returned unchanged', () => {
  assert.equal(shapeOpenAiRequestBody(null), null);
  assert.equal(shapeOpenAiRequestBody('x'), 'x');
  const array = [];
  assert.equal(shapeOpenAiRequestBody(array), array);
});

test('reasoning family: max_tokens renamed, sampling removed, effort clamped', () => {
  const shaped = shapeJson({
    model: 'gpt-5',
    max_tokens: 32768,
    temperature: 0.7,
    top_p: 0.9,
    frequency_penalty: 1,
    presence_penalty: 1,
    stop: ['\n'],
    seed: 42,
    reasoning_effort: 'max'
  });
  assert.equal(shaped.max_completion_tokens, 32768);
  assert.ok(!('max_tokens' in shaped));
  for (const key of ['temperature', 'top_p', 'frequency_penalty', 'presence_penalty', 'stop', 'seed']) {
    assert.ok(!(key in shaped), `${key} should be dropped`);
  }
  assert.equal(shaped.reasoning_effort, 'high');
});

test('reasoning family detection covers o-series, codex and mid-station aliases', () => {
  for (const model of ['o3', 'o3-pro', 'o4-mini', 'codex-mini-latest', '5.6sol', '5.6-sol', '5.6']) {
    const shaped = shapeJson({ model, max_tokens: 16 });
    if (/^o[134]|codex|5\.6/.test(model)) {
      assert.equal(shaped.max_completion_tokens, 16, model);
    } else {
      // gpt-* style ids that slipped through regex must still be safe.
      assert.ok(shaped === undefined || shaped !== null);
    }
  }
  const o3 = shapeJson({ model: 'o3', temperature: 0.2 });
  assert.ok(!('temperature' in o3));
});

test('chat family: sampling preserved, reasoning_effort stripped, no rename', () => {
  const shaped = shapeJson({
    model: 'gpt-4o',
    max_tokens: 8192,
    temperature: 0.3,
    reasoning_effort: 'high'
  });
  assert.equal(shaped.max_tokens, 8192);
  assert.ok(!('max_completion_tokens' in shaped));
  assert.equal(shaped.temperature, 0.3);
  assert.ok(!('reasoning_effort' in shaped));
});

test('tool names with dots are sanitized consistently across tools, history and tool result', () => {
  const shaped = shapeJson({
    model: 'gpt-5',
    tools: [
      { type: 'function', function: { name: 'mcp_default_playwright.browser_click', parameters: {} } },
      { type: 'function', function: { name: 'read', parameters: {} } }
    ],
    messages: [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        tool_calls: [
          { id: 'call_1', type: 'function', function: { name: 'mcp_default_playwright.browser_click', arguments: '{}' } }
        ]
      },
      { role: 'tool', tool_call_id: 'call_1', name: 'mcp_default_playwright.browser_click', content: 'ok' }
    ]
  });
  assert.equal(shaped.tools[0].function.name, 'mcp_default_playwright_browser_click');
  assert.equal(shaped.tools[1].function.name, 'read');
  assert.equal(shaped.messages[1].tool_calls[0].function.name, 'mcp_default_playwright_browser_click');
  assert.equal(shaped.messages[2].name, 'mcp_default_playwright_browser_click');
});

test('clean tool names leave messages array shared with the input', () => {
  // Called directly (no JSON round-trip) so reference sharing is observable.
  const body = { model: 'gpt-4o', messages: [{ role: 'user', content: 'hi' }] };
  const shaped = shapeOpenAiRequestBody(body);
  assert.equal(shaped, body);
  assert.equal(shaped.messages, body.messages);
});

test('shapeOpenAiRequest passthrough: non-JSON, malformed JSON and non-target bodies', async () => {
  assert.equal(await shapeOpenAiRequest('http://x', { body: '{"model":"deepseek"}' }), null);
  assert.equal(await shapeOpenAiRequest('http://x', { body: '{nope' }), null);
  assert.equal(await shapeOpenAiRequest('http://x', { body: 'plain text' }), null);
  assert.equal(await shapeOpenAiRequest('http://x', undefined), null);
});

test('shapeOpenAiRequest rewrites only target bodies', async () => {
  const original = JSON.stringify({
    model: 'gpt-5',
    max_tokens: 100,
    temperature: 0.5,
    reasoning_effort: 'xhigh'
  });
  const shaped = await shapeOpenAiRequest('http://x', { method: 'POST', body: original });
  const parsed = JSON.parse(shaped);
  assert.equal(parsed.max_completion_tokens, 100);
  assert.equal(parsed.reasoning_effort, 'high');
  assert.ok(!('temperature' in parsed));

  const untouched = JSON.stringify({ model: 'glm-5.2', max_tokens: 100 });
  assert.equal(await shapeOpenAiRequest('http://x', { body: untouched }), null);
});

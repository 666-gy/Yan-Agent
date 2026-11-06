'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { buildOpenCodeConfig } = require('../lib/kernel-policy');

test('Jiyuan config selects its module without replaying an internal switch', () => {
  const provider = buildOpenCodeConfig({ providerId: 'relay', modelId: 'glm-5.3-flash', jiyuan: true }).provider.relay;
  assert.match(provider.npm, /opencode-jiyuan-provider/);
  assert.equal(Object.hasOwn(provider.options, 'yanJiyuanCompatibility'), false);
});

for (const suffix of ['mjs', 'bundle.mjs']) {
  for (const model of ['glm-5.3-flash', 'deepseek-v4.1-flash-1017', 'qwen3.8-max', 'kimi-k3', 'custom-model']) {
    for (const method of ['doGenerate', 'doStream']) {
      test(`Jiyuan ${suffix} ${model} ${method} rejects no internal fields`, async () => {
        const { createYanJiyuanProvider } = await import(`../lib/opencode-jiyuan-provider.${suffix}`);
        let sent;
        const provider = createYanJiyuanProvider({ name: 'relay', baseURL: 'https://custom-gateway.invalid/v1',
          yanJiyuanCompatibility: true,
          fetch: async (_url, init) => {
            sent = JSON.parse(init.body);
            const invalid = Object.keys(sent).find(key => /^yan[A-Z]/.test(key) || key === 'tool_stream' || key === 'reasoningEffortAdjusted');
            if (invalid || sent.thinking?.clear_thinking !== undefined) return Response.json({ error: { message: `UNKNOWN_FIELD: ${invalid || 'thinking.clear_thinking'}` } }, { status: 400 });
            const common = { id: 'probe', model, created: 1 };
            return method === 'doGenerate'
              ? Response.json({ ...common, choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] })
              : new Response(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { content: 'ok' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
          } });
        const result = await provider(model)[method]({
          prompt: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
          tools: [{ type: 'function', name: 'noop', inputSchema: { type: 'object' } }],
          providerOptions: { relay: { yanJiyuanCompatibility: true, yanGlmmCompatibility: false,
            top_k: 7, reasoningEffortAdjusted: {}, thinking: { clear_thinking: false } } }
        });
        if (result.stream) for await (const event of result.stream) assert.notEqual(event.type, 'error');
        assert.equal(sent.top_k, 7);
        assert.ok(sent.tools.length);
      });
    }
  }
}

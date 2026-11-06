'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');

for (const suffix of ['mjs', 'bundle.mjs']) {
  for (const method of ['doGenerate', 'doStream']) {
    for (const host of ['tokenrhythm.studio', 'api.z.ai', 'tokenrhythm.studio.example.com']) {
      test(`GLMM ${suffix} ${method} thinking contract for ${host}`, async () => {
        const { createYanGlmmProvider } = await import(`../lib/opencode-glmm-provider.${suffix}`);
        let body;
        const provider = createYanGlmmProvider({ name: 'probe', baseURL: `https://${host}/v1`, fetch: async (_url, init) => {
          body = JSON.parse(init.body);
          if (host === 'tokenrhythm.studio' && (Object.hasOwn(body.thinking, 'clear_thinking')
            || Object.hasOwn(body, 'tool_stream'))) {
            const field = Object.hasOwn(body, 'tool_stream') ? 'tool_stream' : 'thinking.clear_thinking';
            return Response.json({ error: { message: `UNKNOWN_FIELD: ${field}` } }, { status: 400 });
          }
          const common = { id: 'test', created: 1, model: 'glm-5.3-flash' };
          return method === 'doGenerate'
            ? Response.json({ ...common, choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'next' } }] })
            : new Response(`data: ${JSON.stringify({ ...common, choices: [{ index: 0, delta: { content: 'next' }, finish_reason: 'stop' }] })}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } });
        } });
        const result = await provider('glm-5.3-flash')[method]({
          prompt: [{ role: 'assistant', content: [{ type: 'reasoning', text: 'preserve history' }, { type: 'text', text: 'hello' }] },
            { role: 'user', content: [{ type: 'text', text: 'Suggest my next message' }] }],
          tools: [{ type: 'function', name: 'noop', description: 'test', inputSchema: { type: 'object' } }],
          toolChoice: { type: 'auto' },
          providerOptions: { probe: { reasoningEffort: 'low', thinking: { clear_thinking: false } } }
        });
        if (result.stream) for await (const event of result.stream) assert.notEqual(event.type, 'error');
        assert.equal(Object.hasOwn(body.thinking, 'clear_thinking'), host !== 'tokenrhythm.studio');
        assert.equal(Object.hasOwn(body, 'tool_stream'), method === 'doStream' && host !== 'tokenrhythm.studio');
        assert.equal(body.thinking.type, 'enabled');
        assert.equal(body.reasoning_effort, 'low');
        assert.equal(body.messages[0].reasoning_content, 'preserve history');
        assert.ok(Array.isArray(body.tools));
      });
    }
  }
}

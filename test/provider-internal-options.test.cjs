'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { translateConfig } = require('../lib/kernel-v2/config');

const adapters = [
  ['dsml', 'Dsml', 'deepseek-v4.1-flash-1017'],
  ['glmm', 'Glmm', 'glm-5.3-flash'],
  ['qwem', 'Qwem', 'qwen3.8-max'],
  ['kiml', 'Kiml', 'kimi-k3']
];
const controls = adapters.map(([, name]) => `yan${name}Compatibility`);

for (const suffix of ['mjs', 'bundle.mjs']) {
  for (const [adapter, name, modelId] of adapters) {
    for (const enabled of [true, false]) {
      for (const method of ['doGenerate', 'doStream']) {
        test(`${adapter} ${suffix} ${method} keeps internal options local (${enabled})`, async () => {
          const { [`createYan${name}Provider`]: createProvider } = await import(`../lib/opencode-${adapter}-provider.${suffix}`);
          let sent;
          const translated = translateConfig({ provider: { 'conn-probe': {
            models: { [modelId]: { options: { reasoningEffort: 'medium',
              reasoningEffortAdjusted: { requested: 'medium', model: 'high' } } } }
          } } }).providers['conn-probe'].models[modelId];
          const provider = createProvider({
            name: 'conn-probe', baseURL: 'https://example.invalid/v1', apiKey: 'test-key',
            [`yan${name}Compatibility`]: enabled,
            fetch: async (_url, init) => {
              // Match V2's final HTTP middleware: model.body is overlaid
              // AFTER the adapter, whereas settings go through the SDK.
              sent = { ...JSON.parse(init.body), ...translated.body };
              // A strict gateway rejects unexpected fields before generation.
              const leaked = [...controls, 'reasoningEffort', 'reasoningEffortAdjusted']
                .find(key => Object.hasOwn(sent, key));
              if (leaked) return new Response(JSON.stringify({ error: { message: `UNKNOWN_FIELD: ${leaked}` } }), {
                status: 400, headers: { 'content-type': 'application/json' }
              });
              const chunk = { id: 'probe', object: 'chat.completion.chunk', created: 1, model: modelId,
                choices: [{ index: 0, delta: { content: 'hello' }, finish_reason: 'stop' }] };
              return method === 'doStream'
                ? new Response(`data: ${JSON.stringify(chunk)}\n\ndata: [DONE]\n\n`, { headers: { 'content-type': 'text/event-stream' } })
                : new Response(JSON.stringify({ ...chunk, object: 'chat.completion', choices: [
                  { index: 0, message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }
                ] }), { headers: { 'content-type': 'application/json' } });
            }
          });
          const custom = Object.freeze({ ...Object.fromEntries(controls.map(key => [key, enabled])),
            ...translated.settings, top_k: 7 });
          const result = await provider(modelId)[method]({
            prompt: [{ role: 'user', content: [{ type: 'text', text: 'hello yanDsmlCompatibility' }] }],
            providerOptions: { 'conn-probe': custom }
          });
          if (method === 'doStream') {
            for await (const event of result.stream) assert.notEqual(event.type, 'error');
          }
          for (const key of controls) assert.equal(Object.hasOwn(sent, key), false);
          assert.equal(sent.top_k, 7);
          if (adapter === 'dsml' || adapter === 'glmm') {
            assert.equal(sent.reasoning_effort, enabled ? 'high' : 'medium');
          }
          assert.equal(sent.model, modelId);
          assert.ok(JSON.stringify(sent.messages).includes('hello yanDsmlCompatibility'));
          assert.equal(custom[`yan${name}Compatibility`], enabled);
        });
      }
    }
  }
}

import { createYanDsmlProvider } from './opencode-dsml-provider.mjs';
import { createYanGlmmProvider } from './opencode-glmm-provider.mjs';
import { createYanQwemProvider } from './opencode-qwem-provider.mjs';
import { createYanKimlProvider } from './opencode-kiml-provider.mjs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';

// JIYUAN — gateway-owned adapter. TokenRhythm accepts OpenAI Chat Completions
// but rejects vendor-only extensions. Delegate model-family decoding to the
// existing adapters while keeping the gateway identity explicit and stable.
function family(model) {
  const id = String(model || '').split('/').pop().toLowerCase();
  if (/^(?:glm|chatglm)/.test(id)) return 'glm';
  if (/deepseek/.test(id)) return 'deepseek';
  if (/^(?:qwen|qwq|qvq)/.test(id)) return 'qwen';
  if (/^(?:kimi|moonshot)/.test(id)) return 'kimi';
  return 'openai';
}

export function createYanJiyuanProvider(options = {}) {
  const { name = 'jiyuan', fetch: baseFetch = globalThis.fetch,
    yanJiyuanCompatibility: _legacyCompatibility, ...shared } = options;
  // Last boundary after all family-specific shaping. The preset itself is
  // the gateway identity; no extra switch needs to travel through the SDK.
  shared.fetch = async (input, init) => {
    let body;
    try { body = JSON.parse(init?.body); } catch { return baseFetch(input, init); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return baseFetch(input, init);
    for (const key of Object.keys(body)) {
      if (/^yan[A-Z].*Compatibility$/.test(key) || key === 'reasoningEffortAdjusted') delete body[key];
    }
    delete body.tool_stream;
    if (body.thinking && typeof body.thinking === 'object') delete body.thinking.clear_thinking;
    const headers = new Headers(init.headers);
    headers.delete('content-length');
    return baseFetch(input, { ...init, headers, body: JSON.stringify(body) });
  };
  const providers = {
    glm: createYanGlmmProvider({ ...shared, name, yanGlmmCompatibility: true }),
    deepseek: createYanDsmlProvider({ ...shared, name, yanDsmlCompatibility: true }),
    qwen: createYanQwemProvider({ ...shared, name, yanQwemCompatibility: true }),
    kimi: createYanKimlProvider({ ...shared, name, yanKimlCompatibility: true }),
    openai: createOpenAICompatible({ ...shared, name })
  };
  const select = model => providers[family(model)] || providers.openai;
  const callable = (...args) => select(args[0])(...args);
  for (const method of ['languageModel', 'chatModel', 'completionModel']) {
    callable[method] = (...args) => select(args[0])[method](...args);
  }
  return callable;
}

import { restoreProviderTools } from './family-provider-tools.mjs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createYanProviderFetch } from './opencode-dsml-provider.mjs';
import { shapeKimiRequest } from './kimi-request-shaping.mjs';

// KIML — Moonshot Kimi family compatibility preset provider. Chat
// Completions wire with Kimi capability contracts applied at the fetch layer
// (reasoning_effort clamping, known-model fixed-parameter cleanup, tool-name aliasing).
// Reasoning enters history through the sidecar's interleaved reasoning
// option — the K3 multi-turn contract needs the complete assistant message
// replayed, so shaping never prunes assistant fields. The single create*
// export is the provider factory — the kernel resolves the first create*
// export.
//
// includeUsage is on by default: Moonshot streaming replies carry no usage
// chunk unless the request sets `stream_options.include_usage` (verified
// against api.moonshot.cn 2026-09-17), and without it every token counter
// downstream — kernel session tokens, run cache-hit rate, the context ring —
// stays at zero.
export function createYanKimlProvider(options = {}) {
  const {
    yanKimlCompatibility = true,
    fetch: baseFetch = globalThis.fetch,
    includeUsage = true,
    streamEnabled,
    ...providerOptions
  } = options;
  const fetchImpl = createYanProviderFetch(async (input, init) => {
    if (yanKimlCompatibility && typeof init?.body === 'string') {
      const shaped = await shapeKimiRequest(input, init);
      if (shaped != null) {
        const headers = new Headers(init.headers);
        headers.delete('content-length');
        init = { ...init, headers, body: shaped };
      }
    }
    return baseFetch(input, init);
  }, { openAiRequestShaping: false, streamEnabled: streamEnabled !== false });
  const provider = createOpenAICompatible({ ...providerOptions, includeUsage, fetch: fetchImpl });
  return yanKimlCompatibility ? restoreProviderTools(provider) : provider;
}

import { restoreProviderTools, qwenCacheMetadata } from './family-provider-tools.mjs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { createYanProviderFetch } from './opencode-dsml-provider.mjs';
import { shapeQwenRequest } from './qwen-request-shaping.mjs';

// QWEM — Qwen family compatibility preset provider. Requests stay on the
// OpenAI-compatible Chat Completions wire; the fetch layer applies the Qwen
// capability contracts (enable_thinking, opt-in explicit Context Cache marker,
// tool-name aliasing) before the call. The single create* export is the
// provider factory — the kernel resolves the first create* export.
// includeUsage is on by default: OpenAI-compatible gateways only emit the
// streaming usage chunk when `stream_options.include_usage` is requested, and
// without it the context ring and cache-hit readouts never move.
export function createYanQwemProvider(options = {}) {
  const {
    yanQwemCompatibility = true,
    fetch: baseFetch = globalThis.fetch,
    includeUsage = true,
    streamEnabled,
    ...providerOptions
  } = options;
  const fetchImpl = createYanProviderFetch(async (input, init) => {
    if (yanQwemCompatibility && typeof init?.body === 'string') {
      const shaped = await shapeQwenRequest(input, init, providerOptions);
      if (shaped != null) {
        const headers = new Headers(init.headers);
        headers.delete('content-length');
        init = { ...init, headers, body: shaped };
      }
    }
    return baseFetch(input, init);
  }, { openAiRequestShaping: false, streamEnabled: streamEnabled !== false });
  const provider = createOpenAICompatible({ metadataExtractor: qwenCacheMetadata, ...providerOptions, includeUsage, fetch: fetchImpl });
  return yanQwemCompatibility ? restoreProviderTools(provider) : provider;
}

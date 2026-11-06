import { observeProviderFetch } from './provider-telemetry.mjs';
import { providerEndpoint } from './provider-endpoint.mjs';
import { conversationAffinity } from './provider-affinity.mjs';
import { createAnthropic } from '@ai-sdk/anthropic';
import { shapeAntlRequestBody } from './antl-request-shaping.mjs';

// ANTL — the Anthropic Messages native preset.
//
// This is the only adapter that does not translate a protocol. Every other
// vendor here speaks an OpenAI-compatible dialect, so its module converts shapes
// in both directions. Anthropic does not: the Messages API is the native wire
// format of the models themselves, and @ai-sdk/anthropic already implements it
// end to end — request assembly, SSE event parsing, and the usage math. Wrapping
// or reimplementing that would be the fastest way to fall behind the official
// SDK, which is exactly what the compatibility requirement rules out.
//
// So the module owns exactly one job: the outbound body. Anthropic's prompt
// cache is explicit — the API reuses nothing until the client places a
// `cache_control` breakpoint — and no layer below this one places any. Without
// this module a Claude model pays full input price on every turn, no matter how
// much of the prompt is unchanged. That is the gap.
//
// Streaming, tool calls, thinking blocks and usage accounting are left to the
// SDK, whose output the kernel already consumes.
export function createYanAntlProvider(options = {}) {
  const {
    yanAntlCompatibility = true,
    fetch: baseFetch = globalThis.fetch,
    ...providerOptions
  } = options;

  // The SDK builds the URL as baseURL + /messages, so a query-string baseURL
  // (common on relays that carry the key as a parameter) must be preserved
  // rather than silently dropped by that concatenation.
  const transport = providerEndpoint(providerOptions.baseURL, baseFetch);
  providerOptions.baseURL = transport.baseURL;
  const observedFetch = observeProviderFetch(transport.fetch, { adapter: 'antl' });
  // Anthropic Messages has no prompt_cache_key. Relays that implement channel
  // affinity read the opaque `metadata.user_id` for this protocol instead, so
  // the same conversation hint is carried there. It is routing metadata, not a
  // prompt field: it never enters the cached prefix.
  const affinity = typeof options.apiKey === 'string' && options.apiKey
    ? conversationAffinity(options.apiKey, options.name || '') : null;
  const rejectedAffinity = new Set();

  const fetchImpl = async (input, init) => {
    if (!yanAntlCompatibility || typeof init?.body !== 'string') return observedFetch(input, init);
    let parsed;
    try { parsed = JSON.parse(init.body); } catch { return observedFetch(input, init); }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return observedFetch(input, init);
    let body = shapeAntlRequestBody(parsed, providerOptions);
    let affinityRoute = '';
    let affinityApplied = false;
    if (affinity) {
      affinityRoute = `${String(input)}\n${body?.model || ''}`;
      const existing = body?.metadata && typeof body.metadata === 'object' ? body.metadata.user_id : '';
      if (!existing && !rejectedAffinity.has(affinityRoute)) {
        const userId = affinity(body);
        if (userId) {
          body = { ...body, metadata: {
            ...(body.metadata && typeof body.metadata === 'object' ? body.metadata : {}),
            user_id: userId
          } };
          affinityApplied = true;
        }
      }
    }
    const headers = new Headers(init.headers);
    // Body length changed; a stale Content-Length truncates the request.
    headers.delete('content-length');
    let response = await observedFetch(input, { ...init, headers, body: JSON.stringify(body) });
    if (affinityApplied && response.status === 400 && !init?.signal?.aborted) {
      let detail = '';
      try { detail = await response.clone().text(); } catch {}
      let error = null;
      try { const parsedError = JSON.parse(detail); error = parsedError?.error || parsedError; } catch {}
      const message = String(error?.message || detail || '');
      const unsupported = /metadata|user_id/i.test(message)
        && /unsupported|not supported|unknown|unrecognized|unexpected|extra inputs|not permitted|not allowed|invalid/i.test(message);
      if (unsupported) {
        // One pre-stream validation retry only, never after model output.
        void response.body?.cancel().catch(() => {});
        rejectedAffinity.add(affinityRoute);
        if (rejectedAffinity.size > 128) rejectedAffinity.delete(rejectedAffinity.values().next().value);
        const { metadata, ...withoutMetadata } = body;
        const remaining = metadata && typeof metadata === 'object'
          ? Object.fromEntries(Object.entries(metadata).filter(([key]) => key !== 'user_id')) : null;
        const retryBody = remaining && Object.keys(remaining).length
          ? { ...withoutMetadata, metadata: remaining } : withoutMetadata;
        response = await observedFetch(input, { ...init, headers, body: JSON.stringify(retryBody) });
      }
    }
    return response;
  };

  return createAnthropic({ ...providerOptions, fetch: fetchImpl });
}

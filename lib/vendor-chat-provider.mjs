import { observeProviderFetch } from './provider-telemetry.mjs';
import { providerEndpoint } from './provider-endpoint.mjs';
import { createHmac, randomUUID } from 'node:crypto';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { relayCompatibleFetch } from './relay-compatible-fetch.mjs';
import { normalizeChatPayload } from './provider-usage.mjs';
import { restoreProviderTools } from './family-provider-tools.mjs';
import endpointHelpers from './api-endpoint.js';

// This factory is deliberately not exported from provider entry modules:
// OpenCode discovers the first create* export as the provider constructor.
export function vendorChatProvider(options, { name, shape, normalizePayload, googleSignatures = false }) {
  const { fetch: baseFetch = globalThis.fetch, includeUsage = true, ...providerOptions } = options;
  providerOptions.baseURL ||= { agnes: 'https://apihub.agnes-ai.com/v1',
    google: 'https://generativelanguage.googleapis.com/v1beta/openai', grok: 'https://api.x.ai/v1' }[name];
  const endpoint = endpointHelpers.endpointInfo(providerOptions.baseURL);
  if (endpoint.format && endpoint.format !== 'openai') {
    throw new Error(`${name.toUpperCase()}: this adapter requires a Chat Completions endpoint`);
  }
  if (providerOptions.baseURL) providerOptions.baseURL = endpoint.baseURL;
  const transport = providerEndpoint(providerOptions.baseURL, baseFetch);
  providerOptions.baseURL = transport.baseURL;
  const observedFetch = observeProviderFetch(transport.fetch, { adapter: { agnes: 'agnl', google: 'geml', grok: 'grol' }[name] });
  const relayFetch = relayCompatibleFetch(observedFetch, { googleSignatures,
    normalizePayload: payload => normalizeChatPayload(normalizePayload ? normalizePayload(payload) : payload) });
  const routingSalt = typeof providerOptions.apiKey === 'string' ? providerOptions.apiKey : randomUUID();
  const fetchImpl = async (input, init) => {
    if (typeof init?.body === 'string') {
      let parsed;
      try { parsed = JSON.parse(init.body); } catch { /* Preserve non-JSON requests. */ }
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const headers = new Headers(init.headers);
        headers.delete('content-length');
        if (name === 'grok' && !headers.has('x-grok-conv-id')) {
          const firstUser = parsed.messages?.find(message => message.role === 'user');
          if (firstUser) {
            // xAI documents per-server caches and recommends sticky routing.
            // Group a growing conversation by its unchanged first user item;
            // never expose prompt content or override an explicit routing ID.
            const group = createHmac('sha256', routingSalt)
              .update(JSON.stringify([providerOptions.name || name, parsed.model, firstUser])).digest('hex');
            headers.set('x-grok-conv-id', `yan-${group}`);
          }
        }
        init = { ...init, headers, body: JSON.stringify(shape(parsed)) };
      }
    }
    return relayFetch(input, init);
  };
  const provider = createOpenAICompatible({ name, ...providerOptions, includeUsage, fetch: fetchImpl });
  return restoreProviderTools(provider, { googleSignatures });
}

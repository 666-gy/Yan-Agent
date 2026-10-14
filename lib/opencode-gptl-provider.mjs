import { relayCompatibleFetch, stableToolBody } from './relay-compatible-fetch.mjs';
import { conversationAffinity } from './provider-affinity.mjs';
import { providerEndpoint } from './provider-endpoint.mjs';
import { observeProviderFetch } from './provider-telemetry.mjs';
import { createOpenAI } from '@ai-sdk/openai';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import gptProfile from './gpt-model-profile.js';
import endpointHelpers from './api-endpoint.js';
import { finishGptlEventStream } from './gptl-stream.mjs';
import { createGptlDiagnostics, gptlCacheFingerprint } from './gptl-diagnostics.mjs';
import {
  gptlToolNameRestoreMap,
  restoreGptlGenerateResult,
  restoreGptlStreamPart,
  shapeGptlRequest
} from './gptl-request-shaping.mjs';

const { routeFor } = gptProfile;

const MODEL_FACTORY_METHODS = new Set(['languageModel', 'chatModel', 'model']);

// Yan passes model options (for example the reasoning-effort tier) under the
// connection's own provider id. @ai-sdk/openai only reads its `openai`
// namespace, so remap the configured options before the request is built.
function withOpenAiProviderOptions(options, providerId) {
  if (!providerId || !options || typeof options !== 'object') return options;
  const providerOptions = options.providerOptions;
  if (!providerOptions || typeof providerOptions !== 'object') return options;
  const configured = providerOptions[providerId];
  if (!configured || typeof configured !== 'object') return options;
  return {
    ...options,
    providerOptions: {
      ...providerOptions,
      openai: { ...configured, ...(providerOptions.openai || {}) }
    }
  };
}

function withStorePreference(options, providerId, store) {
  if (store === undefined || !options || typeof options !== 'object') return options;
  providerId = providerId || 'openai';
  const providerOptions = options.providerOptions;
  const configured = providerOptions && typeof providerOptions === 'object'
    ? providerOptions[providerId]
    : null;
  if (configured && configured.store != null) return options;
  return {
    ...options,
    providerOptions: {
      ...(providerOptions || {}),
      [providerId]: { store, ...(configured || {}) }
    }
  };
}

// Select the endpoint using the shared profile. Responses-required families
// stay on Responses even without tools to preserve one serialization/cache.
export function createYanGptlProvider(options = {}) {
  const {
    name: providerId = '',
    apiFormat = 'auto',
    store,
    diagnostics,
    ...providerOptions
  } = options;
  const endpoint = endpointHelpers.endpointInfo(providerOptions.baseURL);
  if (providerOptions.baseURL) providerOptions.baseURL = endpoint.baseURL;
  const transport = providerEndpoint(providerOptions.baseURL, providerOptions.fetch || globalThis.fetch);
  providerOptions.baseURL = transport.baseURL;
  const provider = createOpenAI({
    ...providerOptions,
    fetch: makeGptlFetch(transport.fetch, { apiKey: providerOptions.apiKey, name: providerId })
  });
  // Official Chat Completions has no reasoning_content field. Relays often
  // expose it; the OpenAI SDK drops that field, breaking their history replay.
  const relayChat = providerOptions.baseURL && !endpointHelpers.isOfficialOpenAI(providerOptions.baseURL)
    ? createOpenAICompatible({ ...providerOptions, name: 'openai', includeUsage: true,
      supportsStructuredOutputs: true,
      fetch: makeGptlFetch(transport.fetch, { apiKey: providerOptions.apiKey, name: providerId }) }) : null;
  const requestedFormat = String(apiFormat || 'auto').trim().toLowerCase();
  const apiFormatHint = requestedFormat === 'auto'
    ? (endpoint.format || (!providerOptions.baseURL || endpointHelpers.isOfficialOpenAI(providerOptions.baseURL) ? 'auto' : 'openai'))
    : requestedFormat;
  const storePreference = store === undefined ? false : store;
  const emitDiagnostics = typeof diagnostics === 'function' ? diagnostics
    : process.env.YAN_GPTL_PERF_DEBUG === '1'
      ? record => console.warn(`[gptl-perf] ${JSON.stringify(record)}`) : null;

  const createModel = modelId => {
    const chat = relayChat ? relayChat.chatModel(modelId) : provider.chat(modelId);
    const responses = provider.responses(modelId);

    const modelFor = requestOptions => {
      const hasTools = Array.isArray(requestOptions?.tools) && requestOptions.tools.length > 0;
      const route = routeFor(modelId, { hasTools, apiFormat: apiFormatHint });
      return route === 'responses' ? responses : chat;
    };

    const prepare = (requestOptions, { responsesRoute }) => {
      const base = requestOptions || {};
      return withOpenAiProviderOptions(
        responsesRoute ? withStorePreference(base, providerId, storePreference) : base,
        providerId
      );
    };

    const run = async (method, requestOptions) => {
      const target = modelFor(requestOptions);
      const responsesRoute = target === responses;
      const prepared = prepare(requestOptions, { responsesRoute });
      const restore = gptlToolNameRestoreMap([
        ...(requestOptions?.tools || []),
        ...(requestOptions?.toolChoice?.toolName ? [{ name: requestOptions.toolChoice.toolName }] : []),
        ...(requestOptions?.prompt || []).flatMap(message => Array.isArray(message.content)
          ? message.content.filter(part => part.type === 'tool-call').map(part => ({ name: part.toolName })) : [])
      ]);
      const timing = emitDiagnostics ? createGptlDiagnostics({
        model: modelId, route: responsesRoute ? 'responses' : 'chat', emit: emitDiagnostics
      }) : null;
      if (method === 'doGenerate') {
        try {
          const generated = await target.doGenerate(prepared);
          timing?.finish('complete', generated.usage);
          return restoreGptlGenerateResult(generated, restore);
        } catch (error) { timing?.finish('error'); throw error; }
      }
      let result;
      try { result = await target.doStream(prepared); }
      catch (error) { timing?.finish('error'); throw error; }
      timing?.mark('streamReadyMs');
      if (timing) {
        const reader = result.stream.getReader();
        let cancelled = false, released = false;
        const release = () => { if (!released) { released = true; reader.releaseLock(); } };
        return { ...result, stream: new ReadableStream({
          async pull(controller) {
            try {
              const next = await reader.read();
              if (cancelled) return;
              if (next.done) { timing.finish('incomplete'); controller.close(); release(); return; }
              timing.observe(next.value);
              controller.enqueue(restoreGptlStreamPart(next.value, restore));
            } catch (error) {
              if (!cancelled) { timing.finish('error'); controller.error(error); }
              void reader.cancel(error).catch(() => {}).finally(release);
            }
          },
          async cancel(reason) {
            cancelled = true;
            timing.finish('cancelled');
            try { await reader.cancel(reason); } finally { release(); }
          }
        }, { highWaterMark: 0 }) };
      }
      if (!restore.size) return result;
      return {
        ...result,
        stream: result.stream.pipeThrough(new TransformStream({
          transform(part, controller) {
            controller.enqueue(restoreGptlStreamPart(part, restore));
          }
        }))
      };
    };

    return new Proxy(chat, {
      get(target, property, receiver) {
        if (property === 'doGenerate') return requestOptions => run('doGenerate', requestOptions);
        if (property === 'doStream') return requestOptions => run('doStream', requestOptions);
        return Reflect.get(target, property, receiver);
      }
    });
  };

  return new Proxy(provider, {
    apply: (target, thisArg, args) => createModel(args[0]),
    get(target, property, receiver) {
      if (MODEL_FACTORY_METHODS.has(property)) return modelId => createModel(modelId);
      return Reflect.get(target, property, receiver);
    }
  });
}

// Cache diagnostics: set YAN_GPTL_CACHE_DEBUG=1 to log a per-request prefix
// fingerprint (route, model, tool count, item count, and a hash over the
// cache-relevant prefix: instructions/system, tool names, and the first few
// messages). Consecutive same-session requests should log an identical
// prefixHash and growing item counts; a changed hash localizes a prompt-cache
// bust to the exact request that introduced it.
const CACHE_DEBUG_ENABLED = String(process.env.YAN_GPTL_CACHE_DEBUG || '') === '1';

function logCacheFingerprint(format, url, body) {
  if (!CACHE_DEBUG_ENABLED) return;
  try {
    const parsed = JSON.parse(body);
    console.warn(`[gptl-cache] ${JSON.stringify({ route: format, ...gptlCacheFingerprint(parsed) })}`);
  } catch { /* diagnostics only */ }
}

// Every GPTL request is shaped at the outbound boundary: the profile decides
// which reasoning tiers and token caps are legal for the model actually
// addressed, and which tool names need a wire-safe alias.
export function makeGptlFetch(baseFetch, { apiKey, name = '' } = {}) {
  const fetchImpl = observeProviderFetch(typeof baseFetch === 'function' ? baseFetch : globalThis.fetch, { adapter: 'gptl' });
  const chatFetch = relayCompatibleFetch(fetchImpl);
  const affinity = conversationAffinity(apiKey, name);
  const rejectedCacheKeys = new Set();
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  return async (input, init) => {
    const shaped = await shapeGptlRequest(input, init);
    let nextInit = init;
    if (shaped != null) {
      nextInit = { ...(init || {}), body: shaped };
      const headers = new Headers(nextInit.headers || (input instanceof Request ? input.headers : undefined));
      headers.delete('content-length');
      nextInit.headers = headers;
    }
    if (CACHE_DEBUG_ENABLED) {
      const bodyText = nextInit?.body != null ? String(nextInit.body) : '';
      const format = bodyText.includes('"input"') ? 'responses' : (bodyText.includes('"messages"') ? 'chat' : '');
      logCacheFingerprint(format, input, bodyText);
    }
    let parsed; try { parsed = JSON.parse(nextInit?.body); } catch {}
    
    // Stabilize tools BEFORE generating cache key to ensure key matches final body
    if (parsed?.tools) parsed = stableToolBody(parsed);
    
    const cacheRoute = `${String(input)}\n${parsed?.model}`;
    const key = parsed && !Object.hasOwn(parsed, 'prompt_cache_key') && !rejectedCacheKeys.has(cacheRoute)
      && gptProfile.profileFor(parsed.model).kind !== 'unknown' ? affinity(parsed) : '';
    if (key) parsed = { ...parsed, prompt_cache_key: key };
    
    // Serialize once with stable tools and cache key
    nextInit = { ...nextInit, body: JSON.stringify(parsed) };
    const send = () => Array.isArray(parsed?.messages) ? chatFetch(input, nextInit) : fetchImpl(input, nextInit);
    let response = await send();
    if (key && response.status === 400) {
      let error; try { error = (await response.clone().json()).error; } catch {}
      if (error?.param === 'prompt_cache_key' || (/prompt_cache_key/i.test(error?.message || '')
        && /unsupported|not supported|unknown|unrecognized|not permitted/i.test(error?.message || ''))) {
        void response.body?.cancel().catch(() => {});
        rejectedCacheKeys.add(cacheRoute);
        if (rejectedCacheKeys.size > 128) rejectedCacheKeys.delete(rejectedCacheKeys.values().next().value);
        delete parsed.prompt_cache_key;
        nextInit = { ...nextInit, body: JSON.stringify(parsed) };
        response = await send();
      }
    }
    return Array.isArray(parsed?.messages) ? response : finishGptlEventStream(response);
  };
}

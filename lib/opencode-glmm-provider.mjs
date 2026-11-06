import { observeProviderFetch } from './provider-telemetry.mjs';
import { normalizeChatPayload } from './provider-usage.mjs';
import { conversationAffinity } from './provider-affinity.mjs';
import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import {
  createYanProviderFetch,
  normalizeDsmlPrompt,
  transformProtocolGenerateResult,
  transformProtocolStream
} from './opencode-dsml-provider.mjs';
import { GlmmTextDecoder, glmmToolCatalog } from './glmm-tool-call.mjs';
import { shapeGlmmRequestBody } from './glmm-request-shaping.mjs';

const MODEL_METHODS = new Set(['languageModel', 'chatModel', 'completionModel']);

function decoderFactory(options) {
  const catalog = glmmToolCatalog(options);
  const budget = { calls: 0, bytes: 0 };
  return () => new GlmmTextDecoder(catalog, budget);
}

export function transformGlmmGenerateResult(result, options = {}) {
  return transformProtocolGenerateResult(result, decoderFactory(options), ['text']);
}

export function transformGlmmStream(stream, options = {}) {
  const reader = transformProtocolStream(stream, decoderFactory(options), ['text']).getReader();
  let closed = false;
  let released = false;
  const release = () => {
    if (!released) { released = true; reader.releaseLock(); }
  };
  // Report a terminal failure through the SDK's error channel. The sidecar
  // also retains session.error when the kernel omits it from stored history.
  return new ReadableStream({
    async pull(controller) {
      try {
        const next = await reader.read();
        if (closed) return;
        if (next.done) { closed = true; controller.close(); release(); }
        else controller.enqueue(next.value);
      } catch (error) {
        if (closed) return;
        closed = true;
        controller.enqueue({ type: 'error', error });
        controller.close();
        release();
      }
    },
    async cancel(reason) {
      closed = true;
      try { await reader.cancel(reason); } finally { release(); }
    }
  });
}

function wrapModel(model) {
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property === 'doGenerate') return async options => transformGlmmGenerateResult(
        await target.doGenerate({ ...options, prompt: normalizeDsmlPrompt(options?.prompt) }), options);
      if (property === 'doStream') return async options => {
        const result = await target.doStream({ ...options, prompt: normalizeDsmlPrompt(options?.prompt) });
        return { ...result, stream: transformGlmmStream(result.stream, options) };
      };
      return Reflect.get(target, property, receiver);
    }
  });
}

export function createYanGlmmProvider(options = {}) {
  const { yanGlmmCompatibility = true, fetch: baseFetch = globalThis.fetch, includeUsage = true, ...providerOptions } = options;
  const observedFetch = observeProviderFetch(baseFetch, { adapter: 'glmm' });
  const fetchImpl = createYanProviderFetch(async (input, init) => {
    let tokenRhythm = false;
    try {
      tokenRhythm = new URL(input instanceof Request ? input.url : input).hostname.toLowerCase() === 'tokenrhythm.studio';
    } catch { /* Non-URL transports retain the default contract. */ }
    if ((yanGlmmCompatibility || tokenRhythm) && typeof init?.body === 'string') {
      let body;
      try { body = JSON.parse(init.body); } catch { /* Leave non-JSON requests alone. */ }
      if (body) {
        body = yanGlmmCompatibility ? shapeGlmmRequestBody(body) : body;
        // TokenRhythm accepts thinking.type but rejects Z.ai's history policy
        // extension, including for tool-free prompt suggestions. Keep actual
        // reasoning_content history and effort unchanged.
        if (tokenRhythm && body.thinking && typeof body.thinking === 'object') {
          const { clear_thinking: _clearThinking, ...thinking } = body.thinking;
          body = { ...body, thinking };
        }
        // `tool_stream` is a Z.ai/GLM extension. TokenRhythm supports native
        // OpenAI tool calls but rejects this extra top-level field.
        if (tokenRhythm && Object.hasOwn(body, 'tool_stream')) {
          const { tool_stream: _toolStream, ...withoutToolStream } = body;
          body = withoutToolStream;
        }
        const headers = new Headers(init.headers);
        headers.delete('content-length');
        init = { ...init, headers, body: JSON.stringify(body) };
      }
    }
    return observedFetch(input, init);
  }, { openAiRequestShaping: false, normalizePayload: normalizeChatPayload,
    // Same routing hint as DSML: a relay that supports channel affinity pins
    // this conversation to one upstream, so GLM prompt caches stay reachable.
    affinity: typeof options.apiKey === 'string' && options.apiKey
      ? conversationAffinity(options.apiKey, options.name || '') : null });
  const provider = createOpenAICompatible({ ...providerOptions, includeUsage, fetch: fetchImpl });
  if (!yanGlmmCompatibility) return provider;
  return new Proxy(provider, {
    apply(target, thisArg, args) { return wrapModel(Reflect.apply(target, thisArg, args)); },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      return MODEL_METHODS.has(property) && typeof value === 'function'
        ? (...args) => wrapModel(Reflect.apply(value, target, args)) : value;
    }
  });
}

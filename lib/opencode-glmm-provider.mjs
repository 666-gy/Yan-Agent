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
  const { yanGlmmCompatibility = true, fetch: baseFetch = globalThis.fetch, streamEnabled, ...providerOptions } = options;
  const fetchImpl = createYanProviderFetch(async (input, init) => {
    if (yanGlmmCompatibility && typeof init?.body === 'string') {
      let body;
      try { body = JSON.parse(init.body); } catch { /* Leave non-JSON requests alone. */ }
      if (body) {
        const headers = new Headers(init.headers);
        headers.delete('content-length');
        init = { ...init, headers, body: JSON.stringify(shapeGlmmRequestBody(body)) };
      }
    }
    return baseFetch(input, init);
  }, { openAiRequestShaping: false, streamEnabled: streamEnabled !== false });
  const provider = createOpenAICompatible({ ...providerOptions, fetch: fetchImpl });
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

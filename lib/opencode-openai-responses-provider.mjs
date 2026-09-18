import { createOpenAI } from '@ai-sdk/openai';
import { applySupplierStreamPreference, coerceProviderStreamResponse } from './supplier-stream.mjs';

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

function wrapResponseModel(model, providerId) {
  if (!model || typeof model !== 'object') return model;
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property === 'doGenerate') {
        return options => target.doGenerate(withOpenAiProviderOptions(options, providerId));
      }
      if (property === 'doStream') {
        return options => target.doStream(withOpenAiProviderOptions(options, providerId));
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

// OpenCode calls the first `create*` export of a file:// provider module as the
// factory. This provider routes every language-model request to the OpenAI
// Responses API (`POST {baseURL}/responses`) instead of /chat/completions.
export function createYanOpenAIResponsesProvider(options = {}) {
  const { name: providerId = '', streamEnabled, fetch: baseFetch, ...providerOptions } = options;
  const streamOn = streamEnabled !== false;
  const fetchImpl = typeof baseFetch === 'function' ? baseFetch : globalThis.fetch;
  const provider = createOpenAI({
    ...providerOptions,
    fetch: async (input, init) => {
      const nextInit = applySupplierStreamPreference(init, streamOn);
      const response = await fetchImpl(input, nextInit);
      return streamOn ? response : coerceProviderStreamResponse(response, false);
    }
  });
  const createModel = modelId => wrapResponseModel(provider.responses(modelId), providerId);
  return new Proxy(provider, {
    apply: (target, thisArg, args) => createModel(args[0]),
    get(target, property, receiver) {
      if (MODEL_FACTORY_METHODS.has(property)) return modelId => createModel(modelId);
      return Reflect.get(target, property, receiver);
    }
  });
}

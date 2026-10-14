import { observeProviderFetch } from './provider-telemetry.mjs';
import { createOpenAI } from '@ai-sdk/openai';
import { finishGptlEventStream } from './gptl-stream.mjs';
import { providerEndpoint } from './provider-endpoint.mjs';
import { stableToolBody } from './relay-compatible-fetch.mjs';
import endpointHelpers from './api-endpoint.js';

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
  const { name: providerId = '', ...providerOptions } = options;
  if (providerOptions.baseURL) providerOptions.baseURL = endpointHelpers.endpointInfo(providerOptions.baseURL).baseURL;
  const transport = providerEndpoint(providerOptions.baseURL, providerOptions.fetch || globalThis.fetch);
  const observedFetch = observeProviderFetch(transport.fetch, { adapter: 'responses' });
  const provider = createOpenAI({ ...providerOptions, baseURL: transport.baseURL, fetch: async (input, init) => {
    let body; try { body = JSON.parse(init?.body); } catch {}
    if (body?.tools) {
      const headers = new Headers(init.headers); headers.delete('content-length');
      init = { ...init, headers, body: JSON.stringify(stableToolBody(body)) };
    }
    return finishGptlEventStream(await observedFetch(input, init));
  } });
  const createModel = modelId => wrapResponseModel(provider.responses(modelId), providerId);
  return new Proxy(provider, {
    apply: (target, thisArg, args) => createModel(args[0]),
    get(target, property, receiver) {
      if (MODEL_FACTORY_METHODS.has(property)) return modelId => createModel(modelId);
      return Reflect.get(target, property, receiver);
    }
  });
}

import toolAlias from './provider-tool-alias.js';

function catalog(names) {
  return toolAlias.buildToolAliasMap([...new Set(names.filter(name => typeof name === 'string' && name))].sort());
}

export function aliasWireTools(body) {
  const messages = Array.isArray(body.messages) ? body.messages : [];
  const { aliases } = catalog([
    ...(body.tools || []).map(tool => tool?.function?.name),
    ...messages.flatMap(message => [message.role === 'tool' ? message.name : null,
      ...(message.tool_calls || []).map(call => call?.function?.name)])
  ]);
  if (!aliases.size) return body;
  const rename = fn => fn && aliases.has(fn.name) ? { ...fn, name: aliases.get(fn.name) } : fn;
  return { ...body,
    ...(body.tools ? { tools: body.tools.map(tool => ({ ...tool, function: rename(tool.function) })) } : {}),
    ...(body.tool_choice?.function ? { tool_choice: { ...body.tool_choice, function: rename(body.tool_choice.function) } } : {}),
    messages: messages.map(message => ({ ...message,
      ...(message.role === 'tool' && aliases.has(message.name) ? { name: aliases.get(message.name) } : {}),
      ...(message.tool_calls ? { tool_calls: message.tool_calls.map(call => ({ ...call, function: rename(call.function) })) } : {})
    })) };
}

// Maps are local to a model invocation, never shared between concurrent agents.
export function restoreProviderTools(provider) {
  const wrap = model => new Proxy(model, {
    get(target, key, receiver) {
      if (!['doGenerate', 'doStream'].includes(key)) return Reflect.get(target, key, receiver);
      return async options => {
        const { restore } = catalog([
          ...(options.tools || []).map(tool => tool.name),
          ...(options.prompt || []).flatMap(message => Array.isArray(message.content)
            ? message.content.map(part => part.toolName) : [])
        ]);
        const rename = part => restore.has(part.toolName) ? { ...part, toolName: restore.get(part.toolName) } : part;
        const usage = part => {
          const creation = part.providerMetadata?.yanQwem?.cacheCreationInputTokens;
          if (!Number.isFinite(creation) || !part.usage?.inputTokens) return part;
          const input = part.usage.inputTokens;
          return { ...part, usage: { ...part.usage, inputTokens: { ...input,
            cacheWrite: creation, noCache: Math.max(0, (input.noCache ?? input.total ?? 0) - creation) } } };
        };
        const result = await target[key](options);
        if (key === 'doGenerate') return usage({ ...result, content: result.content.map(rename) });
        return { ...result, stream: result.stream.pipeThrough(new TransformStream({
          transform(part, controller) { controller.enqueue(usage(rename(part))); }
        })) };
      };
    }
  });
  return new Proxy(provider, {
    apply(target, thisArg, args) { return wrap(Reflect.apply(target, thisArg, args)); },
    get(target, key, receiver) {
      const value = Reflect.get(target, key, receiver);
      return ['languageModel', 'chatModel', 'completionModel'].includes(key) && typeof value === 'function'
        ? (...args) => wrap(Reflect.apply(value, target, args)) : value;
    }
  });
}

export const qwenCacheMetadata = {
  extractMetadata({ parsedBody }) { return cacheMetadata(parsedBody); },
  createStreamExtractor() {
    let metadata = {};
    return {
      processChunk(chunk) { const next = cacheMetadata(chunk); if (next.yanQwem) metadata = next; },
      buildMetadata() { return metadata; }
    };
  }
};
function cacheMetadata(body) {
  const value = body?.usage?.prompt_tokens_details?.cache_creation_input_tokens;
  return Number.isFinite(value) && value >= 0 ? { yanQwem: { cacheCreationInputTokens: value } } : {};
}

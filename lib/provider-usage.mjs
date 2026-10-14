const number = value => Number.isFinite(value) && value >= 0 ? value : undefined;

// Only equivalent OpenAI-compatible fields. Anthropic input_tokens excludes
// cache reads and is deliberately not interpreted as this schema.
export function normalizeChatUsage(usage) {
  if (!usage || typeof usage !== 'object') return usage;
  const prompt = number(usage.prompt_tokens ?? usage.input_tokens);
  const completion = number(usage.completion_tokens ?? usage.output_tokens);
  const details = usage.prompt_tokens_details || usage.input_tokens_details || {};
  const cached = number(details.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens);
  const output = usage.completion_tokens_details || usage.output_tokens_details;
  return { ...usage,
    ...(prompt != null ? { prompt_tokens: prompt } : {}),
    ...(completion != null ? { completion_tokens: completion } : {}),
    ...(cached != null || Object.keys(details).length ? { prompt_tokens_details: { ...details, ...(cached != null ? { cached_tokens: cached } : {}) } } : {}),
    ...(output ? { completion_tokens_details: output } : {}) };
}

export function normalizeChatPayload(payload) {
  if (!payload || typeof payload !== 'object') return payload;
  const choices = payload.choices?.map((choice, index) => {
    if (!choice.message?.tool_calls) return { ...choice, index: choice.index ?? index };
    return { ...choice, index: choice.index ?? index, message: { ...choice.message,
      tool_calls: choice.message.tool_calls.map(call => ({ ...call,
        id: call.id == null ? `yan-${randomUUID()}` : String(call.id), type: call.type || 'function',
        function: { ...call.function, arguments: typeof call.function?.arguments === 'object'
          && call.function.arguments != null ? JSON.stringify(call.function.arguments) : call.function?.arguments }
      })) } };
  });
  return { ...payload, ...(choices ? { choices } : {}), ...(payload.usage ? { usage: normalizeChatUsage(payload.usage) } : {}) };
}
import { randomUUID } from 'node:crypto';

import { createHash, randomUUID } from 'node:crypto';

// Opt-in metadata only. Never emit URLs, headers, prompts, tool arguments or
// provider error messages (gateways sometimes echo credentials in errors).
export function createGptlDiagnostics({ model, route, emit, now = () => performance.now() }) {
  const started = now();
  const record = { requestId: randomUUID(), model, route };
  let done = false;
  const elapsed = () => Math.round((now() - started) * 100) / 100;
  const mark = key => { record[key] ??= elapsed(); };
  function finish(status, usage) {
    if (done) return;
    done = true;
    record.status = status;
    record.totalMs = elapsed();
    if (usage) {
      record.inputTokens = usage.inputTokens?.total ?? null;
      record.cachedInputTokens = usage.inputTokens?.cacheRead ?? null;
      record.outputTokens = usage.outputTokens?.total ?? null;
      record.reasoningTokens = usage.outputTokens?.reasoning ?? null;
      record.cacheHitRate = record.inputTokens > 0 && record.cachedInputTokens != null
        ? record.cachedInputTokens / record.inputTokens : null;
    }
    try { emit({ ...record }); } catch { /* diagnostic consumers cannot break generation */ }
  }
  return {
    mark, finish,
    observe(part) {
      mark('firstPartMs');
      if (part.type === 'text-delta') mark('firstTextMs');
      if (part.type === 'reasoning-delta') mark('firstReasoningMs');
      if (part.type === 'tool-input-delta') mark('firstToolArgumentMs');
      if (part.type === 'tool-input-end' || part.type === 'tool-call') {
        mark('firstToolArgumentsCompleteMs');
        record.lastToolArgumentsCompleteMs = elapsed();
      }
      if (part.type === 'finish') finish('complete', part.usage);
      if (part.type === 'error') finish('error');
    }
  };
}

export function gptlCacheFingerprint(body) {
  const items = body.input || body.messages || [];
  const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 20);
  // Separate stable instructions/schema from growing history. A fingerprint
  // is a diagnostic hint, never evidence of a server-side cache hit.
  return {
    model: body.model,
    tools: (body.tools || []).length,
    items: items.length,
    schemaHash: hash({ instructions: body.instructions,
      system: items.filter(item => ['system', 'developer'].includes(item?.role)),
      tools: body.tools || [], toolChoice: body.tool_choice, format: body.text?.format || body.response_format }),
    historyHeadHash: hash(items.slice(0, 2))
  };
}

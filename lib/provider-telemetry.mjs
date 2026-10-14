import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { createParser } from 'eventsource-parser';

const hash = value => createHash('sha256').update(JSON.stringify(value ?? null)).digest('hex').slice(0, 24);
const finite = value => Number.isFinite(value) && value >= 0 ? value : null;
const histories = new Map();
const sinks = new Map();

// Only hashes, counts and timings leave this module. Never persist prompts,
// URLs, keys, headers, tool arguments, response text or provider error bodies.
export function requestFingerprint(body, scope = '') {
  const items = Array.isArray(body.messages) ? body.messages : Array.isArray(body.input) ? body.input : [];
  const firstUser = items.find(item => item?.role === 'user');
  let imageCount = 0, inlineImageBytes = 0;
  for (const item of items) for (const part of Array.isArray(item?.content) ? item.content : []) {
    if (!['image_url', 'input_image', 'image'].includes(part?.type)) continue;
    imageCount++;
    const url = part.image_url?.url ?? part.image_url ?? part.image;
    if (typeof url !== 'string' || !url.startsWith('data:')) continue;
    const offset = url.indexOf(';base64,');
    if (offset < 0) continue;
    const length = url.length - offset - 8;
    inlineImageBytes += Math.max(0, Math.floor(length / 4) * 3 - (url.endsWith('==') ? 2 : url.endsWith('=') ? 1 : 0));
  }
  const key = hash([scope, body.model, firstUser || items[0]]);
  const messageHashes = items.slice(0, 2048).map(hash);
  const schemaHash = hash({ instructions: body.instructions, tools: body.tools,
    toolChoice: body.tool_choice, format: body.text?.format || body.response_format });
  const systemHash = hash(items.filter(item => ['system', 'developer'].includes(item?.role)));
  const controlsHash = hash({ reasoning: body.reasoning, effort: body.reasoning_effort,
    thinking: body.thinking, template: body.chat_template_kwargs, extra: body.extra_body,
    cache: body.prompt_cache_options, retention: body.prompt_cache_retention, key: body.prompt_cache_key });
  const previous = histories.get(key);
  let unchangedItems = 0;
  if (previous) while (unchangedItems < Math.min(previous.messages.length, messageHashes.length)
    && previous.messages[unchangedItems] === messageHashes[unchangedItems]) unchangedItems++;
  histories.delete(key);
  histories.set(key, { messages: messageHashes, schemaHash, systemHash, controlsHash });
  if (histories.size > 128) histories.delete(histories.keys().next().value);
  return { conversationHash: key, requestHash: hash(body), schemaHash, systemHash, controlsHash,
    messageCount: items.length, toolCount: body.tools?.length || 0, compared: !!previous,
    requestBytes: Buffer.byteLength(JSON.stringify(body)),
    toolSchemaBytes: Buffer.byteLength(JSON.stringify(body.tools || [])),
    imageCount, inlineImageBytes,
    unchangedItems, previousItems: previous?.messages.length ?? null,
    schemaChanged: previous ? schemaHash !== previous.schemaHash : null,
    systemChanged: previous ? systemHash !== previous.systemHash : null,
    controlsChanged: previous ? controlsHash !== previous.controlsHash : null,
    historySampleTruncated: items.length > 2048 };
}

export function usageMetrics(usage) {
  if (!usage) return {};
  // Anthropic is the one vendor whose input total excludes the cached portion:
  // `input_tokens` alone is the uncached remainder. Summing the three fields is
  // the only way to get a comparable number, and the split also lets the cache
  // readout show writes, which a single cached_tokens field cannot express.
  const cacheCreation = finite(usage.cache_creation_input_tokens);
  const cacheRead = finite(usage.cache_read_input_tokens);
  const anthropicInput = finite(usage.input_tokens);
  const isAnthropic = cacheCreation != null || cacheRead != null;
  if (isAnthropic) {
    const total = (anthropicInput ?? 0) + (cacheCreation ?? 0) + (cacheRead ?? 0);
    return { inputTokens: total, cachedInputTokens: cacheRead ?? 0,
      cacheReported: cacheRead != null, cacheHitRate: total > 0 && cacheRead != null ? cacheRead / total : null,
      cacheWriteTokens: cacheCreation ?? 0,
      outputTokens: finite(usage.output_tokens) };
  }
  const input = finite(usage.prompt_tokens ?? usage.input_tokens);
  const cache = finite(usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? usage.cached_tokens);
  return { inputTokens: input, cachedInputTokens: cache,
    cacheReported: cache != null, cacheHitRate: input > 0 && cache != null ? cache / input : null,
    outputTokens: finite(usage.completion_tokens ?? usage.output_tokens),
    reasoningTokens: finite(usage.completion_tokens_details?.reasoning_tokens ?? usage.output_tokens_details?.reasoning_tokens) };
}

function fileSink(directory, adapter) {
  const file = path.join(directory, `${adapter}-${process.pid}.jsonl`);
  if (sinks.has(file)) return sinks.get(file);
  let pending = 0, queue = Promise.resolve();
  const emit = record => {
    // Telemetry must never apply backpressure to generation or grow unbounded.
    if (pending >= 256) return;
    pending++;
    queue = queue.then(async () => {
      await fs.promises.mkdir(directory, { recursive: true });
      const size = await fs.promises.stat(file).then(stat => stat.size, () => 0);
      if (size > 4 * 1024 * 1024) {
        await fs.promises.rm(file + '.1', { force: true });
        await fs.promises.rename(file, file + '.1');
      }
      await fs.promises.appendFile(file, JSON.stringify(record) + '\n', { mode: 0o600 });
    }).catch(() => {}).finally(() => { pending--; });
  };
  sinks.set(file, emit);
  return emit;
}

// Observe the final outbound request and raw response, before SDK/coalescing.
// Pass emit for controlled tests; the app sets a local diagnostics directory.
export function observeProviderFetch(baseFetch = globalThis.fetch, { adapter, emit,
  directory = process.env.YAN_PROVIDER_DIAGNOSTICS_DIR } = {}) {
  if (!emit && !directory) return baseFetch;
  emit ||= fileSink(directory, adapter);
  return async (input, init) => {
    const start = performance.now();
    const elapsed = () => Math.round((performance.now() - start) * 100) / 100;
    let body;
    try { body = JSON.parse(init?.body); } catch { return baseFetch(input, init); }
    const record = { requestId: randomUUID(), time: new Date().toISOString(), adapter,
      model: body.model, route: body.messages ? 'chat' : 'responses',
      ...requestFingerprint(body, hash([adapter, String(input)])) };
    let finished = false;
    const toolInputs = new Map();
    const send = value => { try { emit(value); } catch {} };
    send({ ...record, event: 'request' });
    const mark = key => { record[key] ??= elapsed(); };
    const finish = status => {
      if (finished) return;
      finished = true;
      if (toolInputs.size) record.toolInputs = [...toolInputs.values()].map(input => {
        let parsed, validJson = false;
        try { parsed = JSON.parse(input.text); validJson = true; } catch {}
        return { bytes: input.bytes, validJson, truncated: input.truncated,
          object: !!parsed && typeof parsed === 'object' && !Array.isArray(parsed),
          fieldCount: parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0 };
      });
      send({ ...record, event: 'finish', status, totalMs: elapsed() });
    };
    let response;
    try { response = await baseFetch(input, init); }
    catch (error) { finish(init?.signal?.aborted ? 'cancelled' : 'network-error'); throw error; }
    record.headersMs = elapsed(); record.httpStatus = response.status;
    if (!response.ok || !response.body) { finish(response.ok ? 'empty' : 'http-error'); return response; }
    let pending = '', oversized = false;
    const decoder = new TextDecoder();
    const event = ({ data, event: eventType }) => {
      if (data.trim() === '[DONE]') { finish('complete'); return; }
      let value; try { value = JSON.parse(data); } catch { return; }
      if (!value || typeof value !== 'object') return;
      if (!value.type && eventType) value = { ...value, type: eventType };
      for (const choice of value.choices || []) {
        const delta = choice.delta || {};
        if (delta.content) mark('firstTextMs');
        if (delta.reasoning_content || delta.reasoning) mark('firstReasoningMs');
        for (const tool of delta.tool_calls || []) if (tool.function?.arguments) {
          mark('firstToolArgumentsMs'); record.lastToolArgumentsMs = elapsed();
        }
        for (const [index, tool] of (choice.delta?.tool_calls || choice.message?.tool_calls || []).entries()) {
          const key = `${choice.index || 0}:${tool.index ?? index}`;
          if (!toolInputs.has(key) && toolInputs.size >= 64) continue;
          const item = toolInputs.get(key) || { text: '', bytes: 0, truncated: false };
          const args = tool.function?.arguments;
          const text = typeof args === 'string' ? args : args == null ? '' : JSON.stringify(args);
          item.bytes += Buffer.byteLength(text);
          if (item.bytes <= 1024 * 1024) item.text += text;
          else item.truncated = true;
          toolInputs.set(key, item);
        }
        if (choice.finish_reason != null) mark('generationFinishedMs');
      }
      if (value.type === 'response.output_text.delta') mark('firstTextMs');
      if (value.type?.includes('reasoning') && value.type.endsWith('.delta')) mark('firstReasoningMs');
      if (value.type === 'response.function_call_arguments.delta') { mark('firstToolArgumentsMs'); record.lastToolArgumentsMs = elapsed(); }
      // Anthropic names its streaming events by block, not by token. A Messages
      // request that is never recognized here records no first-byte-to-first-token
      // timing at all, which quietly makes the speed readout look like a stall.
      if (value.type === 'content_block_delta') {
        const delta = value.delta || {};
        if (delta.type === 'text_delta' && delta.text) mark('firstTextMs');
        if (delta.type === 'thinking_delta' && delta.thinking) mark('firstReasoningMs');
        if (delta.type === 'input_json_delta') { mark('firstToolArgumentsMs'); record.lastToolArgumentsMs = elapsed(); }
      }
      if (value.type === 'message_delta') {
        mark('generationFinishedMs');
        if (value.delta?.stop_reason != null) record.stopReason = value.delta.stop_reason;
      }
      // message_start carries the input side and message_delta the output side;
      // neither is a complete usage record on its own.
      if (value.type === 'message_start' && value.message?.usage) Object.assign(record, usageMetrics(value.message.usage));
      if (value.usage || value.response?.usage) Object.assign(record, usageMetrics(value.usage || value.response.usage));
      if (['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(value.type)) {
        mark('generationFinishedMs'); finish(value.type === 'response.completed' ? 'complete' : value.type);
      }
    };
    const sse = /text\/event-stream/i.test(response.headers.get('content-type') || '');
    const parser = sse ? createParser({ maxBufferSize: 16 * 1024 * 1024, onEvent: event,
      onError: error => { if (error.type === 'max-buffer-size-exceeded') throw error; } }) : null;
    const observe = text => {
      if (oversized) return;
      try {
        if (parser) parser.feed(text);
        else {
          pending += text;
          if (pending.length > 16 * 1024 * 1024) throw new Error('Observation limit');
        }
      } catch {
        // Diagnostics must never break or buffer the actual provider stream.
        pending = ''; oversized = true; record.observationTruncated = true;
        parser?.reset();
      }
    };
    const reader = response.body.getReader();
    let cancelled = false, released = false;
    const release = () => { if (!released) { released = true; reader.releaseLock(); } };
    const stream = new ReadableStream({
      async pull(controller) {
        try {
          const next = await reader.read();
          if (cancelled) return;
          if (next.done) {
            observe(decoder.decode() + (sse ? '\n\n' : ''));
            if (!sse && !oversized) event({ data: pending });
            finish(sse ? 'eof' : 'complete'); controller.close(); release(); return;
          }
          mark('firstByteMs');
          record.firstChunkBytes ??= next.value.byteLength;
          observe(decoder.decode(next.value, { stream: true }));
          controller.enqueue(next.value);
        } catch (error) { if (!cancelled) { finish('stream-error'); controller.error(error); } void reader.cancel().catch(() => {}).finally(release); }
      },
      cancel(reason) {
        cancelled = true;
        finish(reason === 'yan-protocol-complete' && record.generationFinishedMs != null ? 'complete-without-done' : 'cancelled');
        return reader.cancel(reason).finally(release);
      }
    }, { highWaterMark: 0 });
    return new Response(stream, { status: response.status, statusText: response.statusText, headers: response.headers });
  };
}

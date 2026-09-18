import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { shapeOpenAiRequest, shapeDeepSeekReasoningRequest } from './openai-request-shaping.mjs';
import { applySupplierStreamPreference, coerceProviderStreamResponse } from './supplier-stream.mjs';
import dsmlToolCall from './dsml-tool-call.js';
import protocolText from './protocol-text.js';

const { ProtocolTextContext, findUnquotedMarkup } = protocolText;

const {
  MAX_DSML_RESPONSE_BYTES,
  recoverDsmlToolCalls,
  recoverGenericToolCalls
} = dsmlToolCall;

const MAX_PROTOCOL_PREFIX = 64;
const DSML_START = /<[|｜]{2}\s*DSML\s*[|｜]{2}tool_calls\s*>/iu;
const DSML_END = /<\/[|｜]{2}\s*DSML\s*[|｜]{2}tool_calls\s*>/iu;
const GENERIC_START = /<tool_calls\s*>/iu;
const GENERIC_END = /<\/tool_calls\s*>/iu;
const LANGUAGE_MODEL_METHODS = new Set(['languageModel', 'chatModel', 'completionModel']);
const TOOL_STREAM_CONTENT_TYPE = /(?:^|\s|;)text\/event-stream(?:\s*;|$)/iu;
// OpenCode may omit `options.tools` for native Task child sessions even though
// these core tools are registered by the runtime. Keep the XML recovery layer
// useful in that narrow case without authorizing arbitrary MCP tool names.
const CORE_TOOL_IDS = Object.freeze([
  'read',
  'glob',
  'grep',
  'list',
  'edit',
  'write',
  'apply_patch',
  'bash',
  'todowrite'
]);
const OCTET_STREAM = 'application/octet-stream';
const IMAGE_MEDIA_TYPES_BY_EXTENSION = Object.freeze({
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml'
});
const TEXT_ATTACHMENT_EXTENSIONS = new Set([
  '.c', '.cc', '.cpp', '.cxx', '.h', '.hh', '.hpp', '.hxx', '.java', '.js', '.jsx', '.ts', '.tsx',
  '.py', '.pyi', '.rs', '.go', '.cs', '.php', '.rb', '.swift', '.kt', '.kts', '.json', '.jsonc',
  '.md', '.markdown', '.txt', '.html', '.htm', '.css', '.scss', '.sass', '.less', '.xml', '.yaml',
  '.yml', '.toml', '.ini', '.cfg', '.conf', '.env', '.sh', '.bash', '.zsh', '.ps1', '.bat', '.cmd',
  '.sql', '.vue', '.svelte', '.astro', '.cmake', '.gradle', '.properties', '.gitignore'
]);

function attachmentExtension(filename) {
  const value = String(filename || '').trim().toLowerCase();
  const dot = value.lastIndexOf('.');
  return dot >= 0 ? value.slice(dot) : '';
}

function attachmentMediaType(part) {
  const declared = String(part?.mediaType || part?.mimeType || '').trim().toLowerCase();
  if (declared && declared !== OCTET_STREAM) return declared;
  return IMAGE_MEDIA_TYPES_BY_EXTENSION[attachmentExtension(part?.filename)] || declared;
}

function attachmentBytes(data) {
  if (data instanceof Uint8Array) return data;
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof data !== 'string' || !data) return null;
  const comma = data.indexOf(',');
  const encoded = data.startsWith('data:') && comma >= 0 ? data.slice(comma + 1) : data;
  try { return Uint8Array.from(Buffer.from(encoded, 'base64')); } catch { return null; }
}

function attachmentTextPart(part) {
  const filename = String(part?.filename || 'unnamed attachment');
  const extension = attachmentExtension(filename);
  const bytes = attachmentBytes(part?.data);
  if (TEXT_ATTACHMENT_EXTENSIONS.has(extension) && bytes?.length && !bytes.includes(0)) {
    const text = new TextDecoder().decode(bytes);
    return {
      type: 'text',
      text: `[Attached text file: ${filename}]\n${text}`
    };
  }
  return {
    type: 'text',
    text: `[Attached file: ${filename}. The current text runtime cannot read this binary attachment directly.]`
  };
}

function nativeToolCallKey(choiceIndex, toolIndex) {
  return `${choiceIndex}:${toolIndex}`;
}

// OpenAI-compatible gateways are expected to return a string tool-call id,
// but some gateways omit it on streamed deltas or serialize it as a number.
// The AI SDK treats the id as a protocol field, so normalize it before the
// response reaches the SDK instead of allowing a late schema failure.
function normalizeNativeToolCallId(value) {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'bigint' || typeof value === 'boolean') {
    return String(value);
  }
  return '';
}

function appendNativeToolCallDelta(state, choiceIndex, delta) {
  const toolIndex = Number.isInteger(delta?.index) ? delta.index : 0;
  const key = nativeToolCallKey(choiceIndex, toolIndex);
  const current = state.get(key) || {
    choiceIndex,
    index: toolIndex,
    id: '',
    type: 'function',
    nameChunks: [],
    argumentChunks: [],
    startEmitted: false
  };
  const normalizedId = normalizeNativeToolCallId(delta?.id);
  if (normalizedId) current.id = normalizedId;
  // A missing id is common on continuation-only deltas. Allocate one while
  // coalescing so the final synthetic delta always satisfies the SDK schema.
  if (!current.id) current.id = createCallId();
  if (delta?.type != null) current.type = String(delta.type);
  if (delta?.function?.name != null) current.nameChunks.push(String(delta.function.name));
  if (delta?.function?.arguments != null) current.argumentChunks.push(String(delta.function.arguments));
  state.set(key, current);
}

// Once a call's arguments start streaming, its name is final by protocol
// convention — emit a start delta immediately so the UI shows the tool card
// while the (potentially minutes-long) argument generation is still running.
// The final flush then sends arguments-only continuations for these calls to
// avoid duplicating id or name fields.
function takeEarlyToolCallStartPayloads(state, template) {
  const payloads = [];
  for (const call of state.values()) {
    if (call.startEmitted || !call.nameChunks.length || !call.argumentChunks.length) continue;
    call.startEmitted = true;
    payloads.push({
      ...(template || { id: `yan-tool-${Date.now()}`, object: 'chat.completion.chunk', choices: [] }),
      choices: [{
        index: call.choiceIndex,
        delta: {
          tool_calls: [{
            index: call.index,
            id: call.id,
            type: call.type || 'function',
            function: { name: call.nameChunks.join(''), arguments: '' }
          }]
        },
        finish_reason: null
      }]
    });
  }
  return payloads;
}

function completeNativeToolCallPayload(state, template) {
  const byChoice = new Map();
  for (const call of state.values()) {
    const calls = byChoice.get(call.choiceIndex) || [];
    const name = call.nameChunks.join('');
    const argumentsText = call.argumentChunks.join('');
    calls.push({
      index: call.index,
      ...(call.startEmitted ? {} : { id: normalizeNativeToolCallId(call.id) || createCallId() }),
      type: call.type || 'function',
      function: {
        ...(!call.startEmitted && name ? { name } : {}),
        arguments: argumentsText
      }
    });
    byChoice.set(call.choiceIndex, calls);
  }
  if (!byChoice.size) return null;
  return {
    ...template,
    choices: [...byChoice.entries()].map(([index, toolCalls]) => ({
      index,
      delta: { tool_calls: toolCalls.sort((left, right) => left.index - right.index) },
      finish_reason: null
    }))
  };
}

function normalizeNativeToolCallPayload(payload) {
  if (!payload || typeof payload !== 'object' || !Array.isArray(payload.choices)) return payload;
  let changed = false;
  const choices = payload.choices.map(choice => {
    const toolCalls = choice?.message?.tool_calls;
    if (!Array.isArray(toolCalls) || !toolCalls.length) return choice;
    const normalizedCalls = toolCalls.map(toolCall => {
      if (!toolCall || typeof toolCall !== 'object') return toolCall;
      const id = normalizeNativeToolCallId(toolCall?.id) || createCallId();
      if (toolCall?.id !== id) changed = true;
      return { ...toolCall, id };
    });
    const message = { ...choice.message, tool_calls: normalizedCalls };
    return { ...choice, message };
  });
  return changed ? { ...payload, choices } : payload;
}

async function normalizeNativeToolCallJsonResponse(response) {
  const contentType = response?.headers?.get?.('content-type') || '';
  if (!/^(?:application\/json|text\/json)(?:\s*;|$)/iu.test(contentType) || typeof response?.clone !== 'function') {
    return response;
  }
  let payload;
  try {
    payload = await response.clone().json();
  } catch {
    return response;
  }
  const normalized = normalizeNativeToolCallPayload(payload);
  if (normalized === payload) return response;
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(JSON.stringify(normalized), {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function parseSseDataBlock(block) {
  const data = String(block || '')
    .split(/\r?\n/gu)
    .filter(line => line.startsWith('data:'))
    .map(line => line.slice(5).replace(/^ /u, ''))
    .join('\n');
  if (!data || data === '[DONE]') return { data, payload: null };
  try { return { data, payload: JSON.parse(data) }; } catch { return { data, payload: null }; }
}

function rewriteNativeToolCallSseBlock(block, state, parsed = parseSseDataBlock(block)) {
  if (!parsed.payload || !Array.isArray(parsed.payload.choices)) return `${block}\n\n`;
  let changed = false;
  const choices = parsed.payload.choices.flatMap(choice => {
    const toolCalls = choice?.delta?.tool_calls;
    if (!Array.isArray(toolCalls) || !toolCalls.length) return [choice];
    changed = true;
    for (const toolCall of toolCalls) appendNativeToolCallDelta(state, Number(choice.index) || 0, toolCall);
    const delta = { ...(choice.delta || {}) };
    delete delta.tool_calls;
    const hasDelta = Object.keys(delta).length > 0;
    return hasDelta || choice.finish_reason != null ? [{ ...choice, delta }] : [];
  });
  if (!changed) return `${block}\n\n`;
  if (!choices.length && !parsed.payload.usage) return '';
  return `data: ${JSON.stringify({ ...parsed.payload, choices })}\n\n`;
}

function blockHasNativeToolCalls(block) {
  return String(block || '').includes('"tool_calls"');
}

async function coalesceNativeToolCallStream(response) {
  if (!response?.body?.getReader) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const state = new Map();
  let pending = '';
  let terminalTemplate = null;
  const deferredTerminalBlocks = [];
  let flushed = false;
  let completed = false;
  let terminalStarted = false;

  const flushCalls = controller => {
    if (flushed || !state.size) return;
    const payload = completeNativeToolCallPayload(state, terminalTemplate || {
      id: `yan-tool-${Date.now()}`,
      object: 'chat.completion.chunk',
      choices: []
    });
    if (payload) controller.enqueue(encoder.encode(`data: ${JSON.stringify(payload)}\n\n`));
    flushed = true;
  };

  const body = new ReadableStream({
    async start(controller) {
      const consume = block => {
        const isDone = /(?:^|\n)data:\s*\[DONE\]\s*$/u.test(String(block || '').trim());
        if (isDone) {
          flushCalls(controller);
          for (const terminalBlock of deferredTerminalBlocks) controller.enqueue(encoder.encode(terminalBlock));
          controller.enqueue(encoder.encode('data: [DONE]\n\n'));
          completed = true;
          return;
        }
        // Text-only chunks are already valid OpenAI SSE. Avoid decoding and
        // re-encoding them; this keeps the adapter's overhead below the SDK's
        // own event parser on the common non-tool path.
        if (!state.size && !blockHasNativeToolCalls(block)) {
          controller.enqueue(encoder.encode(`${block}\n\n`));
          return;
        }
        const parsed = parseSseDataBlock(block);
        const rewritten = rewriteNativeToolCallSseBlock(block, state, parsed);
        for (const startPayload of takeEarlyToolCallStartPayloads(state, terminalTemplate)) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(startPayload)}\n\n`));
        }
        const isTerminal = !!parsed.payload?.choices?.some(choice => choice?.finish_reason != null);
        if (isTerminal && state.size) terminalStarted = true;
        if (rewritten && terminalStarted) deferredTerminalBlocks.push(rewritten);
        else if (rewritten) controller.enqueue(encoder.encode(rewritten));
        if (parsed.payload?.id || parsed.payload?.object) terminalTemplate = {
          ...(terminalTemplate || {}),
          ...(parsed.payload.id ? { id: parsed.payload.id } : {}),
          ...(parsed.payload.object ? { object: parsed.payload.object } : {}),
          ...(parsed.payload.created ? { created: parsed.payload.created } : {}),
          ...(parsed.payload.model ? { model: parsed.payload.model } : {})
        };
      };

      try {
        while (true) {
          const next = await reader.read();
          if (next.done) break;
          pending += decoder.decode(next.value, { stream: true });
          let separator = /\r?\n\r?\n/u.exec(pending);
          while (separator) {
            const boundary = separator.index;
            const block = pending.slice(0, boundary);
            pending = pending.slice(boundary + separator[0].length);
            consume(block);
            // A terminal [DONE] is authoritative. Do not keep awaiting a
            // gateway that leaves the HTTP body open after sending it; that
            // turns a completed model response into a client-side hang.
            if (completed) {
              try { await reader.cancel(); } catch { /* already closed */ }
              pending = '';
              break;
            }
            separator = /\r?\n\r?\n/u.exec(pending);
          }
          if (completed) break;
        }
        pending += decoder.decode();
        if (pending.trim()) consume(pending);
        if (!completed) {
          flushCalls(controller);
          for (const terminalBlock of deferredTerminalBlocks) controller.enqueue(encoder.encode(terminalBlock));
        }
        controller.close();
      } catch (error) {
        controller.error(error);
      } finally {
        reader.releaseLock?.();
      }
    }
  });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

export function createYanProviderFetch(baseFetch = globalThis.fetch, options = {}) {
  const fetchImpl = typeof baseFetch === 'function' ? baseFetch : globalThis.fetch;
  if (typeof fetchImpl !== 'function') throw new Error('A fetch implementation is required.');
  const deepSeekReasoningReplay = options?.deepSeekReasoningReplay === true;
  const streamEnabled = options?.streamEnabled !== false;
  return async (input, init) => {
    // Outbound-only rewrite for real OpenAI models: bodies for every other
    // provider come back null and the original init object is sent verbatim.
    // DeepSeek requires reasoning_content on assistant history, including
    // empty/non-thinking entries. Compose both rewrites: a gateway's GPT-like
    // alias must not skip replay normalization after parameter shaping.
    const shapedBody = options.openAiRequestShaping === false ? null : await shapeOpenAiRequest(input, init);
    const replayBody = deepSeekReasoningReplay
      ? shapeDeepSeekReasoningRequest(shapedBody == null ? init : { ...init, body: shapedBody })
      : null;
    const nextBody = replayBody ?? shapedBody;
    if (nextBody != null) {
      init = { ...(init || {}), body: nextBody };
      if (init.headers instanceof Headers) {
        init.headers = new Headers(init.headers);
        init.headers.delete('content-length');
      } else if (init.headers && typeof init.headers === 'object') {
        const headers = { ...init.headers };
        delete headers['content-length'];
        delete headers['Content-Length'];
        init.headers = headers;
      }
    }
    init = applySupplierStreamPreference(init, streamEnabled);
    const response = await fetchImpl(input, init);
    if (streamEnabled === false) return coerceProviderStreamResponse(response, false);
    const contentType = response.headers?.get?.('content-type') || '';
    if (!TOOL_STREAM_CONTENT_TYPE.test(contentType)) return normalizeNativeToolCallJsonResponse(response);
    return coalesceNativeToolCallStream(response);
  };
}

export function normalizeDsmlPrompt(prompt = []) {
  return (Array.isArray(prompt) ? prompt : []).map(message => {
    if (!Array.isArray(message?.content)) return message;
    let changed = false;
    const content = message.content.flatMap(part => {
      if (part?.type !== 'file') return [part];
      const mediaType = attachmentMediaType(part);
      const supported = mediaType.startsWith('image/')
        || mediaType.startsWith('audio/')
        || mediaType.startsWith('text/')
        || mediaType === 'application/pdf';
      if (supported) {
        if (mediaType && mediaType !== part.mediaType) {
          changed = true;
          return [{ ...part, mediaType }];
        }
        return [part];
      }
      changed = true;
      return [attachmentTextPart(part)];
    });
    return changed ? { ...message, content } : message;
  });
}

function prepareYanPrompt(prompt = []) {
  return normalizeDsmlPrompt(prompt);
}

function createCallId() {
  const uuid = globalThis.crypto?.randomUUID?.();
  const suffix = uuid
    ? uuid.replaceAll('-', '')
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
  return `call_${suffix}`;
}

function dsmlError(message) {
  return new Error(`DeepSeek DSML compatibility failed: ${message}`);
}

function pendingProtocolPrefixLength(value) {
  const source = String(value || '');
  const markerStart = source.lastIndexOf('<');
  if (markerStart < 0) return 0;
  const candidate = source.slice(markerStart);
  if (candidate.length > MAX_PROTOCOL_PREFIX) return 0;
  const normalized = candidate.replace(/\s+/gu, '').replace(/｜/gu, '|').toLowerCase();
  return ['<tool_calls>', '<||dsml||tool_calls>'].some(marker => marker.startsWith(normalized))
    ? candidate.length
    : 0;
}

class DsmlTextDecoder {
  constructor(authorizedToolIds = null) {
    this.pending = '';
    this.readingProtocol = false;
    this.protocol = '';
    this.converted = false;
    this.earlyStart = null;
    this.authorizedToolIds = authorizedToolIds;
    this.textContext = new ProtocolTextContext();
  }

  push(value) {
    this.pending += String(value || '');
    return this.#drain(false);
  }

  finish() {
    return this.#drain(true);
  }

  #drain(final) {
    const output = [];
    while (this.pending) {
      if (!this.readingProtocol) {
        const starts = [
          { protocol: 'dsml', index: findUnquotedMarkup(this.pending, DSML_START, this.textContext)?.index ?? -1 },
          { protocol: 'generic', index: findUnquotedMarkup(this.pending, GENERIC_START, this.textContext)?.index ?? -1 }
        ].filter(candidate => candidate.index >= 0).sort((left, right) => left.index - right.index);
        const match = starts[0];
        const start = match?.index ?? -1;
        if (start < 0) {
          if (final) {
            if (findUnquotedMarkup(this.pending, /<\/?(?:[|｜]{2}\s*DSML\s*[|｜]{2}|tool_calls\b)/iu, this.textContext)) {
              throw dsmlError('DeepSeek returned an incomplete Tool Call block.');
            }
            output.push({ type: 'text', text: this.pending });
            this.textContext.write(this.pending);
            this.pending = '';
          } else {
            const flushLength = this.pending.length - pendingProtocolPrefixLength(this.pending);
            if (flushLength <= 0) break;
            output.push({ type: 'text', text: this.pending.slice(0, flushLength) });
            this.textContext.write(this.pending.slice(0, flushLength));
            this.pending = this.pending.slice(flushLength);
          }
          break;
        }

        if (start > 0) {
          output.push({ type: 'text', text: this.pending.slice(0, start) });
          this.textContext.write(this.pending.slice(0, start));
        }
        this.pending = this.pending.slice(start);
        this.readingProtocol = true;
        this.protocol = match.protocol;
      }

      const end = (this.protocol === 'generic' ? GENERIC_END : DSML_END).exec(this.pending);
      if (!this.earlyStart && !final) {
        // While the protocol block is still streaming, surface the first
        // recognizable tool name immediately: the block can contain a whole
        // written file, and the UI should show the tool card while it grows.
        // Skipped on the final drain — the generate-result path consumes the
        // whole text at once and has no use for an early signal.
        const earlyToolName = detectEarlyToolName(this.pending, this.protocol, this.authorizedToolIds);
        if (earlyToolName) {
          this.earlyStart = { id: createCallId(), toolName: earlyToolName };
          output.push({ type: 'tool-input-start', id: this.earlyStart.id, toolName: earlyToolName });
        }
      }
      if (!end) {
        if (Buffer.byteLength(this.pending, 'utf8') > MAX_DSML_RESPONSE_BYTES) {
          throw dsmlError(`DSML Tool Call exceeded ${MAX_DSML_RESPONSE_BYTES} bytes.`);
        }
        if (final) throw dsmlError('DeepSeek returned an incomplete Tool Call block.');
        break;
      }

      const blockEnd = end.index + end[0].length;
      const block = this.pending.slice(0, blockEnd);
      const recovered = this.protocol === 'generic'
        ? recoverGenericToolCalls(block, this.authorizedToolIds)
        : recoverDsmlToolCalls(block);
      if (recovered.error || !recovered.calls.length) {
        throw dsmlError(recovered.error || 'DSML did not contain a Tool Call.');
      }
      output.push({ type: 'calls', calls: recovered.calls, earlyStart: this.earlyStart });
      this.converted = true;
      this.earlyStart = null;
      this.pending = this.pending.slice(blockEnd);
      this.readingProtocol = false;
      this.protocol = '';
    }
    return output;
  }
}

function toolCallContent(calls) {
  return calls.map(call => ({
    type: 'tool-call',
    toolCallId: createCallId(),
    toolName: call.toolId,
    input: JSON.stringify(call.args)
  }));
}

function toolCallStreamParts(calls, earlyStart = null) {
  return calls.flatMap((call, callIndex) => {
    const reuseEarly = callIndex === 0 && earlyStart && earlyStart.toolName === call.toolId;
    const id = reuseEarly ? earlyStart.id : createCallId();
    const input = JSON.stringify(call.args);
    const parts = [];
    if (!reuseEarly) parts.push({ type: 'tool-input-start', id, toolName: call.toolId });
    parts.push({ type: 'tool-input-delta', id, delta: input });
    parts.push({ type: 'tool-input-end', id });
    parts.push({ type: 'tool-call', toolCallId: id, toolName: call.toolId, input });
    return parts;
  });
}

// Best-effort early probe into a still-streaming protocol block: returns the
// first invoke's tool name once its opening tag is parseable, validated
// against the run's authorized tools to avoid phantom UI cards.
function detectEarlyToolName(protocol, protocolType, authorizedToolIds) {
  const invokePattern = protocolType === 'generic'
    ? /<invoke\b[^>]*?\bname\s*=\s*"([^"]+)"/iu
    : /<\s*[|｜]{2}\s*DSML\s*[|｜]{2}invoke\b[^>]*?\bname\s*=\s*"([^"]+)"/iu;
  const toolName = String(String(protocol || '').match(invokePattern)?.[1] || '').trim();
  if (!toolName) return null;
  if (authorizedToolIds instanceof Set && !authorizedToolIds.has(toolName)) return null;
  return toolName;
}

function toolCallFinishReason(finishReason) {
  return finishReason && typeof finishReason === 'object'
    ? { ...finishReason, unified: 'tool-calls', raw: 'tool_calls' }
    : 'tool-calls';
}

function availableToolIds(options = {}) {
  const ids = new Set();
  const tools = options?.tools;
  if (Array.isArray(tools)) {
    for (const tool of tools) {
      const name = String(tool?.name || tool?.function?.name || '').trim();
      if (name) ids.add(name);
    }
  } else if (tools && typeof tools === 'object') {
    for (const [name, enabled] of Object.entries(tools)) {
      if (enabled !== false) ids.add(String(name));
    }
  }
  if (ids.size === 0) {
    for (const name of CORE_TOOL_IDS) ids.add(name);
  }
  return ids;
}

export function transformDsmlGenerateResult(result, authorizedToolIds = null) {
  return transformProtocolGenerateResult(result, () => new DsmlTextDecoder(authorizedToolIds));
}

export { createCallId as newToolCallId };

// Shared lifecycle for vendor text protocols. The decoder owns syntax and
// validation; native SDK events, tool ids and finish handling stay identical.
export function transformProtocolGenerateResult(result, createDecoder, types = ['text', 'reasoning']) {
  const content = [];
  let converted = false;

  for (const part of Array.isArray(result?.content) ? result.content : []) {
    if (!types.includes(part?.type)) {
      content.push(part);
      continue;
    }
    const decoder = createDecoder();
    const decoded = [...decoder.push(part.text), ...decoder.finish()];
    for (const item of decoded) {
      if (item.type === 'text') {
        if (item.text) content.push({ ...part, text: item.text });
      } else if (item.type === 'calls') {
        // Stream-only early tool-input-start items carry no conversion value
        // in the non-streaming generate result.
        content.push(...toolCallContent(item.calls));
      }
    }
    converted ||= decoder.converted;
  }

  return converted
    ? { ...result, content, finishReason: toolCallFinishReason(result?.finishReason) }
    : { ...result, content };
}

class ProtocolStreamChannel {
  constructor(type, createDecoder) {
    this.type = type;
    this.createDecoder = createDecoder;
    this.decoder = createDecoder();
    this.sourceId = `${type}-0`;
    this.outputId = '';
    this.outputIndex = 0;
    this.finished = false;
    this.convertedEarlier = false;
  }

  get converted() {
    return this.convertedEarlier || this.decoder.converted;
  }

  start(id) {
    this.#resume();
    this.sourceId = String(id || this.sourceId);
  }

  push(id, value, controller) {
    this.#resume();
    this.sourceId = String(id || this.sourceId);
    this.#append(this.decoder.push(value), controller);
  }

  finish(controller) {
    if (this.finished) return;
    this.#append(this.decoder.finish(), controller);
    this.#close(controller);
    this.finished = true;
  }

  #resume() {
    if (!this.finished) return;
    this.convertedEarlier ||= this.decoder.converted;
    this.decoder = this.createDecoder();
    this.finished = false;
  }

  #append(items, controller) {
    for (const item of items) {
      if (item.type === 'text') {
        if (!item.text) continue;
        if (!this.outputId) {
          this.outputId = `${this.sourceId}-yan-${this.outputIndex++}`;
          controller.enqueue({ type: `${this.type}-start`, id: this.outputId });
        }
        controller.enqueue({ type: `${this.type}-delta`, id: this.outputId, delta: item.text });
      } else if (item.type === 'tool-input-start') {
        this.#close(controller);
        controller.enqueue(item);
      } else {
        this.#close(controller);
        for (const toolPart of toolCallStreamParts(item.calls, item.earlyStart)) controller.enqueue(toolPart);
      }
    }
  }

  #close(controller) {
    if (!this.outputId) return;
    controller.enqueue({ type: `${this.type}-end`, id: this.outputId });
    this.outputId = '';
  }
}

export function transformDsmlStream(stream, authorizedToolIds = null) {
  return transformProtocolStream(stream, () => new DsmlTextDecoder(authorizedToolIds));
}

export function transformProtocolStream(stream, createDecoder, types = ['text', 'reasoning']) {
  const channels = {
    text: new ProtocolStreamChannel('text', createDecoder),
    reasoning: new ProtocolStreamChannel('reasoning', createDecoder)
  };
  let finished = false;

  const finishChannels = controller => {
    if (finished) return;
    channels.reasoning.finish(controller);
    channels.text.finish(controller);
    finished = true;
  };
  const converted = () => channels.text.converted || channels.reasoning.converted;

  return stream.pipeThrough(new TransformStream({
    transform(part, controller) {
      for (const type of types) {
        if (part?.type === `${type}-start`) {
          channels[type].start(part.id);
          return;
        }
        if (part?.type === `${type}-delta`) {
          channels[type].push(part.id, part.delta, controller);
          return;
        }
        if (part?.type === `${type}-end`) {
          channels[type].finish(controller);
          return;
        }
      }
      if (part?.type === 'finish') {
        finishChannels(controller);
        controller.enqueue(converted()
          ? { ...part, finishReason: toolCallFinishReason(part.finishReason) }
          : part);
        return;
      }
      controller.enqueue(part);
    },
    flush(controller) {
      finishChannels(controller);
    }
  }));
}

function wrapLanguageModel(model) {
  if (!model || typeof model !== 'object') return model;
  return new Proxy(model, {
    get(target, property, receiver) {
      if (property === 'doGenerate') {
        return async options => transformDsmlGenerateResult(
          await target.doGenerate({
            ...options,
            prompt: prepareYanPrompt(options?.prompt)
          }),
          availableToolIds(options)
        );
      }
      if (property === 'doStream') {
        return async options => {
          const result = await target.doStream({
            ...options,
            prompt: prepareYanPrompt(options?.prompt)
          });
          return { ...result, stream: transformDsmlStream(result.stream, availableToolIds(options)) };
        };
      }
      return Reflect.get(target, property, receiver);
    }
  });
}

export function createYanDsmlProvider(options = {}) {
  const {
    yanDsmlCompatibility = true,
    fetch: baseFetch,
    streamEnabled,
    ...providerOptions
  } = options;
  const provider = createOpenAICompatible({
    ...providerOptions,
    fetch: createYanProviderFetch(baseFetch, {
      deepSeekReasoningReplay: yanDsmlCompatibility,
      streamEnabled: streamEnabled !== false
    })
  });
  if (!yanDsmlCompatibility) return provider;
  return new Proxy(provider, {
    apply(target, thisArg, args) {
      return wrapLanguageModel(Reflect.apply(target, thisArg, args));
    },
    get(target, property, receiver) {
      const value = Reflect.get(target, property, receiver);
      if (!LANGUAGE_MODEL_METHODS.has(property) || typeof value !== 'function') return value;
      return (...args) => wrapLanguageModel(Reflect.apply(value, target, args));
    }
  });
}

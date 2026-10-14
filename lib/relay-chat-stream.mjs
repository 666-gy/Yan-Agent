import { randomUUID } from 'node:crypto';
import { sseReader, encodeSse, streamResponse } from './provider-sse.mjs';
import { normalizeChatPayload } from './provider-usage.mjs';

// Feed SDKs progressive parameters without letting parsable partial JSON run
// a tool early. Hold the root closing delimiter until the model ends the turn,
// including when a relay appends whitespace or other data after that delimiter.
// Gemini's SDK captures signatures on its first tool delta, so that first
// delta waits for the actual signature (or the end of the turn).
export function relayChatStream(response, { googleSignatures = false, terminalGraceMs,
  normalizePayload = normalizeChatPayload, toolNames = [] } = {}) {
  if (!response.ok || !response.body || !/text\/event-stream/i.test(response.headers.get('content-type') || '')) return response;
  const source = sseReader(response, { terminalGraceMs });
  const calls = new Map(), names = new Set(toolNames), queue = [];
  let terminal = false, done = false, cancelled = false, failed = false;
  let template = {};
  const emit = value => queue.push(encodeSse(value));
  const payload = call => ({ ...template, choices: [{ index: call.choice,
    delta: { tool_calls: [] }, finish_reason: null }] });
  const progressiveEnd = call => {
    // Scan each new character once; parsing the entire growing JSON on every
    // delta would make large code outputs quadratic. Scalars stay buffered.
    for (; call.scanned < call.arguments.length && call.boundary == null; call.scanned++) {
      const char = call.arguments[call.scanned];
      if (!call.root) {
        if (/\s/.test(char)) continue;
        call.root = char;
        if (!['{', '[', '"'].includes(char)) { call.boundary = call.scanned; break; }
      }
      if (call.quoted) {
        if (call.escaped) call.escaped = false;
        else if (char === '\\') call.escaped = true;
        else if (char === '"') {
          call.quoted = false;
          if (call.root === '"' && call.depth === 0) call.boundary = call.scanned;
        }
      } else if (char === '"') call.quoted = true;
      else if (char === '{' || char === '[') call.depth++;
      else if (char === '}' || char === ']') {
        if (--call.depth <= 0) call.boundary = call.scanned;
      }
    }
    return call.boundary ?? Math.max(0, call.arguments.length - 1);
  };
  const writeCall = (call, final = false) => {
    if (!call.name || (!final && (!call.arguments || (googleSignatures && !call.signature)))) return;
    // A partial name must never be exposed if the complete catalog can identify it.
    if (!final && names.size && !names.has(call.name)) return;
    const end = final ? call.arguments.length : progressiveEnd(call);
    const argumentDelta = call.arguments.slice(call.sent, end);
    if (call.started && !argumentDelta) return;
    const p = payload(call);
    p.choices[0].delta.tool_calls.push({ index: call.index, type: 'function',
      ...(!call.started ? { id: call.id || (call.id = `yan-${randomUUID()}`),
        ...(call.extra ? { extra_content: call.extra } : {}) } : {}),
      function: { ...(!call.started ? { name: call.name } : {}), arguments: argumentDelta } });
    call.started = true; call.sent = end; emit(p);
  };
  const append = (choice, delta, ordinal, single) => {
    // Some Chat relays repeat an empty id on continuation chunks.
    // It is missing metadata, not the identity of a second invocation.
    const id = delta.id == null || delta.id === '' ? null : String(delta.id);
    let index = Number.isInteger(delta.index) ? delta.index : null;
    if (index == null && id != null) {
      const active = [...calls.values()].filter(c => c.choice === choice);
      index = active.find(c => c.id === id)?.index
        ?? (active.length ? Math.max(...active.map(c => c.index)) + 1 : ordinal);
    }
    if (index == null && single) {
      const active = [...calls.values()].filter(c => c.choice === choice);
      if (active.length === 1 && (id == null || active[0].id === id)) index = active[0].index;
      else if (active.length > 1 && id == null) throw new Error('Ambiguous tool delta: relay omitted both index and id');
    }
    index ??= ordinal;
    const key = `${choice}:${index}`;
    const call = calls.get(key) || { choice, index, id: '', name: '', arguments: '', sent: 0,
      started: false, scanned: 0, root: '', depth: 0, quoted: false, escaped: false, boundary: null };
    if (id != null && !call.started) call.id = id;
    const name = delta.function?.name;
    if (typeof name === 'string' && name && name !== call.name) {
      if (call.started) throw new Error('Tool name changed after argument streaming began');
      call.name = name.startsWith(call.name) ? name : call.name + name;
    }
    if (delta.extra_content) {
      call.extra = { ...call.extra, ...delta.extra_content,
        ...(delta.extra_content.google ? { google: { ...call.extra?.google, ...delta.extra_content.google } } : {}) };
      call.signature = call.extra?.google?.thought_signature;
    }
    const args = delta.function?.arguments;
    if (args != null) {
      const piece = typeof args === 'string' ? args : JSON.stringify(args);
      // Recognize growing object/array snapshots, without deduplicating real
      // repeated string fragments in ordinary delta streams.
      if (call.arguments.trim() === '{}' && /^\s*\{/.test(piece)
        && piece.startsWith(call.arguments.slice(0, call.sent))) {
        // The initial empty object can be a relay placeholder. Its closing
        // brace is still withheld, so replacing it cannot retract SDK input.
        call.arguments = piece;
        call.scanned = 0; call.root = ''; call.depth = 0;
        call.quoted = false; call.escaped = false; call.boundary = null;
      }
      else if (call.arguments.length > 0 && /^[\s]*[\[{]/.test(piece) && piece.startsWith(call.arguments)) call.arguments = piece;
      else call.arguments += piece;
      if (call.arguments.length > 16 * 1024 * 1024) throw new Error('Tool arguments exceed 16 MiB');
    }
    calls.set(key, call); writeCall(call);
  };
  const validateCall = call => {
    if (!call.name) throw new Error('Tool response has no function name');
    try { JSON.parse(call.arguments); } catch {
      // Do not log argument content: it can contain private code or secrets.
      throw new Error(`Incomplete or invalid tool arguments (tool=${call.name}, index=${call.index}, characters=${call.arguments.length})`);
    }
  };
  const consume = event => {
    if (event.data.trim() === '[DONE]') {
      if (!terminal) {
        for (const call of calls.values()) {
          validateCall(call);
          writeCall(call, true);
        }
        emit({ ...template, choices: [{ index: 0, delta: {}, finish_reason: calls.size ? 'tool_calls' : 'stop' }] });
      }
      emit('[DONE]'); done = true; source.cancel(); return;
    }
    let value;
    try { value = JSON.parse(event.data); } catch { throw new Error('Malformed JSON in provider SSE event'); }
    if (value.error || event.event === 'error') {
      emit(value.error ? value : { error: { message: 'Provider stream failed', type: 'stream_error' } });
      failed = true; done = true; source.cancel(); return;
    }
    value = normalizePayload(value);
    for (const field of ['id','object','model','created']) if (value[field] != null) template[field] = value[field];
    const choices = [];
    for (const choice of value.choices || []) {
      const delta = { ...(choice.message || {}), ...(choice.delta || {}) };
      const tools = delta.tool_calls || [];
      if (terminal && tools.length) throw new Error('Tool data arrived after finish_reason');
      tools.forEach((tool, i) => append(choice.index || 0, tool, i, tools.length === 1));
      delete delta.tool_calls;
      if (choice.finish_reason != null) {
        // length/content_filter do not authorize executing partial arguments.
        for (const call of calls.values()) if (call.choice === (choice.index || 0)) {
          if (!['tool_calls','function_call','stop'].includes(choice.finish_reason)) throw new Error(`Incomplete tool response (${choice.finish_reason})`);
          validateCall(call);
          writeCall(call, true);
        }
        terminal = true; source.markTerminal();
      }
      if (Object.keys(delta).length || choice.finish_reason != null) choices.push({ ...choice, delta, message: undefined });
    }
    if (choices.length || value.usage || !value.choices) emit({ ...value, choices });
  };
  const body = new ReadableStream({
    async pull(controller) {
      try {
        while (!queue.length && !done && !cancelled) {
          const event = await source.next();
          if (cancelled) return;
          if (event) consume(event);
          else {
            if (!terminal && !failed) throw new Error('Provider stream closed before finish_reason');
            done = true; emit('[DONE]');
          }
        }
        if (cancelled) return;
        if (queue.length) controller.enqueue(queue.shift());
        if (done && !queue.length) controller.close();
      } catch (error) { source.cancel(error); if (!cancelled) controller.error(error); }
    },
    cancel(reason) { cancelled = true; queue.length = 0; source.cancel(reason); }
  }, { highWaterMark: 0 });
  return streamResponse(response, body);
}

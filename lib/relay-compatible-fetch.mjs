import { relayChatStream } from './relay-chat-stream.mjs';
import { normalizeChatPayload } from './provider-usage.mjs';
import { encodeSse, streamResponse } from './provider-sse.mjs';

const schemas = value => Array.isArray(value) ? value.map(schemas)
  : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(k => [k, schemas(value[k])])) : value;

export function stableToolBody(body) {
  if (!Array.isArray(body.tools) || !body.tools.every(t => t.type === 'function')) return body;
  // Schemas are declarative; array order within a schema remains untouched.
  // Stable tools avoid cache misses from concurrent MCP discovery order.
  return { ...body, tools: body.tools.map(schemas).sort((a,b) => {
    const x = a.function?.name ?? a.name ?? '', y = b.function?.name ?? b.name ?? '';
    return x < y ? -1 : x > y ? 1 : 0;
  }) };
}

export function relayCompatibleFetch(baseFetch, { googleSignatures = false, normalizePayload = normalizeChatPayload,
  terminalGraceMs = 1200 } = {}) {
  const noUsage = new Set();
  return async (input, init) => {
    let body; try { body = JSON.parse(init?.body); } catch { return baseFetch(input, init); }
    if (!body || typeof body !== 'object' || Array.isArray(body)) return baseFetch(input, init);
    body = stableToolBody(body);
    const key = `${String(input)}\n${body.model}`;
    const send = () => {
      const headers = new Headers(init?.headers); headers.delete('content-length');
      return baseFetch(input, { ...init, headers, body: JSON.stringify(body) });
    };
    if (noUsage.has(key)) delete body.stream_options;
    let response = await send();
    if (response.status === 400 && body.stream_options) {
      let error; try { error = (await response.clone().json()).error; } catch {}
      const unsupported = ['stream_options','stream_options.include_usage'].includes(error?.param)
        || (/stream_options|include_usage/i.test(error?.message || '') && /unsupported|not supported|unknown|unrecognized|extra inputs|not permitted/i.test(error?.message || ''));
      if (unsupported && !init?.signal?.aborted) {
        // One pre-stream validation retry only, never after model output.
        void response.body?.cancel().catch(() => {});
        delete body.stream_options; noUsage.add(key);
        if (noUsage.size > 128) noUsage.delete(noUsage.values().next().value);
        response = await send();
      }
    }
    if (!response.ok) return response;
    const contentType = response.headers.get('content-type') || '';
    if (/application\/json|text\/json/i.test(contentType)) {
      let payload; try { payload = await response.clone().json(); } catch { return response; }
      payload = normalizePayload(payload);
      void response.body?.cancel().catch(() => {});
      // An HTTP 200 error must still reach the SDK as an API failure.
      if (payload.error) return new Response(JSON.stringify(payload), { status: 502, headers: { 'content-type':'application/json' } });
      if (body.stream && Array.isArray(payload.choices)) {
        const choices = payload.choices.map(choice => ({ ...choice, delta: {
          ...choice.message, tool_calls: choice.message?.tool_calls?.map((call,index) => ({ ...call, index }))
        }, message: undefined }));
        response = streamResponse(response, new ReadableStream({start(c) {
          c.enqueue(encodeSse({ ...payload, choices })); c.enqueue(encodeSse('[DONE]')); c.close();
        }}));
      } else {
        const headers = new Headers(response.headers); headers.delete('content-length'); headers.delete('content-encoding');
        return new Response(JSON.stringify(payload), {status:response.status,headers});
      }
    }
    return relayChatStream(response, { googleSignatures, normalizePayload, terminalGraceMs,
      toolNames: (body.tools || []).map(t => t.function?.name).filter(Boolean) });
  };
}

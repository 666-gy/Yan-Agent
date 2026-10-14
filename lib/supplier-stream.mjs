'use strict';

// Per-connection supplier streaming preference. OpenCode always consumes an
// SSE stream; when the user turns streaming off we still ask the gateway for
// a JSON body, then wrap it as a one-shot event stream so the kernel stays
// on its existing doStream path.

export function applySupplierStreamPreference(init, streamEnabled) {
  if (streamEnabled !== false || typeof init?.body !== 'string') return init;
  try {
    const body = JSON.parse(init.body);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return init;
    body.stream = false;
    const headers = new Headers(init.headers || {});
    headers.delete('content-length');
    return { ...init, headers, body: JSON.stringify(body) };
  } catch {
    return init;
  }
}

export async function coerceProviderStreamResponse(response, streamEnabled) {
  if (streamEnabled !== false || !response) return response;
  const contentType = String(response.headers?.get?.('content-type') || '');
  if (/text\/event-stream/i.test(contentType)) return response;
  if (!response.ok) return response;
  const raw = await response.text();
  let payload;
  try {
    payload = jsonToSse(JSON.parse(raw));
  } catch {
    payload = `data: ${raw}\n\n` + 'data: [DONE]\n\n';
  }
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/event-stream; charset=utf-8');
  headers.delete('content-length');
  return new Response(payload, {
    status: response.status,
    statusText: response.statusText,
    headers
  });
}

function jsonToSse(parsed) {
  if (parsed && Array.isArray(parsed.choices)) {
    const choice = parsed.choices[0] || {};
    const message = choice.message || {};
    const content = typeof message.content === 'string' ? message.content : '';
    const reasoning = message.reasoning_content || message.reasoning || '';
    const toolCalls = message.tool_calls;
    const id = parsed.id || 'chatcmpl-yan';
    const model = parsed.model || '';
    const created = parsed.created || Math.floor(Date.now() / 1000);
    const base = { id, object: 'chat.completion.chunk', model, created };
    const chunks = [];
    if (reasoning) {
      chunks.push({
        ...base,
        choices: [{ index: 0, delta: { role: 'assistant', reasoning_content: reasoning }, finish_reason: null }]
      });
    }
    chunks.push({
      ...base,
      choices: [{
        index: 0,
        delta: {
          role: 'assistant',
          content,
          ...(Array.isArray(toolCalls) ? { tool_calls: toolCalls } : {})
        },
        finish_reason: null
      }]
    });
    chunks.push({
      ...base,
      choices: [{ index: 0, delta: {}, finish_reason: choice.finish_reason || 'stop' }]
    });
    return chunks.map(chunk => `data: ${JSON.stringify(chunk)}\n\n`).join('') + 'data: [DONE]\n\n';
  }
  if (parsed && parsed.type === 'message' && Array.isArray(parsed.content)) {
    const text = parsed.content.filter(part => part?.type === 'text').map(part => part.text || '').join('');
    const usageIn = parsed.usage?.input_tokens || 0;
    const usageOut = parsed.usage?.output_tokens || 0;
    return [
      `event: message_start\ndata: ${JSON.stringify({
        type: 'message_start',
        message: { ...parsed, content: [], usage: { input_tokens: usageIn, output_tokens: 0 } }
      })}\n\n`,
      `event: content_block_start\ndata: ${JSON.stringify({
        type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' }
      })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({
        type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text }
      })}\n\n`,
      `event: content_block_stop\ndata: ${JSON.stringify({ type: 'content_block_stop', index: 0 })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({
        type: 'message_delta',
        delta: { stop_reason: parsed.stop_reason || 'end_turn', stop_sequence: null },
        usage: { output_tokens: usageOut }
      })}\n\n`,
      `event: message_stop\ndata: ${JSON.stringify({ type: 'message_stop' })}\n\n`
    ].join('');
  }
  if (parsed && (parsed.object === 'response' || Array.isArray(parsed.output))) {
    return `data: ${JSON.stringify({ type: 'response.completed', response: parsed })}\n\n`;
  }
  return `data: ${JSON.stringify(parsed)}\n\n` + 'data: [DONE]\n\n';
}

import { sseReader, encodeSse, streamResponse } from './provider-sse.mjs';

// Responses events have an authoritative terminal state. Accept relays that
// put the type only in event:, but do not silently accept a truncated stream.
export function finishGptlEventStream(response) {
  if (!response.ok || !response.body || !/text\/event-stream/i.test(response.headers.get('content-type') || '')) return response;
  const source = sseReader(response);
  let ended = false, cancelled = false, sawResponses = false;
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        const event = await source.next();
        if (cancelled) return;
        if (!event) {
          ended = true;
          if (sawResponses) throw new Error('Responses stream closed before response.completed');
          controller.close(); return;
        }
        let value;
        if (event.data.trim() === '[DONE]') {
          if (sawResponses) throw new Error('Responses stream ended before response.completed');
          value = '[DONE]'; ended = true;
        } else {
          try { value = JSON.parse(event.data); } catch { throw new Error('Malformed JSON in Responses SSE event'); }
          if (!value.type && event.event) value = { ...value, type: event.event };
          sawResponses ||= String(value.type || '').startsWith('response.');
          ended = ['response.completed','response.failed','response.incomplete','error'].includes(value.type);
        }
        controller.enqueue(encodeSse(value));
        if (ended) { controller.close(); source.cancel(); }
      } catch (error) { source.cancel(error); if (!cancelled) controller.error(error); }
    },
    cancel(reason) { cancelled = true; source.cancel(reason); }
  }, { highWaterMark: 0 });
  return streamResponse(response, stream);
}

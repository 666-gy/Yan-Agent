import { createParser } from 'eventsource-parser';

// Canonical SSE framing shared by Chat and Responses. The upstream decoder
// owns UTF-8 boundaries; eventsource-parser owns CR/LF, comments and data lines.
export function sseReader(response, { terminalGraceMs = 1200 } = {}) {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const events = [];
  let ended = false, cancelled = false, first = true, terminalAt = 0, reading, released = false;
  const parser = createParser({ maxBufferSize: 16 * 1024 * 1024,
    onEvent: event => events.push(event),
    onError: error => { if (error.type === 'max-buffer-size-exceeded') throw error; }
  });
  const release = () => { if (!released) { released = true; reader.releaseLock(); } };
  const feed = value => {
    let text = decoder.decode(value, { stream: true });
    if (first && text) { first = false; text = text.replace(/^\uFEFF/, ''); }
    parser.feed(text);
  };
  const cancel = reason => {
    cancelled = true;
    void reader.cancel(reason).catch(() => {}).finally(release);
  };
  return {
    markTerminal() { terminalAt ||= performance.now(); },
    cancel,
    async next() {
      while (!events.length && !ended && !cancelled) {
        reading ||= reader.read();
        let timer;
        const remaining = terminalAt ? Math.max(0, terminalGraceMs - (performance.now() - terminalAt)) : null;
        const next = remaining == null ? await reading : await Promise.race([
          reading, new Promise(resolve => { timer = setTimeout(() => resolve({ tailTimeout: true }), remaining); })
        ]).finally(() => clearTimeout(timer));
        if (cancelled) return null;
        if (next.tailTimeout) { cancel('yan-protocol-complete'); ended = true; return null; }
        reading = null;
        if (next.done) {
          // Gateways sometimes omit the last empty line. Flush an otherwise
          // complete event, but never fabricate a response terminal event.
          parser.feed(decoder.decode() + '\n\n'); ended = true; release();
        } else feed(next.value);
      }
      return events.shift() || null;
    }
  };
}

export function encodeSse(data) {
  return new TextEncoder().encode(`data: ${typeof data === 'string' ? data : JSON.stringify(data)}\n\n`);
}

export function streamResponse(response, body) {
  const headers = new Headers(response.headers);
  headers.set('content-type', 'text/event-stream');
  headers.delete('content-length'); headers.delete('content-encoding');
  return new Response(body, { status: response.status, statusText: response.statusText, headers });
}

// Some relays leave HTTP open after the protocol has already finished. End
// at the actual SSE terminal event, after forwarding it (including usage).
export function finishGptlEventStream(response) {
  if (!response.ok || !response.body || !/text\/event-stream/i.test(response.headers.get('content-type') || '')) return response;
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  let buffer = '';
  let ended = false;
  const cancelUpstream = reason => { void reader.cancel(reason).catch(() => {}); };
  const isTerminal = block => {
    const data = block.split(/\r?\n/).filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trimStart()).join('\n');
    if (data.trim() === '[DONE]') return true;
    try {
      return ['response.completed', 'response.failed', 'response.incomplete', 'error'].includes(JSON.parse(data).type);
    } catch { return false; }
  };
  const stream = new ReadableStream({
    async pull(controller) {
      try {
        while (!ended) {
          const boundary = /\r?\n\r?\n/.exec(buffer);
          if (boundary) {
            const end = boundary.index + boundary[0].length;
            const block = buffer.slice(0, end);
            buffer = buffer.slice(end);
            controller.enqueue(encoder.encode(block));
            if (isTerminal(block)) {
              ended = true;
              buffer = '';
              controller.close();
              cancelUpstream();
            }
            return;
          }
          const next = await reader.read();
          buffer += decoder.decode(next.value, { stream: !next.done });
          if (next.done) {
            ended = true;
            if (buffer) controller.enqueue(encoder.encode(buffer));
            controller.close();
            reader.releaseLock();
            return;
          }
          if (buffer.length > 16 * 1024 * 1024) throw new Error('GPTL SSE event exceeds 16 MiB');
        }
      } catch (error) {
        ended = true;
        controller.error(error);
        cancelUpstream(error);
      }
    },
    cancel(reason) { ended = true; buffer = ''; cancelUpstream(reason); }
  }, { highWaterMark: 0 });
  const headers = new Headers(response.headers);
  headers.delete('content-length');
  headers.delete('content-encoding');
  return new Response(stream, { status: response.status, statusText: response.statusText, headers });
}

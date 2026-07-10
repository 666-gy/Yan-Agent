/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

async function callApiStream(messages, assistantEl, runCtx, tools = K.snapshotTools()) {
  if (!runCtx) runCtx = K.createRunCtx(deps().getCurrentSession()?.id, true);
  const shouldAbort = () => !!runCtx.shouldAbort;
  const { baseUrl, apiKey, model, thinking } = deps().getConfig().api;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body = {
    model,
    messages,
    stream: true,
    tools,
    tool_choice: 'auto'
  };
  if (thinking) body.thinking = { type: 'enabled' };

  const abortController = new AbortController();
  runCtx.abortController = abortController;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: abortController.signal
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let toolCalls = [];
  const bodyEl = assistantEl ? assistantEl.querySelector('.msg-body') : null;
  let roundEl = null;
  let thinkEl = null;
  let thinkTextEl = null;

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          if (bodyEl) {
            if (!thinkEl) {
              thinkEl = document.createElement('details');
              thinkEl.className = 'thinking-block';
              thinkEl.open = true;
              thinkEl.innerHTML = '<summary>深度思考中…</summary><div class="thinking-text"></div>';
              bodyEl.appendChild(thinkEl);
              thinkTextEl = thinkEl.querySelector('.thinking-text');
            }
            thinkTextEl.textContent = reasoning;
            thinkTextEl.scrollTop = thinkTextEl.scrollHeight;
            deps().hooks.scrollChatToBottom();
          }
        }

        if (delta.content) {
          content += delta.content;
          if (bodyEl) {
            if (thinkEl && thinkEl.open) {
              thinkEl.open = false;
              thinkEl.querySelector('summary').textContent = '深度思考';
            }
            if (!roundEl) {
              roundEl = document.createElement('div');
              roundEl.className = 'msg-round';
              bodyEl.appendChild(roundEl);
            }
            roundEl.innerHTML = deps().hooks.renderMarkdown(content);
            deps().hooks.scrollChatToBottom();
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      } catch (e) { /* skip parse errors */ }
    }
  }
  } catch (e) {
    if (!(e && e.name === 'AbortError') && !shouldAbort()) throw e;
  }

  if (thinkEl && thinkEl.open) {
    thinkEl.open = false;
    thinkEl.querySelector('summary').textContent = '深度思考';
  }

  const filteredToolCalls = toolCalls.filter(tc => tc.function.name);
  return {
    content: content || '',
    reasoning_content: reasoning || undefined,
    tool_calls: filteredToolCalls.length > 0 ? filteredToolCalls : null
  };
}

  K.callApiStream = callApiStream;
})(window.YanKernel);

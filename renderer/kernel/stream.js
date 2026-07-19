/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

function applyProviderOptions(body, apiConfig = {}) {
  const provider = String(apiConfig.provider || '');
  const model = String(apiConfig.model || '');
  const thinking = !!apiConfig.thinking;

  switch (provider) {
    case 'deepseek':
      body.thinking = { type: thinking ? 'enabled' : 'disabled' };
      break;

    case 'qwen': {
      const mixedThinking = /^(?:qwen3\.7-(?:max|plus)|qwen3\.6-(?:flash|max-preview|plus)|qwen3-max|qwen-(?:plus|turbo))$/;
      if (mixedThinking.test(model)) {
        body.enable_thinking = thinking;
      }
      break;
    }

    case 'glm':
      if (/^glm-(?:5(?:[.-]|$)|4\.(?:5|6|7)(?:[.-]|$))/.test(model)) {
        body.thinking = { type: thinking ? 'enabled' : 'disabled' };
      }
      break;

    case 'doubao':
      body.thinking = { type: thinking ? 'enabled' : 'disabled' };
      break;

    case 'moonshot':
      if (model === 'kimi-k3') {
        // K3 always reasons and currently accepts only the max effort level.
        body.reasoning_effort = 'max';
      } else if (/^kimi-k2\.7-code(?:-highspeed)?$/.test(model)) {
        // K2.7 Code is thinking-only; sending disabled is an API error.
        body.thinking = { type: 'enabled' };
      } else if (/^kimi-k2\.(?:6|5)$/.test(model)) {
        body.thinking = { type: thinking ? 'enabled' : 'disabled' };
      }
      break;

    case 'stepfun':
      // StepFun exposes low/medium/high rather than a true on/off switch.
      body.reasoning_effort = thinking ? 'high' : 'low';
      break;

    case 'minimax':
      // Do not leak another vendor's non-standard thinking field into
      // MiniMax's OpenAI-compatible endpoint.
      break;
  }

  return body;
}


function extractReasoningText(delta) {
  if (!delta || typeof delta !== 'object') return '';

  for (const key of ['reasoning_content', 'reasoning']) {
    if (typeof delta[key] === 'string') return delta[key];
  }

  if (Array.isArray(delta.reasoning_details)) {
    return delta.reasoning_details.map(item => {
      if (typeof item === 'string') return item;
      if (!item || typeof item !== 'object') return '';
      for (const key of ['text', 'content', 'thinking']) {
        if (typeof item[key] === 'string') return item[key];
      }
      return '';
    }).join('');
  }

  return '';
}

async function callApiStream(messages, assistantEl, runCtx, tools = K.snapshotTools()) {
  if (!runCtx) {
    const currentSession = deps().getCurrentSession();
    runCtx = K.createRunCtx(currentSession?.id, true, currentSession?.workspace);
    runCtx.sessionRef = currentSession;
  }
  const shouldAbort = () => !!runCtx.shouldAbort;
  const apiConfig = deps().getConfig().api;
  const { baseUrl, apiKey, model } = apiConfig;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body = {
    model,
    messages,
    stream: true
  };

  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  applyProviderOptions(body, apiConfig);

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
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        const reasoningDelta = extractReasoningText(delta);
        if (reasoningDelta) {
          reasoning += reasoningDelta;
          if (bodyEl) {
            if (!thinkEl) {
              thinkEl = document.createElement('details');
              thinkEl.className = 'thinking-block';
              thinkEl.open = true;
              thinkEl.innerHTML = '<summary><span class="think-icon" aria-hidden="true"></span>思考中…</summary><div class="thinking-text"></div>';
              (deps().hooks.getAgentActivityBody?.(bodyEl) || bodyEl).appendChild(thinkEl);
              thinkTextEl = thinkEl.querySelector('.thinking-text');
            }
            thinkTextEl.textContent = reasoning;
            thinkTextEl.scrollTop = thinkTextEl.scrollHeight;
            deps().hooks.scrollChatToBottom();
          }
        }

        if (typeof delta.content === 'string' && delta.content) {
          content += delta.content;
          if (bodyEl) {
            if (thinkEl && thinkEl.open) {
              thinkEl.open = false;
              thinkEl.querySelector('summary').innerHTML = '<span class="think-icon" aria-hidden="true"></span>思考过程';
            }
            if (!roundEl) {
              roundEl = document.createElement('div');
              roundEl.className = 'msg-round streaming';
              bodyEl.appendChild(roundEl);
            }
            roundEl.innerHTML = deps().hooks.renderMarkdown(content) + '<span class="stream-cursor" aria-hidden="true"></span>';
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

  if (shouldAbort() && bodyEl) {
    deps().hooks.onRunAborted?.(runCtx);
  }

  if (thinkEl && thinkEl.open) {
    thinkEl.open = false;
    const sum = thinkEl.querySelector('summary');
    if (sum) sum.innerHTML = '<span class="think-icon" aria-hidden="true"></span>思考过程';
  }
  if (roundEl) roundEl.classList.remove('streaming');

  const filteredToolCalls = toolCalls.filter(tc => tc.function.name);
  return {
    content: content || '',
    reasoning_content: reasoning || undefined,
    tool_calls: filteredToolCalls.length > 0 ? filteredToolCalls : null
  };
}

  K.applyProviderOptions = applyProviderOptions;
  K.extractReasoningText = extractReasoningText;
  K.callApiStream = callApiStream;
})(window.YanKernel);

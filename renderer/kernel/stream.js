/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

function applyProviderOptions(body, apiConfig = {}) {
  const provider = String(apiConfig.provider || '');
  const model = String(apiConfig.model || '');
  const reasoningSpeed = K.getReasoningSpeed ? K.getReasoningSpeed(apiConfig) : (apiConfig.thinking ? 'smart' : 'balanced');
  const reasoningEffort = K.getReasoningEffort ? K.getReasoningEffort(apiConfig) : ({ fast: 'low', balanced: 'medium', smart: 'high' }[reasoningSpeed]);
  const thinking = reasoningSpeed === 'smart';
  if (K.resolveRuntimeModelId) body.model = K.resolveRuntimeModelId(apiConfig);

  switch (provider) {
    case 'openai':
      if (/^(?:gpt-)?5(?:[.-]|$)|^o[134](?:[-_.]|$)|codex/i.test(model)) {
        body.reasoning_effort = reasoningEffort;
      }
      break;

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
      body.reasoning_effort = reasoningEffort;
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

function cloneMessageContent(content) {
  if (typeof content === 'string' || content == null) return content == null ? '' : content;
  try { return JSON.parse(JSON.stringify(content)); } catch { return String(content); }
}

function normalizeToolArguments(value) {
  if (value && typeof value === 'object') {
    try { return JSON.stringify(value); } catch { return '{}'; }
  }
  const raw = String(value || '').trim();
  if (!raw) return '{}';
  try { return JSON.stringify(JSON.parse(raw)); } catch { return '{}'; }
}

function normalizeAssistantMessage(message) {
  const normalized = {
    role: 'assistant',
    content: cloneMessageContent(message?.content)
  };
  if (typeof message?.reasoning_content === 'string' && message.reasoning_content.trim()) {
    normalized.reasoning_content = message.reasoning_content;
  }
  const calls = (Array.isArray(message?.tool_calls) ? message.tool_calls : [])
    .map(call => {
      const id = String(call?.id || '').trim();
      const name = String(call?.function?.name || '').trim();
      if (!id || !name) return null;
      return {
        id,
        type: 'function',
        function: {
          name,
          arguments: normalizeToolArguments(call?.function?.arguments)
        }
      };
    })
    .filter(Boolean);
  if (calls.length) normalized.tool_calls = calls;
  return normalized;
}

// Keep only the OpenAI-compatible message surface and complete assistant/tool
// groups. An orphaned tool result or an unfinished tool call can make an
// otherwise valid request fail at the gateway before it reaches the model.
function normalizeApiMessages(messages) {
  const normalized = [];
  for (let index = 0; index < (messages || []).length; index++) {
    const message = messages[index];
    const role = String(message?.role || '');
    if (role === 'system' || role === 'user') {
      normalized.push({ role, content: cloneMessageContent(message.content) });
      continue;
    }
    if (role === 'tool') continue;
    if (role !== 'assistant') continue;

    const assistant = normalizeAssistantMessage(message);
    if (!assistant.tool_calls?.length) {
      if (String(assistant.content || '').trim() || assistant.reasoning_content) normalized.push(assistant);
      continue;
    }

    let cursor = index + 1;
    const results = new Map();
    while (cursor < messages.length && messages[cursor]?.role === 'tool') {
      const result = messages[cursor];
      const id = String(result?.tool_call_id || '').trim();
      if (id && !results.has(id)) {
        results.set(id, { role: 'tool', tool_call_id: id, content: String(result.content ?? '') });
      }
      cursor++;
    }
    const complete = assistant.tool_calls.every(call => results.has(call.id));
    if (complete) {
      normalized.push(assistant);
      for (const call of assistant.tool_calls) normalized.push(results.get(call.id));
    } else {
      // Incomplete group: keep assistant + synthesize placeholder results for missing tool calls
      // so the model knows what it previously attempted rather than losing that context entirely.
      normalized.push(assistant);
      for (const call of assistant.tool_calls) {
        normalized.push(results.get(call.id) || {
          role: 'tool',
          tool_call_id: call.id,
          content: JSON.stringify({ ok: false, error: 'result unavailable (context was compressed or message was lost)', meta: { code: 'RESULT_UNAVAILABLE', nonFatal: true } })
        });
      }
    }
    index = cursor - 1;
  }
  return normalized;
}

function endpointForLog(value) {
  try {
    const parsed = new URL(String(value || ''));
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(value || '').split('?')[0].slice(0, 300);
  }
}

function logRequestDiagnostic(runCtx, diagnostic) {
  if (!runCtx || !diagnostic) return diagnostic;
  if (!Array.isArray(runCtx.requestDiagnostics)) runCtx.requestDiagnostics = [];
  if (!runCtx.requestDiagnostics.includes(diagnostic)) runCtx.requestDiagnostics.push(diagnostic);
  if (runCtx.requestDiagnostics.length > 50) runCtx.requestDiagnostics.splice(0, runCtx.requestDiagnostics.length - 50);
  const line = [
    '[api]',
    `provider=${diagnostic.provider || 'unknown'}`,
    `model=${diagnostic.model || 'unknown'}`,
    `iteration=${diagnostic.iteration || 0}`,
    `messages=${diagnostic.messageCount || 0}`,
    `tools=${diagnostic.toolCount || 0}`,
    `bytes=${diagnostic.requestBytes || 0}`,
    `status=${diagnostic.status || 'pending'}`,
    diagnostic.requestId ? `requestId=${diagnostic.requestId}` : '',
    diagnostic.error ? `error=${String(diagnostic.error).replace(/\s+/g, ' ').slice(0, 500)}` : ''
  ].filter(Boolean).join(' ');
  Promise.resolve(K.getRunWorkspace?.(runCtx))
    .then(workspace => workspace && api().yanagentLog?.(line, workspace))
    .catch(() => {});
  return diagnostic;
}

const DSML_PREFIX_PATTERN = '[|｜]{2}\\s*DSML\\s*[|｜]{2}';

function decodeDsmlText(value) {
  return String(value || '')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&');
}

function readDsmlAttribute(attributes, name) {
  const match = String(attributes || '').match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, 'i'));
  return match ? decodeDsmlText(match[2]) : '';
}

function decodeDsmlParameter(rawValue, isString) {
  const value = decodeDsmlText(rawValue).trim();
  if (String(isString).toLowerCase() === 'true') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function normalizeDsmlArguments(toolName, args, tools) {
  const aliases = {
    filePath: 'path', filepath: 'path', file_path: 'path',
    oldString: 'old_string', newString: 'new_string',
    startLine: 'start_line', endLine: 'end_line',
    maxResults: 'max_results', caseSensitive: 'case_sensitive',
    contextLines: 'context_lines', useInputImage: 'use_input_image',
    aspectRatio: 'aspect_ratio', taskContext: 'task_context',
    skillId: 'skill_id'
  };
  const normalized = {};
  for (const [key, value] of Object.entries(args || {})) normalized[aliases[key] || key] = value;

  let name = String(toolName || '').trim();
  if (name === 'read_file' && (normalized.offset !== undefined || normalized.limit !== undefined)) {
    const rangeAvailable = !!K.getToolDefinition?.('read_file_range', tools);
    if (rangeAvailable) {
      const offset = Number(normalized.offset);
      const limit = Number(normalized.limit);
      const start = Number.isFinite(offset) ? Math.max(1, Math.floor(offset)) : 1;
      name = 'read_file_range';
      normalized.start_line = start;
      normalized.end_line = Number.isFinite(limit) && limit > 0
        ? start + Math.floor(limit) - 1
        : start + 199;
    }
    delete normalized.offset;
    delete normalized.limit;
  }
  return { name, args: normalized };
}

function stripDsmlForDisplay(rawText) {
  const text = String(rawText || '');
  const completeBlockRe = new RegExp(`<${DSML_PREFIX_PATTERN}tool_calls\\s*>[\\s\\S]*?<\\/${DSML_PREFIX_PATTERN}tool_calls\\s*>`, 'gi');
  let cleaned = text.replace(completeBlockRe, '');
  const protocolStartRe = new RegExp(`<${DSML_PREFIX_PATTERN}(?:tool_calls|invoke|parameter)\\b`, 'i');
  const incompleteStart = cleaned.search(protocolStartRe);
  if (incompleteStart >= 0) cleaned = cleaned.slice(0, incompleteStart);
  return cleaned.replace(/\n{3,}/g, '\n\n').trim();
}

function parseDsmlToolCalls(rawText, tools = [], runCtx = null) {
  const text = String(rawText || '');
  const blockRe = new RegExp(`<${DSML_PREFIX_PATTERN}tool_calls\\s*>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}tool_calls\\s*>`, 'gi');
  const invokeRe = new RegExp(`<${DSML_PREFIX_PATTERN}invoke\\b([^>]*)>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}invoke\\s*>`, 'gi');
  const parameterRe = new RegExp(`<${DSML_PREFIX_PATTERN}parameter\\b([^>]*)>([\\s\\S]*?)<\\/${DSML_PREFIX_PATTERN}parameter\\s*>`, 'gi');
  const calls = [];
  const markerRe = new RegExp(`<${DSML_PREFIX_PATTERN}(?:tool_calls|invoke|parameter)\\b`, 'i');
  let detected = markerRe.test(text);
  let blockMatch;

  while ((blockMatch = blockRe.exec(text)) !== null) {
    let invokeMatch;
    while ((invokeMatch = invokeRe.exec(blockMatch[1])) !== null) {
      const rawName = readDsmlAttribute(invokeMatch[1], 'name');
      if (!rawName) continue;
      const args = {};
      let parameterMatch;
      parameterRe.lastIndex = 0;
      while ((parameterMatch = parameterRe.exec(invokeMatch[2])) !== null) {
        const parameterName = readDsmlAttribute(parameterMatch[1], 'name');
        if (!parameterName) continue;
        args[parameterName] = decodeDsmlParameter(
          parameterMatch[2],
          readDsmlAttribute(parameterMatch[1], 'string')
        );
      }
      const normalized = normalizeDsmlArguments(rawName, args, tools);
      calls.push({
        id: `call_dsml_${runCtx?.runId || 'run'}_${(runCtx?.toolCallSeq || 0) + calls.length + 1}`,
        type: 'function',
        function: {
          name: normalized.name,
          arguments: JSON.stringify(normalized.args)
        }
      });
    }
    invokeRe.lastIndex = 0;
  }

  return {
    detected,
    content: stripDsmlForDisplay(text),
    tool_calls: calls
  };
}

function stripDsmlToolBlocks(rawText) {
  return parseDsmlToolCalls(rawText).content;
}

async function callApiStream(messages, assistantEl, runCtx, tools = K.snapshotTools(), options = {}) {
  if (!runCtx) {
    const currentSession = deps().getCurrentSession();
    runCtx = K.createRunCtx(currentSession?.id, true, currentSession?.workspace);
    runCtx.sessionRef = currentSession;
  }
  const shouldAbort = () => !!runCtx.shouldAbort;
  const getBodyEl = () => {
    if (!runCtx.ui) return null;
    const activeBody = deps().hooks.getActiveAssistantBody?.(runCtx.sessionId);
    if (activeBody?.isConnected) return activeBody;
    const fallbackBody = assistantEl?.querySelector?.('.msg-body');
    return fallbackBody?.isConnected ? fallbackBody : null;
  };
  const apiConfig = options.apiConfig || deps().getConfig().api;
  const { baseUrl, apiKey } = apiConfig;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const normalizedMessages = normalizeApiMessages(messages);
  const body = {
    model: apiConfig.model,
    messages: normalizedMessages,
    stream: true
  };

  if (Array.isArray(tools) && tools.length > 0) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  applyProviderOptions(body, apiConfig);

  // Output budget: high ceilings for large write turns, but ALWAYS clamp to the
  // provider's legal max_tokens range (DeepSeek rejects values above 393216).
  {
    const budget = runCtx?.runBudget || (K.resolveModelBudget ? K.resolveModelBudget(apiConfig) : null);
    let requested = typeof body.max_tokens === 'number'
      ? body.max_tokens
      : (typeof apiConfig.maxTokens === 'number' && apiConfig.maxTokens > 0
        ? apiConfig.maxTokens
        : Number(budget?.maxTokens) || 393_216);
    if (K.clampMaxTokensForApi) {
      requested = K.clampMaxTokensForApi(requested, apiConfig);
    } else {
      const cap = Number(budget?.apiMaxTokensCap) || 393_216;
      requested = Math.max(1, Math.min(Math.floor(requested), cap));
    }
    body.max_tokens = requested;
  }
  // Some OpenAI-compatible gateways use max_completion_tokens instead of / as well as max_tokens.
  if (typeof body.max_completion_tokens !== 'number' && typeof body.max_tokens === 'number') {
    const provider = String(apiConfig.provider || '');
    if (provider === 'openai' || /gpt-|o[134]/i.test(String(apiConfig.model || ''))) {
      body.max_completion_tokens = body.max_tokens;
    }
  }

  const serializedBody = JSON.stringify(body);
  const requestBytes = typeof TextEncoder === 'function'
    ? new TextEncoder().encode(serializedBody).byteLength
    : serializedBody.length;
  const diagnostic = logRequestDiagnostic(runCtx, {
    ts: Date.now(),
    provider: String(apiConfig.provider || ''),
    model: String(apiConfig.model || ''),
    endpoint: endpointForLog(url),
    iteration: Number(runCtx.agentState?.iteration || 0),
    messageCount: normalizedMessages.length,
    toolCount: Array.isArray(body.tools) ? body.tools.length : 0,
    requestBytes,
    status: 'pending'
  });

  const abortController = new AbortController();
  runCtx.abortController = abortController;

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: serializedBody,
      signal: abortController.signal
    });
  } catch (error) {
    diagnostic.status = 'fetch_error';
    diagnostic.error = String(error?.message || error);
    logRequestDiagnostic(runCtx, diagnostic);
    if (error?.name === 'AbortError') throw error;
    throw new Error(`模型请求发送失败：${diagnostic.error}\n阶段：建立 HTTP 连接。\nEndpoint：${diagnostic.endpoint}`);
  }

  const responseRequestId = res.headers.get('x-request-id') || res.headers.get('request-id') || '';
  diagnostic.status = res.status;
  diagnostic.requestId = responseRequestId;

  if (!res.ok) {
    const t = await res.text();
    diagnostic.error = t.slice(0, 1000) || res.statusText || 'empty error response';
    logRequestDiagnostic(runCtx, diagnostic);
    throw new Error([
      `HTTP ${res.status}: ${diagnostic.error}`,
      `阶段：模型接口拒绝请求；请求体 ${requestBytes} 字节，${normalizedMessages.length} 条消息，${body.tools?.length || 0} 个工具。`,
      responseRequestId ? `Request ID：${responseRequestId}` : '',
      `Endpoint：${diagnostic.endpoint}`
    ].filter(Boolean).join('\n'));
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let rawContent = '';
  let content = '';
  let rawReasoning = '';
  let reasoning = '';
  let toolCalls = [];
  let sawDoneMarker = false;
  let sawFinishReason = false;
  let finishReason = '';
  let receivedBytes = 0;
  let receivedChunks = 0;
  let sseEventCount = 0;
  let malformedEventCount = 0;
  let firstByteAt = 0;
  const streamStartedAt = Date.now();
  const requestId = responseRequestId;
  let streamProtocolError = '';
  let roundEl = null;
  let thinkEl = null;
  let thinkTextEl = null;
  const previousContent = runCtx.partialContent || '';
  runCtx.streamingContent = '';
  runCtx.streamingReasoning = '';

  const makeStreamError = (message, cause) => {
    diagnostic.status = 'stream_error';
    diagnostic.error = String(message || 'unknown stream error');
    diagnostic.responseBytes = receivedBytes;
    diagnostic.sseEventCount = sseEventCount;
    diagnostic.finishReason = finishReason || (sawDoneMarker ? 'done_marker' : '');
    logRequestDiagnostic(runCtx, diagnostic);
    return cause ? new Error(diagnostic.error, { cause }) : new Error(diagnostic.error);
  };

  const getThinkingEl = bodyEl => {
    if (thinkEl?.isConnected && bodyEl.contains(thinkEl)) return thinkEl;
    thinkEl = bodyEl.querySelector('.thinking-block.streaming');
    if (!thinkEl) {
      thinkEl = document.createElement('details');
      thinkEl.className = 'thinking-block streaming';
      thinkEl.open = true;
      thinkEl.innerHTML = '<summary><span class="think-icon" aria-hidden="true"></span>思考中…</summary><div class="thinking-text"></div>';
      (deps().hooks.getAgentActivityBody?.(bodyEl) || bodyEl).appendChild(thinkEl);
    }
    thinkTextEl = thinkEl.querySelector('.thinking-text');
    return thinkEl;
  };

  const getRoundEl = bodyEl => {
    if (roundEl?.isConnected && bodyEl.contains(roundEl)) return roundEl;
    roundEl = Array.from(bodyEl.children).find(el => el.classList?.contains('msg-round') && el.classList.contains('streaming')) || null;
    if (!roundEl) {
      roundEl = document.createElement('div');
      roundEl.className = 'msg-round streaming';
      bodyEl.appendChild(roundEl);
    }
    return roundEl;
  };

  const appendReasoning = reasoningDelta => {
    if (!reasoningDelta) return;
    rawReasoning += reasoningDelta;
    reasoning = stripDsmlForDisplay(rawReasoning);
    runCtx.streamingReasoning = reasoning;
    try { options.onReasoning?.({ text: reasoning, delta: reasoningDelta }); } catch { /* UI callbacks are optional */ }
    const bodyEl = getBodyEl();
    if (bodyEl) {
      getThinkingEl(bodyEl);
      thinkTextEl.textContent = reasoning;
      thinkTextEl.scrollTop = thinkTextEl.scrollHeight;
      deps().hooks.scrollChatToBottom();
    }
  };

  const appendContent = contentDelta => {
    if (!contentDelta) return;
    rawContent += contentDelta;
    content = stripDsmlForDisplay(rawContent);
    runCtx.streamingContent = content;
    runCtx.partialContent = [previousContent, content].filter(Boolean).join('\n\n');
    try { options.onContent?.({ text: content, delta: contentDelta }); } catch { /* UI callbacks are optional */ }
    const bodyEl = getBodyEl();
    if (bodyEl) {
      const currentThinkEl = bodyEl.querySelector('.thinking-block.streaming');
      if (currentThinkEl?.open) {
        currentThinkEl.open = false;
        currentThinkEl.querySelector('summary').innerHTML = '<span class="think-icon" aria-hidden="true"></span>思考过程';
      }
      const currentRoundEl = getRoundEl(bodyEl);
      currentRoundEl.innerHTML = deps().hooks.renderMarkdown(content) + '<span class="stream-cursor" aria-hidden="true"></span>';
      deps().hooks.scrollChatToBottom();
    }
  };

  const processSseData = data => {
    if (!data || data === '[DONE]') {
      if (data === '[DONE]') sawDoneMarker = true;
      return;
    }
    sseEventCount++;
    try {
      const json = JSON.parse(data);
      if (json?.error) {
        const apiError = json.error;
        streamProtocolError = typeof apiError === 'string'
          ? apiError
          : String(apiError.message || apiError.code || JSON.stringify(apiError));
        return;
      }
      const choice = json.choices?.[0];
      if (choice?.finish_reason) {
        sawFinishReason = true;
        finishReason = String(choice.finish_reason);
      }
      const delta = choice?.delta;
      if (!delta) return;

      appendReasoning(extractReasoningText(delta));
      appendContent(typeof delta.content === 'string' ? delta.content : '');

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
    } catch {
      malformedEventCount++;
      // Ignore malformed keep-alive lines; a missing terminal marker is handled below.
    }
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        buffer += decoder.decode();
        const tail = buffer.trim();
        if (tail.startsWith('data:')) processSseData(tail.slice(5).trim());
        break;
      }

      receivedChunks++;
      receivedBytes += value.byteLength;
      if (!firstByteAt) firstByteAt = Date.now();
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop();
      for (const line of lines) {
        if (line.startsWith('data:')) processSseData(line.slice(5).trim());
      }
    }
  } catch (e) {
    if (!(e && e.name === 'AbortError') && !shouldAbort()) {
      const elapsedMs = Date.now() - streamStartedAt;
      const cause = e?.cause;
      const detail = [
        `流读取失败：${e?.message || e}`,
        `阶段：读取响应正文；已持续 ${elapsedMs} ms，收到 ${receivedBytes} 字节 / ${receivedChunks} 个网络分块 / ${sseEventCount} 个 SSE 事件。`,
        `终止信号：finish_reason=${finishReason || '未收到'}，DONE=${sawDoneMarker ? '已收到' : '未收到'}。`,
        requestId ? `Request ID：${requestId}。` : '',
        cause?.code ? `底层错误码：${cause.code}。` : '',
        cause?.message && cause.message !== e?.message ? `底层原因：${cause.message}` : ''
      ].filter(Boolean).join('\n');
      throw makeStreamError(detail, e);
    }
  }

  if (!shouldAbort() && streamProtocolError) {
    throw makeStreamError(`模型流返回错误：${streamProtocolError}${requestId ? `\nRequest ID：${requestId}` : ''}`);
  }

  if (!shouldAbort() && !sawDoneMarker && !sawFinishReason) {
    const elapsedMs = Date.now() - streamStartedAt;
    const detail = [
      '模型连接提前关闭，未收到 finish_reason 或 [DONE]，响应在协议层不完整。',
      `已持续 ${elapsedMs} ms，收到 ${receivedBytes} 字节 / ${receivedChunks} 个网络分块 / ${sseEventCount} 个 SSE 事件。`,
      malformedEventCount ? `其中 ${malformedEventCount} 个 SSE 事件无法解析。` : '',
      firstByteAt ? `首包耗时 ${firstByteAt - streamStartedAt} ms。` : '未收到任何响应正文。',
      requestId ? `Request ID：${requestId}。` : '',
      '请检查 Base URL、模型 ID、中转站兼容性或上游连接日志。'
    ].filter(Boolean).join('\n');
    throw makeStreamError(detail);
  }

  // Normalize provider aliases before the agent loop interprets terminal state.
  // `max_tokens` is truncation, never successful completion.
  if (finishReason === 'max_tokens') finishReason = 'length';

  // Tolerate non-standard normal stops from relay/domestic providers. Explicit
  // filter/error/cancel signals always fail, even when a partial text prefix exists.
  const KNOWN_STOP_REASONS = new Set(['stop', 'tool_calls', 'function_call', 'length', 'eos', 'end_turn', 'end']);
  const HARD_FAIL_REASONS = new Set(['content_filter', 'content_filter_stop', 'refusal', 'error', 'cancelled', 'canceled']);
  if (!shouldAbort() && HARD_FAIL_REASONS.has(finishReason)) {
    throw makeStreamError('模型响应被服务端终止：finish_reason=' + finishReason + '。部分输出不代表任务完成。' + (requestId ? '\nRequest ID：' + requestId : ''));
  }
  if (!shouldAbort() && finishReason && !KNOWN_STOP_REASONS.has(finishReason)) {
    if (rawContent.trim() === '' && toolCalls.length === 0) {
      throw makeStreamError('模型响应异常结束：finish_reason=' + finishReason + '。响应可能被截断、过滤或达到输出上限，任务没有正常完成。' + (requestId ? '\nRequest ID：' + requestId : ''));
    }
    // Unknown but non-empty response — treat as stop and continue.
  }

  if (!shouldAbort() && finishReason === 'tool_calls' && !toolCalls.some(call => call?.function?.name)) {
    throw makeStreamError(`模型声明了工具调用，但流中没有收到可执行的 tool_calls。${requestId ? `\nRequest ID：${requestId}` : ''}`);
  }

  const parsedContent = parseDsmlToolCalls(rawContent, tools, runCtx);
  const parsedReasoning = parseDsmlToolCalls(rawReasoning, tools, runCtx);
  if ((parsedContent.detected || parsedReasoning.detected)
      && parsedContent.tool_calls.length + parsedReasoning.tool_calls.length === 0
      && !shouldAbort()) {
    throw makeStreamError('模型返回了 DSML 工具调用文本，但 Yan Agent 无法解析其中的工具名称或参数。请检查模型工具调用兼容性。');
  }
  content = parsedContent.content;
  reasoning = parsedReasoning.content;
  const dsmlToolCalls = [...parsedContent.tool_calls, ...parsedReasoning.tool_calls];
  for (const call of dsmlToolCalls) {
    const fingerprint = `${call.function.name}:${call.function.arguments}`;
    const duplicate = toolCalls.some(existing => (
      `${existing?.function?.name}:${existing?.function?.arguments}` === fingerprint
    ));
    if (!duplicate) toolCalls.push(call);
  }
  if (parsedContent.detected || parsedReasoning.detected) {
    runCtx.streamingContent = content;
    runCtx.streamingReasoning = reasoning;
    runCtx.partialContent = [previousContent, content].filter(Boolean).join('\n\n');
  }

  const bodyEl = getBodyEl();
  if (shouldAbort() && bodyEl) {
    deps().hooks.onRunAborted?.(runCtx);
  }

  const currentThinkEl = bodyEl?.querySelector('.thinking-block.streaming');
  if (currentThinkEl?.open) {
    currentThinkEl.open = false;
    const sum = currentThinkEl.querySelector('summary');
    if (sum) sum.innerHTML = '<span class="think-icon" aria-hidden="true"></span>思考过程';
  }
  currentThinkEl?.classList.remove('streaming');
  const currentRoundEl = bodyEl && Array.from(bodyEl.children)
    .find(el => el.classList?.contains('msg-round') && el.classList.contains('streaming'));
  if (currentRoundEl && parsedContent.detected) {
    if (content) currentRoundEl.innerHTML = deps().hooks.renderMarkdown(content);
    else currentRoundEl.remove();
  }
  currentRoundEl?.classList.remove('streaming');

  const filteredToolCalls = toolCalls.filter(tc => tc.function.name);
  diagnostic.status = shouldAbort() ? 'aborted' : 'complete';
  diagnostic.finishReason = finishReason || (sawDoneMarker ? 'done_marker' : '');
  diagnostic.responseBytes = receivedBytes;
  diagnostic.sseEventCount = sseEventCount;
  logRequestDiagnostic(runCtx, diagnostic);
  return {
    content: content || '',
    reasoning_content: reasoning || undefined,
    tool_calls: filteredToolCalls.length > 0 ? filteredToolCalls : null,
    finish_reason: finishReason || ''
  };
}

  K.applyProviderOptions = applyProviderOptions;
  K.extractReasoningText = extractReasoningText;
  K.normalizeApiMessages = normalizeApiMessages;

  // Clip tool results inside a replayed historical trace. These runs are already
  // finished — the model needs the shape of what happened (which tools, ok/fail,
  // key output), not the full 12k-char payloads. 1500 chars keeps error messages
  // and file heads while cutting replay cost by ~8x.
  K.REPLAY_TOOL_RESULT_CLIP = 1500;
  K.clipReplayedTrace = function (trace) {
    if (!Array.isArray(trace)) return trace;
    const max = Number(K.REPLAY_TOOL_RESULT_CLIP) || 1500;
    return trace.map(msg => {
      if (msg?.role !== 'tool' || typeof msg.content !== 'string') return msg;
      if (msg.content.length <= max) return msg;
      return { ...msg, content: msg.content.slice(0, max) + `\n...(replay clipped, ${msg.content.length - max} chars omitted)` };
    });
  };
  K.parseDsmlToolCalls = parseDsmlToolCalls;
  K.stripDsmlForDisplay = stripDsmlForDisplay;
  K.stripDsmlToolBlocks = stripDsmlToolBlocks;
  K.callApiStream = callApiStream;
})(window.YanKernel);

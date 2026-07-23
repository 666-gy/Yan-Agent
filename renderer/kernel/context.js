/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
// --- Context compression ---
// 当对话历史超过 token 阈值时，压缩早期消息为摘要
// Character-class-aware token estimate. A flat chars*1.8 factor badly UNDER-counts
// CJK text (~1 token per Han char vs ~4 chars per token for English), which let real
// token usage silently blow past the model window before compression ever triggered.
// We estimate CJK chars at ~1 token each and Latin/whitespace at ~0.28 token each.
function estimateTextTokens(value) {
  const s = typeof value === 'string' ? value : (value == null ? '' : valueStringify(value));
  if (!s) return 0;
  let cjk = 0;
  // CJK Unified + ext A, Hiragana/Katakana, Hangul, CJK symbols/punctuation, fullwidth forms.
  const m = s.match(/[\u3000-\u303f\u3040-\u30ff\u3400-\u4dbf\u4e00-\u9fff\uac00-\ud7af\uff00-\uffef]/g);
  if (m) cjk = m.length;
  const other = s.length - cjk;
  return Math.ceil(cjk * 1.0 + other * 0.28);
}

function valueStringify(value) {
  if (value == null) return '';
  try { return JSON.stringify(value); } catch { return String(value); }
}

function estimateTokens(messages) {
  let tokens = 0;
  for (const m of messages || []) {
    const trace = m.agentRun?.apiTrace;
    if (Array.isArray(trace) && trace.length) {
      for (const tm of trace) {
        tokens += estimateTextTokens(tm.content);
        tokens += estimateTextTokens(tm.reasoning_content);
        tokens += estimateTextTokens(tm.tool_calls);
      }
    } else {
      tokens += estimateTextTokens(m.content);
      tokens += estimateTextTokens(m.reasoning_content);
      tokens += estimateTextTokens(m.tool_calls);
    }
    const skillCalls = Array.isArray(m.skillCalls) ? m.skillCalls : (m.skillCall?.id ? [m.skillCall] : []);
    for (const skill of skillCalls) tokens += estimateTextTokens(skill?.prompt);
    if (Array.isArray(m.attachments)) {
      for (const a of m.attachments) {
        tokens += estimateTextTokens(a.name || '') + (K.isImageAttachment?.(a) ? 1200 : 24);
      }
    }
  }
  return tokens;
}

function valueCharLength(value) {
  if (typeof value === 'string') return value.length;
  if (value == null) return 0;
  try { return JSON.stringify(value).length; } catch { return String(value).length; }
}

// 多模态 content（string 或 content parts 数组）转成纯文本摘要
function contentToText(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content.map(part => {
      if (typeof part === 'string') return part;
      if (!part || typeof part !== 'object') return '';
      if (part.type === 'text') return String(part.text || '');
      if (part.type === 'image_url') return '[图片]';
      return '';
    }).filter(Boolean).join(' ');
  }
  return '';
}

function clipTraceForStorage(trace) {
  return (trace || []).map(tm => {
    if (tm.role === 'tool') return { ...tm, content: K.clipToolText(tm.content, 8000) };
    if (tm.role === 'assistant' && tm.content) return { ...tm, content: K.clipToolText(tm.content, 4000) };
    return tm;
  });
}

async function compressContextIfNeeded(messages, runCtx) {
  const beforeTokens = estimateTokens(messages);
  // Prefer the model-window-derived hard threshold; fall back to the global constant.
  const hardThreshold = Number(
    runCtx?.runBudget?.compressHardThreshold
    || K.CONTEXT_TOKEN_COMPRESS_THRESHOLD
    || K.CONTEXT_TOKEN_THRESHOLD
  );
  // Soft threshold: compress earlier on long runs so harness state stays sharp.
  const softThreshold = Number(
    runCtx?.runBudget?.compressSoftThreshold
    || K.CONTEXT_TOKEN_COMPRESS_SOFT
    || hardThreshold
  );
  if (beforeTokens <= softThreshold) {
    return { messages, compressed: false, tokens: beforeTokens };
  }

  // Reserve enough headroom for the system prompt, tool schemas, and the next run.
  // Selecting by token budget handles short conversations with enormous tool traces.
  const keepBudget = Math.max(1, Math.floor(Math.min(softThreshold, hardThreshold) * 0.68));
  let keptTokens = 0;
  let splitIdx = messages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    const messageTokens = estimateTokens([messages[index]]);
    if (index !== messages.length - 1 && keptTokens + messageTokens > keepBudget) break;
    keptTokens += messageTokens;
    splitIdx = index;
  }

  // Never retain orphaned tool results without their assistant tool call.
  while (splitIdx > 0 && messages[splitIdx]?.role === 'tool') splitIdx--;
  if (splitIdx <= 0) {
    const compacted = compactMessagesToBudget(messages, keepBudget);
    const afterTokens = estimateTokens(compacted.messages);
    if (compacted.changed && afterTokens < beforeTokens) {
      return {
        messages: compacted.messages,
        compressed: true,
        beforeTokens,
        afterTokens,
        compressedMessageCount: 0,
        strippedTraceCount: compacted.strippedTraceCount,
        clippedToolResultCount: compacted.clippedToolResultCount
      };
    }
    return { messages, compressed: false, tokens: beforeTokens, reason: 'latest_message_exceeds_budget' };
  }

  const toCompress = messages.slice(0, splitIdx);
  const compactedKeep = compactMessagesToBudget(messages.slice(splitIdx), keepBudget);
  const toKeep = compactedKeep.messages;
  const source = buildCompressionSource(toCompress);
  const localSummary = buildLocalSummary(toCompress);

  // Prefer harness-backed summary when run state is available (M3 long-run).
  const harnessHint = runCtx && K.buildTaskStatePrompt
    ? `\n\n当前 harness 权威状态（摘要中必须保留 outcome/todos/路径）：\n${K.buildTaskStatePrompt(runCtx)}`
    : '';
  const compressPrompt = `你是上下文压缩器。将以下对话历史压缩为结构化摘要，供同一个 agent 在后续轮次中继续工作。摘要是它对早期对话的唯一记忆，宁可多保留具体细节，不要泛泛概括。

严格按以下模板输出（无内容的小节写"无"）：

## 任务意图
用户的原始目标与关键需求，包括后续追加或修正的要求。

## 已完成的工作
每项一行：做了什么 + 涉及文件的完整路径。已验证的写"[已验证]"，未验证的写"[未验证]"。

## 关键认知
继续工作必须知道的事实：项目结构、技术栈、代码约定、重要函数/配置的位置、调试中确认的因果关系。宁具体勿抽象（写"config.js 的 retry 逻辑在 fetchWithRetry()，指数退避上限 5s"，不写"了解了重试机制"）。

## 出错与教训
走过的弯路、失败的尝试及原因——防止重蹈覆辙。

## 用户偏好与约束
明确表达过的偏好、禁止事项、验收口径。

## 当前状态与下一步
未完成的 todos、验收标准的通过情况、接下来该做什么。

规则：
- 文件路径、命令、函数名、错误信息必须原样保留，不得改写或省略路径层级。
- 关键的短代码片段/报错原文可直接引用。
- 不得编造摘要源里没有的信息；不确定的写"(未确认)"。
- 删除的只有：冗长的工具原始输出、重复的中间过程、与任务无关的寒暄。
${harnessHint}`;

  const compressMessages = [
    { role: 'system', content: compressPrompt },
    { role: 'user', content: source }
  ];

  let summary = localSummary;
  let timeoutId = null;
  try {
    const apiConfig = deps().getConfig().api || {};
    const { baseUrl, apiKey, model } = apiConfig;
    if (!baseUrl || !apiKey || !model || !source) throw new Error('compression_api_unavailable');
    const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;
    const controller = typeof AbortController === 'function' ? new AbortController() : null;
    if (controller) timeoutId = setTimeout(() => controller.abort(), 15000);
    const reqBody = { model, messages: compressMessages, stream: false };
    // 思考型模型（如 kimi-k2.7-code、deepseek-r1）的网关会拒绝不带 thinking 字段的请求。
    // 不带 provider 选项时压缩永远会失败回退到本地摘要，违背"真正成功压缩"的目标。
    if (K.applyProviderOptions) K.applyProviderOptions(reqBody, apiConfig);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(reqBody),
      signal: controller?.signal
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => '');
      throw new Error(`compression_http_${res.status}: ${String(detail).slice(0, 300)}`);
    }
    const data = await res.json();
    const remoteSummary = String(data.choices?.[0]?.message?.content || '').trim();
    if (!remoteSummary) throw new Error('compression_empty_summary');
    summary = remoteSummary.slice(0, 20000);
  } catch (error) {
    // 仍 fallback 到本地摘要，但记录原因供诊断
    if (K.describeRunError) {
      try { api().yanagentLog?.(`context compression failed: ${error?.message || error}`); } catch {}
    }
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }

  const merged = [
    {
      role: 'system',
      content: `## Previous Context (已压缩的早期对话摘要 — 这是你对更早对话的唯一记忆，其中的路径与结论可直接信任)\n${summary || '早期对话已压缩，冗长的工具调用与输出已移除。'}`
    },
    ...buildCompactionAnchors(messages, runCtx),
    ...toKeep
  ];
  return {
    messages: merged,
    compressed: true,
    beforeTokens,
    afterTokens: estimateTokens(merged),
    compressedMessageCount: toCompress.length,
    strippedTraceCount: compactedKeep.strippedTraceCount,
    clippedToolResultCount: compactedKeep.clippedToolResultCount
  };
}

function compactMessagesToBudget(messages, budget) {
  const compacted = [...messages];
  let tokens = estimateTokens(compacted);
  let strippedTraceCount = 0;
  for (let index = 0; index < compacted.length && tokens > budget; index++) {
    const message = compacted[index];
    if (!message?.agentRun?.apiTrace?.length) continue;
    compacted[index] = {
      ...message,
      agentRun: { ...message.agentRun, apiTrace: [] }
    };
    strippedTraceCount++;
    tokens = estimateTokens(compacted);
  }

  let clippedToolResultCount = 0;
  for (const maxChars of [4000, 1000]) {
    for (let index = 0; index < compacted.length && tokens > budget; index++) {
      const message = compacted[index];
      if (message?.role !== 'tool' || valueCharLength(message.content) <= maxChars) continue;
      compacted[index] = { ...message, content: K.clipToolText(message.content, maxChars) };
      clippedToolResultCount++;
      tokens = estimateTokens(compacted);
    }
  }
  return {
    messages: compacted,
    changed: strippedTraceCount > 0 || clippedToolResultCount > 0,
    strippedTraceCount,
    clippedToolResultCount
  };
}

function renderCompressionChunk(message, maxContentChars = 6000) {
  const m = message || {};
  const details = [];
  const content = contentToText(m.content);
  if (content) details.push(content.slice(0, maxContentChars));
  const skillCalls = Array.isArray(m.skillCalls) ? m.skillCalls : (m.skillCall?.id ? [m.skillCall] : []);
  if (skillCalls.length) {
    details.push('Selected Skills: ' + skillCalls
      .filter(skill => skill?.id)
      .map(skill => `${String(skill.name || skill.id)} (${String(skill.id)})`)
      .join(', '));
  }
  const run = m.agentRun;
  if (run?.outcome) details.push(`Outcome: ${String(run.outcome).slice(0, 1000)}`);
  if (Array.isArray(run?.acceptanceCriteria)) {
    details.push('Acceptance: ' + run.acceptanceCriteria.slice(0, 12)
      .map(c => `[${c.status || 'pending'}] ${c.text}${c.evidence ? ` (${String(c.evidence).slice(0, 300)})` : ''}`)
      .join('; '));
  }
  const toolNames = collectTraceToolNames(run?.apiTrace);
  if (toolNames.length) details.push(`Tools used: ${toolNames.join(', ')}`);
  return `[${m.role || 'unknown'}]\n${details.join('\n') || '(no visible text)'}`;
}

function buildCompactionAnchors(messages, runCtx, maxChars = 24000) {
  const anchors = [];
  const seen = new Set();
  const add = (label, value, limit) => {
    const text = String(value || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    anchors.push(`${label}:\n${text.slice(0, limit)}`);
  };

  add('Original task for this run (verbatim)', runCtx?.originalUserGoal, 12000);
  const realUsers = (messages || []).filter(message => (
    message?.role === 'user'
    && !message?._harnessState
    && !message?._kernelInstruction
    && !message?._compactionAnchor
    && !/^## (?:Harness re-anchor|Compaction anchors)/.test(contentToText(message.content).trim())
  ));
  if (!runCtx?.originalUserGoal) {
    add('First user request retained verbatim', contentToText(realUsers[0]?.content), 12000);
  }
  for (const message of realUsers.slice(-4)) {
    add('Recent user correction/request retained verbatim', contentToText(message.content), 4000);
  }
  if (!anchors.length) return [];
  return [{
    role: 'user',
    _compactionAnchor: true,
    content: `## Compaction anchors (authoritative, retained verbatim)\n${anchors.join('\n\n').slice(0, maxChars)}`
  }];
}

function buildCompressionSource(messages, maxChars = 60000) {
  const chunks = [];
  const included = new Set();
  let used = 0;

  // Reserve part of the source budget for the beginning of the task. The old
  // tail-only strategy could summarize 1M tokens while never showing the
  // summarizer the original goal or its constraints.
  const headBudget = Math.min(16000, Math.floor(maxChars * 0.28));
  const firstUserIndex = (messages || []).findIndex(message => message?.role === 'user');
  for (const index of [0, firstUserIndex]) {
    if (index < 0 || included.has(index) || used >= headBudget) continue;
    let chunk = renderCompressionChunk(messages[index], Math.max(1000, headBudget - used));
    if (chunk.length > headBudget - used) chunk = chunk.slice(0, headBudget - used);
    chunks.push(chunk);
    included.add(index);
    used += chunk.length + 2;
  }

  const tail = [];
  for (let index = messages.length - 1; index >= 0 && used < maxChars; index--) {
    if (included.has(index)) continue;
    let chunk = renderCompressionChunk(messages[index]);
    const remaining = maxChars - used;
    if (chunk.length > remaining) chunk = chunk.slice(0, remaining);
    tail.unshift(chunk);
    used += chunk.length + 2;
  }
  return [...chunks, ...tail].join('\n\n');
}

function buildLocalSummary(messages) {
  const source = buildCompressionSource(messages, 12000);
  return source
    ? `以下为本地生成的早期上下文摘要（原始工具输出已移除）：\n${source}`
    : '早期对话已压缩，冗长的工具调用与输出已移除。';
}

function collectTraceToolNames(trace) {
  const names = [];
  const seen = new Set();
  for (const tm of trace || []) {
    for (const call of tm?.tool_calls || []) {
      const name = String(call?.function?.name || '').trim();
      if (name && !seen.has(name)) {
        seen.add(name);
        names.push(name);
      }
      if (names.length >= 20) return names;
    }
  }
  return names;
}

// --- Memory extraction ---
// 任务完成后从对话中提取关键事实存入长期记忆
async function extractMemoryFacts(messages) {
  const apiConfig = deps().getConfig().api;
  const { baseUrl, apiKey, model } = apiConfig;
  if (!apiKey) return []; // 无 Key 时不发起额外请求
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const extractPrompt = `请从以下对话中提取值得长期记住的关键事实（用户偏好、项目约定、重要决策、技术栈选择等）。
只提取跨会话有用的事实，不要提取具体任务细节。
每条事实一行，格式为简洁陈述句。如果没有值得提取的内容，回复"无"。`;

  // 只看最近 12 条消息，避免 token 过多
  const recentMsgs = messages.slice(-12);

  // Skip extraction if there's nothing substantive to extract.
  const userMessages = recentMsgs.filter(m => m.role === 'user');
  if (!userMessages.length) return [];

  const extractController = typeof AbortController === 'function' ? new AbortController() : null;
  const extractTimeout = extractController ? setTimeout(() => extractController.abort(), 10000) : null;
  try {
    const extractMessages = [
      { role: 'system', content: extractPrompt },
      { role: 'user', content: recentMsgs.map(m => `[${m.role}]: ${contentToText(m.content).slice(0, 500)}`).join('\n\n') }
    ];
    const reqBody = { model, messages: extractMessages, stream: false };
    if (K.applyProviderOptions) K.applyProviderOptions(reqBody, apiConfig);
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify(reqBody),
      signal: extractController?.signal
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content || content.trim() === '无') return [];

    // 按行分割为事实列表
    return content.split('\n')
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(line => line.length > 3 && line.length < 200);
  } catch (e) {
    return [];
  } finally {
    if (extractTimeout) clearTimeout(extractTimeout);
  }
}

  K.estimateTokens = estimateTokens;
  K.clipTraceForStorage = clipTraceForStorage;
  K.compressContextIfNeeded = compressContextIfNeeded;
  K.buildCompressionSource = buildCompressionSource;
  K.buildCompactionAnchors = buildCompactionAnchors;
  K.extractMemoryFacts = extractMemoryFacts;

})(window.YanKernel);

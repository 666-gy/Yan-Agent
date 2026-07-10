/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
// --- Context compression ---
// 当对话历史超过 token 阈值时，压缩早期消息为摘要
function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    chars += (m.content || '').length;
  }
  return Math.ceil(chars * 1.8);
}

function clipTraceForStorage(trace) {
  return (trace || []).map(tm => {
    if (tm.role === 'tool') return { ...tm, content: K.clipToolText(tm.content, 8000) };
    if (tm.role === 'assistant' && tm.content) return { ...tm, content: K.clipToolText(tm.content, 4000) };
    return tm;
  });
}

async function compressContextIfNeeded(messages) {
  const estTokens = estimateTokens(messages);
  if (estTokens <= K.CONTEXT_TOKEN_THRESHOLD) {
    return messages;
  }

  let splitIdx = messages.length - K.CONTEXT_KEEP_RECENT;
  if (splitIdx <= 2) return messages;

  while (splitIdx < messages.length && messages[splitIdx]?.role === 'tool') {
    splitIdx++;
  }
  if (splitIdx >= messages.length) return messages;

  const toCompress = messages.slice(0, splitIdx);
  const toKeep = messages.slice(splitIdx);

  // 保留含 apiTrace 的 assistant 消息（工具调用链），只压缩普通文本
  const traceKeepers = [];
  const toSummarize = [];
  for (const m of toCompress) {
    if (m.role === 'assistant' && m.agentRun?.apiTrace?.length) {
      traceKeepers.push({
        role: 'assistant',
        content: m.content || '',
        agentRun: {
          status: m.agentRun.status,
          iteration: m.agentRun.iteration,
          toolCallCount: m.agentRun.toolCallCount,
          todos: m.agentRun.todos,
          todosFromTool: m.agentRun.todosFromTool,
          timeline: m.agentRun.timeline,
          apiTrace: clipTraceForStorage(m.agentRun.apiTrace)
        }
      });
    } else {
      toSummarize.push(m);
    }
  }

  if (!toSummarize.length) {
    return [...traceKeepers, ...toKeep];
  }

  const { baseUrl, apiKey, model } = deps().getConfig().api;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const compressPrompt = `请将以下对话历史压缩为简洁的上下文摘要。保留：
1. 用户的任务意图和关键需求
2. 已完成的操作和创建/修改的文件
3. 遇到的问题和解决方案
4. 任何用户偏好或约束

删除冗余的工具输出细节，只保留关键信息。输出为简洁的要点列表。`;

  const compressMessages = [
    { role: 'system', content: compressPrompt },
    { role: 'user', content: toSummarize.map(m => `[${m.role}]: ${m.content}`).join('\n\n') }
  ];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages: compressMessages, stream: false })
    });
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content || '';

    return [
      { role: 'system', content: `## Previous Context (已压缩的早期对话摘要)\n${summary}` },
      ...traceKeepers,
      ...toKeep
    ];
  } catch (e) {
    return [
      ...traceKeepers,
      ...toSummarize.map(m => {
        if ((m.content || '').length > 4000) {
          return { ...m, content: m.content.slice(0, 2000) + '\n...(已截断)...' };
        }
        return m;
      }),
      ...toKeep
    ];
  }
}

// --- Memory extraction ---
// 任务完成后从对话中提取关键事实存入长期记忆
async function extractMemoryFacts(messages) {
  const { baseUrl, apiKey, model } = deps().getConfig().api;
  if (!apiKey) return []; // 无 Key 时不发起额外请求
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const extractPrompt = `请从以下对话中提取值得长期记住的关键事实（用户偏好、项目约定、重要决策、技术栈选择等）。
只提取跨会话有用的事实，不要提取具体任务细节。
每条事实一行，格式为简洁陈述句。如果没有值得提取的内容，回复"无"。`;

  // 只看最近 12 条消息，避免 token 过多
  const recentMsgs = messages.slice(-12);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: extractPrompt },
          { role: 'user', content: recentMsgs.map(m => `[${m.role}]: ${(m.content || '').slice(0, 500)}`).join('\n\n') }
        ],
        stream: false
      })
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
  }
}

  K.estimateTokens = estimateTokens;
  K.clipTraceForStorage = clipTraceForStorage;
  K.compressContextIfNeeded = compressContextIfNeeded;
  K.extractMemoryFacts = extractMemoryFacts;

})(window.YanKernel);

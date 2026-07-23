/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
function createRunCtx(sessionId, ui = true, workspace) {
  const runCtx = {
    sessionId,
    workspace: workspace === undefined ? undefined : String(workspace || ''),
    runId: 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fileChangeCount: 0,
    ui,
    startedInForeground: !!ui,
    shouldAbort: false,
    abortController: null,
    partialContent: '',
    streamingContent: '',
    streamingReasoning: '',
    toolCallSeq: 0,
    toolCallResults: new Map(),
    builtinBrowserOpened: false,
    builtinBrowserUrl: '',
    builtinWebPageOpened: false,
    builtinWebPageUrl: '',
    agentState: {
      todos: [], todosFromTool: false,
      outcome: '', acceptanceCriteria: [], outcomeFromTool: false,
      iteration: 0, toolCallCount: 0, status: 'idle'
    },
    activeAgentRun: null,
    mcpToolMapSnapshot: null,
    capabilityIndex: new Map(),
    discoveredCapabilityIds: new Set(),
    capabilityPlan: null,
    workMode: 'normal',
    planExecutionApproved: false,
    planOnly: false,
    accessMode: 'request',
    workspaceRequestDenied: false,
    originalUserGoal: '',
    exposedToolNames: null,
    runBudget: null,
    maxLoopIterations: null,
    contextCompressionCount: 0,
    unresolvedToolErrors: new Map(),
    toolFailureStreak: null,
    requestDiagnostics: [],
    // gate 死循环防护：连续被完成门拒绝的次数。模型本轮调过工具则重置，避免误杀努力修正的模型。
    gateBlockedAttempts: 0,
    policyState: K.createPolicyState ? K.createPolicyState() : { readPaths: new Set() },
    // M1/M2 harness
    phase: 'plan',
    evidenceLedger: new Map(),
    progress: null
  };
  if (K.initRunProgress) K.initRunProgress(runCtx);
  return runCtx;
}

function describeRunError(error, options = {}) {
  const source = error?.message || error || '未知错误';
  const raw = String(source)
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(line => line.replace(/[\t ]+/g, ' ').trim())
    .filter(Boolean)
    .join('\n') || '未知错误';
  const clipped = raw.length > 1600 ? `${raw.slice(0, 1600)}...` : raw;
  const kind = String(options.kind || '').toLowerCase();
  let summary = '';

  if (kind === 'mcp' || /\bmcp\b|服务器未运行|tools\/call|connection closed/i.test(raw)) {
    const mcpHttpStatus = raw.match(/(?:HTTP(?:\s+status)?|status(?:\s+code)?)[\s:=_-]*(\d{3})/i)?.[1];
    summary = mcpHttpStatus
      ? `MCP 连接失败（HTTP ${mcpHttpStatus}）：服务或依赖源暂时不可用，也可能受到当前网络/VPN/代理限制。`
      : 'MCP 连接失败：服务可能未启动、连接超时，或当前网络/VPN/代理限制了连接。';
  } else {
    const httpStatus = raw.match(/(?:HTTP(?:\s+status)?|status(?:\s+code)?)[\s:=_-]*(\d{3})/i)?.[1];
    if (httpStatus === '401') summary = 'HTTP 401：API Key 无效或已失效，请检查当前模型配置。';
    else if (httpStatus === '403') summary = 'HTTP 403：请求被服务端拒绝，可能是账号权限、地区或网络出口受限。';
    else if (httpStatus === '429') summary = 'HTTP 429：请求过于频繁或额度已用尽，请稍后重试并检查账户额度。';
    else if (httpStatus === '400' && /max_tokens|max_completion_tokens|valid range/i.test(raw)) {
      summary = 'HTTP 400：max_tokens 超出当前厂商允许范围（例如 DeepSeek 上限为 393216）。内核会按厂商上限自动钳制；若仍报错请重启客户端后再试。';
    }
    else if (httpStatus === '400') summary = 'HTTP 400：请求参数被接口拒绝，请检查模型 ID、max_tokens 与请求体是否符合当前厂商规范。';
    else if (httpStatus === '502') summary = 'HTTP 502：接口未能处理本次请求，可能是请求结构不兼容或上游响应无效；任务已按错误停止。';
    else if (httpStatus === '503') summary = 'HTTP 503：模型或中转服务暂时不可用，请稍后重试或检查 Base URL。';
    else if (httpStatus && /^5\d\d$/.test(httpStatus)) summary = `HTTP ${httpStatus}：模型或中转服务发生服务端错误。`;
    else if (/failed to fetch|fetch failed|econnreset|econnrefused|enotfound|etimedout|network\s*error|socket hang up|dns/i.test(raw)) {
      summary = '网络连接失败：可能存在网络受限、VPN/代理未开启、DNS 异常或服务不可达。';
    }
  }

  if (!summary || clipped.startsWith(summary)) return clipped;
  return `${summary}\n\n原始错误：${clipped}`;
}

function startAgentRun(runCtx) {
  const run = { timeline: [], apiTrace: [], provider: '', model: '' };
  if (runCtx) runCtx.activeAgentRun = run;
  return run;
}

function getActiveRun(runCtx) {
  return runCtx?.activeAgentRun || null;
}

function recordTimelineEvent(entry, runCtx) {
  const run = getActiveRun(runCtx);
  if (!run) return;
  run.timeline.push({ ...entry, ts: Date.now() });
}

function recordApiTraceMessage(message, runCtx) {
  const run = getActiveRun(runCtx);
  if (!run || !message) return;
  let copy;
  try { copy = JSON.parse(JSON.stringify(message)); } catch { copy = { ...message }; }
  run.apiTrace.push(copy);
}

function clipApiTrace(trace) {
  return trace.map(m => {
    if (m.role === 'tool') {
      return { ...m, content: K.clipToolText(m.content, 8000) };
    }
    if (m.role === 'assistant' && m.content) {
      return { ...m, content: K.clipToolText(m.content, 4000) };
    }
    return m;
  });
}

function finalizeAgentRun(content, status, run, bodyEl, apiMessages, runCtx) {
  const as = runCtx?.agentState || deps().getCurrentAgentState();
  let timeline = run?.timeline?.length
    ? run.timeline
    : (bodyEl ? deps().hooks.collectTimelineFromDom(bodyEl) : []);
  if (runCtx?.streamingReasoning) {
    timeline = [...timeline, { type: 'thinking', content: runCtx.streamingReasoning }];
  }
  if (runCtx?.streamingContent) {
    timeline = [...timeline, { type: 'text', content: runCtx.streamingContent }];
  }
  let apiTrace = [];
  if (Array.isArray(run?.apiTrace)) {
    apiTrace = clipApiTrace(run.apiTrace);
  } else if (apiMessages && run?.runStartIndex != null) {
    // Compatibility for runs started by an older renderer during a hot reload.
    apiTrace = clipApiTrace(apiMessages.slice(run.runStartIndex));
  }
  const agentRun = {
    status,
    runId: runCtx?.runId,
    provider: run?.provider || '',
    model: run?.model || '',
    workMode: runCtx?.workMode || 'normal',
    planOnly: !!runCtx?.planOnly,
    changeCount: runCtx?.fileChangeCount || 0,
    rolledBack: false,
    iteration: as.iteration,
    toolCallCount: as.toolCallCount,
    todos: as.todos.map(t => ({ text: t.text, done: t.done, inProgress: t.inProgress })),
    todosFromTool: as.todosFromTool,
    outcome: as.outcome || '',
    acceptanceCriteria: (as.acceptanceCriteria || []).map(c => ({
      text: c.text,
      status: c.status,
      evidence: c.evidence || ''
    })),
    outcomeFromTool: !!as.outcomeFromTool,
    timeline,
    apiTrace
  };
  if (runCtx?.requestDiagnostics?.length) {
    agentRun.requestDiagnostics = runCtx.requestDiagnostics.slice(-30).map(item => ({ ...item }));
  }
  return agentRun;
}

function makeLoopResult(content, status, apiMessages, runCtx, errorMessage) {
  if (runCtx && status && status !== 'working') {
    runCtx.finalStatus = status;
    if (runCtx.agentState) {
      runCtx.agentState.status = status === 'interrupted' ? 'interrupted' : status;
    }
  }
  const run = getActiveRun(runCtx);
  const agentRun = finalizeAgentRun(content, status, run, null, apiMessages, runCtx);
  if (status === 'error' && errorMessage) agentRun.error = String(errorMessage);
  if (runCtx) runCtx.activeAgentRun = null;
  return { content, agentRun };
}

  K.createRunCtx = createRunCtx;
  K.describeRunError = describeRunError;
  K.startAgentRun = startAgentRun;
  K.getActiveRun = getActiveRun;
  K.recordTimelineEvent = recordTimelineEvent;
  K.recordApiTraceMessage = recordApiTraceMessage;
  K.clipApiTrace = clipApiTrace;
  K.finalizeAgentRun = finalizeAgentRun;
  K.makeLoopResult = makeLoopResult;

})(window.YanKernel);

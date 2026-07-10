/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
function createRunCtx(sessionId, ui = true) {
  return {
    sessionId,
    runId: 'run_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    fileChangeCount: 0,
    ui,
    shouldAbort: false,
    abortController: null,
    agentState: { todos: [], todosFromTool: false, iteration: 0, toolCallCount: 0, status: 'idle' },
    activeAgentRun: null,
    mcpToolMapSnapshot: null,
    policyState: K.createPolicyState ? K.createPolicyState() : { readPaths: new Set() }
  };
}

function startAgentRun(runCtx) {
  const run = { timeline: [], runStartIndex: 0 };
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
  const timeline = run?.timeline?.length
    ? run.timeline
    : (bodyEl ? deps().hooks.collectTimelineFromDom(bodyEl) : []);
  let apiTrace = [];
  if (apiMessages && run?.runStartIndex != null) {
    apiTrace = clipApiTrace(apiMessages.slice(run.runStartIndex));
  }
  return {
    status,
    runId: runCtx?.runId,
    changeCount: runCtx?.fileChangeCount || 0,
    rolledBack: false,
    iteration: as.iteration,
    toolCallCount: as.toolCallCount,
    todos: as.todos.map(t => ({ text: t.text, done: t.done, inProgress: t.inProgress })),
    todosFromTool: as.todosFromTool,
    timeline,
    apiTrace
  };
}

function makeLoopResult(content, status, apiMessages, runCtx) {
  const run = getActiveRun(runCtx);
  const agentRun = finalizeAgentRun(content, status, run, null, apiMessages, runCtx);
  if (runCtx) runCtx.activeAgentRun = null;
  return { content, agentRun };
}

  K.createRunCtx = createRunCtx;
  K.startAgentRun = startAgentRun;
  K.getActiveRun = getActiveRun;
  K.recordTimelineEvent = recordTimelineEvent;
  K.clipApiTrace = clipApiTrace;
  K.finalizeAgentRun = finalizeAgentRun;
  K.makeLoopResult = makeLoopResult;

})(window.YanKernel);

/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

async function runAgentLoop(sessionMessages, assistantEl, runCtx) {
  if (!runCtx) runCtx = K.createRunCtx(deps().getCurrentSession()?.id, true);
  const as = runCtx.agentState;
  const shouldAbort = () => !!runCtx.shouldAbort;
  const ui = runCtx.ui && assistantEl;
  const cfg = deps().getConfig();
  const perm = await api().getPermissions();

  if (!perm.allowNetwork) {
    return K.makeLoopResult(`⚠️ **网络权限已关闭**，无法调用 AI 接口。\n\n请在「设置 → 权限」中开启「允许网络访问」。`, 'error', null, runCtx);
  }
  if (!cfg.api?.apiKey) {
    return K.makeLoopResult(`⚠️ **未配置 API Key**\n\n请在「设置 → API 配置」中填入你的 DeepSeek API Key。`, 'error', null, runCtx);
  }

  const systemPrompt = await K.buildSystemPrompt();
  await K.refreshMcpTools();
  const toolsForRun = K.snapshotTools();
  runCtx.mcpToolMapSnapshot = new Map(K.getMcpToolMap());

  let memoryContext = '';
  try {
    const mem = await api().getMemory();
    if (mem.facts && mem.facts.length > 0) {
      memoryContext = '\n\n## Long-term Memory (跨会话记忆)\n以下是关于用户和项目的长期记忆，请始终遵循：\n' +
        mem.facts.map(f => `- ${f.content}`).join('\n');
    }
  } catch {}

  const session = deps().getCurrentSession();
  if (session?.deferredTodos?.length) {
    memoryContext += '\n\n## Deferred todos (上次遗留的非必要任务，可在方便时处理)\n' +
      session.deferredTodos.map(t => `- ${t.text}`).join('\n');
  }

  try {
    const ws = await api().getWorkspace();
    if (ws && api().yanagentEnsure) await api().yanagentEnsure(ws);
    if (ws && api().yanagentLog) {
      api().yanagentLog(`agent run start session=${runCtx.sessionId} run=${runCtx.runId}`, ws);
    }
  } catch {}

  const compressedMessages = await K.compressContextIfNeeded(sessionMessages);
  const apiMessages = [{ role: 'system', content: systemPrompt + memoryContext }];
  for (const m of compressedMessages) {
    if (m.role === 'assistant' && m.agentRun?.apiTrace?.length) {
      apiMessages.push(...m.agentRun.apiTrace);
      continue;
    }
    let content = m.content || '';
    if (m.role === 'user' && Array.isArray(m.attachments) && m.attachments.length) {
      const parts = [];
      for (const a of m.attachments) {
        try {
          const res = await api().readFile(a.path);
          if (res && res.error) parts.push(`【附件: ${a.name}】(无法读取: ${res.error})`);
          else if (res && res.isBinary) parts.push(`【附件: ${a.name}】(二进制文件，${res.size} 字节，未内联)`);
          else if (res && res.content != null) {
            const clipped = res.content.length > 8000 ? res.content.slice(0, 8000) + '\n...(内容过长已截断)...' : res.content;
            parts.push(`【附件: ${a.name}】\n\`\`\`\n${clipped}\n\`\`\``);
          }
        } catch {}
      }
      if (parts.length) content = (content ? content + '\n\n' : '') + parts.join('\n\n');
    }
    apiMessages.push({ role: m.role, content });
  }

  const run = K.startAgentRun(runCtx);
  run.runStartIndex = apiMessages.length;

  let iteration = 0;
  const maxIterations = K.MAX_LOOP_ITERATIONS;
  let fullContent = '';
  let finalStatus = 'done';

  as.todos = [];
  as.todosFromTool = false;
  as.iteration = 0;
  as.toolCallCount = 0;
  as.status = 'working';
  if (ui) {
    deps().hooks.renderTodos(as);
    deps().hooks.updateContextInfo(as);
  }

  const bodyEl = ui ? assistantEl.querySelector('.msg-body') : null;
  if (bodyEl) deps().hooks.renderAgentRunHeader(bodyEl, { status: 'working', iteration: 0, toolCallCount: 0 });

  while (iteration < maxIterations) {
    if (shouldAbort()) {
      fullContent += (fullContent ? '\n\n' : '') + '⚠️ **任务已被用户中断**';
      finalStatus = 'interrupted';
      break;
    }
    iteration++;
    as.iteration = iteration;
    if (ui) {
      deps().hooks.updateContextInfo(as);
      deps().hooks.renderAgentRunHeader(bodyEl, { status: 'working', iteration, toolCallCount: as.toolCallCount });
    }

    const result = await K.callApiStream(apiMessages, assistantEl, runCtx, toolsForRun);

    if (result.reasoning_content) {
      K.recordTimelineEvent({ type: 'thinking', content: result.reasoning_content }, runCtx);
    }
    if (result.content) {
      fullContent += (fullContent ? '\n\n' : '') + result.content;
      deps().hooks.updateTodos(result.content, as, ui);
      K.recordTimelineEvent({ type: 'text', content: result.content }, runCtx);
    }

    if (shouldAbort()) {
      fullContent += (fullContent ? '\n\n' : '') + '⚠️ **任务已被用户中断**';
      finalStatus = 'interrupted';
      break;
    }

    if (!result.tool_calls || result.tool_calls.length === 0) {
      const gate = K.checkCompletionGate ? K.checkCompletionGate(runCtx) : { ok: true };
      if (!gate.ok) {
        if (result.content || result.reasoning_content) {
          const blockedTurn = { role: 'assistant', content: result.content || '' };
          if (result.reasoning_content) blockedTurn.reasoning_content = result.reasoning_content;
          apiMessages.push(blockedTurn);
        }
        apiMessages.push({ role: 'user', content: gate.hint });
        continue;
      }

      if (result.content || result.reasoning_content) {
        const finalTurn = { role: 'assistant', content: result.content || '' };
        if (result.reasoning_content) finalTurn.reasoning_content = result.reasoning_content;
        apiMessages.push(finalTurn);
      }
      as.status = 'done';
      if (!as.todosFromTool) as.todos.forEach(t => t.done = true);
      if (ui) {
        deps().hooks.renderTodos(as);
        deps().hooks.updateContextInfo(as);
      }
      return K.makeLoopResult(fullContent || result.content || '(无回复)', finalStatus, apiMessages, runCtx);
    }

    const assistantTurn = {
      role: 'assistant',
      content: result.content || '',
      tool_calls: result.tool_calls
    };
    if (result.reasoning_content) assistantTurn.reasoning_content = result.reasoning_content;
    apiMessages.push(assistantTurn);

    for (const toolCall of result.tool_calls) {
      if (shouldAbort()) break;
      const fnName = toolCall.function.name;
      let fnArgs = {};
      try { fnArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch {}

      K.recordTimelineEvent({ type: 'tool_call', name: fnName, args: fnArgs }, runCtx);
      const toolOutput = await K.executeToolWithRetry(fnName, fnArgs, runCtx);
      const toolOk = K.parseToolOutputOk(toolOutput);
      K.recordTimelineEvent({ type: 'tool_result', name: fnName, output: toolOutput, ok: toolOk }, runCtx);

      if (bodyEl) bodyEl.appendChild(deps().hooks.buildToolStepElement(fnName, fnArgs, toolOutput, toolOk));

      as.toolCallCount++;
      if (ui) {
        deps().hooks.updateContextInfo(as);
        deps().hooks.renderAgentRunHeader(bodyEl, { status: 'working', iteration, toolCallCount: as.toolCallCount });
      }

      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolOutput
      });
    }

    if (shouldAbort()) {
      fullContent += (fullContent ? '\n\n' : '') + '⚠️ **任务已被用户中断**';
      finalStatus = 'interrupted';
      break;
    }
    if (ui) deps().hooks.renderRightSidebarFiles();
  }

  as.status = 'done';
  if (ui) deps().hooks.updateContextInfo(as);
  return K.makeLoopResult(fullContent || '⚠️ 达到最大迭代次数限制。', finalStatus, apiMessages, runCtx);
}

  K.runAgentLoop = runAgentLoop;
})(window.YanKernel);

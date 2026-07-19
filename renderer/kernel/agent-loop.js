/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;

function getLatestUserPrompt(messages) {
  for (let index = (messages || []).length - 1; index >= 0; index--) {
    if (messages[index]?.role === 'user') return String(messages[index].content || '').trim();
  }
  return '';
}

function inferDirectImageAspectRatio(prompt, fallback = '1:1') {
  const text = String(prompt || '');
  if (/(?:^|\D)9\s*[:：xX×]\s*16(?:\D|$)/.test(text) || /竖版|竖屏|手机壁纸/.test(text)) return '9:16';
  if (/(?:^|\D)16\s*[:：xX×]\s*9(?:\D|$)/.test(text) || /横版|横屏|宽屏/.test(text)) return '16:9';
  return fallback;
}

function readToolError(raw, fallback) {
  try { return String(JSON.parse(raw)?.error || fallback); } catch { return String(fallback); }
}

async function runDirectImageGeneration(sessionMessages, assistantEl, runCtx, selectedModel) {
  const as = runCtx.agentState;
  const ui = runCtx.ui && assistantEl;
  const bodyEl = ui ? assistantEl.querySelector('.msg-body') : null;
  const prompt = getLatestUserPrompt(sessionMessages);
  const latestUser = [...(sessionMessages || [])].reverse().find(message => message?.role === 'user');
  const hasInputImage = (latestUser?.attachments || []).some(attachment => (
    attachment?.kind === 'image' || /^image\//i.test(String(attachment?.mimeType || ''))
  ));
  const args = { prompt, aspect_ratio: inferDirectImageAspectRatio(prompt, hasInputImage ? 'auto' : '1:1') };
  const run = K.startAgentRun(runCtx);
  run.runStartIndex = 0;

  as.todos = [];
  as.todosFromTool = false;
  as.outcome = '';
  as.acceptanceCriteria = [];
  as.outcomeFromTool = false;
  as.iteration = 1;
  as.toolCallCount = 0;
  as.status = 'working';
  if (ui) {
    deps().hooks.renderTodos(as);
    deps().hooks.updateContextInfo(as);
  }
  if (bodyEl) deps().hooks.renderAgentRunHeader(bodyEl, { status: 'working', iteration: 1, toolCallCount: 0 });

  K.recordTimelineEvent({ type: 'tool_call', name: 'generate_image', args }, runCtx);
  deps().hooks.onSupervisorEvent?.({ type: 'tool-start', name: 'generate_image', args }, runCtx);
  let stepEl = null;
  if (bodyEl) {
    stepEl = deps().hooks.buildToolStepElement('generate_image', args, '', null, 'running');
    (deps().hooks.getAgentActivityBody?.(bodyEl) || bodyEl).appendChild(stepEl);
    deps().hooks.scrollChatToBottom?.();
  }

  const output = await K.executeToolWithRetry('generate_image', args, runCtx);
  const ok = K.parseToolOutputOk(output) === true;
  K.recordTimelineEvent({ type: 'tool_result', name: 'generate_image', output, ok }, runCtx);
  as.toolCallCount = 1;
  deps().hooks.onSupervisorEvent?.({ type: 'tool-finish', name: 'generate_image', args, ok }, runCtx);

  if (runCtx.shouldAbort) {
    as.status = 'done';
    if (stepEl) deps().hooks.cancelToolStepElement?.(stepEl);
    if (ui) deps().hooks.updateContextInfo(as);
    deps().hooks.onRunAborted?.(runCtx);
    return K.makeLoopResult('', 'interrupted', null, runCtx);
  }

  if (stepEl) deps().hooks.finishToolStepElement(stepEl, output, ok);
  const modelName = selectedModel?.name || selectedModel?.id || '当前模型';
  const content = ok
    ? `已使用 ${modelName} 生成图片。`
    : `图片生成失败：${readToolError(output, '图片接口请求失败')}`;
  K.recordTimelineEvent({ type: 'text', content }, runCtx);
  as.status = 'done';
  if (ui) deps().hooks.updateContextInfo(as);
  return K.makeLoopResult(content, ok ? 'done' : 'error', null, runCtx);
}

async function runAgentLoop(sessionMessages, assistantEl, runCtx) {
  if (!runCtx) {
    const currentSession = deps().getCurrentSession();
    runCtx = K.createRunCtx(currentSession?.id, true, currentSession?.workspace);
    runCtx.sessionRef = currentSession;
  }
  const as = runCtx.agentState;
  const shouldAbort = () => !!runCtx.shouldAbort;
  const ui = runCtx.ui && assistantEl;
  const cfg = deps().getConfig();
  const selectedModel = (cfg.models || []).find(model => model.id === cfg.api?.model);
  const perm = await api().getPermissions();

  if (!perm.allowNetwork) {
    return K.makeLoopResult(`⚠️ **网络权限已关闭**，无法调用 AI 接口。\n\n请在「设置 → 权限」中开启「允许网络访问」。`, 'error', null, runCtx);
  }
  if (!cfg.api?.apiKey) {
    return K.makeLoopResult(`⚠️ **未配置 API Key**\n\n请在「设置 → API 配置」中填入你的 DeepSeek API Key。`, 'error', null, runCtx);
  }
  if (selectedModel?.capabilities?.imageGenerationModel) {
    return runDirectImageGeneration(sessionMessages, assistantEl, runCtx, selectedModel);
  }

  const systemPrompt = await K.buildSystemPrompt(runCtx);
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

  const session = runCtx.sessionRef || deps().getCurrentSession();
  if (session?.deferredTodos?.length) {
    memoryContext += '\n\n## Deferred todos (上次遗留的非必要任务，可在方便时处理)\n' +
      session.deferredTodos.map(t => `- ${t.text}`).join('\n');
  }

  try {
    const ws = await K.getRunWorkspace(runCtx);
    if (ws && api().yanagentEnsure) await api().yanagentEnsure(ws);
    if (ws && api().yanagentLog) {
      api().yanagentLog(`agent run start session=${runCtx.sessionId} run=${runCtx.runId}`, ws);
    }
  } catch {}

  const compressResult = await K.compressContextIfNeeded(sessionMessages);
  const compressedMessages = compressResult.messages;
  if (compressResult.compressed) {
    sessionMessages.splice(0, sessionMessages.length, ...compressedMessages);
    deps().hooks.onContextCompressed?.(compressResult);
  }
  const apiMessages = [{ role: 'system', content: systemPrompt + memoryContext }];
  const apiConfig = deps().getConfig();
  const modelCapabilities = selectedModel?.capabilities || {};
  for (const m of compressedMessages) {
    if (m.role === 'assistant' && m.agentRun?.apiTrace?.length) {
      apiMessages.push(...m.agentRun.apiTrace);
      continue;
    }
    const content = m.role === 'user'
      ? await K.buildApiMessageContent(m, modelCapabilities)
      : (m.content || '');
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
  as.outcome = '';
  as.acceptanceCriteria = [];
  as.outcomeFromTool = false;
  as.iteration = 0;
  as.toolCallCount = 0;
  as.status = 'working';
  if (ui) {
    deps().hooks.renderTodos(as);
    deps().hooks.updateContextInfo(as);
  }

  const bodyEl = ui ? assistantEl.querySelector('.msg-body') : null;
  const syncRunHeader = () => {
    if (!bodyEl) return;
    if (shouldAbort()) {
      deps().hooks.onRunAborted?.(runCtx);
      return;
    }
    deps().hooks.renderAgentRunHeader(bodyEl, {
      status: 'working',
      iteration: as.iteration,
      toolCallCount: as.toolCallCount
    });
  };
  if (bodyEl) deps().hooks.renderAgentRunHeader(bodyEl, { status: 'working', iteration: 0, toolCallCount: 0 });

  while (iteration < maxIterations) {
    if (shouldAbort()) {
      finalStatus = 'interrupted';
      deps().hooks.onRunAborted?.(runCtx);
      break;
    }
    iteration++;
    as.iteration = iteration;
    deps().hooks.onSupervisorEvent?.({
      type: 'iteration',
      iteration,
      toolCallCount: as.toolCallCount
    }, runCtx);
    if (ui) {
      deps().hooks.updateContextInfo(as);
      syncRunHeader();
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
      finalStatus = 'interrupted';
      deps().hooks.onRunAborted?.(runCtx);
      break;
    }

    if (!result.tool_calls || result.tool_calls.length === 0) {
      const gate = K.checkCompletionGate ? K.checkCompletionGate(runCtx) : { ok: true };
      if (!gate.ok) {
        deps().hooks.onSupervisorEvent?.({ type: 'gate-blocked', hint: gate.hint || '' }, runCtx);
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

    const preparedCalls = result.tool_calls.map(toolCall => K.prepareToolCall(toolCall, toolsForRun, runCtx));
    const normalizedToolCalls = result.tool_calls.map((toolCall, index) => ({
      ...toolCall,
      id: preparedCalls[index].id
    }));
    const assistantTurn = {
      role: 'assistant',
      content: result.content || '',
      tool_calls: normalizedToolCalls
    };
    if (result.reasoning_content) assistantTurn.reasoning_content = result.reasoning_content;
    apiMessages.push(assistantTurn);

    const stepElements = new Map();
    const scheduledResults = await K.scheduleToolCalls(preparedCalls, runCtx, {
      onStart(prepared) {
        K.recordTimelineEvent({ type: 'tool_call', name: prepared.name, args: prepared.args }, runCtx);
        deps().hooks.onSupervisorEvent?.({
          type: 'tool-start',
          name: prepared.name,
          args: prepared.args
        }, runCtx);
        if (!bodyEl) return;
        const stepEl = deps().hooks.buildToolStepElement(prepared.name, prepared.args, '', null, 'running');
        stepElements.set(prepared.index, stepEl);
        (deps().hooks.getAgentActivityBody?.(bodyEl) || bodyEl).appendChild(stepEl);
        deps().hooks.scrollChatToBottom?.();
      },
      onFinish(executed) {
        K.recordTimelineEvent({
          type: 'tool_result',
          name: executed.name,
          output: executed.output,
          ok: executed.ok,
          replayed: executed.replayed
        }, runCtx);
        const stepEl = stepElements.get(executed.index);
        if (stepEl && shouldAbort()) {
          deps().hooks.cancelToolStepElement?.(stepEl);
        } else if (stepEl) {
          deps().hooks.finishToolStepElement(stepEl, executed.output, executed.ok);
        }
        as.toolCallCount++;
        deps().hooks.onSupervisorEvent?.({
          type: 'tool-finish',
          name: executed.name,
          args: executed.args,
          ok: executed.ok,
          replayed: executed.replayed
        }, runCtx);
        if (ui) {
          deps().hooks.updateContextInfo(as);
          syncRunHeader();
        }
      }
    });

    if (shouldAbort()) {
      finalStatus = 'interrupted';
      deps().hooks.onRunAborted?.(runCtx);
      break;
    }
    for (const executed of scheduledResults) {
      apiMessages.push({
        role: 'tool',
        tool_call_id: executed.id,
        content: executed.output
      });
    }
    if (ui) deps().hooks.renderRightSidebarFiles();
  }

  as.status = 'done';
  if (ui) deps().hooks.updateContextInfo(as);
  if (finalStatus === 'interrupted' && ui) deps().hooks.onRunAborted?.(runCtx);
  return K.makeLoopResult(fullContent || (finalStatus === 'interrupted' ? '' : '⚠️ 达到最大迭代次数限制。'), finalStatus, apiMessages, runCtx);
}

  K.getLatestUserPrompt = getLatestUserPrompt;
  K.inferDirectImageAspectRatio = inferDirectImageAspectRatio;
  K.runDirectImageGeneration = runDirectImageGeneration;
  K.runAgentLoop = runAgentLoop;
})(window.YanKernel);

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

function requiresWindowsMcp(messages) {
  const prompt = getLatestUserPrompt(messages);
  return /Yan\s*Computer\s*Use|computer[\s-]*use|操作(?:电脑|Windows)|控制(?:电脑|桌面|Windows)|桌面自动化|(?:打开|启动|运行|进入|切换到|点击|输入|搜索).{0,24}(?:系统浏览器|外部浏览器|Chrome|Google\s*Chrome|Edge|Firefox|抖音|微信|软件|应用|窗口)/i.test(prompt);
}

function isWindowsMcpIdentity(value) {
  return /windows/i.test(String(value || ''));
}

function getExecutedEffectiveToolName(executed) {
  try {
    return String(JSON.parse(executed?.output || '{}')?.meta?.effectiveToolName || executed?.name || '');
  } catch {
    return String(executed?.name || '');
  }
}

function getToolFailureIdentity(executed, runCtx) {
  const effectiveName = getExecutedEffectiveToolName(executed);
  const route = runCtx?.mcpToolMapSnapshot?.get?.(effectiveName);
  if (route) {
    const serverId = String(route.serverId || 'unknown');
    const serverName = String(route.serverName || route.serverId || 'MCP');
    return {
      key: `mcp:${serverId}`,
      label: `${serverName} / ${route.toolName || executed.name}`,
      kind: 'mcp'
    };
  }
  const name = effectiveName || String(executed?.name || '未知工具');
  return { key: `tool:${name}`, label: name, kind: 'tool' };
}

function readExecutedToolError(executed, identity) {
  let detail = '';
  let stderr = '';
  try {
    const parsed = JSON.parse(executed?.output || '');
    detail = String(parsed?.error || parsed?.output || '工具返回失败状态');
    stderr = String(parsed?.meta?.stderr || '').trim();
  } catch {
    detail = String(executed?.output || '工具执行失败');
  }
  if (stderr && !detail.includes(stderr)) detail += `\nstderr: ${stderr}`;
  return K.describeRunError(detail, { kind: identity.kind });
}

function updateUnresolvedToolErrors(scheduledResults, runCtx) {
  const unresolved = runCtx.unresolvedToolErrors instanceof Map
    ? runCtx.unresolvedToolErrors
    : (runCtx.unresolvedToolErrors = new Map());
  for (const executed of scheduledResults || []) {
    const identity = getToolFailureIdentity(executed, runCtx);
    let meta = {};
    try { meta = JSON.parse(executed?.output || '{}')?.meta || {}; } catch { /* malformed result is a real error */ }
    if (meta.nonFatal) {
      unresolved.delete(identity.key);
      continue;
    }
    if (executed?.ok === true) {
      unresolved.delete(identity.key);
      continue;
    }
    unresolved.set(identity.key, {
      label: identity.label,
      detail: readExecutedToolError(executed, identity)
    });
  }
  return unresolved;
}

function formatUnresolvedToolErrors(runCtx) {
  const failures = Array.from(runCtx?.unresolvedToolErrors?.values?.() || []);
  if (!failures.length) return '';
  const details = failures.map(failure => `- ${failure.label}：${failure.detail}`).join('\n');
  return `任务因工具错误停止，以下错误未能恢复：\n${details}`;
}

function getToolFailureText(executed) {
  try {
    const parsed = JSON.parse(executed?.output || '');
    return String(parsed?.error || parsed?.output || '工具返回失败状态').trim();
  } catch {
    return String(executed?.output || '工具执行失败').trim();
  }
}

function updateRepeatedToolFailureStreak(scheduledResults, runCtx) {
  let streak = runCtx?.toolFailureStreak || null;
  let tripped = null;
  const limit = Number(
    runCtx?.runBudget?.maxIdenticalToolFailures
    || K.MAX_IDENTICAL_TOOL_FAILURES
  ) || 10;
  for (const executed of scheduledResults || []) {
    if (executed?.ok === true) {
      streak = null;
      continue;
    }
    const error = getToolFailureText(executed);
    const fingerprint = error.replace(/\s+/g, ' ').trim().slice(0, 1600);
    if (!fingerprint) {
      streak = null;
      continue;
    }
    if (streak?.fingerprint === fingerprint) {
      streak = { ...streak, count: streak.count + 1, toolName: getExecutedEffectiveToolName(executed) || executed.name };
    } else {
      streak = { fingerprint, count: 1, toolName: getExecutedEffectiveToolName(executed) || executed.name };
    }
    if (!tripped && streak.count >= limit) tripped = { ...streak };
  }
  if (runCtx) runCtx.toolFailureStreak = streak;
  if (!tripped) return null;
  return {
    ...tripped,
    limit,
    message: `检测到无效工具循环：连续 ${tripped.count} 次工具调用返回相同错误，已停止任务以避免无效重试。\n工具：${tripped.toolName}\n错误：${tripped.fingerprint}`
  };
}

function requiresActionToolCall(runCtx) {
  const plan = runCtx?.capabilityPlan;
  if (!plan?.operational) return false;
  return !!(plan.workspace || plan.desktop || plan.browserAutomation || plan.git);
}

function pushApiMessage(apiMessages, message, runCtx, persist = true) {
  apiMessages.push(message);
  if (persist) K.recordApiTraceMessage?.(message, runCtx);
  return message;
}

function consumeMcpVisionMessage(raw, runCtx, modelCapabilities) {
  let frameId = '';
  try { frameId = String(JSON.parse(raw)?.meta?.mcpVisionFrameId || ''); } catch {}
  if (!frameId || !(runCtx?.mcpVisionFrames instanceof Map)) return null;
  const frame = runCtx.mcpVisionFrames.get(frameId);
  runCtx.mcpVisionFrames.delete(frameId);
  if (!frame?.images?.length) return null;
  const browserFrame = frame.toolName === 'browser_screenshot';
  const screenshotSource = browserFrame ? '内置浏览器' : 'Computer Use';
  if (!modelCapabilities?.vision) {
    return {
      role: 'user',
      content: `${screenshotSource} 已返回截图，但当前模型不支持图像输入。请改用页面文本、可访问性快照或可靠的键盘导航；如果仍无法验证目标控件，请向用户明确报告视觉定位受限。`
    };
  }
  return {
    role: 'user',
    content: [
      {
        type: 'text',
        text: `这是刚刚 ${screenshotSource} 返回的最新截图。请只依据这张截图定位本次操作，并在界面变化后重新观察。`
      },
      ...frame.images.map(image => ({
        type: 'image_url',
        image_url: { url: `data:${image.mimeType};base64,${image.data}` }
      }))
    ]
  };
}

async function runDirectImageGeneration(sessionMessages, assistantEl, runCtx, selectedModel) {
  const as = runCtx.agentState;
  const getBodyEl = () => {
    if (!runCtx.ui) return null;
    const activeBody = deps().hooks.getActiveAssistantBody?.(runCtx.sessionId);
    if (activeBody?.isConnected) return activeBody;
    const fallbackBody = assistantEl?.querySelector?.('.msg-body');
    return fallbackBody?.isConnected ? fallbackBody : null;
  };
  const hasUi = () => !!getBodyEl();
  const prompt = getLatestUserPrompt(sessionMessages);
  const latestUser = [...(sessionMessages || [])].reverse().find(message => message?.role === 'user');
  const hasInputImage = (latestUser?.attachments || []).some(attachment => (
    attachment?.kind === 'image' || /^image\//i.test(String(attachment?.mimeType || ''))
  ));
  const args = { prompt, aspect_ratio: inferDirectImageAspectRatio(prompt, hasInputImage ? 'auto' : '1:1') };
  const run = K.startAgentRun(runCtx);
  const directConfig = deps().getConfig().api || {};
  run.provider = String(directConfig.provider || '');
  run.model = String(directConfig.model || '');

  as.todos = [];
  as.todosFromTool = false;
  as.outcome = '';
  as.acceptanceCriteria = [];
  as.outcomeFromTool = false;
  as.iteration = 1;
  as.toolCallCount = 0;
  as.status = 'working';
  if (hasUi()) {
    deps().hooks.renderTodos(as);
    deps().hooks.updateContextInfo(as);
  }
  const bodyEl = getBodyEl();
  if (bodyEl) deps().hooks.renderAgentRunHeader(bodyEl, { status: 'working', iteration: 1, toolCallCount: 0 });

  const directCallId = `${runCtx.runId}:generate_image`;
  K.recordTimelineEvent({ type: 'tool_call', name: 'generate_image', args, callId: directCallId }, runCtx);
  deps().hooks.onSupervisorEvent?.({ type: 'tool-start', name: 'generate_image', args }, runCtx);
  let stepEl = null;
  if (bodyEl) {
    stepEl = deps().hooks.buildToolStepElement('generate_image', args, '', null, 'running');
    stepEl.dataset.callId = directCallId;
    (deps().hooks.getAgentActivityBody?.(bodyEl) || bodyEl).appendChild(stepEl);
    deps().hooks.scrollChatToBottom?.();
  }

  const output = await K.executeToolWithRetry('generate_image', args, runCtx);
  const ok = K.parseToolOutputOk(output) === true;
  K.recordTimelineEvent({
    type: 'tool_result', name: 'generate_image', output, ok,
    callId: directCallId, interrupted: !!runCtx.shouldAbort
  }, runCtx);
  as.toolCallCount = 1;
  deps().hooks.onSupervisorEvent?.({ type: 'tool-finish', name: 'generate_image', args, ok }, runCtx);

  if (runCtx.shouldAbort) {
    as.status = 'done';
    const liveStep = stepEl?.isConnected
      ? stepEl
      : getBodyEl()?.querySelector(`.tool-step[data-call-id="${directCallId}"]`);
    if (liveStep) deps().hooks.cancelToolStepElement?.(liveStep);
    if (hasUi()) deps().hooks.updateContextInfo(as);
    deps().hooks.onRunAborted?.(runCtx);
    return K.makeLoopResult('', 'interrupted', null, runCtx);
  }

  const liveStep = stepEl?.isConnected
    ? stepEl
    : getBodyEl()?.querySelector(`.tool-step[data-call-id="${directCallId}"]`);
  if (liveStep) deps().hooks.finishToolStepElement(liveStep, output, ok);
  const modelName = selectedModel?.name || selectedModel?.id || '当前模型';
  const imageError = ok ? '' : K.describeRunError(readToolError(output, '图片接口请求失败'));
  const content = ok
    ? `已使用 ${modelName} 生成图片。`
    : `图片生成失败：${imageError}`;
  K.recordTimelineEvent({ type: 'text', content }, runCtx);
  runCtx.partialContent = content;
  as.status = 'done';
  if (hasUi()) deps().hooks.updateContextInfo(as);
  return K.makeLoopResult(content, ok ? 'done' : 'error', null, runCtx, ok ? null : content);
}

async function runAgentLoop(sessionMessages, assistantEl, runCtx) {
  if (!runCtx) {
    const currentSession = deps().getCurrentSession();
    runCtx = K.createRunCtx(currentSession?.id, true, currentSession?.workspace);
    runCtx.sessionRef = currentSession;
  }
  const as = runCtx.agentState;
  if (!runCtx.originalUserGoal) runCtx.originalUserGoal = getLatestUserPrompt(sessionMessages);
  const shouldAbort = () => !!runCtx.shouldAbort;
  const getBodyEl = () => {
    if (!runCtx.ui) return null;
    const activeBody = deps().hooks.getActiveAssistantBody?.(runCtx.sessionId);
    if (activeBody?.isConnected) return activeBody;
    const fallbackBody = assistantEl?.querySelector?.('.msg-body');
    return fallbackBody?.isConnected ? fallbackBody : null;
  };
  const hasUi = () => !!getBodyEl();
  const cfg = deps().getConfig();
  runCtx.workMode = K.getWorkMode?.(cfg) || 'normal';
  runCtx.planExecutionApproved = runCtx.workMode === 'plan'
    && !!K.isPlanExecutionApproved?.(sessionMessages);
  const selectedModel = (cfg.models || []).find(model => model.id === cfg.api?.model);
  const perm = await api().getPermissions();

  if (!perm.allowNetwork) {
    const message = '网络权限已关闭，无法调用 AI 接口。请在「设置 → 权限」中开启「允许网络访问」。';
    return K.makeLoopResult(`⚠️ ${message}`, 'error', null, runCtx, message);
  }
  if (!cfg.api?.apiKey) {
    const message = '未配置 API Key。请在「设置 → API 配置」中填写当前模型厂商的 API Key。';
    return K.makeLoopResult(`⚠️ ${message}`, 'error', null, runCtx, message);
  }
  if (selectedModel?.capabilities?.imageGenerationModel) {
    return runDirectImageGeneration(sessionMessages, assistantEl, runCtx, selectedModel);
  }

  let mcpRefresh = { loadedCount: 0, errors: [] };
  const shouldRefreshMcp = K.taskMayNeedMcp
    ? K.taskMayNeedMcp(sessionMessages)
    : requiresWindowsMcp(sessionMessages);
  if (shouldRefreshMcp) mcpRefresh = await K.refreshMcpTools();
  const initialTools = K.snapshotTools();
  const allNativeTools = K.snapshotAllNativeTools?.() || initialTools;
  runCtx.mcpToolMapSnapshot = new Map(K.getMcpToolMap());
  await K.planRunCapabilities?.(sessionMessages, allNativeTools, runCtx);
  const systemPrompt = await K.buildSystemPrompt(runCtx);
  let toolsForRun = K.getToolsForRun
    ? K.getToolsForRun(runCtx, K.snapshotTools())
    : initialTools;
  runCtx.exposedToolNames = new Set(
    (toolsForRun || []).map(tool => tool?.function?.name).filter(Boolean)
  );
  const windowsMcpRequired = K.taskRequiresWindowsMcp
    ? K.taskRequiresWindowsMcp(sessionMessages)
    : requiresWindowsMcp(sessionMessages);
  if (windowsMcpRequired) {
    const windowsToolsAvailable = Array.from(runCtx.mcpToolMapSnapshot.values()).some(route => (
      isWindowsMcpIdentity(`${route.serverId} ${route.serverName}`)
    ));
    if (!windowsToolsAvailable) {
      const windowsErrors = (mcpRefresh?.errors || []).filter(error => (
        isWindowsMcpIdentity(`${error.serverId} ${error.serverName}`)
      ));
      const rawReason = windowsErrors.length
        ? windowsErrors.map(error => `${error.serverName}: ${error.error}`).join('\n')
        : 'Windows-MCP 未启用、未启动，或没有返回可用工具。';
      const errorMessage = K.describeRunError(rawReason, { kind: 'mcp' });
      return K.makeLoopResult(`⚠️ ${errorMessage}`, 'error', null, runCtx, errorMessage);
    }
  }

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
    await deps().hooks.onContextCompressed?.(compressResult, runCtx);
  }
  const apiMessages = [{ role: 'system', content: systemPrompt + memoryContext }];
  const apiConfig = cfg.api || {};
  const modelCapabilities = selectedModel?.capabilities || {};
  for (const m of compressedMessages) {
    if (m.role === 'system') {
      const summary = String(m.content || '').trim();
      if (summary) apiMessages[0].content += `\n\n${summary}`;
      continue;
    }
    if (m.role === 'assistant' && m.agentRun?.apiTrace?.length) {
      const sameProvider = !!m.agentRun.provider && m.agentRun.provider === apiConfig.provider;
      const replayable = sameProvider && m.agentRun.status === 'done';
      if (replayable) {
        const cleanedTrace = m.agentRun.apiTrace.map(traceMessage => (
          traceMessage?.role === 'assistant' && K.stripDsmlToolBlocks
            ? { ...traceMessage, content: K.stripDsmlToolBlocks(traceMessage.content || '') }
            : traceMessage
        ));
        const normalizedTrace = K.normalizeApiMessages
          ? K.normalizeApiMessages(cleanedTrace)
          : cleanedTrace;
        // Historical runs are already complete: the model only needs to know what
        // happened, not full tool outputs. Clip replayed tool results hard so a
        // 20-file exploration round doesn't cost 240k chars on every new request.
        const clippedTrace = K.clipReplayedTrace
          ? K.clipReplayedTrace(normalizedTrace)
          : normalizedTrace;
        if (clippedTrace.length) {
          apiMessages.push(...clippedTrace);
          continue;
        }
      }
    }
    const storedContent = m.role === 'assistant' && K.stripDsmlToolBlocks
      ? K.stripDsmlToolBlocks(m.content || '')
      : (m.content || '');
    const content = m.role === 'user'
      ? await K.buildApiMessageContent(m, modelCapabilities)
      : storedContent;
    if (m.role !== 'assistant' || String(content || '').trim()) {
      apiMessages.push({ role: m.role, content });
    }
  }

  const run = K.startAgentRun(runCtx);
  run.provider = String(apiConfig.provider || '');
  run.model = String(K.resolveRuntimeModelId?.(apiConfig) || apiConfig.model || '');
  const ephemeralVisionMessages = new WeakSet();
  // M3: per-model long-run budget (Kimi K3/K2.7 get higher ceilings + max_tokens).
  // initRunProgress must run AFTER applyRunBudget so model-specific thresholds
  // (maxNoProgressRounds, maxIdenticalErrorCode) are set before the first iteration.
  const runBudget = K.applyRunBudget
    ? K.applyRunBudget(runCtx, apiConfig)
    : (K.resolveModelBudget ? K.resolveModelBudget(apiConfig) : null);
  if (runBudget) runCtx.runBudget = runBudget;
  K.applyWorkModeBudget?.(runCtx, runBudget);
  if (K.initRunProgress) K.initRunProgress(runCtx);
  if (K.syncRunPhase) K.syncRunPhase(runCtx);

  let iteration = 0;
  const maxIterations = Number(
    runCtx.maxLoopIterations
    || runBudget?.maxLoopIterations
    || K.MAX_LOOP_ITERATIONS
  ) || 120;
  runCtx.maxLoopIterations = maxIterations;
  const lengthContinueLimit = Number(runBudget?.lengthContinueLimit) || 5;
  const gateBlockLimit = Number(runBudget?.gateBlockLimit) || 3;
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
  if (hasUi()) {
    deps().hooks.renderTodos(as);
    deps().hooks.updateContextInfo(as);
  }

  const syncRunHeader = () => {
    const bodyEl = getBodyEl();
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
  const bodyEl = getBodyEl();
  if (bodyEl) deps().hooks.renderAgentRunHeader(bodyEl, { status: 'working', iteration: 0, toolCallCount: 0 });

  while (iteration < maxIterations) {
    if (shouldAbort()) {
      finalStatus = 'interrupted';
      deps().hooks.onRunAborted?.(runCtx);
      break;
    }

    // Compression rebuilds the message list (prefix cache resets regardless), so this
    // is the free moment to drop accumulated harness-state blocks — they are
    // regenerated fresh below and would otherwise pollute the summary source.
    if (apiMessages.some(m => m._harnessState)) {
      const pruned = apiMessages.filter(m => !m._harnessState);
      apiMessages.splice(0, apiMessages.length, ...pruned);
    }
    const liveCompression = await K.compressContextIfNeeded(apiMessages.slice(1), runCtx);
    if (liveCompression.compressed) {
      // Keep the compression summary as a user message (never mutate role:'system' to 'user' —
      // that breaks role-aware models). The summary is already a plain string; inject it as an
      // ephemeral user message so the model sees it without polluting the system slot.
      const liveMessages = liveCompression.messages.filter(m => m.role !== 'system');
      const summaryMsg = liveCompression.messages.find(m => m.role === 'system');
      if (summaryMsg) {
        liveMessages.unshift({ role: 'user', content: summaryMsg.content });
      }
      apiMessages.splice(1, apiMessages.length - 1, ...liveMessages);
      runCtx.contextCompressionCount = (runCtx.contextCompressionCount || 0) + 1;
      // New context epoch: earlier full file reads may have been compressed away,
      // so the read_file dedup cache must not suppress re-reads after this point.
      runCtx.contextEpoch = (runCtx.contextEpoch || 0) + 1;
      // Re-anchor strong-thinking models after compress: inject authoritative harness state.
      if (K.buildPostCompressHarnessPrompt) {
        pushApiMessage(apiMessages, {
          role: 'user',
          content: K.buildPostCompressHarnessPrompt(runCtx)
        }, runCtx, false);
      }
      // After compression, rebuild system message once so static content (workspace tree,
      // capability section) is current — this is the only place system[0] is refreshed.
      if (apiMessages[0]?.role === 'system') {
        apiMessages[0].content = systemPrompt + memoryContext;
      }
      deps().hooks.onSupervisorEvent?.({
        type: 'context-compressed',
        beforeTokens: liveCompression.beforeTokens,
        afterTokens: liveCompression.afterTokens,
        modelBudget: runCtx.runBudget?.label
      }, runCtx);
    }
    iteration++;
    as.iteration = iteration;
    if (K.syncRunPhase) K.syncRunPhase(runCtx);
    toolsForRun = K.getToolsForRun
      ? K.getToolsForRun(runCtx, K.snapshotTools())
      : toolsForRun;
    runCtx.exposedToolNames = new Set(
      (toolsForRun || []).map(tool => tool?.function?.name).filter(Boolean)
    );
    // Inject live task state as an ephemeral user message each iteration instead of
    // rebuilding the system message. This avoids re-sending the full static system prompt
    // (workspace tree, capability section, etc.) on every iteration, saving significant tokens.
    // The system message is set once at run start and only refreshed after context compression.
    if (K.buildTaskStatePrompt) {
      const taskState = K.buildTaskStatePrompt(runCtx);
      if (taskState) {
        // Cache alignment: append-only. Removing or rewriting the previous harness
        // block mid-history would invalidate the provider prefix cache from that
        // position on (a full round of tool results re-read at uncached price,
        // every iteration). Stale blocks stay in place — each block declares that
        // the latest one supersedes it, and compression (which rebuilds the list
        // and busts the cache anyway) prunes them for free.
        // Dedup: the block is built to be stable across uneventful iterations —
        // if it equals the previous one, skip the append entirely (zero new tokens).
        const prevIdx = apiMessages.findLastIndex?.(m => m._harnessState) ?? -1;
        if (prevIdx < 0 || apiMessages[prevIdx].content !== taskState) {
          pushApiMessage(apiMessages, { role: 'user', content: taskState, _harnessState: true }, runCtx, false);
        }
      }
    }
    deps().hooks.onSupervisorEvent?.({
      type: 'iteration',
      iteration,
      toolCallCount: as.toolCallCount,
      phase: runCtx.phase
    }, runCtx);
    if (hasUi()) {
      deps().hooks.updateContextInfo(as);
      syncRunHeader();
    }

    let result;
    try {
      result = await K.callApiStream(apiMessages, assistantEl, runCtx, toolsForRun);
    } catch (error) {
      if (error?.name === 'AbortError' || shouldAbort()) {
        finalStatus = 'interrupted';
        deps().hooks.onRunAborted?.(runCtx);
        break;
      }
      const errorMessage = K.describeRunError(error);
      const errorContent = [fullContent, `⚠️ ${errorMessage}`].filter(Boolean).join('\n\n');
      as.status = 'error';
      if (hasUi()) deps().hooks.updateContextInfo(as);
      return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, errorMessage);
    }

    // A Computer Use screenshot is useful for one decision only. Keeping its
    // base64 payload in later rounds would rapidly exhaust the context window.
    for (const message of apiMessages) {
      if (!ephemeralVisionMessages.has(message)) continue;
      message.content = '[Computer Use 截图已在上一轮完成分析；界面变化后必须重新获取截图。]';
      ephemeralVisionMessages.delete(message);
    }

    if (result.reasoning_content) {
      K.recordTimelineEvent({ type: 'thinking', content: result.reasoning_content }, runCtx);
    }
    if (result.content) {
      fullContent += (fullContent ? '\n\n' : '') + result.content;
      runCtx.partialContent = fullContent;
      deps().hooks.updateTodos(result.content, as, hasUi());
      K.recordTimelineEvent({ type: 'text', content: result.content }, runCtx);
    }
    runCtx.streamingContent = '';
    runCtx.streamingReasoning = '';

    if (shouldAbort()) {
      finalStatus = 'interrupted';
      deps().hooks.onRunAborted?.(runCtx);
      break;
    }

    // finish_reason=length：输出触顶时绝不直接判定任务失败。
    // 若本轮已有 tool_calls，优先执行工具（大文件应落盘而非卡在聊天里）；
    // 仅纯文本被截断时才走续写提示。
    if (result.finish_reason === 'length' && !shouldAbort()) {
      runCtx.lengthContinueCount = (runCtx.lengthContinueCount || 0) + 1;
      runCtx.gateBlockedAttempts = 0;
      runCtx.noToolActionAttempts = 0;
      if (runCtx.progress) runCtx.progress.noProgressRounds = 0;
      if (runCtx.lengthContinueCount > lengthContinueLimit) {
        const errorMessage = `模型连续 ${lengthContinueLimit} 次因输出长度被截断。请改用 write_file/apply_patch 分段写入工作区，或在设置里提高 max_tokens。`;
        const errorContent = [fullContent, `⚠️ ${errorMessage}`].filter(Boolean).join('\n\n');
        as.status = 'error';
        if (hasUi()) deps().hooks.updateContextInfo(as);
        return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, errorMessage);
      }
      if (!result.tool_calls?.length) {
        const partialTurn = { role: 'assistant', content: result.content || '' };
        if (result.reasoning_content) partialTurn.reasoning_content = result.reasoning_content;
        pushApiMessage(apiMessages, partialTurn, runCtx, false);
        pushApiMessage(apiMessages, {
          role: 'user',
          content: [
            '上一段输出因长度上限被截断（这不是任务失败）。',
            '规则：',
            '1. 不要把完整大文件塞进一次聊天回复。',
            '2. 立刻用工具 write_file / apply_patch / edit_file 把代码写入工作区。',
            '3. 单次写入过大时拆成多次工具调用（先骨架再补模块），每次工具参数必须完整合法。',
            '4. 不要重复已经写出的内容；从截断处继续。',
            '5. 现在必须调用工具，不要只描述计划。'
          ].join('\n')
        }, runCtx, false);
        continue;
      }
      // fall through: execute tool_calls even when finish_reason=length
    }
    // 非 length 的正常响应，计数器清零
    if (result.finish_reason !== 'length') runCtx.lengthContinueCount = 0;

    if (!result.tool_calls || result.tool_calls.length === 0) {
      if (requiresActionToolCall(runCtx) && as.toolCallCount === 0) {
        runCtx.noToolActionAttempts = (runCtx.noToolActionAttempts || 0) + 1;
        if (!toolsForRun.length) {
          const errorMessage = `任务需要操作工作区或外部能力，但能力路由没有提供任何可用工具（${runCtx.capabilityPlan?.summary || '未知路由'}）。`;
          const errorContent = [fullContent, `⚠️ ${errorMessage}`].filter(Boolean).join('\n\n');
          return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, errorMessage);
        }
        if (runCtx.noToolActionAttempts <= 3) {
          if (result.content || result.reasoning_content) {
            const blockedTurn = { role: 'assistant', content: result.content || '' };
            if (result.reasoning_content) blockedTurn.reasoning_content = result.reasoning_content;
            pushApiMessage(apiMessages, blockedTurn, runCtx, false);
          }
          pushApiMessage(apiMessages, {
            role: 'user',
            content: '你还没有执行本次行动任务。不要只说明准备做什么；现在使用 write_file/edit_file/apply_patch/execute_shell 等工具修改工作区。大文件请分段多次写入，不要在聊天里贴整份源码。'
          }, runCtx, false);
          continue;
        }
        const errorMessage = '模型连续结束响应却没有调用本次任务所需的任何工具，Yan Agent 已阻止任务被误标为完成。';
        const errorContent = [fullContent, `⚠️ ${errorMessage}`].filter(Boolean).join('\n\n');
        return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, errorMessage);
      }

      const gate = K.checkCompletionGate ? K.checkCompletionGate(runCtx) : { ok: true };
      if (!gate.ok) {
        // 防护：本轮调过工具 → 重置；只给文字 → +1。
        // length 续写刚发生时不累计（上面已清零）。
        // 已有工具调用历史时，给更多空转预算（模型可能在汇报中间状态）。
        const modelTriedThisTurn = !!(result.tool_calls && result.tool_calls.length);
        if (modelTriedThisTurn) {
          runCtx.gateBlockedAttempts = 0;
          runCtx.noToolActionAttempts = 0; // model did call tools; reset no-tool counter
        } else {
          runCtx.gateBlockedAttempts = (runCtx.gateBlockedAttempts || 0) + 1;
        }
        const workedBefore = Number(as.toolCallCount || 0) > 0;
        const GATE_BLOCK_LIMIT = workedBefore
          ? Math.max(gateBlockLimit, 10)
          : gateBlockLimit;
        if (runCtx.gateBlockedAttempts >= GATE_BLOCK_LIMIT) {
          const errorMessage = `任务连续 ${GATE_BLOCK_LIMIT} 次未能通过完成门验证，且模型未调用工具修正。${gate.hint || ''}`;
          const errorContent = [fullContent, `⚠️ ${errorMessage}`].filter(Boolean).join('\n\n');
          as.status = 'error';
          if (hasUi()) deps().hooks.updateContextInfo(as);
          return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, errorMessage);
        }
        deps().hooks.onSupervisorEvent?.({ type: 'gate-blocked', hint: gate.hint || '', attempt: runCtx.gateBlockedAttempts }, runCtx);
        if (result.content || result.reasoning_content) {
          const blockedTurn = { role: 'assistant', content: result.content || '' };
          if (result.reasoning_content) blockedTurn.reasoning_content = result.reasoning_content;
          pushApiMessage(apiMessages, blockedTurn, runCtx, false);
        }
        // 强化：完成门失败时明确要求工具落盘，避免「嘴硬规划 shell」空转
        const forceToolHint = [
          gate.hint,
          '',
          '强制执行：下一轮必须调用工具（write_file / edit_file / apply_patch / execute_shell / todo_write 等），禁止只输出计划。',
          '大文件策略：多次 write_file/apply_patch 分段写入，每次工具参数保持完整；不要把整份游戏源码塞进聊天消息。'
        ].join('\n');
        pushApiMessage(apiMessages, { role: 'user', content: forceToolHint }, runCtx, false);
        continue;
      }
      // gate 通过，计数器清零
      runCtx.gateBlockedAttempts = 0;

      const unresolvedToolError = formatUnresolvedToolErrors(runCtx);
      if (unresolvedToolError) {
        if (result.content || result.reasoning_content) {
          const failedFinalTurn = { role: 'assistant', content: result.content || '' };
          if (result.reasoning_content) failedFinalTurn.reasoning_content = result.reasoning_content;
          pushApiMessage(apiMessages, failedFinalTurn, runCtx);
        }
        const errorContent = [fullContent, `⚠️ ${unresolvedToolError}`].filter(Boolean).join('\n\n');
        as.status = 'error';
        if (hasUi()) deps().hooks.updateContextInfo(as);
        return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, unresolvedToolError);
      }

      if (!String(result.content || '').trim()) {
        const errorMessage = '模型已结束响应，但没有返回可显示的最终答复。请检查模型 ID、Base URL 或中转站的流式响应兼容性。';
        const errorContent = [fullContent, `⚠️ ${errorMessage}`].filter(Boolean).join('\n\n');
        return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, errorMessage);
      }

      if (result.content || result.reasoning_content) {
        const finalTurn = { role: 'assistant', content: result.content || '' };
        if (result.reasoning_content) finalTurn.reasoning_content = result.reasoning_content;
        pushApiMessage(apiMessages, finalTurn, runCtx);
      }
      as.status = 'done';
      if (!as.todosFromTool) as.todos.forEach(t => t.done = true);
      if (hasUi()) {
        deps().hooks.renderTodos(as);
        deps().hooks.updateContextInfo(as);
      }
      return K.makeLoopResult(fullContent || result.content || '(无回复)', finalStatus, apiMessages, runCtx);
    }

    const preparedCalls = result.tool_calls.map(toolCall => K.prepareToolCall(toolCall, toolsForRun, runCtx));
    const normalizedToolCalls = result.tool_calls.map((toolCall, index) => ({
      id: preparedCalls[index].id,
      type: 'function',
      function: {
        name: preparedCalls[index].name,
        arguments: JSON.stringify(preparedCalls[index].args || {})
      }
    }));
    const assistantTurn = {
      role: 'assistant',
      content: result.content || '',
      tool_calls: normalizedToolCalls
    };
    if (result.reasoning_content) assistantTurn.reasoning_content = result.reasoning_content;
    pushApiMessage(apiMessages, assistantTurn, runCtx);

    const stepElements = new Map();
    const scheduledResults = await K.scheduleToolCalls(preparedCalls, runCtx, {
      onStart(prepared) {
        const computerUseNarration = !runCtx.computerUseNarrated
          ? deps().hooks.getComputerUseNarration?.(prepared.name, prepared.args, runCtx)
          : '';
        if (computerUseNarration) {
          runCtx.computerUseNarrated = true;
          K.recordTimelineEvent({
            type: 'computer_use', content: computerUseNarration, toolName: prepared.name
          }, runCtx);
        }
        K.recordTimelineEvent({
          type: 'tool_call', name: prepared.name, args: prepared.args, callId: prepared.id
        }, runCtx);
        deps().hooks.onSupervisorEvent?.({
          type: 'tool-start',
          name: prepared.name,
          args: prepared.args
        }, runCtx);
        const bodyEl = getBodyEl();
        if (!bodyEl) return;
        if (computerUseNarration) {
          bodyEl.appendChild(deps().hooks.buildComputerUseNarrationElement(computerUseNarration, true));
        }
        const stepEl = deps().hooks.buildToolStepElement(prepared.name, prepared.args, '', null, 'running');
        stepEl.dataset.callId = prepared.id;
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
          replayed: executed.replayed,
          callId: executed.id,
          interrupted: shouldAbort()
        }, runCtx);
        let stepEl = stepElements.get(executed.index);
        if (!stepEl?.isConnected) {
          stepEl = Array.from(getBodyEl()?.querySelectorAll('.tool-step.is-running') || [])
            .find(el => el.dataset.callId === executed.id) || null;
        }
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
        if (hasUi()) {
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
    const visionMessages = [];
    updateUnresolvedToolErrors(scheduledResults, runCtx);
    const repeatedToolFailure = updateRepeatedToolFailureStreak(scheduledResults, runCtx);
    if (K.recordProgressAfterTools) K.recordProgressAfterTools(runCtx, scheduledResults);
    for (const executed of scheduledResults) {
      pushApiMessage(apiMessages, {
        role: 'tool',
        tool_call_id: executed.id,
        content: executed.output
      }, runCtx);
      const visionMessage = consumeMcpVisionMessage(executed.output, runCtx, modelCapabilities);
      if (visionMessage) visionMessages.push(visionMessage);
    }
    for (const message of visionMessages) {
      pushApiMessage(apiMessages, message, runCtx, false);
      if (Array.isArray(message.content)) ephemeralVisionMessages.add(message);
    }
    if (repeatedToolFailure) {
      const errorContent = [fullContent, `⚠️ ${repeatedToolFailure.message}`].filter(Boolean).join('\n\n');
      as.status = 'error';
      if (hasUi()) deps().hooks.updateContextInfo(as);
      return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, repeatedToolFailure.message);
    }
    const progressStop = K.evaluateProgressGovernor?.(runCtx);
    if (progressStop?.stop) {
      const errorContent = [fullContent, `⚠️ ${progressStop.message}`].filter(Boolean).join('\n\n');
      as.status = 'error';
      if (hasUi()) deps().hooks.updateContextInfo(as);
      return K.makeLoopResult(errorContent, progressStop.status || 'error', apiMessages, runCtx, progressStop.message);
    }
    if (K.syncRunPhase) K.syncRunPhase(runCtx);
    toolsForRun = K.getToolsForRun
      ? K.getToolsForRun(runCtx, K.snapshotTools())
      : toolsForRun;
    runCtx.exposedToolNames = new Set(
      (toolsForRun || []).map(tool => tool?.function?.name).filter(Boolean)
    );
    if (hasUi()) deps().hooks.renderRightSidebarFiles();
  }

  if (finalStatus === 'interrupted') {
    as.status = 'interrupted';
    if (hasUi()) {
      deps().hooks.updateContextInfo(as);
      deps().hooks.onRunAborted?.(runCtx);
    }
    return K.makeLoopResult(fullContent, 'interrupted', apiMessages, runCtx);
  }

  const limitMessage = `Agent 已达到 ${maxIterations} 次最大迭代限制，任务未能正常收尾。请检查模型是否反复调用工具、待办是否无法完成，或中转站是否返回了错误的工具调用。`;
  const unresolvedToolError = formatUnresolvedToolErrors(runCtx);
  const errorMessage = [limitMessage, unresolvedToolError].filter(Boolean).join('\n\n');
  const errorContent = [fullContent, `⚠️ ${errorMessage}`].filter(Boolean).join('\n\n');
  as.status = 'error';
  if (hasUi()) deps().hooks.updateContextInfo(as);
  return K.makeLoopResult(errorContent, 'error', apiMessages, runCtx, errorMessage);
}

  K.getLatestUserPrompt = getLatestUserPrompt;
  K.getExecutedEffectiveToolName = getExecutedEffectiveToolName;
  K.requiresWindowsMcp = requiresWindowsMcp;
  K.updateUnresolvedToolErrors = updateUnresolvedToolErrors;
  K.formatUnresolvedToolErrors = formatUnresolvedToolErrors;
  K.updateRepeatedToolFailureStreak = updateRepeatedToolFailureStreak;
  K.inferDirectImageAspectRatio = inferDirectImageAspectRatio;
  K.consumeMcpVisionMessage = consumeMcpVisionMessage;
  K.runDirectImageGeneration = runDirectImageGeneration;
  K.runAgentLoop = runAgentLoop;
})(window.YanKernel);

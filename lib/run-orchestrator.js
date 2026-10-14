'use strict';

// Run admission, provider dispatch and completion (T6.1). Mutable singletons
// remain owned by main.js; replaceable instances are accessed through getters.

const crypto = require('crypto');
const { ModelLoopWatch } = require('./model-loop-watch');
const workspaceSandbox = require('./workspace-sandbox');
const fsp = require('fs/promises');
const { extractExplicitPolicyInstruction } = require('./behavior-policy');
const { evolutionEnabled, isolateWorkMode } = require('./work-mode-isolation');
const fs = require('fs');
const { DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond, OPENCODE_VERSION, isSelectedSkillReadOnlyRequest, openCodeErrorDetail } = require('./opencode-sidecar');
const { summarizeOpenCodeDiffs } = require('./run-change-summary');
const { isTrustworthyMeasurement, measurementKey, normalizeMeasurementStore, smoothMeasurement } = require('./input-throughput');
const { writePlanDocument } = require('./plan-document');
const { buildTaskReferenceContext } = require('./task-reference-context');
const { resolveSelectedPlugins, selectedPluginContext } = require('./plugins/selection');
const { imageEditContext } = require('./image-edit-context');
const { lanesFor, laneCount } = require('./run-limits');
const { computerControlReviewRequest, observeControlEvent, isComputerControlToolName } = require('./computer-control-review');

async function startRun(ctx, request = {}, internal = {}) {
  const {
    manualContextCompressions,
    configStore,
    modelState,
    openCodeActiveRuns,
    openCodeRunAdmissions,
    MAX_CONCURRENT_AGENT_RUNS,
    skillsRuntime,
    harnessPolicy,
    longTermMemory,

    harnessBridge,
    continualHarness,
    sessionStore,
    refreshAgentRuntimeActivity,
    recovery,
    generatedMedia,
    workspaceRuntime,

    getYanCore,
    mcpRuntimeConfig,
    visionRelay,
    getOpenCodeSidecar,
    getOpenCodeProviderAdapter,
    providerConfig,
    bridges,
    skillsDir,
    yanagent,
    STABLE_DATA_DIR,
    getMainWindow,
    withOpenCodeBackgroundLease,
    reviewCompletedRunMemory
  } = ctx;
  const admittedRunId = String(request.runId || crypto.randomUUID());
  let admissionPending = false;
  let coreTurnStarted = false;
  let coreTurn = null;
  const runLane = 'interactive';
  try {
    if (manualContextCompressions.has(String(request.yanSessionId || ''))) {
      return { ok: false, error: '上下文正在压缩，请完成后再开始工作' };
    }
    if (request.backgroundBashGuard && !request.backgroundBashGuard()) return { ok: false, discard: true };
    const targetSession = String(request.yanSessionId || '');
    await ctx.backgroundBash?.ready;
    if (targetSession && sessionStore.isSessionDeleted?.(targetSession)) return { ok: false, code: 'SESSION_DELETED', error: '任务已永久删除或正在清理' };
    if (targetSession && ([...openCodeActiveRuns.values()].some(run => run.yanSessionId === targetSession)
      || [...openCodeRunAdmissions.values()].includes(targetSession))) return { ok: false, code: 'SESSION_BUSY', error: '当前会话仍在运行' };
    const cfg = structuredClone(configStore.loadConfig());
    if (configStore.memoryDeleting) return { ok: false, error: '正在删除记忆，请稍后再试' };
    const memorySettings = require('./memory-settings').normalizeMemorySettings(cfg.memory);
    request = { ...request, gitPreferences: require('./git-preferences').normalizeGitPreferences(cfg.git), memoryEnabled: memorySettings.enabled, customInstructions: memorySettings.instructions };
    if (request.modelSelection) {
      const wanted = request.modelSelection;
      providerConfig.ensureProviderConfigs(cfg);
      const enabled = providerConfig.getEnabledConnections(cfg).some(c => c.providerId === wanted.providerId && c.supplierId === wanted.supplierId);
      const model = enabled && providerConfig.getProviderModels(cfg, wanted.providerId, wanted.supplierId)
        .find(m => m.id === wanted.modelId && m.enabled !== false && require('./model-roles').getModelType(wanted.providerId,m) === 'text');
      if (!model) {
        return { ok:false, error:'所选模型已不可用，请重新选择' };
      }
      cfg.agentModel = { ...wanted, modelType:'text' };
      if (['low','medium','high','xhigh','max'].includes(request.reasoningMode)) cfg.api.reasoningSpeed = request.reasoningMode;
    }
    const selection = modelState.normalizeAgentModelSelection(cfg);
    if (selection.modelType !== 'text') {
      return { ok: false, error: 'Yan Kernel 只能启动文本/工具模型。' };
    }
    const limit = MAX_CONCURRENT_AGENT_RUNS;
    if (laneCount(openCodeActiveRuns, openCodeRunAdmissions, runLane) >= limit) {
      return { ok: false, code: 'RUN_LIMIT', error: `并发任务已达上限（${limit}个），请稍后再试。` };
    }
    request = { ...request, runId: admittedRunId };
    openCodeRunAdmissions.set(admittedRunId, String(request.yanSessionId || ''));
    lanesFor(openCodeRunAdmissions).set(admittedRunId, runLane);
    admissionPending = true;
    const workspaceInput = Object.prototype.hasOwnProperty.call(request, 'workspace')
      ? request.workspace
      : cfg.workspace;
    const workspace = workspaceSandbox.normalizeWorkspace(workspaceInput);
    request.selectedPlugins = resolveSelectedPlugins(STABLE_DATA_DIR, request.selectedPlugins, workspace, cfg.externalAgents);
    if (memorySettings.enabled && workspace && !(cfg.memoryWorkspaces || []).includes(workspace)) {
      cfg.memoryWorkspaces = [...(cfg.memoryWorkspaces || []), workspace];
      const persistedCfg = configStore.loadConfig();
      persistedCfg.memoryWorkspaces = [...new Set([...(persistedCfg.memoryWorkspaces || []), workspace])];
      configStore.saveConfig(persistedCfg);
    }
    const executionDirectory = workspace || skillsRuntime.getNoWorkspaceAgentDirectory(request.yanSessionId);
    await fsp.mkdir(executionDirectory, { recursive: true });
    const prompt = require('./git-preferences').expandGitWorkflowPrompt(String(request.prompt || '').trim(), cfg.git)
      || (Array.isArray(request.selectedSkills) && request.selectedSkills.length
        ? 'Apply the explicitly selected Skills to the current task.'
        : 'Continue the current task.');
    // Activate an explicit durable user rule before this run snapshots
    // Harness state. This removes the A->B race where background memory
    // review had not finished by the time the next task was constructed.
    if (evolutionEnabled(request)) {
      const startingPolicy = extractExplicitPolicyInstruction({ prompt, history: request.history });
      if (startingPolicy?.text) {
        const persisted = await harnessPolicy.persistExplicitUserPolicy({
          instructions: startingPolicy.text,
          scope: 'global',
          workspace,
          runId: admittedRunId,
          sessionId: String(request.yanSessionId || ''),
          source: 'explicit_user_policy_start'
        });
        if (!persisted.ok) {
          console.warn(`[harness] start-of-run policy activation failed for ${admittedRunId}: ${persisted.error}`);
        }
      }
    }
    const memoryQuery = [
      prompt,
      ...(Array.isArray(request.history) ? request.history : [])
        .slice(-8)
        .filter(message => message?.role === 'user')
        .map(message => String(message?.content || '').slice(0, 1_500))
    ].filter(Boolean).join('\n').slice(0, 10_000);
    const runWorkMode = ['normal', 'plan', 'goal', 'evolution'].includes(String(request.workMode || ''))
      ? String(request.workMode)
      : (['normal', 'plan', 'goal', 'evolution'].includes(cfg.agent?.workMode) ? cfg.agent.workMode : 'normal');
    request.workMode = runWorkMode === 'evolution' ? 'normal' : runWorkMode;
    const isolated = isolateWorkMode(request);
    for (const key of Object.keys(request)) if (!(key in isolated)) delete request[key];
    Object.assign(request, isolated);
    const retrievedMemory = request.utility || !memorySettings.enabled
      ? { context: '' }
      : longTermMemory.query({
        query: memoryQuery,
        workspace,
        maxChars: 3_600,
        limit: 12,
        excludeSourceKinds: ['agi_memory_consolidation']
      });
    const runId = admittedRunId;
    const yanSessionId = String(request.yanSessionId || '');
    const runStartedAt = Date.now();
    const evolutionMode = evolutionEnabled(request);
    try { fs.rmSync(harnessBridge.pendingHarnessRequestPath(runId), { force: true }); } catch {}
    if (evolutionMode && workspace) {
      try { await continualHarness.recoverRejectedAgentRefinements({ scope: 'workspace', workspace }); } catch (error) {
        console.warn(`[harness] workspace policy recovery failed for ${workspace}:`, error?.message || error);
      }
    }
    // Every workspace run gets a per-run context file: it authorizes the
    // yan_workspace (worktree/impact) and yan_analysis tools per call. The
    // Harness refinement tools stay separately task-gated to evolution mode,
    // so registering the file here exposes nothing extra.
    if (evolutionMode || (workspace && !request.utility)) {
      harnessBridge.registerHarnessRunContext({
        runId,
        sessionId: yanSessionId,
        workspace,
        allowFileRead: cfg.permissions?.allowFileRead !== false,
        allowNetwork: cfg.permissions?.allowNetwork !== false,
        allowFileWrite: cfg.permissions?.allowFileWrite !== false
      });
    }
    const harnessBaselines = evolutionMode ? {
      global: continualHarness.load({ scope: 'global' }),
      ...(workspace ? { workspace: continualHarness.load({ scope: 'workspace', workspace }) } : {})
    } : {};
    const evolutionSelection = evolutionMode
      ? continualHarness.evolutionContext({ workspace, query: memoryQuery, maxChars: 6_000, maxEntries: 6 })
      : { entries: [], policies: [], text: '' };
    const behaviorPolicies = evolutionSelection.policies;
    const harnessContext = evolutionSelection.text;
    if (evolutionMode) {
      harnessBridge.registerHarnessUsage({
        runId,
        workspace,
        sessionId: yanSessionId,
        entries: evolutionSelection.entries || []
      });
    }
    const authoritativeSession = yanSessionId ? await sessionStore.readSessionRecord(yanSessionId) : null;
    if (yanSessionId && (!authoritativeSession || sessionStore.isSessionDeleted?.(yanSessionId))) throw Object.assign(new Error('任务不存在或已永久删除'), { code: 'SESSION_DELETED' });
    const visionAbortController = new AbortController();
    openCodeActiveRuns.set(runId, {
      runLane,
      task: null,
      utility: request.utility === true,
      startedAt: runStartedAt,
      yanSessionId,
      workspace,
      executionDirectory,
      externalAgentReadOnly: cfg.agent?.sandboxMode === 'read-only' || request.workMode === 'plan' || cfg.permissions?.allowFileWrite === false,
      visionAbortController,
      selection,
      prompt
    });
    openCodeRunAdmissions.delete(runId);
    admissionPending = false;
    refreshAgentRuntimeActivity();
    recovery.ensureOpenCodeReconcileRun(runId, { runLane, yanSessionId, workspace, startedAt: runStartedAt });
    generatedMedia.registerMediaWorkspace(runId, workspace);
    // Repo map is frozen into this run's request: the sidecar embeds it in the
    // first user turn, which must stay stable for kernel prompt caching. It is
    // read non-blockingly (warmed at app start / workspace switch) so a cold
    // build never delays the first reply.
    if (workspace && !request.utility && !request.skillOnly) {
      request.repoMap = workspaceRuntime.peekRepoMap(workspace);
    }
    const requestedWorkMode = request.workMode;
    const workMode = request.utility ? 'normal' : requestedWorkMode;
    try {
      coreTurn = getYanCore().startTurn({
        threadId: yanSessionId || `thread_${runId}`,
        turnId: runId,
        workspace,
        title: authoritativeSession?.title || '',
        configSnapshot: {
          providerId: selection.providerId,
          supplierId: selection.supplierId,
          modelId: selection.modelId,
          modelType: selection.modelType,
          workMode,
          accessMode: cfg.agent?.accessMode || 'request',
          inputTokensPerSecond: Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
            cfg.api?.inputTokensPerSecond || cfg.agent?.inputTokensPerSecond
          )),
          enableSubagents: true,
        },
        intent: {
          prompt,
          attachments: request.attachments,
          selectedSkills: request.selectedSkills,
          selectedPlugins: request.selectedPlugins,
          subagentRoles: Array.isArray(request.subagentRoles) ? request.subagentRoles : [],
          workMode,
        }
      });
      coreTurnStarted = true;
    } catch (error) {
      const detail = error?.message || String(error);
      console.error('[yan-core] failed to start Turn; refusing to start an untracked provider run:', detail);
      try { fs.rmSync(harnessBridge.pendingHarnessRequestPath(runId), { force: true }); } catch {}
      harnessBridge.removeHarnessRunContext(runId);
      generatedMedia.releaseMediaWorkspace(runId);
      openCodeActiveRuns.delete(runId);
      recovery.openCodeRunReconcile.delete(runId);
      refreshAgentRuntimeActivity();
      return { ok: false, code: error?.code || 'YAN_CORE_START_FAILED', error: `Yan Core 无法启动本轮任务：${detail}` };
    }
    const resolvedSkills = await skillsRuntime.selectedRunSkills(request.selectedSkills, cfg, { workspace, workMode });
    if (resolvedSkills.error) {
      if (coreTurnStarted) getYanCore().completeTurn(runId, { status: 'error', error: resolvedSkills.error });
      harnessBridge.removeHarnessRunContext(runId);
      generatedMedia.releaseMediaWorkspace(runId);
      openCodeActiveRuns.delete(runId);
      ctx.backgroundBash?.settled(runId);
      refreshAgentRuntimeActivity();
      recovery.openCodeRunReconcile.delete(runId);
      return { ok: false, error: resolvedSkills.error };
    }
    const runSelectedSkills = resolvedSkills.skills;
    const skippedSkills = resolvedSkills.skippedSkills || [];
    const desktopTask = mcpRuntimeConfig.isDesktopTaskRequest({ prompt, selectedSkills: runSelectedSkills });
    const skillOnly = isSelectedSkillReadOnlyRequest({
      prompt,
      selectedSkills: runSelectedSkills
    });
    const emitVisionEvent = (type, data = {}) => {
      recovery.sendOpenCodeRendererEvent(runId, { type, data });
    };
    const relayed = await visionRelay.relayImagesForTextModel(
      cfg,
      selection,
      { ...request, prompt },
      runId,
      emitVisionEvent,
      visionAbortController.signal
    );
    if (visionAbortController.signal.aborted) {
      const error = new Error('Aborted');
      error.name = 'AbortError';
      throw error;
    }
    const sidecar = getOpenCodeSidecar();
    const providerAdapter = getOpenCodeProviderAdapter(sidecar);
    const mediaModels = providerConfig.getConfiguredMediaModels(cfg);
    const openCodeMcpServers = mcpRuntimeConfig.getOpenCodeMcpServers(cfg, {
      workspace,
      workMode,
      evolutionMode,
      prompt,
      attachments: request.attachments,
      selectedSkills: runSelectedSkills,
      desktopTask,
      runId,
      yanSessionId,
      skillOnly
    });
    const capabilityContext = mcpRuntimeConfig.getOpenCodeCapabilityContext({ ...cfg, workspace }, openCodeMcpServers, { skippedSkills });
    const openCodeConfig = mcpRuntimeConfig.getOpenCodeRuntimeConfig(cfg, {
      mcpServers: openCodeMcpServers,
      taskId: runId,
      skillOnly
    });
    const loopWatch = new ModelLoopWatch();
    const controlEvidence = new Map();
    let settledResult;
    const reviewToolCalls = result => {
      const calls = Array.isArray(result?.toolCalls) ? result.toolCalls : [];
      return calls.some(call => isComputerControlToolName(call?.name))
        ? calls : [...calls, ...controlEvidence.values()];
    };
    let loopSettings = cfg.general;
    let loopSettingsCheckedAt = Date.now();
    const emitOpenCodeEvent = event => {
      observeControlEvent(controlEvidence, event);
      require('./computer-control-lifecycle').emit('tool-event', runId, event);
      ctx.backgroundBash?.observe(runId, event);
      if (event?.type === 'yan.delivery.contract.updated') {
        const activeRun = openCodeActiveRuns.get(runId);
        if (activeRun) activeRun.deliveryContract = event.data?.contract || null;
      }
      bridges.trackBrowserAgentToolClaim(runId, event);
      bridges.trackSessionAgentToolClaim(runId, event);
      recovery.sendOpenCodeRendererEvent(runId, event);
      // Config loading reads/decrypts disk state; do not do it per token.
      if (Date.now() - loopSettingsCheckedAt >= 1000) {
        loopSettings = configStore.loadConfig().general;
        loopSettingsCheckedAt = Date.now();
      }
      const loopWarning = loopWatch.observe(event, loopSettings);
      if (loopWarning) recovery.sendOpenCodeRendererEvent(runId, loopWarning);
      const eventData = event?.data || event?.properties || {};
      if (event?.type === 'session.diff' && Array.isArray(eventData.diff)) {
        recovery.sendOpenCodeRendererEvent(runId, {
          type: 'yan.review.updated',
          data: summarizeOpenCodeDiffs(workspace, eventData.diff, {
            includeDiff: true,
            startTime: openCodeActiveRuns.get(runId)?.startedAt || runStartedAt
          })
        });
      } else if (event?.type === 'file.edited') {
        recovery.sendOpenCodeRendererEvent(runId, {
          type: 'yan.review.invalidated',
          data: { file: String(eventData.file || '') }
        });
      }
    };
    const taskReferenceContext = await buildTaskReferenceContext({ ...request, prompt }, sessionStore, skillsRuntime);
    if (visionAbortController.signal.aborted) {
      const error = new Error('Aborted'); error.name = 'AbortError'; throw error;
    }
    const modelPrompt = [relayed.prompt || prompt, taskReferenceContext, selectedPluginContext(request.selectedPlugins), imageEditContext(request.attachments, executionDirectory)].filter(Boolean).join('\n\n');
    if (request.backgroundBashGuard && !request.backgroundBashGuard()) throw new Error('后台唤醒已取消');
    ctx.backgroundBash?.register(runId, { ...request, workspace, yanSessionId, runInternal: internal });
    const intelligentUiAvailable = capabilityContext.mcpServers?.some(server => server.id === 'yan_session') === true;
    const intelligentUiAllowed = require('./intelligent-ui').canCreateIntelligentUi({
      ...request, workMode, skillOnly, permissions: cfg.permissions, sandboxMode: cfg.agent?.sandboxMode,
      intelligentUiEnabled: cfg.experiments?.intelligentUi === true, intelligentUiAvailable,
    });
    openCodeActiveRuns.get(runId).intelligentUiAllowed = intelligentUiAllowed;
    openCodeActiveRuns.get(runId).intelligentUiNetworkAllowed = cfg.permissions?.allowNetwork !== false;
    const task = providerAdapter.startTurn({
      ...request,
      runId,
      yanConfigSnapshotId: coreTurn?.configSnapshotId || '',
      language: cfg.language,
      prompt: modelPrompt,
      attachments: relayed.attachments,
      workspace: executionDirectory,
      userWorkspace: workspace,
      hasUserWorkspace: !!workspace,
      providerId: selection.providerId,
      modelId: selection.modelId,
      inputTokensPerSecond: Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
        cfg.api?.inputTokensPerSecond || cfg.agent?.inputTokensPerSecond
      )),
      workMode,
      measuredInputTokensPerSecond: Number(
        cfg.api?.inputThroughput?.[measurementKey(selection.providerId, selection.modelId)]?.tokensPerSecond
      ) || 0,
      accessMode: cfg.agent?.accessMode || 'request',
      replyVerbosity: cfg.agent?.replyVerbosity || 'default',
      sandboxMode: cfg.agent?.sandboxMode || 'full',
      externalAgentsEnabled: cfg.externalAgents?.enabled === true,
      reasoningSummary: cfg.agent?.reasoningSummary || 'auto',
      desktopTask,
      permissions: cfg.permissions,
      enableSubagents: true,
      subagentRoles: Array.isArray(request.subagentRoles) ? request.subagentRoles : [],
      subagentMaxChildren: cfg.agent?.subagentMaxChildren,
      mediaModels,
      yanSkillDirectory: skillsDir,
      mcpServers: openCodeMcpServers,
      skillOnly,
      selectedSkills: runSelectedSkills,
      skippedSkills,
      availableSkills: capabilityContext.skills,
      availableMcpServers: capabilityContext.mcpServers,
      yanBrowserAvailable: capabilityContext.yanBrowserAvailable,
      intelligentUiEnabled: cfg.experiments?.intelligentUi === true,
      intelligentUiAvailable,
      openCodeConfig,
      behaviorPolicies,
      visionRelay: relayed.relay,
      handoff: authoritativeSession?.handoff || null,
      memoryContext: retrievedMemory.context || '',
      harnessContext
    }, emitOpenCodeEvent);
    openCodeActiveRuns.set(runId, {
      ...openCodeActiveRuns.get(runId),
      task,
      utility: request.utility === true,
      startedAt: runStartedAt,
      yanSessionId,
      workspace,
      executionDirectory,
      visionAbortController,
      selection,
      prompt: relayed.prompt || prompt
    });
    const completion = task.then(async result => {
      settledResult = result;
      if (coreTurnStarted) getYanCore().completeTurn(runId, result);
      const performance = result?.performance;
      if (performance) {
        const outputTps = performance.outputTokensPerSecond
          ?? performance.visibleOutputTokensPerSecond
          ?? performance.providerOutputTokensPerSecond;
        const visibleOutputTps = performance.visibleOutputTokensPerSecond;
        const providerOutputTps = performance.providerOutputTokensPerSecond;
        const inputTps = performance.effectiveInputTokensPerSecond;
        const inputP50 = performance.medianInputTokensPerSecond;
        const inputP10 = performance.p10InputTokensPerSecond;
        const cacheHit = performance.cacheHitRate;
        console.log([
          `[opencode perf] run=${runId}`,
          `ttft=${performance.firstTtftMs ?? 'n/a'}ms`,
          `input_tps=${Number.isFinite(inputTps) ? inputTps.toFixed(1) : 'n/a'}`,
          `input_p50=${Number.isFinite(inputP50) ? inputP50.toFixed(1) : 'n/a'}`,
          `input_p10=${Number.isFinite(inputP10) ? inputP10.toFixed(1) : 'n/a'}`,
          `slow_steps=${Number(performance.requestsBelow2000TokensPerSecond) || 0}/${Number(performance.requestCount) || 0}`,
          `decode=${performance.decodeMs ?? 'n/a'}ms`,
          `output_tps=${Number.isFinite(outputTps) ? outputTps.toFixed(1) : 'n/a'}`,
          `visible_output_tps=${Number.isFinite(visibleOutputTps) ? visibleOutputTps.toFixed(1) : 'n/a'}`,
          `provider_output_tps=${Number.isFinite(providerOutputTps) ? providerOutputTps.toFixed(1) : 'n/a'}`,
          `cache_hit=${Number.isFinite(cacheHit) ? `${(cacheHit * 100).toFixed(1)}%` : 'n/a'}`,
          `events=${Number(performance.streamEvents) || 0}`,
          `first_desktop_action=${performance.firstDesktopActionMs ?? 'n/a'}ms`,
          `first_desktop_progress=${performance.firstDesktopProgressMs ?? 'n/a'}ms`,
          `desktop_recoveries=${Number(performance.desktopActionRecoveryCount) || 0}`
        ].join(' '));
      }
      // Close the throughput loop: learn the real prefill rate for this
      // (provider, model) pair and feed it to the next run. Works for any
      // vendor — nothing is model-specific here.
      try {
        if (isTrustworthyMeasurement(result?.performance)) {
          const measuredCfg = configStore.loadConfig();
          const key = measurementKey(selection?.providerId, selection?.modelId);
          if (key !== ':') {
            const store = measuredCfg.api.inputThroughput || {};
            const previousEntry = store[key] || {};
            const metric = result.performance.inputThroughputMetric;
            const sameMetric = previousEntry.metric === metric;
            store[key] = {
              tokensPerSecond: smoothMeasurement(
                sameMetric ? previousEntry.tokensPerSecond : 0,
                result.performance.effectiveInputTokensPerSecond
              ),
              samples: (sameMetric ? Number(previousEntry.samples) || 0 : 0) + 1,
              updatedAt: Date.now(),
              metric
            };
            measuredCfg.api.inputThroughput = normalizeMeasurementStore(store);
            configStore.saveConfig(measuredCfg);
          }
        }
      } catch (measurementError) {
        console.warn('[opencode] Input throughput measurement update failed:', measurementError?.message || measurementError);
      }
      await yanagent.writeRunRollbackSnapshot({
        workspace,
        sessionId: yanSessionId,
        runId,
        rollbackChanges: result?.rollbackChanges
      });
      recovery.flushOpenCodeRendererEvents(runId);
      const reviewSummary = summarizeOpenCodeDiffs(workspace, result?.changes, {
        includeDiff: true,
        startTime: runStartedAt
      });
      const { rollbackChanges: _rollbackChanges, ...rendererResult } = result || {};
      const completedResult = { ...rendererResult, reviewSummary };
      if (request.workMode === 'plan' && result?.status === 'done' && String(result.text || '').trim()) {
        try {
          const planFile = writePlanDocument({
            dataDir: STABLE_DATA_DIR,
            text: result.text,
            reasoning: result.reasoning
          });
          if (planFile) completedResult.planFile = planFile;
        } catch (planError) {
          console.warn('[plan] Failed to write plan document:', planError?.message || planError);
        }
      }
      await internal.onCompleted?.(completedResult, runId);
      recovery.completeOpenCodeReconcileRun(runId, completedResult);
      if (getMainWindow() && !getMainWindow().isDestroyed()) {
        getMainWindow().webContents.send('opencode:completed', { runId, result: completedResult });
      }
      return completedResult;
    }).catch(async error => {
      console.error(`[opencode] Run ${runId} failed:`, error);
      recovery.flushOpenCodeRendererEvents(runId);
      const failedResult = {
        openCodeVersion: OPENCODE_VERSION,
        status: 'error',
        text: '',
        reasoning: '',
        toolCalls: [],
        todos: [],
        changes: [],
        usage: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0, cost: 0 },
        contextTokens: 0,
        error: openCodeErrorDetail(error)
      };
      settledResult = { ...failedResult, toolCalls: reviewToolCalls(settledResult) };
      if (coreTurnStarted) getYanCore().completeTurn(runId, failedResult);
      try { await internal.onCompleted?.(failedResult, runId); }
      catch (saveError) { console.error('[run] result persistence failed:', saveError); }
      recovery.completeOpenCodeReconcileRun(runId, failedResult);
      if (getMainWindow() && !getMainWindow().isDestroyed()) {
        getMainWindow().webContents.send('opencode:completed', {
          runId,
          result: failedResult
        });
      }
      return failedResult;
    }).finally(() => {
      require('./computer-control-lifecycle').emit('run-ended', runId);
      // Release belongs to the host. Review cannot depend on an optional model
      // end_session/schedule_refinement call or on a successful provider finish.
      const reviewResult = { ...settledResult, toolCalls: reviewToolCalls(settledResult) };
      const controlReview = computerControlReviewRequest({ runId, sessionId: yanSessionId,
        workspace, controlReleased: true, toolCalls: reviewResult.toolCalls, result: reviewResult });
      const normalReview = !request.utility && ['done', 'error'].includes(reviewResult.status)
        && reviewResult.userRequestedFinish !== true;
      if (controlReview || normalReview) {
        if (controlReview) {
          try { harnessBridge.writeHarnessRefinementRequest(runId, controlReview); }
          catch (error) { console.warn(`[harness] computer-control review was not queued for ${runId}:`, error?.message || error); }
        }
        // Invoke synchronously so the reviewer consumes the queue before cleanup.
        try {
          void Promise.resolve(withOpenCodeBackgroundLease(() => reviewCompletedRunMemory({
            sidecar, selection, request, result: reviewResult, prompt, workspace,
            yanSessionId, runId, harnessBaselines, evolutionMode
          }))).catch(error => console.warn(`[harness] review failed for ${runId}:`, error?.message || error));
        } catch (error) { console.warn(`[harness] review failed for ${runId}:`, error?.message || error); }
      }
      try { fs.rmSync(harnessBridge.pendingHarnessRequestPath(runId), { force: true }); } catch {}
      harnessBridge.removeHarnessRunContext(runId);
      generatedMedia.releaseMediaWorkspace(runId);
      bridges.notifyBrowserAgentRelease(runId);
      bridges.clearBrowserAgentToolClaims(runId);
      bridges.clearSessionAgentToolClaims(runId);
      openCodeActiveRuns.delete(runId);
      ctx.backgroundBash?.settled(runId);
      refreshAgentRuntimeActivity();
    });
    return { ok: true, runId, version: OPENCODE_VERSION };
  } catch (error) {
    const runId = String(request.runId || '');
    if (coreTurnStarted) getYanCore().completeTurn(runId, { status: 'error', error: openCodeErrorDetail(error) });
    if (admissionPending) openCodeRunAdmissions.delete(admittedRunId);
    harnessBridge.removeHarnessRunContext(runId);
    generatedMedia.releaseMediaWorkspace(runId);
    bridges.clearSessionAgentToolClaims(runId);
    openCodeActiveRuns.delete(runId);
    ctx.backgroundBash?.settled(runId);
    refreshAgentRuntimeActivity();
    console.error('[opencode] start-run failed:', error);
    return { ok: false, error: error instanceof Error && error.message ? error.message : openCodeErrorDetail(error) };
  } finally {
    lanesFor(openCodeRunAdmissions).delete(admittedRunId);
  }
}

module.exports = { startRun };

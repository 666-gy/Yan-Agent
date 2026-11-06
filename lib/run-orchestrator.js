'use strict';

// Run admission, provider dispatch and completion (T6.1). Mutable singletons
// remain owned by main.js; replaceable instances are accessed through getters.

const crypto = require('crypto');
const { ModelLoopWatch } = require('./model-loop-watch');
const workspaceSandbox = require('./workspace-sandbox');
const fsp = require('fs/promises');
const { extractExplicitPolicyInstruction } = require('./behavior-policy');
const { UNCENSORED_CONTENT_RE, isUncensoredPreset } = require('./preset-scope');
const { evolutionEnabled, isolateWorkMode } = require('./work-mode-isolation');
const fs = require('fs');
const { DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond, OPENCODE_VERSION, isSelectedSkillReadOnlyRequest, openCodeErrorDetail } = require('./kernel-policy');
const { summarizeOpenCodeDiffs } = require('./run-change-summary');
const { isTrustworthyMeasurement, measurementKey, normalizeMeasurementStore, smoothMeasurement } = require('./input-throughput');
const { writePlanDocument } = require('./plan-document');
const { buildTaskReferenceContext } = require('./task-reference-context');
const { resolveSelectedPlugins, selectedPluginContext } = require('./plugins/selection');
const { imageEditContext } = require('./image-edit-context');
const { lanesFor, laneCount } = require('./run-limits');
const { computerControlReviewRequest, observeControlEvent, isComputerControlToolName } = require('./computer-control-review');

// Subagents inherit the parent model unless the user picked a different model
// for them in settings; an override equal to the parent is not forwarded.
function subagentModelOverride(cfg, selection) {
  const stored = cfg.agent?.subagentModel;
  if (!stored?.modelId) return null;
  if (String(stored.providerId || '') === String(selection.providerId || '')
    && String(stored.modelId || '') === String(selection.modelId || '')) return null;
  return {
    providerId: String(stored.providerId || ''),
    supplierId: String(stored.supplierId || ''),
    modelId: String(stored.modelId || ''),
    modelName: String(stored.name || stored.modelId || '')
  };
}

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
  const voiceCall = require('./voice-call-agent').isVoiceCall(request);
  if (voiceCall) request = { ...request, yanSessionId: '', selectedSkills: [], selectedPlugins: [], workMode: 'normal', handoff: null };
  const admittedRunId = String(request.runId || crypto.randomUUID());
  let admissionPending = false;
  let coreTurnStarted = false;
  let coreTurn = null;
  const suggestion = request.utility === true && request.utilityKind === 'prompt-suggestion';
  const runLane = suggestion ? 'suggestion' : 'interactive';
  const sessionBusy = sessionId => sessionId && (
    [...openCodeActiveRuns.values()].some(run => run.yanSessionId === sessionId && (suggestion || run.runLane !== 'suggestion'))
    || [...openCodeRunAdmissions].some(([id, owner]) => owner === sessionId
      && (suggestion || lanesFor(openCodeRunAdmissions).get(id) !== 'suggestion'))
  );
  try {
    if (manualContextCompressions.has(String(request.yanSessionId || ''))) {
      return { ok: false, error: '上下文正在压缩，请完成后再开始工作' };
    }
    if (request.backgroundBashGuard && !request.backgroundBashGuard()) return { ok: false, discard: true };
    const targetSession = String(request.yanSessionId || '');
    await ctx.nestedSessions?.ready;
    if (request.utility && ctx.nestedSessions?.group(targetSession)?.wake) return { ok: false, code: 'NESTED_SLEEPING', error: '主会话正在等待子会话结果' };
    const nestedChild = ctx.nestedSessions?.child(targetSession);
    if (nestedChild) {
      if (nestedChild.status !== 'ready') throw Error('子会话工作区尚未就绪');
      request = { ...request, workspace: nestedChild.workspace };
    }
    await ctx.backgroundBash?.ready;
    
    if (internal.shouldStart && !internal.shouldStart()) return { ok: false, error: '协作已中止' };
    if (targetSession && sessionStore.isSessionDeleted?.(targetSession)) return { ok: false, code: 'SESSION_DELETED', error: '任务已永久删除或正在清理' };
    if (sessionBusy(targetSession)) return { ok: false, code: 'SESSION_BUSY', error: '当前会话仍在运行' };
    const cfg = structuredClone(configStore.loadConfig());
    if (nestedChild?.policy) {
      // A continuing child cannot widen the permission policy it inherited.
      const inherited = nestedChild.policy.agent || {};
      const modes = ['read-only', 'workspace-write', 'full'];
      if (modes.indexOf(inherited.sandboxMode) >= 0 && modes.indexOf(inherited.sandboxMode) < modes.indexOf(cfg.agent?.sandboxMode || 'full')) cfg.agent.sandboxMode = inherited.sandboxMode;
      if (inherited.accessMode && inherited.accessMode !== 'full') cfg.agent.accessMode = inherited.accessMode;
      cfg.permissions = { ...cfg.permissions };
      for (const [key, value] of Object.entries(nestedChild.policy.permissions || {})) if (value === false) cfg.permissions[key] = false;
      cfg.externalAgents = { ...cfg.externalAgents, enabled: false };
    }
    if (configStore.memoryDeleting) return { ok: false, error: '正在删除记忆，请稍后再试' };
    const memorySettings = require('./memory-settings').normalizeMemorySettings(cfg.memory);
    request = { ...request, gitPreferences: require('./git-preferences').normalizeGitPreferences(cfg.git), memoryEnabled: memorySettings.enabled, customInstructions: voiceCall ? '' : memorySettings.instructions };
    const memorySession = targetSession ? await sessionStore.readSessionRecord(targetSession) : null;
    // The renderer marker alone is not authoritative; bind it to the stored
    // session/task. Also recover execution intent for manual resends.
    request.scheduledTaskContext = require('./scheduled-task-context').resolveScheduledTaskContext(request, memorySession, ctx.scheduledTasksStore);
    request.forkHistory = !!memorySession?.forkOrigin && !request.openCodeSessionId;
    request.memoryEnabled = typeof memorySession?.memoryEnabled === 'boolean' ? memorySession.memoryEnabled : memorySettings.enabled;
    request.memoryWriteEnabled = request.memoryEnabled && memorySession?.memoryWriteEnabled !== false;
    memorySettings.enabled = request.memoryEnabled;
    if (memorySession && typeof memorySession.memoryEnabled !== 'boolean') {
      await sessionStore.saveSession({ ...memorySession, memoryEnabled: request.memoryEnabled, memoryWriteEnabled: request.memoryWriteEnabled });
    }
    
    const magpie = require('./magpie-config').readMagpieConfig(STABLE_DATA_DIR);
    if (request.modelSelection && !magpie) {
      const wanted = request.modelSelection;
      providerConfig.ensureProviderConfigs(cfg);
      const enabled = providerConfig.getEnabledConnections(cfg).some(c => c.providerId === wanted.providerId && c.supplierId === wanted.supplierId);
      const model = enabled && providerConfig.getProviderModels(cfg, wanted.providerId, wanted.supplierId)
        .find(m => m.id === wanted.modelId && m.enabled !== false && require('./model-roles').getModelType(wanted.providerId,m) === 'text');
      if (!model) {
        return { ok:false, error:'所选模型已不可用，请重新选择' };
      }
      cfg.agentModel = { ...wanted, modelType:'text' };
    }
    if ((request.modelSelection || magpie) && ['low','medium','high','xhigh','max'].includes(request.reasoningMode)) cfg.api.reasoningSpeed = request.reasoningMode;
    const selection = magpie?.selection || modelState.normalizeAgentModelSelection(cfg);
    if (selection.modelType !== 'text') {
      return { ok: false, error: 'Yan Kernel 只能启动文本/工具模型。' };
    }
    // Suggestions are expendable background work. They cannot occupy a user
    // turn's lock/capacity, and at most one is admitted across the application.
    const limit = suggestion ? 1 : MAX_CONCURRENT_AGENT_RUNS;
    if (sessionBusy(targetSession)) return { ok: false, code: 'SESSION_BUSY', error: '当前会话仍在运行' };
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
    const presetSession = targetSession ? await sessionStore.readSessionRecord(targetSession) : null;
    const customAgents = (Array.isArray(cfg.customAgents) ? cfg.customAgents : []).flatMap(agent => {
      try { return [require('./custom-agents').normalizeCustomAgent(agent)]; }
      catch { return []; }
    });
    request.agentPreset = require('./agent-presets').normalizeAgentPreset(
      request.utility ? 'standard' : (request.agentPreset ?? presetSession?.agentPreset),
      customAgents
    );
    request.customAgent = customAgents.find(agent => agent.id === request.agentPreset) || null;
    const dailyMode = require('./daily-agent').isDaily(request);
    const creativeMode = require('./creative-agent').isCreative(request);
    const minimalMode = require('./minimal-agent').isMinimal(request);
    if (minimalMode) {
      request.memoryEnabled = false;
      request.memoryWriteEnabled = false;
      request.customInstructions = '';
      memorySettings.enabled = false;
    }
    if (dailyMode || minimalMode || creativeMode) {
      request.workMode = 'normal';
      request.selectedSkills = [];
      request.selectedPlugins = [];
    }
    request.selectedPlugins = resolveSelectedPlugins(STABLE_DATA_DIR, request.selectedPlugins, workspace, cfg.externalAgents);
    if (!voiceCall && memorySettings.enabled && workspace && !(cfg.memoryWorkspaces || []).includes(workspace)) {
      cfg.memoryWorkspaces = [...(cfg.memoryWorkspaces || []), workspace];
      const persistedCfg = configStore.loadConfig();
      persistedCfg.memoryWorkspaces = [...new Set([...(persistedCfg.memoryWorkspaces || []), workspace])];
      configStore.saveConfig(persistedCfg);
    }
    const executionDirectory = workspace || skillsRuntime.getNoWorkspaceAgentDirectory(request.yanSessionId);
    await fsp.mkdir(executionDirectory, { recursive: true });
    const prompt = (voiceCall ? String(request.prompt || '').trim() : require('./git-preferences').expandGitWorkflowPrompt(String(request.prompt || '').trim(), cfg.git))
      || (Array.isArray(request.selectedSkills) && request.selectedSkills.length
        ? 'Apply the explicitly selected Skills to the current task.'
        : 'Continue the current task.');
    // Activate an explicit durable user rule before this run snapshots
    // Harness state. This removes the A->B race where background memory
    // review had not finished by the time the next task was constructed.
    if (evolutionEnabled(request) && request.memoryWriteEnabled) {
      const startingPolicy = extractExplicitPolicyInstruction({ prompt, history: request.history });
      if (startingPolicy?.text) {
        const persisted = await harnessPolicy.persistExplicitUserPolicy({
          memoryEnabled: request.memoryEnabled,
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
    const runWorkMode = ['normal', 'plan', 'evolution'].includes(String(request.workMode || ''))
      ? String(request.workMode)
      : (['normal', 'plan', 'evolution'].includes(cfg.agent?.workMode) ? cfg.agent.workMode : 'normal');
    request.workMode = runWorkMode === 'evolution' ? 'normal' : runWorkMode;
    const isolated = isolateWorkMode(request);
    for (const key of Object.keys(request)) if (!(key in isolated)) delete request[key];
    Object.assign(request, isolated);
    const presetTextExclude = isUncensoredPreset(request) ? null : UNCENSORED_CONTENT_RE;
    const retrievedMemory = request.utility || !memorySettings.enabled
      ? { context: '' }
      : longTermMemory.query({
        query: memoryQuery,
        workspace,
        maxChars: 3_600,
        limit: 12,
        excludeSourceKinds: ['agi_memory_consolidation'],
        excludeTextPattern: presetTextExclude
      });
    const runId = admittedRunId;
    const yanSessionId = String(request.yanSessionId || '');
    const runStartedAt = Date.now();
    const evolutionMode = evolutionEnabled(request);
    try { fs.rmSync(harnessBridge.pendingHarnessRequestPath(runId), { force: true }); } catch {}
    if (evolutionMode && request.memoryWriteEnabled && workspace) {
      try { await continualHarness.recoverRejectedAgentRefinements({ scope: 'workspace', workspace }); } catch (error) {
        console.warn(`[harness] workspace policy recovery failed for ${workspace}:`, error?.message || error);
      }
    }
    // Every run gets a context for authorized HTTP reads, including Blank tasks.
    // Workspace analysis and downloads still require a nonempty workspace. The
    // Harness refinement tools stay separately task-gated to evolution mode,
    // so registering the file here exposes nothing extra.
    if (evolutionMode || !request.utility) {
      harnessBridge.registerHarnessRunContext({
        runId,
        sessionId: yanSessionId,
        workspace: creativeMode ? executionDirectory : workspace,
        executionDirectory,
        memoryEnabled: request.memoryEnabled,
        memoryWriteEnabled: request.memoryWriteEnabled,
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
      ? continualHarness.evolutionContext({ workspace, query: memoryQuery, maxChars: 6_000, maxEntries: 6, excludeTextPattern: presetTextExclude })
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
      nestedPolicy: { agent: { sandboxMode: cfg.agent?.sandboxMode, accessMode: cfg.agent?.accessMode }, permissions: cfg.permissions },
      prompt
    });
    openCodeRunAdmissions.delete(runId);
    admissionPending = false;
    refreshAgentRuntimeActivity();
    recovery.ensureOpenCodeReconcileRun(runId, { runLane, yanSessionId, workspace, startedAt: runStartedAt, utility: request.utility === true });
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
        threadId: suggestion ? `suggestion_${runId}` : yanSessionId || `thread_${runId}`,
        turnId: runId,
        workspace,
        title: authoritativeSession?.title || '',
        configSnapshot: {
          providerId: selection.providerId,
          supplierId: selection.supplierId,
          modelId: selection.modelId,
          modelType: selection.modelType,
          workMode,
          agentPreset: request.agentPreset,
          accessMode: cfg.agent?.accessMode || 'request',
          inputTokensPerSecond: Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
            cfg.api?.inputTokensPerSecond || cfg.agent?.inputTokensPerSecond
          )),
        },
        intent: {
          prompt,
          attachments: request.attachments,
          selectedSkills: request.selectedSkills,
          selectedPlugins: request.selectedPlugins,
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
    let openCodeMcpServers = mcpRuntimeConfig.getOpenCodeMcpServers(cfg, {
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
    if (voiceCall) openCodeMcpServers = [];
    if (minimalMode) openCodeMcpServers = [];
    if (creativeMode) openCodeMcpServers = openCodeMcpServers.filter(server => ['yan_skills', 'yan_web'].includes(server.id))
      .map(server => ({ ...server, deferred: false, taskEnabled: true }));
    if (request.customAgent) {
      const selectedTools = new Set(request.customAgent.tools || []);
      openCodeMcpServers = openCodeMcpServers.filter(server =>
        [...selectedTools].some(tool => tool.startsWith(`${server.id}_`)));
    }
    if (dailyMode) openCodeMcpServers = openCodeMcpServers.filter(server => server.id === 'yan_web' || (server.id === 'yan_session' && cfg.experiments?.intelligentUi === true))
      .map(server => ({ ...server, deferred: false, taskEnabled: true }));
    const capabilityContext = mcpRuntimeConfig.getOpenCodeCapabilityContext({ ...cfg, workspace }, openCodeMcpServers, { skippedSkills });
    const openCodeConfig = mcpRuntimeConfig.getOpenCodeRuntimeConfig(cfg, {
      magpie,
      mcpServers: openCodeMcpServers,
      taskId: runId,
      reasoningSpeed: (voiceCall || request.utilityKind === 'prompt-suggestion') ? 'low' : undefined,
      skillOnly
    });
    if (voiceCall) {
      openCodeConfig.yanVoiceCall = true;
      openCodeConfig.agent = { build: { prompt: require('./voice-call-agent').system } };
    }
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
      ctx.nestedSessions?.observe(yanSessionId, runId, event);
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
    const taskReferenceContext = voiceCall || minimalMode || creativeMode ? '' : await buildTaskReferenceContext({ ...request, prompt }, sessionStore, skillsRuntime);
    if (visionAbortController.signal.aborted) {
      const error = new Error('Aborted'); error.name = 'AbortError'; throw error;
    }
    const nestedContext = nestedChild
      ? 'This is an independent Nested Session. Work only in your assigned worktree. Do not edit the parent checkout or shared Git metadata, create more agents, or dispatch external agents. Report your changes and tests; the parent explicitly integrates them. A finished response reports results but does not prove integration.'
      : cfg.nestedSessions?.enabled === true && !voiceCall
        ? 'Nested Sessions are enabled. For parallel user-steerable work, use yan_session_nested_sessions with the current task_id to dispatch up to four independent sessions. Provide bounded goals and acceptance criteria. New child sessions wait for the user to confirm the model and start them, so do not expect immediate results. After dispatch, if there is no independent work, call operation=suspend and finish this reply normally. Do not poll or wait in a tool loop: the host resumes this conversation when reports arrive. Use list for results, and integrate with explicit session_id/result_id when ready; test integrated changes before claiming success.' : '';
    const modelPrompt = minimalMode || creativeMode ? (relayed.prompt || prompt) : [relayed.prompt || prompt, nestedContext, taskReferenceContext, selectedPluginContext(request.selectedPlugins), voiceCall ? '' : imageEditContext(request.attachments, executionDirectory)].filter(Boolean).join('\n\n');
    if (request.backgroundBashGuard && !request.backgroundBashGuard()) throw new Error('后台唤醒已取消');
    ctx.backgroundBash?.register(runId, { ...request, workspace, persistentShellDirectory: executionDirectory, yanSessionId,
      terminalShell: cfg.general?.terminalShell || 'git-bash', sandboxMode: cfg.agent?.sandboxMode || 'full', runInternal: internal });
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
      modelName: selection.name || selection.modelId,
      subagentModel: subagentModelOverride(cfg, selection),
      reasoningMode: cfg.api?.reasoningSpeed || request.reasoningMode || '',
      // The system prompt must not point a multimodal model at the text-only
      // visual relay tool, which Yan Media does not expose for it.
      supportsImageInput: selection.capabilities?.imageInput === true,
      inputTokensPerSecond: Math.max(DEFAULT_INPUT_TOKENS_PER_SECOND, normalizeInputTokensPerSecond(
        cfg.api?.inputTokensPerSecond || cfg.agent?.inputTokensPerSecond
      )),
      workMode,
      measuredInputTokensPerSecond: Number(
        cfg.api?.inputThroughput?.[measurementKey(selection.providerId, selection.modelId)]?.tokensPerSecond
      ) || 0,
      accessMode: cfg.agent?.accessMode || 'request',
      delegationConcurrency: cfg.agent?.delegationConcurrency || 10,
      delegationReturn: true,
      terminalShell: cfg.general?.terminalShell || 'git-bash',
      replyVerbosity: cfg.agent?.replyVerbosity || 'default',
      sandboxMode: cfg.agent?.sandboxMode || 'full',
      externalAgentsEnabled: cfg.externalAgents?.enabled === true,
      reasoningSummary: cfg.agent?.reasoningSummary || 'auto',
      desktopTask,
      permissions: cfg.permissions,
      mediaModels,
      yanSkillDirectory: skillsDir,
      mcpServers: openCodeMcpServers,
      skillOnly,
      selectedSkills: runSelectedSkills,
      skippedSkills,
      availableSkills: capabilityContext.skills,
      availableMcpServers: capabilityContext.mcpServers,
      yanBrowserAvailable: capabilityContext.yanBrowserAvailable,
      browserAcceptanceLevel: cfg.browser?.acceptanceLevel === 'quick' ? 'quick' : 'rigorous',
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
    (task.then(async result => {
      const contextBreakdown = ctx.backgroundBash?.runs.get(runId)?.contextBreakdown;
      if (contextBreakdown) result = { ...result, contextBreakdown };
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
          if (planFile) {
            completedResult.planFile = planFile;
            completedResult.text = String(completedResult.text || '') + `\n\n[${planFile.name}](<${planFile.path.replace(/\\/g, '/')}>)`;
          }
        } catch (planError) {
          console.warn('[plan] Failed to write plan document:', planError?.message || planError);
        }
      }
      await internal.onCompleted?.(completedResult, runId);
      require('./main/windows/session-windows').sendRun(runId, 'opencode:completed', { runId, result: completedResult });
      
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
        contextBreakdown: ctx.backgroundBash?.runs.get(runId)?.contextBreakdown || null,
        error: openCodeErrorDetail(error)
      };
      settledResult = { ...failedResult, toolCalls: reviewToolCalls(settledResult) };
      if (coreTurnStarted) getYanCore().completeTurn(runId, failedResult);
      try { await internal.onCompleted?.(failedResult, runId); }
      catch (saveError) { console.error('[run] result persistence failed:', saveError); }
      require('./main/windows/session-windows').sendRun(runId, 'opencode:completed', { runId, result: failedResult });
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
      if (request.memoryEnabled && request.memoryWriteEnabled && (controlReview || normalReview)) {
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
      if (settledResult?.status === 'done') ctx.backgroundBash?.continueTask(runId, settledResult.delegation?.reports);
      ctx.backgroundBash?.settled(runId);
      refreshAgentRuntimeActivity();
      internal.onSettled?.(settledResult, runId);
      void ctx.nestedSessions?.pump().catch(error => console.error('[nested]', error));
    }));
    return { ok: true, runId, version: sidecar.status?.().version || OPENCODE_VERSION };
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

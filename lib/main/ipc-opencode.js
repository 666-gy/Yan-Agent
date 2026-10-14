'use strict';

// Run controls, review, recovery and Core intents (T6.2). State stays in main.js.
const { isSafeSessionId } = require('../session-store');
const workspaceSandbox = require('../workspace-sandbox');
const { startRun } = require('../run-orchestrator');
const { runReviewTask } = require('../review-worker');
const { projectReviewSummary } = require('../review-data');
const { classifyDelegatedShellCommand, deriveShellCommandPrefix } = require('../shell-command-risk');
const { normalizeShellPrefixes, permissionAudit } = require('../permission-audit');
const { SideChat } = require('../side-chat');

function registerOpenCodeIpc(ctx, deps) {
  const { ipcMain } = ctx;
  const sideChat = deps.sideChat || new SideChat();
  const sideChatOwners = new WeakSet();
  const {
    prewarmOpenCodeSidecar,
    sessionStore,
    manualContextCompressions,
    withOpenCodeBackgroundLease,
    configStore,
    modelState,
    skillsRuntime,
    ensureOpenCodeSidecar,
    mcpRuntimeConfig,
    runContext,
    recovery,
    openCodeActiveRuns,
    getYanCore,
    getCurrentSidecar,
    getOpenCodeProviderAdapter,
    openCodeRunAdmissions,
    bridges
  } = deps;

  ipcMain.handle('opencode:prewarm', async (_e, { workspace, yanSessionId } = {}) => {
    try {
      const directory = workspaceSandbox.normalizeWorkspace(workspace)
        || (isSafeSessionId(yanSessionId) ? skillsRuntime.getNoWorkspaceAgentDirectory(yanSessionId) : '');
      return await prewarmOpenCodeSidecar({ directory });
    } catch (error) {
      console.warn('[opencode] prewarm failed:', error?.message || error);
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('opencode:compress-session', async (_e, { yanSessionId } = {}) => {
    const id = String(yanSessionId || '');
    if (!isSafeSessionId(id)) return { ok: false, error: '会话 ID 无效' };
    if (sessionStore.isSessionRunActive(id) || manualContextCompressions.has(id)) {
      return { ok: false, error: '任务工作中或正在压缩，请稍后再试' };
    }
    // Reserve before the first await; start-run checks the same reservation.
    manualContextCompressions.add(id);
    console.info('[context] manual compression started:', id);
    try {
      return await withOpenCodeBackgroundLease(async () => {
        const session = await sessionStore.readSessionRecord(id);
        if (!session?.openCodeSessionId) return { ok: false, error: '还没有可压缩的上下文' };
        const cfg = configStore.loadConfig();
        const selection = modelState.normalizeAgentModelSelection(cfg);
        if (selection.modelType !== 'text') return { ok: false, error: '请选择文本模型进行压缩' };
        const workspace = workspaceSandbox.normalizeWorkspace(session.workspace) || skillsRuntime.getNoWorkspaceAgentDirectory(id);
        const sidecar = await ensureOpenCodeSidecar(mcpRuntimeConfig.getOpenCodeRuntimeConfig(cfg));
        const result = await sidecar.compressSession({
          openCodeSessionId: session.openCodeSessionId, workspace,
          providerId: selection.providerId, modelId: selection.modelId,
          openCodeConfig: mcpRuntimeConfig.getOpenCodeRuntimeConfig(cfg)
        });
        if (result.compacted) {
          console.info('[context] manual compression completed:', id, result.beforeTokens, '->', result.afterTokens);
        } else {
          console.warn('[context] manual compression failed:', id, result.error || '内核未完成压缩');
        }
        return { ...result, ok: result.compacted === true, completedAt: Date.now() };
      });
    } catch (error) {
      console.error('[context] manual compression failed:', id, error?.message || error);
      return { ok: false, error: error?.message || String(error) };
    } finally {
      manualContextCompressions.delete(id);
    }
  });
  
  ipcMain.handle('opencode:start-run', (_e, request = {}) => startRun(runContext, request));
  
  ipcMain.handle('opencode:sync-active-runs', () => {
    const runs = [];
    for (const [runId, entry] of recovery.openCodeRunReconcile) {
      const active = openCodeActiveRuns.get(runId);
      if (!active && !entry.completed) continue; // stale entry without a run
      runs.push({
        runId,
        yanSessionId: String(active?.yanSessionId || entry.meta.yanSessionId || ''),
        workspace: String(active?.workspace || entry.meta.workspace || ''),
        startedAt: Number(active?.startedAt || entry.meta.startedAt) || 0,
        running: !!active,
        events: entry.events,
        completed: entry.completed || null,
        coreTurn: getYanCore().getTurn(runId)
      });
    }
    return runs;
  });
  
  ipcMain.handle('opencode:recover-runs', (_e, payload = {}) => {
    try {
      return recovery.buildRecoveredRunDescriptors(payload?.runIds);
    } catch (error) {
      console.warn('[opencode] recovery descriptor build failed:', error?.message || error);
      return [];
    }
  });
  
  ipcMain.handle('yan:core-settle-recovered-run', async (_e, payload = {}) => {
    const runId = String(payload?.runId || '');
    if (!runId) return { ok: false, error: '缺少要结算的 Turn。' };
    try {
      if (!getYanCore()) return { ok: false, error: 'Yan Core 尚未初始化。' };
      const core = getYanCore();
      const existing = core.getTurn(runId);
      if (!existing?.recovery) return { ok: false, error: '该 Turn 不处于退出恢复流程。' };
      const session = await sessionStore.readSessionRecord(existing.threadId);
      const restored = session?.messages?.find(message => message?.agentRun?.runId === runId && message.agentRun?.timeline?.length);
      const text = String(restored?.agentRun?.textContent || payload?.text || existing.result?.text || '');
      let turn = existing.status === 'recovering' ? core.completeTurn(runId, {
        status: 'interrupted',
        text,
        emptyFinalText: !text.trim()
      }) : existing;
      // A crash placeholder or failed save must not permanently suppress replay.
      if (restored || !session) turn = core.markRecoveryReplayed(runId) || turn;
      return turn ? { ok: true, turn } : { ok: false, error: 'Yan Turn 不存在。' };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('yan:core-state', (_e, payload = {}) => {
    try {
      return getYanCore().getState(payload && typeof payload === 'object' ? payload : {});
    } catch (error) {
      return { version: 1, threads: {}, turns: {}, intents: {}, events: [], error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('yan:core-enqueue-intent', (_e, payload = {}) => {
    try {
      return { ok: true, intent: getYanCore().enqueueIntent(payload) };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('yan:core-consume-intent', (_e, intentId) => {
    try {
      const intent = getYanCore().consumeIntent(intentId);
      return intent ? { ok: true, intent } : { ok: false, error: 'Yan Intent 不存在或已处理。' };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('yan:core-requeue-intent', (_e, intentId) => {
    try {
      const intent = getYanCore().requeueIntent(intentId);
      return intent ? { ok: true, intent } : { ok: false, error: 'Yan Intent 不存在。' };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('yan:core-ack-intent', (_e, intentId) => {
    try {
      const intent = getYanCore().ackIntent(intentId);
      return intent ? { ok: true, intent } : { ok: false, error: 'Yan Intent 不存在或无法确认。' };
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('yan:core-delete-intent', (_e, payload = {}) => {
    try {
      return getYanCore().deleteIntent(payload?.intentId || payload?.id, payload?.reason);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('opencode:run-changes', async (_e, payload = {}) => {
    const runId = String(payload.runId || '');
    const active = openCodeActiveRuns.get(runId);
    if (!runId || !active || !getCurrentSidecar()) {
      return { count: 0, additions: 0, deletions: 0, files: [] };
    }
    try {
      const diffs = await getCurrentSidecar().runChanges(runId, { includeDiff: payload.includeDiff, paths: payload.paths });
      return await runReviewTask('openCodeDiffs', active.workspace, diffs, {
        includeDiff: payload.includeDiff !== false,
        documentPath: payload.documentPath,
        paths: payload.paths,
        startTime: active.startedAt
      });
    } catch (error) {
      return { count: 0, additions: 0, deletions: 0, files: [], error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('opencode:session-changes', async (_e, payload = {}) => {
    const yanSessionId = String(payload.yanSessionId || '');
    const runId = String(payload.runId || '');
    if (!yanSessionId || !runId) {
      return { count: 0, additions: 0, deletions: 0, files: [] };
    }
    try {
      const session = await sessionStore.readSessionRecord(yanSessionId);
      const workspace = workspaceSandbox.normalizeWorkspace(session?.workspace);
      const agentRun = (session?.messages || [])
        .find(message => message?.role === 'assistant' && message?.agentRun?.runId === runId)
        ?.agentRun;
      if (workspace && agentRun && payload.includeDiff === false && !payload.documentPath && payload.fresh !== true) {
        const manifest = projectReviewSummary(agentRun.changeSummary, { paths: payload.paths });
        if (manifest) return manifest;
      }
      if (!workspace || !agentRun?.openCodeSessionId) {
        return { count: 0, additions: 0, deletions: 0, files: [] };
      }
      return await withOpenCodeBackgroundLease(async () => {
        const sidecar = await ensureOpenCodeSidecar(mcpRuntimeConfig.getOpenCodeRuntimeConfig(configStore.loadConfig()));
        const diffs = await sidecar.sessionChanges({
          sessionId: agentRun.openCodeSessionId,
          directory: workspace,
          startTime: agentRun.startedAt,
          endTime: agentRun.completedAt || undefined,
          includeDiff: payload.includeDiff,
          paths: payload.paths
        });
        return runReviewTask('openCodeDiffs', workspace, diffs, {
          includeDiff: payload.includeDiff !== false,
          documentPath: payload.documentPath,
          paths: payload.paths,
          startTime: agentRun.startedAt
        });
      });
    } catch (error) {
      return { count: 0, additions: 0, deletions: 0, files: [], error: error?.message || String(error) };
    }
  });
  
  async function cancelOpenCodeRun(runId) {
    const key = String(runId || '');
    runContext?.backgroundBash?.cancelRun(key);
    const bashSessionId = openCodeActiveRuns.get(key)?.yanSessionId || openCodeRunAdmissions?.get(key);
    if (bashSessionId) runContext?.backgroundBash?.cancelSession(bashSessionId);
    const active = openCodeActiveRuns.get(key);
    const coreResult = getYanCore().requestCancel(key, active?.utility ? 'utility_cancelled' : 'user_cancelled');
    const visionCancelled = !!active?.visionAbortController;
    active?.visionAbortController?.abort();
    let sidecarResult = { ok: false, error: '' };
    if (getCurrentSidecar()) {
      try {
        const result = await getOpenCodeProviderAdapter(getCurrentSidecar()).cancel(key);
        sidecarResult = {
          ok: result?.ok === true,
          error: result?.error ? String(result.error) : '',
          pending: result?.pending === true
        };
      } catch (error) {
        sidecarResult = { ok: false, error: error?.message || String(error) };
      }
    }
    const cancelRequested = visionCancelled || sidecarResult.ok || coreResult.cancelled === true;
    const sidecarLive = !!getCurrentSidecar()?.hasRun?.(key)
      || !!getCurrentSidecar()?.hasPendingRun?.(key);
    const mainRunLive = openCodeActiveRuns.has(key) || openCodeRunAdmissions.has(key);
    const settled = !mainRunLive && !sidecarLive && (
      !active || coreResult.alreadySettled === true || coreResult.cancelled === false
    );
    const cancelled = settled;
    if (cancelRequested) bridges.notifyBrowserAgentRelease(key, 'run_cancelled');
    return {
      ok: cancelRequested,
      cancelRequested,
      cancelled,
      settled,
      error: cancelRequested ? '' : (sidecarResult.error || coreResult.error || 'Yan Kernel 任务不存在'),
      coreTurn: coreResult.turn || getYanCore().getTurn(key)
    };
  }
  
  ipcMain.handle('opencode:interject', async (event, payload = {}) => {
    const runId = String(payload.runId || '');
    const requestId = String(payload.requestId || '');
    const text = String(payload.text || '').trim();
    const mode = payload.directGuidance === true ? 'steer' : (payload.mode || 'auto');
    if (!['auto', 'side-chat', 'steer'].includes(mode)) return { ok: false, error: '不支持的侧边聊天请求。' };
    if (!text && !payload.attachments?.length) return { ok: false, error: '侧边聊天内容不能为空。' };
    if (mode === 'steer') {
      if (!text || !openCodeActiveRuns.get(runId) || !getCurrentSidecar()) return { ok: false, error: 'Steer 需要一个正在运行的主任务。' };
      try { return { ...await getCurrentSidecar().deliverInterjection(runId, { kind: 'guidance', guidance: text, requestFinish: false }), mode }; }
      catch (error) { return { ok: false, error: error.message }; }
    }
    const emitAuxiliaryEvent = auxiliaryEvent => {
      if (!event.sender || event.sender.isDestroyed()) return;
      event.sender.send('opencode:interjection-event', {
        runId,
        requestId,
        event: auxiliaryEvent
      });
    };
    try {
      if (event.sender && !sideChatOwners.has(event.sender)) {
        sideChatOwners.add(event.sender);
        event.sender.once?.('destroyed', () => sideChat.cancelOwner(event.sender));
      }
      const cfg = configStore.loadConfig();
      // Side Chat may carry its own text model and reasoning choice. Both are
      // resolved read-only here: the Agent configuration is never modified.
      const selection = mcpRuntimeConfig.resolveRequestedTextSelection(cfg, payload.selection);
      const runtime = mcpRuntimeConfig.getOpenCodeRuntimeConfig(cfg, {
        mcpServers: [],
        selection: payload.selection,
        reasoningSpeed: payload.reasoningSpeed
      });
      const targetRun = openCodeActiveRuns.get(runId);
      const targetSidecar = getCurrentSidecar();
      const steer = targetRun && targetSidecar ? async guidance => {
        if (openCodeActiveRuns.get(runId) !== targetRun || getCurrentSidecar() !== targetSidecar) {
          return { ok: false, delivered: false, error: '主任务已结束，这条要求未送达。' };
        }
        return targetSidecar.deliverInterjection(runId, { kind: 'guidance', guidance, requestFinish: false });
      } : null;
      if (mode === 'auto' && runId && !steer) return { ok: false, error: '主任务已结束，请重新发送以继续侧边讨论。' };
      return await sideChat.send({ ...payload, mode }, { owner: event.sender, runtime, selection, onEvent: emitAuxiliaryEvent, steer });
    } catch (error) {
      return { ok: false, error: '侧边聊天暂不可用，请检查文本模型配置。' };
    }
  });
  
  ipcMain.handle('opencode:cancel-interjection', async (event, payload = {}) => {
    const requestId = String(payload.requestId || '');
    return sideChat.cancel(requestId, event.sender);
  });
  
  ipcMain.handle('opencode:cancel-run', async (_e, runId) => {
    return cancelOpenCodeRun(runId);
  });
  
  ipcMain.handle('opencode:permission-reply', async (_e, payload = {}) => {
    if (!getCurrentSidecar()) return { ok: false, error: 'Yan Kernel 尚未运行' };
    try {
      // P0: "always" remembers a command *prefix* in the persisted grant scope,
      // and the kernel is still told 'once'. Granting here (main owns config)
      // keeps the renderer from being the only thing that remembers.
      const grantPrefix = String(payload.grantPrefix || '').trim();
      if (grantPrefix) {
        const cfg = configStore.loadConfig();
        const current = normalizeShellPrefixes(cfg.permissions?.shellAllowPrefixes);
        if (!current.includes(grantPrefix)) {
          cfg.permissions = { ...cfg.permissions, shellAllowPrefixes: [...current, grantPrefix] };
          configStore.saveConfig(cfg);
        }
      }
      return await getCurrentSidecar().replyPermission(payload);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
  
  ipcMain.handle('opencode:classify-shell-command', (_e, command) => {
    // `prefix` is the reusable grant scope (P0): the renderer remembers a
    // command shape instead of the whole `bash` permission. Undefined means the
    // command has no safe reusable prefix and must be confirmed every time.
    // `granted` answers "is this prefix already persisted?", so the renderer
    // never has to cache grants itself (P4: one source of truth).
    const prefix = deriveShellCommandPrefix(command);
    const persisted = normalizeShellPrefixes(configStore.loadConfig().permissions?.shellAllowPrefixes);
    return {
      ...classifyDelegatedShellCommand(command),
      prefix,
      granted: Boolean(prefix) && persisted.includes(prefix)
    };
  });

  // Permission visibility surface (P3/P4): what Yan asked, why, what it decided,
  // and which command prefixes it is currently allowing. Read-only except for
  // the two explicit mutations below.
  function shellGrantSnapshot() {
    const permissions = configStore.loadConfig().permissions || {};
    return { shellAllowPrefixes: normalizeShellPrefixes(permissions.shellAllowPrefixes) };
  }

  ipcMain.handle('opencode:permission-audit', (_e, payload = {}) => {
    const action = String(payload.action || 'list');
    if (action === 'clear') permissionAudit.clear();
    if (action === 'revoke-prefix') {
      const prefix = String(payload.prefix || '').trim();
      const cfg = configStore.loadConfig();
      const current = normalizeShellPrefixes(cfg.permissions?.shellAllowPrefixes);
      cfg.permissions = {
        ...cfg.permissions,
        shellAllowPrefixes: current.filter(item => item !== prefix)
      };
      configStore.saveConfig(cfg);
    }
    return {
      ok: true,
      ...shellGrantSnapshot(),
      entries: permissionAudit.list({ limit: payload.limit })
    };
  });
  
  ipcMain.handle('opencode:question-reply', async (_e, payload = {}) => {
    if (!getCurrentSidecar()) return { ok: false, error: 'Yan Kernel 尚未运行' };
    try {
      return await getCurrentSidecar().replyQuestion(payload);
    } catch (error) {
      return { ok: false, error: error?.message || String(error) };
    }
  });
}

module.exports = { registerOpenCodeIpc };

'use strict';

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// Explicit service doubles let tests drive the real admission/dispatch path
// without starting a provider, making network calls or using live user data.
function createRunContext(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-run-orchestrator-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const calls = { provider: [], core: [], completed: [], events: [], released: [] };
  let resolveTask, rejectTask, resolveIdle;
  const task = new Promise((resolve, reject) => { resolveTask = resolve; rejectTask = reject; });
  const idle = new Promise(resolve => { resolveIdle = resolve; });
  const config = { api: {}, agent: { workMode: 'normal' }, permissions: {}, workspace: '' };
  const core = {
    startTurn: request => { calls.core.push(request); return { configSnapshotId: 'snapshot-1' }; },
    completeTurn: (id, result) => { calls.completed.push({ id, result }); }
  };
  const ctx = {
    manualContextCompressions: new Set(),
    configStore: { loadConfig: () => config, saveConfig: () => {} },
    modelState: { normalizeAgentModelSelection: () => ({ modelType: 'text', providerId: 'test', modelId: 'model' }) },
    openCodeActiveRuns: new Map(), openCodeRunAdmissions: new Map(), MAX_CONCURRENT_AGENT_RUNS: 3,
    skillsRuntime: { getNoWorkspaceAgentDirectory: () => directory, selectedRunSkills: async () => ({ skills: [] }) },
    harnessPolicy: {}, longTermMemory: { query: () => ({ context: '' }) },
    harnessBridge: {
      pendingHarnessRequestPath: id => path.join(directory, `${id}.json`),
      removeHarnessRunContext: () => {}
    },
    sessionStore: { readSessionRecord: async () => null },
    refreshAgentRuntimeActivity: () => { if (!ctx.openCodeActiveRuns.size) resolveIdle(); },
    recovery: {
      openCodeRunReconcile: new Map(), ensureOpenCodeReconcileRun: () => {},
      sendOpenCodeRendererEvent: (id, event) => calls.events.push({ id, event }),
      flushOpenCodeRendererEvents: () => {}, completeOpenCodeReconcileRun: () => {}
    },
    generatedMedia: { registerMediaWorkspace: () => {}, releaseMediaWorkspace: id => calls.released.push(id) },
    getYanCore: () => core,
    mcpRuntimeConfig: {
      isDesktopTaskRequest: () => false, getOpenCodeMcpServers: () => [],
      getOpenCodeCapabilityContext: () => ({}), getOpenCodeRuntimeConfig: () => ({})
    },
    visionRelay: { relayImagesForTextModel: async (_cfg, _selection, request) => request },
    getOpenCodeSidecar: () => ({}),
    getOpenCodeProviderAdapter: () => ({ startTurn: (request, emit) => { calls.provider.push({ request, emit }); return task; } }),
    providerConfig: { getConfiguredMediaModels: () => [] },
    bridges: {
      trackBrowserAgentToolClaim: () => {}, trackSessionAgentToolClaim: () => {},
      notifyBrowserAgentRelease: () => {}, clearBrowserAgentToolClaims: () => {}, clearSessionAgentToolClaims: () => {}
    },
    skillsDir: directory, yanagent: { writeRunRollbackSnapshot: async () => {} },
    STABLE_DATA_DIR: directory, getMainWindow: () => null,
    withOpenCodeBackgroundLease: fn => fn(), reviewCompletedRunMemory: async () => {}
  };
  return { ctx, calls, config, core, idle, complete: resolveTask, fail: rejectTask };
}

module.exports = { createRunContext };

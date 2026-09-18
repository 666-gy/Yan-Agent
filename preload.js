const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('yan', {
  // Config / API / models / skills
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  wallpaperAnalyze: (source) => ipcRenderer.invoke('wallpaper:analyze', { source }),
  getQuickLaunch: () => ipcRenderer.invoke('quick-launch:get'),
  updateQuickLaunch: (settings) => ipcRenderer.invoke('quick-launch:update', settings),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  connectionsList: () => ipcRenderer.invoke('connections:list'),
  connectionsSave: (payload) => ipcRenderer.invoke('connections:save', payload || {}),
  connectionsDelete: (id) => ipcRenderer.invoke('connections:delete', { id }),
  connectionsTest: (payload) => ipcRenderer.invoke('connections:test', payload || {}),
  getVisionRelayStatus: () => ipcRenderer.invoke('vision-relay:status'),
  openVisionRelayGuideUrl: (url) => ipcRenderer.invoke('vision-relay:open-guide-url', { url }),
  getProviderSecret: (providerId, supplierId) => ipcRenderer.invoke('provider:get-secret', { providerId, supplierId }),
  addProviderSupplier: (providerId, name) => ipcRenderer.invoke('provider:add-supplier', { providerId, name }),
  setProviderSupplier: (providerId, supplierId) => ipcRenderer.invoke('provider:set-supplier', { providerId, supplierId }),
  deleteProviderSupplier: (providerId, supplierId) => ipcRenderer.invoke('provider:delete-supplier', { providerId, supplierId }),
  configureProvider: (providerId, config) => ipcRenderer.invoke('provider:configure', {
    providerId,
    ...(config && typeof config === 'object' ? config : { apiKey: config })
  }),
  removeProviderConfig: (providerId, supplierId = '') => ipcRenderer.invoke('provider:remove-config', { providerId, supplierId }),
  browserRecoverNetwork: (url) => ipcRenderer.invoke('browser:recover-network', url),
  browserClearData: (type) => ipcRenderer.invoke('browser:clear-data', type),
  onBrowserNewTabRequest: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('browser:new-tab-request', handler);
    return () => ipcRenderer.removeListener('browser:new-tab-request', handler);
  },
  onBrowserAgentCommand: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('browser:agent-command', handler);
    return () => ipcRenderer.removeListener('browser:agent-command', handler);
  },
  browserAgentCommandResult: (payload) => ipcRenderer.send('browser:agent-command-result', payload),
  listQuickModels: () => ipcRenderer.invoke('models:quick-list'),
  listMediaModels: () => ipcRenderer.invoke('models:media-list'),
  setModelRole: (providerId, modelId, modelType, supplierId = '') => ipcRenderer.invoke('model:role-set', {
    providerId,
    modelId,
    modelType,
    supplierId
  }),
  onModelChanged: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('model:changed', handler);
    return () => ipcRenderer.removeListener('model:changed', handler);
  },
  listSkills: () => ipcRenderer.invoke('skills:list'),
  getSkillMarket: () => ipcRenderer.invoke('skills:market'),
  getSkillCatalog: () => ipcRenderer.invoke('skills:catalog'),
  openSkillDirectory: (id) => ipcRenderer.invoke('skills:open-directory', id),
  readSkill: (id, taskContext) => ipcRenderer.invoke('skills:read', { id, taskContext }),

  // Workspace
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspaceInExplorer: (workspace) => ipcRenderer.invoke('workspace:open-explorer', workspace),

  // Git workspace
  gitStatus: (workspace) => ipcRenderer.invoke('git:status', { workspace }),
  gitInit: (workspace, initialBranch = 'main') => ipcRenderer.invoke('git:init', { workspace, initialBranch }),
  gitStage: (workspace, paths = [], all = false) => ipcRenderer.invoke('git:stage', { workspace, paths, all }),
  gitUnstage: (workspace, paths = [], all = false) => ipcRenderer.invoke('git:unstage', { workspace, paths, all }),
  gitDiscard: (workspace, paths = []) => ipcRenderer.invoke('git:discard', { workspace, paths }),
  gitCommit: (workspace, message, amend = false) => ipcRenderer.invoke('git:commit', { workspace, message, amend }),
  gitCreateBranch: (workspace, name, checkout = true) => ipcRenderer.invoke('git:branch-create', { workspace, name, checkout }),
  gitSwitchBranch: (workspace, name, remoteBranch = '') => ipcRenderer.invoke('git:branch-switch', { workspace, name, remoteBranch }),
  gitFetch: (workspace, remoteName = '') => ipcRenderer.invoke('git:fetch', { workspace, remoteName }),
  gitPull: (workspace) => ipcRenderer.invoke('git:pull', { workspace }),
  gitPush: (workspace, remoteName = '') => ipcRenderer.invoke('git:push', { workspace, remoteName }),
  gitAddRemote: (workspace, name, url) => ipcRenderer.invoke('git:remote-add', { workspace, name, url }),
  gitSetRemoteUrl: (workspace, name, url) => ipcRenderer.invoke('git:remote-set-url', { workspace, name, url }),
  gitRemoveRemote: (workspace, name) => ipcRenderer.invoke('git:remote-remove', { workspace, name }),
  gitSetIdentity: (workspace, name, email) => ipcRenderer.invoke('git:identity-set', { workspace, name, email }),
  gitHistory: (workspace, limit = 40) => ipcRenderer.invoke('git:history', { workspace, limit }),
  gitDiff: (workspace, filePath, staged = false) => ipcRenderer.invoke('git:diff', { workspace, path: filePath, staged }),
  gitReview: (workspace, options = {}) => ipcRenderer.invoke('git:review', { workspace, options }),
  gitReviewDocument: (workspace, filePath, options = {}) => ipcRenderer.invoke('git:review-document', {
    workspace,
    path: filePath,
    options
  }),
  dshReviewWriteHtml: (html) => ipcRenderer.invoke('dsh-review:write-html', html),
  gitPickCloneDestination: () => ipcRenderer.invoke('git:pick-clone-destination'),
  gitClone: (remoteUrl, destination) => ipcRenderer.invoke('git:clone', { remoteUrl, destination }),
  gitOpenRemote: (remoteUrl) => ipcRenderer.invoke('git:open-remote', { remoteUrl }),
  gitWorktreeCreate: (workspace, taskId, base = '') => ipcRenderer.invoke('git:worktree-create', { workspace, taskId, base }),
  gitWorktreeList: (workspace) => ipcRenderer.invoke('git:worktree-list', { workspace }),
  gitWorktreeStatus: (workspace, taskId) => ipcRenderer.invoke('git:worktree-status', { workspace, taskId }),
  gitWorktreeMerge: (workspace, taskId, message = '', squash = false) => ipcRenderer.invoke('git:worktree-merge', { workspace, taskId, message, squash }),
  gitWorktreeRemove: (workspace, taskId, force = false) => ipcRenderer.invoke('git:worktree-remove', { workspace, taskId, force }),
  ghDetect: () => ipcRenderer.invoke('gh:detect'),
  ghPrList: (workspace, { limit = 20, state = 'open', base = '' } = {}) => ipcRenderer.invoke('gh:pr-list', { workspace, limit, state, base }),
  ghPrDiff: (workspace, number) => ipcRenderer.invoke('gh:pr-diff', { workspace, number }),
  ghPrView: (workspace, number) => ipcRenderer.invoke('gh:pr-view', { workspace, number }),
  ghPrCreate: (workspace, { title = '', body = '', base = '', draft = false } = {}) => ipcRenderer.invoke('gh:pr-create', { workspace, title, body, base, draft }),

  // Sessions
  listSessions: () => ipcRenderer.invoke('session:list'),
  getSession: (id, options = {}) => ipcRenderer.invoke('session:get', id, options),
  getSessionMessages: (id, offset = 0, limit = 40) => ipcRenderer.invoke('session:messages', { id, offset, limit }),
  createSession: (forceNew = false, workspace = '') => ipcRenderer.invoke('session:create', { forceNew, workspace }),
  saveSession: (session) => ipcRenderer.invoke('session:save', session),
  renameSession: (id, title) => ipcRenderer.invoke('session:rename', { id, title }),
  setSessionPinned: (id, pinned) => ipcRenderer.invoke('session:set-pinned', { id, pinned }),
  setSessionWorkspace: (id, workspace, activate = true) => ipcRenderer.invoke('session:set-workspace', { id, workspace, activate }),
  activateWorkspace: (workspace) => ipcRenderer.invoke('workspace:activate', workspace),
  deleteSession: (id, confirmed = false) => ipcRenderer.invoke('session:delete', {
    id,
    confirmed
  }),
  onSessionChanged: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('session:changed', handler);
    return () => ipcRenderer.removeListener('session:changed', handler);
  },
  onSessionAgentCommand: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('session:agent-command', handler);
    return () => ipcRenderer.removeListener('session:agent-command', handler);
  },
  sessionAgentCommandResult: (payload) => ipcRenderer.send('session:agent-command-result', payload),
  onSessionAgentHandoffReady: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('session:agent-handoff-ready', handler);
    return () => ipcRenderer.removeListener('session:agent-handoff-ready', handler);
  },
  onQuickInputSubmit: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('quick-input:submit', handler);
    return () => ipcRenderer.removeListener('quick-input:submit', handler);
  },

  // Desktop pet supervision bridge
  petUpdate: (payload) => ipcRenderer.send('pet:update', payload),
  getPetVisible: () => ipcRenderer.invoke('pet:get-visible'),
  togglePetWindow: () => ipcRenderer.invoke('pet:toggle-window'),
  onPetAction: (cb) => {
    const handler = (_e, action) => cb(action);
    ipcRenderer.on('pet:action', handler);
    return () => ipcRenderer.removeListener('pet:action', handler);
  },
  onPetVisibility: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('pet:visibility', handler);
    return () => ipcRenderer.removeListener('pet:visibility', handler);
  },

  // Skills
  addCustomSkill: (skill) => ipcRenderer.invoke('skills:add-custom', skill),
  removeCustomSkill: (id) => ipcRenderer.invoke('skills:remove-custom', id),

  // Files
  chooseOpenDirectory: () => ipcRenderer.invoke('file:choose-directory'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  inspectAttachmentPath: (filePath) => ipcRenderer.invoke('file:inspect-attachment-path', filePath),
  uploadFile: (name, base64, mimeType) => ipcRenderer.invoke('file:upload', { name, data: base64, mimeType }),
  generateImage: (payload) => ipcRenderer.invoke('image:generate', payload),
  cancelImageGeneration: (requestId) => ipcRenderer.invoke('image:cancel', requestId),
  generateVideo: (payload) => ipcRenderer.invoke('video:generate', payload),
  cancelVideoGeneration: (requestId) => ipcRenderer.invoke('video:cancel', requestId),
  readGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-read', assetId),
  openGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-open', assetId),
  previewImageFile: (filePath) => ipcRenderer.invoke('image:file-open', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  previewLocalFile: (filePath) => ipcRenderer.invoke('file:preview-local', filePath),

  // Text-to-speech (Edge neural voices, read replies aloud)
  ttsSynthesize: (payload) => ipcRenderer.invoke('tts:synth', payload || {}),
  ttsListVoices: () => ipcRenderer.invoke('tts:voices'),
  ttsCancel: (requestId) => ipcRenderer.invoke('tts:cancel', requestId),

  // Auto-update (Tencent COS release feed)
  updateCheck: () => ipcRenderer.invoke('update:check'),
  updateDownload: () => ipcRenderer.invoke('update:download'),
  updateInstall: () => ipcRenderer.invoke('update:install'),
  onUpdateProgress: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('update:progress', handler);
    return () => ipcRenderer.removeListener('update:progress', handler);
  },

  // .yanagent (memory/logs/snapshots in workspace)
  yanagentEnsure: (workspace) => ipcRenderer.invoke('yanagent:ensure', workspace),
  yanagentRunChanges: (sessionId, runId, workspace, options = {}) => ipcRenderer.invoke('yanagent:run-changes', {
    sessionId,
    runId,
    workspace,
    includeDiff: !!options.includeDiff,
    documentPath: String(options.documentPath || ''),
    allRuns: !!options.allRuns,
    paths: Array.isArray(options.paths) ? options.paths : null
  }),
  yanagentRollbackRun: (sessionId, runId, workspace) => ipcRenderer.invoke('yanagent:rollback-run', { sessionId, runId, workspace }),

  getVsCodeStatus: () => ipcRenderer.invoke('vscode:status'),
  launchVsCode: (workspace = '') => ipcRenderer.invoke('vscode:launch', { workspace }),
  openExternalPowerShell: (workspace = '') => ipcRenderer.invoke('powershell:open-external', { workspace }),

  // Permissions
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  setPermissions: (perms) => ipcRenderer.invoke('permissions:set', perms),


  // MCP (Model Context Protocol)
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpAdd: (cfg) => ipcRenderer.invoke('mcp:add', cfg),
  mcpRemove: (id) => ipcRenderer.invoke('mcp:remove', id),
  mcpUpdate: (id, changes) => ipcRenderer.invoke('mcp:update', { id, ...changes }),
  mcpTest: (cfg) => ipcRenderer.invoke('mcp:test', cfg),
  mcpStart: (id) => ipcRenderer.invoke('mcp:start', id),
  mcpTools: (id) => ipcRenderer.invoke('mcp:tools', id),
  mcpStop: (id) => ipcRenderer.invoke('mcp:stop', id),
  understandAnythingOpen: (workspace) => ipcRenderer.invoke('understand-anything:open', workspace),
  understandAnythingRefresh: (workspace) => ipcRenderer.invoke('understand-anything:refresh', workspace),

  // Window controls (custom title bar)
  window: {
    minimize: () => ipcRenderer.send('win:minimize'),
    toggleMaximize: () => ipcRenderer.send('win:toggle-maximize'),
    close: () => ipcRenderer.send('win:close'),
    isMaximized: () => ipcRenderer.invoke('win:is-maximized'),
    onMaximizeChange: (cb) => {
      const handler = (_e, v) => cb(v);
      ipcRenderer.on('win:maximize-changed', handler);
      return () => ipcRenderer.removeListener('win:maximize-changed', handler);
    }
  },

  onMcpStatus: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('mcp:status', handler);
    return () => ipcRenderer.removeListener('mcp:status', handler);
  },
  onWorkspaceChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  },

  onSkillsChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('skills:changed', handler);
    return () => ipcRenderer.removeListener('skills:changed', handler);
  },

  // OpenCode runtime
  openCodePrewarm: () => ipcRenderer.invoke('opencode:prewarm'),
  openCodeStartRun: (request) => ipcRenderer.invoke('opencode:start-run', request),
  openCodeCompressSession: (yanSessionId) => ipcRenderer.invoke('opencode:compress-session', { yanSessionId }),
  openCodeRunChanges: (runId, options = {}) => ipcRenderer.invoke('opencode:run-changes', {
    runId,
    fresh: options.fresh === true,
    includeDiff: options.includeDiff !== false,
    documentPath: String(options.documentPath || ''),
    paths: Array.isArray(options.paths) ? options.paths : null
  }),
  openCodeSessionChanges: (yanSessionId, runId, options = {}) => ipcRenderer.invoke('opencode:session-changes', {
    yanSessionId,
    runId,
    fresh: options.fresh === true,
    includeDiff: options.includeDiff !== false,
    documentPath: String(options.documentPath || ''),
    paths: Array.isArray(options.paths) ? options.paths : null
  }),
  openCodeCancelRun: (runId) => ipcRenderer.invoke('opencode:cancel-run', runId),
  openCodeSyncActiveRuns: () => ipcRenderer.invoke('opencode:sync-active-runs'),
  openCodeRecoverRuns: (payload = {}) => ipcRenderer.invoke('opencode:recover-runs', payload || {}),
  yanCoreGetState: (payload = {}) => ipcRenderer.invoke('yan:core-state', payload || {}),
  yanCoreSettleRecoveredRun: (payload = {}) => ipcRenderer.invoke('yan:core-settle-recovered-run', payload || {}),
  workGuiSnapshot: () => ipcRenderer.invoke('work-gui:snapshot'),
  onWorkGuiEvent: (cb) => {
    const handler = (_e, batch) => cb(batch);
    ipcRenderer.on('work-gui:event-batch', handler);
    return () => ipcRenderer.removeListener('work-gui:event-batch', handler);
  },
  yanCoreEnqueueIntent: (payload = {}) => ipcRenderer.invoke('yan:core-enqueue-intent', payload || {}),
  yanCoreConsumeIntent: (intentId) => ipcRenderer.invoke('yan:core-consume-intent', intentId),
  yanCoreRequeueIntent: (intentId) => ipcRenderer.invoke('yan:core-requeue-intent', intentId),
  yanCoreAckIntent: (intentId) => ipcRenderer.invoke('yan:core-ack-intent', intentId),
  yanCoreDeleteIntent: (intentId, reason = 'user_removed') => ipcRenderer.invoke('yan:core-delete-intent', { intentId, reason }),
  openCodeInterject: (payload) => ipcRenderer.invoke('opencode:interject', payload),
  openCodeCancelInterjection: (payload) => ipcRenderer.invoke('opencode:cancel-interjection', payload),
  readPlanFile: (targetPath) => ipcRenderer.invoke('plan:read-file', { path: targetPath }),
  downloadPlanFile: (targetPath) => ipcRenderer.invoke('plan:download-file', { path: targetPath }),
  classifyOpenCodeShellCommand: (command) => ipcRenderer.invoke('opencode:classify-shell-command', command),
  openCodeReplyPermission: (payload) => ipcRenderer.invoke('opencode:permission-reply', payload),
  openCodeReplyQuestion: (payload) => ipcRenderer.invoke('opencode:question-reply', payload),
  onOpenCodeEvent: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('opencode:event', handler);
    return () => ipcRenderer.removeListener('opencode:event', handler);
  },
  onOpenCodeEventBatch: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('opencode:event-batch', handler);
    return () => ipcRenderer.removeListener('opencode:event-batch', handler);
  },
  onOpenCodeInterjectionEvent: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('opencode:interjection-event', handler);
    return () => ipcRenderer.removeListener('opencode:interjection-event', handler);
  },
  onOpenCodeCompleted: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('opencode:completed', handler);
    return () => ipcRenderer.removeListener('opencode:completed', handler);
  },
  onYanCoreEvent: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('yan:core-event', handler);
    return () => ipcRenderer.removeListener('yan:core-event', handler);
  },
});

contextBridge.exposeInMainWorld('electronAPI', {
  receive: (channel, callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});

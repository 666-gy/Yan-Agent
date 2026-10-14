const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('yan', {
  windowUiReady: () => ipcRenderer.send('win:ui-ready'),
  onWebuiRequest: cb => { const handler = (_event, request) => cb(request); ipcRenderer.on('webui:request', handler); return () => ipcRenderer.removeListener('webui:request', handler); },
  webuiReply: (id, result) => ipcRenderer.send('webui:reply', { id, result }),
  webuiSnapshots: tasks => ipcRenderer.send('webui:snapshots', tasks),
  onWebuiWatch: cb => {
    const handler = (_event, id) => cb(id);
    ipcRenderer.on('webui:watch', handler);
    return () => ipcRenderer.removeListener('webui:watch', handler);
  },
  remoteControlInfo: () => ipcRenderer.invoke('remote-control:info'),
  windowBackground: color => ipcRenderer.send('win:background', color),
  bashList: sessionId => ipcRenderer.invoke('bash:list', sessionId),
  bashControl: params => ipcRenderer.invoke('bash:control', params),
  onBashChanged: cb => { const handler = (_event, job) => cb(job); ipcRenderer.on('bash:changed', handler); return () => ipcRenderer.removeListener('bash:changed', handler); },
  onBashWake: cb => { const handler = (_event, detail) => cb(detail); ipcRenderer.on('bash:wake', handler); return () => ipcRenderer.removeListener('bash:wake', handler); },
  // Config / API / models / skills
  getConfig: () => ipcRenderer.invoke('config:get'),
  storageStats: () => ipcRenderer.invoke('storage:stats'),
  storageReview: (options = {}) => ipcRenderer.invoke('storage:review', options),
  getLocalHistorySettings: () => ipcRenderer.invoke('general:local-status'),
  setLocalHistorySetting: (key, enabled) => ipcRenderer.invoke('general:local-update', key, enabled),
  openStartupApps: () => ipcRenderer.invoke('general:startup-apps'),
  clearMemories: () => ipcRenderer.invoke('memory:clear'),
  externalAgentsStatus: () => ipcRenderer.invoke('external-agents:status'),
  externalAgentsList: () => ipcRenderer.invoke('external-agents:list'),
  externalAgentsResult: (params) => ipcRenderer.invoke('external-agents:result', params),
  externalAgentsCancel: id => ipcRenderer.invoke('external-agents:cancel', id),
  externalAgentsAcknowledgeStop: id => ipcRenderer.invoke('external-agents:acknowledge-stop', id),
  externalAgentsChooseExecutable: () => ipcRenderer.invoke('external-agents:choose-executable'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  wallpaperAnalyze: (source) => ipcRenderer.invoke('wallpaper:analyze', { source }),
  getQuickLaunch: () => ipcRenderer.invoke('quick-launch:get'),
  updateQuickLaunch: (settings) => ipcRenderer.invoke('quick-launch:update', settings),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  connectionsList: () => ipcRenderer.invoke('connections:list'),
  connectionsSave: (payload) => ipcRenderer.invoke('connections:save', payload || {}),
  connectionsDelete: (id) => ipcRenderer.invoke('connections:delete', { id }),
  connectionsTest: (payload) => ipcRenderer.invoke('connections:test', payload || {}),
  setConnectionEnabled: (id, enabled) => ipcRenderer.invoke('connections:set-enabled', { id, enabled }),
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
  browserTabActivity: value => ipcRenderer.invoke('browser:tab-activity', value),
  browserCapturePage: id => ipcRenderer.invoke('browser:capture-page', id),
  browserExportPdf: id => ipcRenderer.invoke('browser:export-pdf', id),
  browserClearData: (type) => ipcRenderer.invoke('browser:clear-data', type),
  browserPasswordList: () => ipcRenderer.invoke('browser:password-list'),
  browserPasswordGet: id => ipcRenderer.invoke('browser:password-get', id),
  browserPasswordSave: value => ipcRenderer.invoke('browser:password-save', value),
  browserPasswordRemove: id => ipcRenderer.invoke('browser:password-remove', id),
  browserPasswordClear: () => ipcRenderer.invoke('browser:password-clear'),
  browserHistory: () => ipcRenderer.invoke('browser:history'),
  browserDownloadLocation: () => ipcRenderer.invoke('browser:download-location'),
  browserChooseDownloadLocation: () => ipcRenderer.invoke('browser:download-choose-location'),
  browserDownloads: () => ipcRenderer.invoke('browser:downloads'),
  browserDownloadControl: options => ipcRenderer.invoke('browser:download-control', options),
  browserDownloadOpenFolder: () => ipcRenderer.invoke('browser:download-open-folder'),
  browserRemoveDownloads: ids => ipcRenderer.invoke('browser:downloads-remove', ids),
  browserDownloadFile: options => ipcRenderer.invoke('browser:download-file', options),
  browserRemoveHistory: ids => ipcRenderer.invoke('browser:history-remove', ids),
  browserDataSummary: range => ipcRenderer.invoke('browser:data-summary', range),
  browserClearSelected: options => ipcRenderer.invoke('browser:clear-selected', options),
  browserOpenLink: url => ipcRenderer.invoke('browser:open-link', url),
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
  listMainModels: () => ipcRenderer.invoke('models:main-list'),
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
  setSkillEnabled: (id, enabled) => ipcRenderer.invoke('skills:set-enabled', { id, enabled }),
  readSkill: (id, taskContext) => ipcRenderer.invoke('skills:read', { id, taskContext }),
  readSkillDocument: (id) => ipcRenderer.invoke('skills:read', { id, documentOnly: true }),

  // Workspace
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  pickWorkspace: (defaultPath = '') => ipcRenderer.invoke('workspace:pick', { defaultPath }),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspaceInExplorer: (workspace) => ipcRenderer.invoke('workspace:open-explorer', workspace),

  // Git workspace
  gitStatus: (workspace) => ipcRenderer.invoke('git:status', { workspace }),
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
  managedWorktrees: (workspace = '') => ipcRenderer.invoke('git:worktrees-managed', { workspace }),
  archiveWorktree: id => ipcRenderer.invoke('git:worktree-archive', { id }),
  restoreWorktree: id => ipcRenderer.invoke('git:worktree-restore', { id }),
  cleanupWorktrees: () => ipcRenderer.invoke('git:worktrees-cleanup'),
  gitWorktreeCreate: (workspace, taskId, base = '', branch = '') => ipcRenderer.invoke('git:worktree-create', { workspace, taskId, base, branch }),
  gitWorktreeList: (workspace) => ipcRenderer.invoke('git:worktree-list', { workspace }),
  gitWorktreeStatus: (workspace, taskId) => ipcRenderer.invoke('git:worktree-status', { workspace, taskId }),
  gitWorktreeMerge: (workspace, taskId, message = '', squash = false) => ipcRenderer.invoke('git:worktree-merge', { workspace, taskId, message, squash }),
  gitWorktreeRemove: (workspace, taskId, force = false) => ipcRenderer.invoke('git:worktree-remove', { workspace, taskId, force }),
  ghConnectionStatus: () => ipcRenderer.invoke('gh:connection-status'),
  ghDetect: () => ipcRenderer.invoke('gh:detect'),
  ghPrList: (workspace, { limit = 20, state = 'open', base = '' } = {}) => ipcRenderer.invoke('gh:pr-list', { workspace, limit, state, base }),
  ghPrDiff: (workspace, number) => ipcRenderer.invoke('gh:pr-diff', { workspace, number }),
  ghPrView: (workspace, number) => ipcRenderer.invoke('gh:pr-view', { workspace, number }),
  ghReviewProject: (workspace) => ipcRenderer.invoke('gh:review-project', { workspace }),
  ghPrMerge: (workspace, number, expectedHead = '') => ipcRenderer.invoke('gh:pr-merge', { workspace, number, expectedHead }),
  ghPrCreate: (workspace, { title = '', body = '', base = '', draft } = {}) => ipcRenderer.invoke('gh:pr-create', { workspace, title, body, base, draft }),
  ghIssueList: (workspace, { limit = 50, state = 'open' } = {}) => ipcRenderer.invoke('gh:issue-list', { workspace, limit, state }),
  ghIssueCreate: (workspace, { title = '', body = '' } = {}) => ipcRenderer.invoke('gh:issue-create', { workspace, title, body }),

  // Sessions
  listArchivedSessions: () => ipcRenderer.invoke('session:archived'),
  setSessionsArchived: (ids, archived) => ipcRenderer.invoke('session:archive', { ids, archived }),
  listSessions: () => ipcRenderer.invoke('session:list'),
  getUsageStats: (options = {}) => ipcRenderer.invoke('usage:stats', options),
  getSessionDirectory: (id) => ipcRenderer.invoke('session:directory', id),
  getSessionDeepLink: (id) => ipcRenderer.invoke('session:deep-link', id),
  taskLinkReady: () => ipcRenderer.invoke('task-link:ready'),
  onTaskLink: (cb) => {
    const handler = (_event, detail) => cb(detail);
    ipcRenderer.on('task-link:open', handler);
    return () => ipcRenderer.removeListener('task-link:open', handler);
  },
  getSession: (id, options = {}) => ipcRenderer.invoke('session:get', id, options),
  getSessionMessages: (id, offset = 0, limit = 40) => ipcRenderer.invoke('session:messages', { id, offset, limit }),
  createSession: (forceNew = false, workspace = '') => ipcRenderer.invoke('session:create', { forceNew, workspace }),
  saveSession: (session) => ipcRenderer.invoke('session:save', session),
  exportSessionJson: (payload) => ipcRenderer.invoke('session:export-json', payload),
  renameSession: (id, title) => ipcRenderer.invoke('session:rename', { id, title }),
  setSessionPinned: (id, pinned) => ipcRenderer.invoke('session:set-pinned', { id, pinned }),
  setSessionWorkspace: (id, workspace, activate = true) => ipcRenderer.invoke('session:set-workspace', { id, workspace, activate }),
  activateWorkspace: (workspace) => ipcRenderer.invoke('workspace:activate', workspace),
  deleteSession: (id, confirmed = false, archivedOnly = false, cleanupDays) => ipcRenderer.invoke('session:delete', {
    id,
    confirmed,
    archivedOnly,
    cleanupDays
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
  listPets: () => ipcRenderer.invoke('pets:list'),
  deletePet: (id) => ipcRenderer.invoke('pets:delete', id),
  onPetsChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('pets:changed', handler);
    return () => ipcRenderer.removeListener('pets:changed', handler);
  },
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
  pluginsList: () => ipcRenderer.invoke('plugins:list'),
  pluginsCatalog: () => ipcRenderer.invoke('plugins:catalog'),
  pluginsAddMarketplace: payload => ipcRenderer.invoke('plugins:add-marketplace', payload),
  pluginsMarkets: () => ipcRenderer.invoke('plugins:markets'),
  pluginsRemoveMarketplace: id => ipcRenderer.invoke('plugins:remove-marketplace', { id }),
  pluginsInstallCatalog: id => ipcRenderer.invoke('plugins:install-catalog', { id }),
  pluginsConnectAccount: id => ipcRenderer.invoke('plugins:connect-account', { id }),
  pluginsDisconnectAccount: id => ipcRenderer.invoke('plugins:disconnect-account', { id }),
  pluginsUpdate: payload => ipcRenderer.invoke('plugins:update', payload),
  pluginsPrepare: id => ipcRenderer.invoke('plugins:prepare', { id }),
  pluginsRemove: id => ipcRenderer.invoke('plugins:remove', { id }),
  pluginsOpenDirectory: id => ipcRenderer.invoke('plugins:open-directory', { id }),
  pluginsOpenLink: (id, kind) => ipcRenderer.invoke('plugins:open-link', { id, kind }),
  onPluginsChanged: cb => {
    const handler = () => cb(); ipcRenderer.on('plugins:changed', handler);
    return () => ipcRenderer.removeListener('plugins:changed', handler);
  },
  // Runtime downloads (Playwright's Chromium): { id, phase, percent }.
  onPluginsProgress: cb => {
    const handler = (_event, data) => cb(data); ipcRenderer.on('plugins:progress', handler);
    return () => ipcRenderer.removeListener('plugins:progress', handler);
  },
  addCustomSkill: (skill) => ipcRenderer.invoke('skills:add-custom', skill),
  removeCustomSkill: (id) => ipcRenderer.invoke('skills:remove-custom', id),

  // Files
  chooseOpenDirectory: () => ipcRenderer.invoke('file:choose-directory'),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  inspectAttachmentPath: (filePath) => ipcRenderer.invoke('file:inspect-attachment-path', filePath),
  uploadFile: (name, base64, mimeType) => ipcRenderer.invoke('file:upload', { name, data: base64, mimeType }),
  getAppSnapshotTarget: () => ipcRenderer.invoke('app-snapshot:target'),
  getComputerControlSettings: () => ipcRenderer.invoke('computer-control:settings'),
  updateComputerControlSettings: partial => ipcRenderer.invoke('computer-control:update', partial),
  addComputerControlApp: () => ipcRenderer.invoke('computer-control:add-app'),
  removeComputerControlAllowedApp: id => ipcRenderer.invoke('computer-control:remove-allowed', id),
  getComputerControlExperience: id => ipcRenderer.invoke('computer-control:experience', id),
  downloadComputerControlExperience: id => ipcRenderer.invoke('computer-control:download-experience', id),
  recordComputerControlReview: payload => ipcRenderer.invoke('computer-control:record-review', payload),
  deleteComputerControlExperience: id => ipcRenderer.invoke('computer-control:delete-experience', id),
  captureAppSnapshot: handle => ipcRenderer.invoke('app-snapshot:capture', handle),
  onAppSnapshotTarget: cb => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('app-snapshot:target-changed', handler);
    return () => ipcRenderer.removeListener('app-snapshot:target-changed', handler);
  },
  getAppSnapshotSettings: () => ipcRenderer.invoke('app-snapshot:settings'),
  updateAppSnapshotSettings: partial => ipcRenderer.invoke('app-snapshot:update', partial),
  onAppSnapshot: cb => {
    const handler = (_event, payload) => cb(payload);
    ipcRenderer.on('app-snapshot:received', handler);
    return () => ipcRenderer.removeListener('app-snapshot:received', handler);
  },
  generateImage: (payload) => ipcRenderer.invoke('image:generate', payload),
  cancelImageGeneration: (requestId) => ipcRenderer.invoke('image:cancel', requestId),
  generateVideo: (payload) => ipcRenderer.invoke('video:generate', payload),
  cancelVideoGeneration: (requestId) => ipcRenderer.invoke('video:cancel', requestId),
  readGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-read', assetId),
  openGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-open', assetId),
  previewImageFile: (filePath) => ipcRenderer.invoke('image:file-open', filePath),
  readImageFile: (filePath) => ipcRenderer.invoke('image:file-read', filePath),
  downloadImageFile: (filePath) => ipcRenderer.invoke('image:file-download', filePath),
  downloadGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-download', assetId),
  openImageDefault: (filePath) => ipcRenderer.invoke('image:file-default', filePath),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),

  // Text-to-speech (Edge neural voices, read replies aloud)
  ttsSynthesize: (payload) => ipcRenderer.invoke('tts:synth', payload || {}),
  ttsListVoices: () => ipcRenderer.invoke('tts:voices'),
  ttsCancel: (requestId) => ipcRenderer.invoke('tts:cancel', requestId),
  voiceStatus: () => ipcRenderer.invoke('voice:status'),
  voiceConfigure: patch => ipcRenderer.invoke('voice:configure', patch),
  voicePrepare: () => ipcRenderer.invoke('voice:prepare'),
  voiceCancelPreparation: () => ipcRenderer.invoke('voice:cancel-preparation'),
  voiceRemoveModels: () => ipcRenderer.invoke('voice:remove-models'),
  voiceTranscribe: request => ipcRenderer.invoke('voice:transcribe', request),
  voiceStreamStart: request => ipcRenderer.invoke('voice:stream-start', request),
  voiceStreamChunk: request => ipcRenderer.invoke('voice:stream-chunk', request),
  voiceStreamFinish: request => ipcRenderer.invoke('voice:stream-finish', request),
  voiceCancel: requestId => ipcRenderer.invoke('voice:cancel', requestId),
  onVoiceChanged: cb => {
    const handler = (_event, value) => cb(value); ipcRenderer.on('voice:changed', handler);
    return () => ipcRenderer.removeListener('voice:changed', handler);
  },

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
  openFileDefault: (workspace) => ipcRenderer.invoke('vscode:launch', { workspace, useDefault: true }),
  openExternalPowerShell: (workspace = '') => ipcRenderer.invoke('powershell:open-external', { workspace }),

  // Permissions
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  setPermissions: (perms) => ipcRenderer.invoke('permissions:set', perms),
  permissionAudit: (payload) => ipcRenderer.invoke('opencode:permission-audit', payload),


  // MCP (Model Context Protocol)
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  openMcpDirectory: (id) => ipcRenderer.invoke('mcp:open-directory', id),
  mcpAdd: (cfg) => ipcRenderer.invoke('mcp:add', cfg),
  mcpRemove: (id) => ipcRenderer.invoke('mcp:remove', id),
  mcpUpdate: (id, changes) => ipcRenderer.invoke('mcp:update', { id, ...changes }),
  mcpTest: (cfg) => ipcRenderer.invoke('mcp:test', cfg),
  mcpStart: (id) => ipcRenderer.invoke('mcp:start', id),
  mcpTools: (id) => ipcRenderer.invoke('mcp:tools', id),
  mcpStop: (id) => ipcRenderer.invoke('mcp:stop', id),

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
  openCodePrewarm: (payload) => ipcRenderer.invoke('opencode:prewarm', payload),
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

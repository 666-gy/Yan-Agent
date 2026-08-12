const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yan', {
  // Config / API / models / skills
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  getQuickLaunch: () => ipcRenderer.invoke('quick-launch:get'),
  updateQuickLaunch: (settings) => ipcRenderer.invoke('quick-launch:update', settings),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  getProviderSecret: (providerId, supplierId) => ipcRenderer.invoke('provider:get-secret', { providerId, supplierId }),
  addProviderSupplier: (providerId, name) => ipcRenderer.invoke('provider:add-supplier', { providerId, name }),
  setProviderSupplier: (providerId, supplierId) => ipcRenderer.invoke('provider:set-supplier', { providerId, supplierId }),
  deleteProviderSupplier: (providerId, supplierId) => ipcRenderer.invoke('provider:delete-supplier', { providerId, supplierId }),
  configureProvider: (providerId, config) => ipcRenderer.invoke('provider:configure', {
    providerId,
    ...(config && typeof config === 'object' ? config : { apiKey: config })
  }),
  removeProviderConfig: (providerId, supplierId = '') => ipcRenderer.invoke('provider:remove-config', { providerId, supplierId }),
  deleteCustomProvider: (providerId) => ipcRenderer.invoke('provider:delete-custom', providerId),
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
  readSkill: (id, taskContext) => ipcRenderer.invoke('skills:read', { id, taskContext }),

  // Workspace
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  pickWorkspace: () => ipcRenderer.invoke('workspace:pick'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  openWorkspaceInExplorer: (workspace) => ipcRenderer.invoke('workspace:open-explorer', workspace),
  listWorkspace: (dir) => ipcRenderer.invoke('workspace:list', dir),

  // Git workspace
  gitStatus: (workspace) => ipcRenderer.invoke('git:status', { workspace }),
  gitInit: (workspace, initialBranch = 'main') => ipcRenderer.invoke('git:init', { workspace, initialBranch }),
  gitStage: (workspace, paths = [], all = false) => ipcRenderer.invoke('git:stage', { workspace, paths, all }),
  gitUnstage: (workspace, paths = [], all = false) => ipcRenderer.invoke('git:unstage', { workspace, paths, all }),
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
  gitPickCloneDestination: () => ipcRenderer.invoke('git:pick-clone-destination'),
  gitClone: (remoteUrl, destination) => ipcRenderer.invoke('git:clone', { remoteUrl, destination }),
  gitOpenRemote: (remoteUrl) => ipcRenderer.invoke('git:open-remote', { remoteUrl }),

  // Sessions
  listSessions: () => ipcRenderer.invoke('session:list'),
  getSession: (id) => ipcRenderer.invoke('session:get', id),
  createSession: (forceNew = false) => ipcRenderer.invoke('session:create', { forceNew }),
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

  // Files — pass { filePath, workspace } for sandbox enforcement (session workspace)
  readFile: (filePath, workspace) => {
    if (filePath && typeof filePath === 'object') return ipcRenderer.invoke('file:read', filePath);
    return ipcRenderer.invoke('file:read', { filePath, workspace });
  },
  chooseOpenDirectory: () => ipcRenderer.invoke('file:choose-directory'),
  uploadFile: (name, base64, mimeType) => ipcRenderer.invoke('file:upload', { name, data: base64, mimeType }),
  generateImage: (payload) => ipcRenderer.invoke('image:generate', payload),
  cancelImageGeneration: (requestId) => ipcRenderer.invoke('image:cancel', requestId),
  generateVideo: (payload) => ipcRenderer.invoke('video:generate', payload),
  cancelVideoGeneration: (requestId) => ipcRenderer.invoke('video:cancel', requestId),
  readGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-read', assetId),
  openGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-open', assetId),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),

  // Built-in terminal (real PTY, independent from Agent workspaces)
  terminalCreate: (options) => ipcRenderer.invoke('terminal:create', options || {}),
  terminalWrite: (sessionId, data) => ipcRenderer.invoke('terminal:write', { sessionId, data }),
  terminalResize: (sessionId, cols, rows) => ipcRenderer.invoke('terminal:resize', { sessionId, cols, rows }),
  terminalDestroy: (sessionId) => ipcRenderer.invoke('terminal:destroy', sessionId),

  // .yanagent (memory/logs/snapshots in workspace)
  yanagentEnsure: (workspace) => ipcRenderer.invoke('yanagent:ensure', workspace),
  yanagentRunChanges: (sessionId, runId, workspace, options = {}) => ipcRenderer.invoke('yanagent:run-changes', {
    sessionId,
    runId,
    workspace,
    includeDiff: !!options.includeDiff,
    allRuns: !!options.allRuns
  }),
  yanagentRollbackRun: (sessionId, runId, workspace) => ipcRenderer.invoke('yanagent:rollback-run', { sessionId, runId, workspace }),

  launchYanxiCode: (workspace, mode = 'workspace') => ipcRenderer.invoke('yanxi:launch', { workspace, mode }),
  getVsCodeStatus: () => ipcRenderer.invoke('vscode:status'),
  launchVsCode: (workspace = '') => ipcRenderer.invoke('vscode:launch', { workspace }),
  openExternalPowerShell: (workspace = '') => ipcRenderer.invoke('powershell:open-external', { workspace }),

  // Permissions
  getPermissions: () => ipcRenderer.invoke('permissions:get'),
  setPermissions: (perms) => ipcRenderer.invoke('permissions:set', perms),

  // Mobile remote control
  getRemoteInfo: () => ipcRenderer.invoke('remote:get-info'),
  restartRemote: () => ipcRenderer.invoke('remote:restart'),
  setRemotePassword: (password) => ipcRenderer.invoke('remote:set-password', { password }),
  remoteResult: (payload) => ipcRenderer.send('remote:result', payload),
  remoteNotify: (payload) => ipcRenderer.send('remote:notify', payload),
  onRemoteInvoke: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('remote:invoke', handler);
    return () => ipcRenderer.removeListener('remote:invoke', handler);
  },

  // Automations (定时自动任务)
  autoList: () => ipcRenderer.invoke('auto:list'),
  autoAdd: (auto) => ipcRenderer.invoke('auto:add', auto),
  autoUpdate: (id, changes) => ipcRenderer.invoke('auto:update', { id, ...changes }),
  autoRemove: (id) => ipcRenderer.invoke('auto:remove', id),

  // MCP (Model Context Protocol)
  mcpList: () => ipcRenderer.invoke('mcp:list'),
  mcpAdd: (cfg) => ipcRenderer.invoke('mcp:add', cfg),
  mcpRemove: (id) => ipcRenderer.invoke('mcp:remove', id),
  mcpUpdate: (id, changes) => ipcRenderer.invoke('mcp:update', { id, ...changes }),
  mcpTest: (cfg) => ipcRenderer.invoke('mcp:test', cfg),
  mcpStart: (id) => ipcRenderer.invoke('mcp:start', id),
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
  onTerminalEvent: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('terminal:event', handler);
    return () => ipcRenderer.removeListener('terminal:event', handler);
  },

  onWorkspaceChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  },

  onYanxiWorkspaceSync: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('yanxi:workspace-sync', handler);
    return () => ipcRenderer.removeListener('yanxi:workspace-sync', handler);
  },

  consumePendingYanxiWorkspace: () => ipcRenderer.invoke('yanxi:consume-pending-workspace'),

  onSkillsChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('skills:changed', handler);
    return () => ipcRenderer.removeListener('skills:changed', handler);
  },

  // OpenCode runtime
  openCodeStartRun: (request) => ipcRenderer.invoke('opencode:start-run', request),
  openCodeRunChanges: (runId, options = {}) => ipcRenderer.invoke('opencode:run-changes', {
    runId,
    includeDiff: options.includeDiff !== false
  }),
  openCodeSessionChanges: (yanSessionId, runId, options = {}) => ipcRenderer.invoke('opencode:session-changes', {
    yanSessionId,
    runId,
    includeDiff: options.includeDiff !== false
  }),
  openCodeCancelRun: (runId) => ipcRenderer.invoke('opencode:cancel-run', runId),
  openCodeInterject: (payload) => ipcRenderer.invoke('opencode:interject', payload),
  openCodeCancelInterjection: (payload) => ipcRenderer.invoke('opencode:cancel-interjection', payload),
  classifyOpenCodeShellCommand: (command) => ipcRenderer.invoke('opencode:classify-shell-command', command),
  openCodeReplyPermission: (payload) => ipcRenderer.invoke('opencode:permission-reply', payload),
  openCodeReplyQuestion: (payload) => ipcRenderer.invoke('opencode:question-reply', payload),
  onOpenCodeEvent: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('opencode:event', handler);
    return () => ipcRenderer.removeListener('opencode:event', handler);
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

  // Computer control
  computerStart: (opts) => ipcRenderer.invoke('computer:start', opts),
  computerStop: () => ipcRenderer.invoke('computer:stop'),
  computerStatus: () => ipcRenderer.invoke('computer:status')
});

contextBridge.exposeInMainWorld('electronAPI', {
  receive: (channel, callback) => {
    const handler = (_event, ...args) => callback(...args);
    ipcRenderer.on(channel, handler);
    return () => ipcRenderer.removeListener(channel, handler);
  }
});

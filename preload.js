const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yan', {
  // Config / API / models / skills
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  setProvider: (providerId) => ipcRenderer.invoke('provider:set', providerId),
  configureProvider: (providerId, apiKey) => ipcRenderer.invoke('provider:configure', { providerId, apiKey }),
  refreshProviderModels: (providerId) => ipcRenderer.invoke('provider:models:refresh', providerId),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  listModels: () => ipcRenderer.invoke('models:list'),
  setModel: (modelId) => ipcRenderer.invoke('model:set', modelId),
  onModelChanged: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('model:changed', handler);
    return () => ipcRenderer.removeListener('model:changed', handler);
  },
  listSkills: () => ipcRenderer.invoke('skills:list'),
  getSkillMarket: () => ipcRenderer.invoke('skills:market'),
  getSkillCatalog: () => ipcRenderer.invoke('skills:catalog'),
  getSkillPromptSection: () => ipcRenderer.invoke('skills:prompt-section'),
  readSkill: (id, taskContext) => ipcRenderer.invoke('skills:read', { id, taskContext }),
  ensureSkill: (id) => ipcRenderer.invoke('skills:ensure', { id }),
  syncSkills: () => ipcRenderer.invoke('skills:sync'),

  listUiKits: () => ipcRenderer.invoke('ui-kits:list'),
  listUiKit: (kit, query) => ipcRenderer.invoke('ui-kits:catalog', { kit, query }),
  getUiKitPromptSection: () => ipcRenderer.invoke('ui-kits:prompt-section'),
  readUiKit: (kit, component, variant) => ipcRenderer.invoke('ui-kits:read', { kit, component, variant }),

  // Workspace
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  listWorkspace: (dir) => ipcRenderer.invoke('workspace:list', dir),
  clearWorkspace: () => ipcRenderer.invoke('workspace:clear'),

  // Sessions
  listSessions: () => ipcRenderer.invoke('session:list'),
  getSession: (id) => ipcRenderer.invoke('session:get', id),
  createSession: (forceNew = false) => ipcRenderer.invoke('session:create', { forceNew }),
  saveSession: (session) => ipcRenderer.invoke('session:save', session),
  renameSession: (id, title) => ipcRenderer.invoke('session:rename', { id, title }),
  setSessionPinned: (id, pinned) => ipcRenderer.invoke('session:set-pinned', { id, pinned }),
  setSessionWorkspace: (id, workspace, activate = true) => ipcRenderer.invoke('session:set-workspace', { id, workspace, activate }),
  activateWorkspace: (workspace) => ipcRenderer.invoke('workspace:activate', workspace),
  deleteSession: (id, confirmed = false) => ipcRenderer.invoke('session:delete', { id, confirmed }),
  onSessionChanged: (cb) => {
    const handler = (_e, detail) => cb(detail);
    ipcRenderer.on('session:changed', handler);
    return () => ipcRenderer.removeListener('session:changed', handler);
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

  // Long-term memory
  getMemory: () => ipcRenderer.invoke('memory:get'),
  saveMemory: (mem) => ipcRenderer.invoke('memory:save', mem),
  addMemoryFact: (fact) => ipcRenderer.invoke('memory:add-fact', fact),
  clearMemory: () => ipcRenderer.invoke('memory:clear'),

  // Skills
  addCustomSkill: (skill) => ipcRenderer.invoke('skills:add-custom', skill),
  removeCustomSkill: (id) => ipcRenderer.invoke('skills:remove-custom', id),
  getCustomSkills: () => ipcRenderer.invoke('skills:get-custom'),

  // Files
  readFile: (filePath) => ipcRenderer.invoke('file:read', filePath),
  readFileRange: (filePath, start_line, end_line) =>
    ipcRenderer.invoke('file:read-range', { filePath, start_line, end_line }),
  writeFile: (filePath, content) => ipcRenderer.invoke('file:write', { filePath, content }),
  chooseOpenFile: () => ipcRenderer.invoke('file:choose-open'),
  chooseSaveFile: () => ipcRenderer.invoke('file:choose-save'),
  uploadFile: (name, base64, mimeType) => ipcRenderer.invoke('file:upload', { name, data: base64, mimeType }),
  readImageAttachment: (filePath) => ipcRenderer.invoke('file:image-data', filePath),
  generateImage: (payload) => ipcRenderer.invoke('image:generate', payload),
  cancelImageGeneration: (requestId) => ipcRenderer.invoke('image:cancel', requestId),
  readGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-read', assetId),
  openGeneratedImage: (assetId) => ipcRenderer.invoke('image:generated-open', assetId),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('file:delete', filePath),

  // Shell execution
  executeShell: (command, cwd, oneShot) => ipcRenderer.invoke('shell:execute', { command, cwd, oneShot }),

  // Built-in terminal (persistent and independent from Agent workspaces)
  terminalCreate: () => ipcRenderer.invoke('terminal:create'),
  terminalExecute: (sessionId, command) => ipcRenderer.invoke('terminal:execute', { sessionId, command }),
  terminalWrite: (sessionId, data) => ipcRenderer.invoke('terminal:write', { sessionId, data }),
  terminalInterrupt: (sessionId) => ipcRenderer.invoke('terminal:interrupt', sessionId),
  terminalRestart: (sessionId) => ipcRenderer.invoke('terminal:restart', sessionId),
  terminalDestroy: (sessionId) => ipcRenderer.invoke('terminal:destroy', sessionId),

  // .yanagent (memory/logs/snapshots in workspace)
  yanagentEnsure: (workspace) => ipcRenderer.invoke('yanagent:ensure', workspace),
  yanagentLog: (message, workspace) => ipcRenderer.invoke('yanagent:log', { message, workspace }),
  yanagentRecordChange: (payload) => ipcRenderer.invoke('yanagent:record-change', payload),
  yanagentRunChanges: (sessionId, runId, workspace) => ipcRenderer.invoke('yanagent:run-changes', { sessionId, runId, workspace }),
  yanagentRollbackRun: (sessionId, runId, workspace) => ipcRenderer.invoke('yanagent:rollback-run', { sessionId, runId, workspace }),

  // Search (supports options object or legacy positional args)
  searchFiles: (query, directory, extensions) => {
    if (query && typeof query === 'object') {
      return ipcRenderer.invoke('search:files', query);
    }
    return ipcRenderer.invoke('search:files', { query, directory, extensions });
  },

  // Code understanding
  buildCodeIndex: (opts) => ipcRenderer.invoke('code:build-index', opts || {}),
  codeIndexStatus: (workspace) => ipcRenderer.invoke('code:index-status', workspace),
  codeSearchSymbols: (opts) => ipcRenderer.invoke('code:search-symbols', opts || {}),
  codeFindSymbol: (opts) => ipcRenderer.invoke('code:find-symbol', opts || {}),
  codeFindReferences: (opts) => ipcRenderer.invoke('code:find-references', opts || {}),
  codeFindRelated: (opts) => ipcRenderer.invoke('code:find-related', opts || {}),
  codeFileImports: (filePath) => ipcRenderer.invoke('code:file-imports', { path: filePath }),
  codeScanProject: (workspace) => ipcRenderer.invoke('code:scan-project', { workspace }),
  codeTraceSymbol: (opts) => ipcRenderer.invoke('code:trace-symbol', opts || {}),

  // Code map
  getCodeMap: (workspace, force = false) => ipcRenderer.invoke('code-map:get', { workspace, force }),
  enrichCodeMap: (workspace, limit) => ipcRenderer.invoke('code-map:enrich', { workspace, limit }),
  clearCodeMapCache: (workspace) => ipcRenderer.invoke('code-map:clear-cache', workspace),
  listCodeMapModels: () => ipcRenderer.invoke('code-map:models:list'),
  getCodeMapModel: () => ipcRenderer.invoke('code-map:model:get'),
  setCodeMapModel: (modelId) => ipcRenderer.invoke('code-map:model:set', modelId),
  launchYanxiCode: (workspace, mode = 'workspace') => ipcRenderer.invoke('yanxi:launch', { workspace, mode }),

  // Workspace tree
  getWorkspaceTree: (directory, maxDepth) => ipcRenderer.invoke('workspace:tree', { directory, maxDepth }),

  // Git operations
  gitStatus: (dirPath) => ipcRenderer.invoke('git:status', dirPath),
  gitDiff: (stagedOrDirPath, maybeStaged) => {
    const staged = typeof stagedOrDirPath === 'boolean' ? stagedOrDirPath : maybeStaged;
    const dirPath = typeof stagedOrDirPath === 'string' ? stagedOrDirPath : undefined;
    return ipcRenderer.invoke('git:diff', { dirPath, staged });
  },
  gitLog: (limitOrDirPath, maybeLimit) => {
    const limit = typeof limitOrDirPath === 'number' ? limitOrDirPath : maybeLimit;
    const dirPath = typeof limitOrDirPath === 'string' ? limitOrDirPath : undefined;
    return ipcRenderer.invoke('git:log', { dirPath, limit });
  },
  gitCommit: (message, dirPath) => ipcRenderer.invoke('git:commit', { message, dirPath }),
  gitPush: (remoteOrDirPath, branchOrRemote, maybeBranch) => {
    const looksLikePath = typeof remoteOrDirPath === 'string' && /[\\/:]/.test(remoteOrDirPath);
    const dirPath = looksLikePath ? remoteOrDirPath : undefined;
    const remote = looksLikePath ? branchOrRemote : remoteOrDirPath;
    const branch = looksLikePath ? maybeBranch : branchOrRemote;
    return ipcRenderer.invoke('git:push', { dirPath, remote, branch });
  },
  gitPull: (remoteOrDirPath, branchOrRemote, maybeBranch) => {
    const looksLikePath = typeof remoteOrDirPath === 'string' && /[\\/:]/.test(remoteOrDirPath);
    const dirPath = looksLikePath ? remoteOrDirPath : undefined;
    const remote = looksLikePath ? branchOrRemote : remoteOrDirPath;
    const branch = looksLikePath ? maybeBranch : branchOrRemote;
    return ipcRenderer.invoke('git:pull', { dirPath, remote, branch });
  },
  gitClone: (url, dirPath) => ipcRenderer.invoke('git:clone', { url, dirPath }),
  gitBranch: (dirPath) => ipcRenderer.invoke('git:branch', dirPath),

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
  mcpStart: (id) => ipcRenderer.invoke('mcp:start', id),
  mcpStop: (id) => ipcRenderer.invoke('mcp:stop', id),
  mcpListTools: () => ipcRenderer.invoke('mcp:list-tools'),
  mcpCallTool: (serverId, toolName, args) => ipcRenderer.invoke('mcp:call-tool', serverId, toolName, args),

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

  onCodeMapProgress: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('code-map:progress', handler);
    return () => ipcRenderer.removeListener('code-map:progress', handler);
  },

  onCodeMapChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('code-map:changed', handler);
    return () => ipcRenderer.removeListener('code-map:changed', handler);
  },

  onSkillsSynced: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('skills:synced', handler);
    return () => ipcRenderer.removeListener('skills:synced', handler);
  },

  onSkillsChanged: (cb) => {
    const handler = (_e, data) => cb(data);
    ipcRenderer.on('skills:changed', handler);
    return () => ipcRenderer.removeListener('skills:changed', handler);
  },

  // Platform
  platform: process.platform
});

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('yan', {
  // Config / API / models / skills
  getConfig: () => ipcRenderer.invoke('config:get'),
  setConfig: (partial) => ipcRenderer.invoke('config:set', partial),
  listProviders: () => ipcRenderer.invoke('providers:list'),
  setProvider: (providerId) => ipcRenderer.invoke('provider:set', providerId),
  listModels: () => ipcRenderer.invoke('models:list'),
  setModel: (modelId) => ipcRenderer.invoke('model:set', modelId),
  listSkills: () => ipcRenderer.invoke('skills:list'),

  // Workspace
  getWorkspace: () => ipcRenderer.invoke('workspace:get'),
  chooseWorkspace: () => ipcRenderer.invoke('workspace:choose'),
  listWorkspace: (dir) => ipcRenderer.invoke('workspace:list', dir),
  clearWorkspace: () => ipcRenderer.invoke('workspace:clear'),

  // Sessions
  listSessions: () => ipcRenderer.invoke('session:list'),
  getSession: (id) => ipcRenderer.invoke('session:get', id),
  createSession: () => ipcRenderer.invoke('session:create'),
  saveSession: (session) => ipcRenderer.invoke('session:save', session),
  renameSession: (id, title) => ipcRenderer.invoke('session:rename', { id, title }),
  setSessionWorkspace: (id, workspace) => ipcRenderer.invoke('session:set-workspace', { id, workspace }),
  deleteSession: (id) => ipcRenderer.invoke('session:delete', id),

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
  uploadFile: (name, base64) => ipcRenderer.invoke('file:upload', { name, data: base64 }),
  revealFile: (filePath) => ipcRenderer.invoke('file:reveal', filePath),
  deleteFile: (filePath) => ipcRenderer.invoke('file:delete', filePath),

  // Shell execution
  executeShell: (command, cwd, oneShot) => ipcRenderer.invoke('shell:execute', { command, cwd, oneShot }),

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

  onWorkspaceChanged: (cb) => {
    const handler = () => cb();
    ipcRenderer.on('workspace:changed', handler);
    return () => ipcRenderer.removeListener('workspace:changed', handler);
  },

  // Platform
  platform: process.platform
});

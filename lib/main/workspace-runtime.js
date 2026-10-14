'use strict';

// Workspace runtime (plan T3.5): workspace IPC, the recursive file watcher, the
// repo-map cache and the debounced workspace:changed broadcast. Moved verbatim
// from main.js; the main window reference arrives through a state cell.

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const workspaceSandbox = require('../workspace-sandbox');
const { buildRepoMapBackground } = require('../analysis/repo-map-background');

function registerWorkspaceRuntime(ctx, deps = {}) {
  const { ipcMain, dialog, shell, config, state } = ctx;
  const loadConfig = config.load;
  const saveConfig = config.save;
  const mainWindow = state.mainWindow;
  const { yanagent, yanagentDir } = deps;

  let workspaceWatcher = null;
  let workspaceNotifyTimer = null;
  const pendingWorkspaceChanges = new Map();

  const WORKSPACE_WATCH_IGNORED_ROOTS = new Set([
    yanagentDir,
    '.git',
    'node_modules',
    'dist',
    'build',
    'coverage',
    '.cache',
    '.next',
    '.turbo'
  ]);

  function shouldIgnoreWorkspaceWatch(filename) {
    if (!filename) return false;
    const norm = String(filename).replace(/\\/g, '/');
    return norm.split('/').some(segment => WORKSPACE_WATCH_IGNORED_ROOTS.has(segment));
  }

  // Per-workspace repo map cache. Built once, refreshed on workspace file
  // changes (watcher) or after a TTL, and frozen into each run's request so the
  // kernel's cached system prefix stays stable for the whole run.
  const REPO_MAP_TTL_MS = 5 * 60_000;
  const REPO_MAP_BUDGET_TOKENS = 1200;
  const repoMapCache = new Map();
  const repoMapInflight = new Map();

  function invalidateRepoMap(workspace) {
    const key = String(workspace || '').trim();
    if (!key) return;
    repoMapCache.delete(path.resolve(key).toLowerCase());
    repoMapInflight.get(path.resolve(key).toLowerCase())?.cancel?.();
    repoMapInflight.delete(path.resolve(key).toLowerCase());
  }

  async function getCachedRepoMap(workspace) {
    const normalized = workspaceSandbox.normalizeWorkspace(workspace);
    if (!normalized) return '';
    const key = normalized.toLowerCase();
    const cached = repoMapCache.get(key);
    if (cached && Date.now() - cached.builtAt < REPO_MAP_TTL_MS) return cached.text;
    const inflight = repoMapInflight.get(key);
    if (inflight) return inflight;
    const controller = new AbortController();
    const building = (async () => {
      try {
        const text = await buildRepoMapBackground(normalized, { budgetTokens: REPO_MAP_BUDGET_TOKENS, signal: controller.signal });
        if (repoMapInflight.get(key) === building) repoMapCache.set(key, { text, builtAt: Date.now() });
        return text;
      } catch {
        return '';
      } finally {
        if (repoMapInflight.get(key) === building) repoMapInflight.delete(key);
      }
    })();
    building.cancel = () => controller.abort();
    repoMapInflight.set(key, building);
    return building;
  }

  // Non-blocking read for the run path: return the fresh cached map, otherwise
  // kick off a background build and hand the caller an empty orientation aid.
  // Warming happens at app start / workspace switch, so the cold branch is the
  // rare first-message-in-a-new-workspace case rather than the blocking path.
  function peekRepoMap(workspace) {
    const normalized = workspaceSandbox.normalizeWorkspace(workspace);
    if (!normalized) return '';
    const key = normalized.toLowerCase();
    const cached = repoMapCache.get(key);
    if (cached && Date.now() - cached.builtAt < REPO_MAP_TTL_MS) return cached.text;
    void getCachedRepoMap(normalized).catch(() => {});
    return '';
  }

  function warmRepoMap(workspace) {
    const normalized = workspaceSandbox.normalizeWorkspace(workspace);
    if (!normalized) return;
    void getCachedRepoMap(normalized).catch(() => {});
  }

  function notifyWorkspaceChanged(detail = {}) {
    if (detail.workspace) invalidateRepoMap(detail.workspace);
    if (detail.path) {
      pendingWorkspaceChanges.set(detail.path, {
        path: detail.path,
        eventType: detail.eventType || 'change'
      });
    }
    if (workspaceNotifyTimer) clearTimeout(workspaceNotifyTimer);
    workspaceNotifyTimer = setTimeout(() => {
      workspaceNotifyTimer = null;
      const payload = {
        workspace: detail.workspace || loadConfig().workspace,
        changes: [...pendingWorkspaceChanges.values()].slice(0, 100),
        timestamp: Date.now()
      };
      pendingWorkspaceChanges.clear();
      const win = mainWindow.get();
      if (win && !win.isDestroyed()) {
        win.webContents.send('workspace:changed', payload);
      }
    }, 300);
  }

  function stopWorkspaceWatcher() {
    if (workspaceWatcher) {
      workspaceWatcher.close();
      workspaceWatcher = null;
    }
    pendingWorkspaceChanges.clear();
  }

  function startWorkspaceWatcher(workspace) {
    stopWorkspaceWatcher();
    if (!workspace || !fs.existsSync(workspace)) return;
    warmRepoMap(workspace);
    try {
      workspaceWatcher = fs.watch(workspace, { recursive: true }, (eventType, filename) => {
        if (shouldIgnoreWorkspaceWatch(filename)) return;
        const relPath = String(filename || '').replace(/\\/g, '/');
        notifyWorkspaceChanged({
          workspace,
          eventType,
          path: relPath ? path.join(workspace, relPath) : workspace
        });
      });
      workspaceWatcher.on('error', () => stopWorkspaceWatcher());
    } catch {
      stopWorkspaceWatcher();
    }
  }

  ipcMain.handle('workspace:get', () => loadConfig().workspace);
  function activateWorkspace(workspace) {
    const ws = workspace || '';
    const cfg = loadConfig();
    cfg.workspace = ws;
    saveConfig(cfg);
    if (ws) {
      yanagent.migrateMemoryToWorkspace(ws);
      yanagent.ensureYanagent(ws);
    }
    startWorkspaceWatcher(ws);
    return cfg;
  }
  ipcMain.handle('workspace:activate', (_e, workspace) => activateWorkspace(workspace));
  async function pickWorkspaceDirectory(_event, { defaultPath = '' } = {}) {
    const owner = mainWindow.get();
    if (defaultPath && path.isAbsolute(defaultPath)) await fsp.mkdir(defaultPath, { recursive: true });
    const result = await dialog.showOpenDialog(owner, {
      defaultPath: String(defaultPath || ''),
      properties: ['openDirectory']
    });
    return !result.canceled && result.filePaths.length ? result.filePaths[0] : null;
  }
  ipcMain.handle('workspace:pick', pickWorkspaceDirectory);
  ipcMain.handle('workspace:choose', async () => {
    const workspace = await pickWorkspaceDirectory();
    if (workspace) {
      const cfg = loadConfig();
      cfg.workspace = workspace;
      saveConfig(cfg);
      startWorkspaceWatcher(cfg.workspace);
      return workspace;
    }
    return null;
  });

  ipcMain.handle('workspace:open-explorer', async (_e, workspace) => {
    const normalized = workspaceSandbox.normalizeWorkspace(workspace);
    if (!normalized) return { ok: false, error: '工作区路径为空。' };
    try {
      const stat = await fsp.stat(normalized);
      if (!stat.isDirectory()) return { ok: false, error: '工作区不是文件夹。' };
      const error = await shell.openPath(normalized);
      return error ? { ok: false, error } : { ok: true, path: normalized };
    } catch (error) {
      return { ok: false, error: error.message || String(error) };
    }
  });

  return {
    notifyWorkspaceChanged,
    invalidateRepoMap,
    getCachedRepoMap,
    peekRepoMap,
    warmRepoMap,
    stopWorkspaceWatcher,
    startWorkspaceWatcher,
    activateWorkspace,
    pickWorkspaceDirectory
  };
}

module.exports = { registerWorkspaceRuntime };

'use strict';

// IPC: Git, task worktrees and GitHub (plan T1.1/T1.2).
// Handlers moved verbatim from main.js; every dependency arrives through the
// injected main context (lib/main/context.js). `gitIpc` is the shared result
// envelope for this family and is exported for lib/main/ipc-gh.js.

async function gitIpc(action) {
  try {
    const result = await action();
    if (result && typeof result === 'object' && !Array.isArray(result)) return { ok: true, ...result };
    return { ok: true, result };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || 'GIT_ERROR'
    };
  }
}

function registerGitIpc(ctx) {
  const { ipcMain, dialog, shell, services, windows } = ctx;
  const { gitService, runReviewTask } = services;
  const manager = ctx.paths?.dataDir ? require('../managed-worktrees').createManagedWorktrees({ dataDir: ctx.paths.dataDir, loadConfig: ctx.config.load }) : null;
  const worktreeService = manager || services.worktreeService;
  if (manager) {
    ipcMain.handle('git:worktrees-managed', (_e, { workspace = '' } = {}) => gitIpc(() => manager.list(workspace)));
    ipcMain.handle('git:worktree-archive', (_e, { id } = {}) => gitIpc(() => manager.archive(id)));
    ipcMain.handle('git:worktree-restore', (_e, { id } = {}) => gitIpc(() => manager.restore(id)));
    ipcMain.handle('git:worktrees-cleanup', () => gitIpc(() => manager.cleanup()));
    const timer = setInterval(() => manager.cleanup().catch(error => console.warn('[worktrees] cleanup:', error.message)), 5 * 60 * 1000);
    timer.unref();
    ctx.app?.once('will-quit', () => clearInterval(timer));
  }
  const preferences = () => require('../git-preferences').normalizeGitPreferences(ctx.config.load().git);

  ipcMain.handle('git:status', (_e, { workspace = '' } = {}) => gitIpc(async () => ({
    status: await gitService.repositoryStatus(workspace)
  })));
  ipcMain.handle('git:stage', (_e, { workspace = '', paths = [], all = false } = {}) => gitIpc(async () => ({
    status: await gitService.stageFiles(workspace, paths, all)
  })));
  ipcMain.handle('git:unstage', (_e, { workspace = '', paths = [], all = false } = {}) => gitIpc(async () => ({
    status: await gitService.unstageFiles(workspace, paths, all)
  })));
  ipcMain.handle('git:discard', (_e, { workspace = '', paths = [] } = {}) => gitIpc(async () => ({
    status: await gitService.discardFiles(workspace, paths)
  })));
  ipcMain.handle('git:commit', (_e, { workspace = '', message = '', amend = false } = {}) => gitIpc(() => (
    gitService.commit(workspace, message, { amend })
  )));
  ipcMain.handle('git:branch-create', (_e, { workspace = '', name = '', checkout = true } = {}) => gitIpc(async () => ({
    status: await gitService.createBranch(workspace, require('../git-preferences').prefixedBranch(name, preferences()), { checkout })
  })));
  ipcMain.handle('git:branch-switch', (_e, { workspace = '', name = '', remoteBranch = '' } = {}) => gitIpc(async () => ({
    status: await gitService.switchBranch(workspace, name, remoteBranch)
  })));
  ipcMain.handle('git:fetch', (_e, { workspace = '', remoteName = '' } = {}) => gitIpc(async () => ({
    status: await gitService.fetchRemote(workspace, remoteName)
  })));
  ipcMain.handle('git:pull', (_e, { workspace = '' } = {}) => gitIpc(async () => ({
    status: await gitService.pull(workspace)
  })));
  ipcMain.handle('git:push', (_e, { workspace = '', remoteName = '' } = {}) => gitIpc(async () => ({
    status: await gitService.push(workspace, remoteName, preferences())
  })));
  ipcMain.handle('git:remote-add', (_e, { workspace = '', name = '', url = '' } = {}) => gitIpc(async () => ({
    status: await gitService.addRemote(workspace, name, url)
  })));
  ipcMain.handle('git:remote-set-url', (_e, { workspace = '', name = '', url = '' } = {}) => gitIpc(async () => ({
    status: await gitService.setRemoteUrl(workspace, name, url)
  })));
  ipcMain.handle('git:remote-remove', (_e, { workspace = '', name = '' } = {}) => gitIpc(async () => ({
    status: await gitService.removeRemote(workspace, name)
  })));
  ipcMain.handle('git:identity-set', (_e, { workspace = '', name = '', email = '' } = {}) => gitIpc(async () => ({
    status: await gitService.setIdentity(workspace, name, email)
  })));
  ipcMain.handle('git:history', (_e, { workspace = '', limit = 40 } = {}) => gitIpc(async () => ({
    commits: await gitService.history(workspace, limit)
  })));
  ipcMain.handle('git:diff', (_e, { workspace = '', path: filePath = '', staged = false } = {}) => gitIpc(async () => ({
    diff: await gitService.diff(workspace, filePath, staged)
  })));
  ipcMain.handle('git:review', (_e, { workspace = '', options = {} } = {}) => gitIpc(async () => ({
    review: await runReviewTask('gitReview', workspace, options)
  })));
  ipcMain.handle('git:review-document', (_e, { workspace = '', path: filePath = '', options = {} } = {}) => gitIpc(async () => ({
    document: await gitService.reviewDocument(workspace, filePath, options)
  })));
  ipcMain.handle('git:pick-clone-destination', async () => {
    const result = await dialog.showOpenDialog(windows.getMainWindow(), {
      title: '选择空文件夹作为克隆目标',
      buttonLabel: '选择文件夹',
      properties: ['openDirectory', 'createDirectory']
    });
    return !result.canceled && result.filePaths.length ? result.filePaths[0] : '';
  });
  ipcMain.handle('git:clone', (_e, { remoteUrl = '', destination = '' } = {}) => gitIpc(() => (
    gitService.cloneRepository(remoteUrl, destination)
  )));
  ipcMain.handle('git:open-remote', (_e, { remoteUrl = '' } = {}) => gitIpc(async () => {
    const url = gitService.remoteWebUrl(remoteUrl);
    if (!url) {
      const error = new Error('该远程地址没有可打开的网页。');
      error.code = 'REMOTE_WEB_URL_UNAVAILABLE';
      throw error;
    }
    await shell.openExternal(url);
    return { url };
  }));

  // Task-scoped git worktrees (parallel builder isolation) and GitHub PR flows.
  // The agent reaches the same operations through yan_workspace MCP tools; the
  // channels exist so the Git panel and scripts can drive them too.
  ipcMain.handle('git:worktree-create', (_e, { workspace = '', taskId = '', base = '', branch = '' } = {}) => gitIpc(async () => ({
    worktree: await worktreeService.createTaskWorktree(workspace, { taskId, base, branch, branchPrefix: preferences().branchPrefix })
  })));
  ipcMain.handle('git:worktree-list', (_e, { workspace = '' } = {}) => gitIpc(async () => ({
    worktrees: await worktreeService.listTaskWorktrees(workspace)
  })));
  ipcMain.handle('git:worktree-status', (_e, { workspace = '', taskId = '' } = {}) => gitIpc(async () => ({
    status: await worktreeService.taskWorktreeStatus(workspace, { taskId })
  })));
  ipcMain.handle('git:worktree-merge', (_e, { workspace = '', taskId = '', message = '', squash = false } = {}) => gitIpc(async () => (
    worktreeService.mergeTaskWorktree(workspace, { taskId, message, squash })
  )));
  ipcMain.handle('git:worktree-remove', (_e, { workspace = '', taskId = '', force = false } = {}) => gitIpc(async () => (
    worktreeService.removeTaskWorktree(workspace, { taskId, force })
  )));
}

module.exports = { registerGitIpc, gitIpc };

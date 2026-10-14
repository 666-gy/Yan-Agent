'use strict';

// IPC: GitHub PR flows (plan T1.2). Handlers moved verbatim from main.js; the
// shared result envelope comes from lib/main/ipc-git.js (pure helper, no state).

const { gitIpc } = require('./ipc-git');

function registerGhIpc(ctx) {
  const { ipcMain, services } = ctx;
  const { ghService } = services;

  ipcMain.handle('gh:review-project', (_e, { workspace = '' } = {}) => gitIpc(() => ghService.reviewProject({ cwd: workspace })));
  ipcMain.handle('gh:pr-merge', (_e, { workspace = '', number, expectedHead = '' } = {}) => gitIpc(() =>
    ghService.prMerge({ cwd: workspace, number, expectedHead, method: require('../git-preferences').normalizeGitPreferences(ctx.config.load().git).mergeMethod })
  ));

  ipcMain.handle('gh:connection-status', () => gitIpc(() => ghService.connectionStatus()));
  ipcMain.handle('gh:detect', () => gitIpc(async () => ({
    ghPath: await ghService.detectGh()
  })));
  ipcMain.handle('gh:pr-list', (_e, { workspace = '', limit = 20, state = 'open', base = '' } = {}) => gitIpc(async () => ({
    prs: await ghService.prList({ cwd: workspace, limit, state, base })
  })));
  ipcMain.handle('gh:pr-diff', (_e, { workspace = '', number = 0 } = {}) => gitIpc(async () => ({
    diff: await ghService.prDiff({ cwd: workspace, number })
  })));
  ipcMain.handle('gh:pr-view', (_e, { workspace = '', number = 0 } = {}) => gitIpc(async () => ({
    pr: await ghService.prView({ cwd: workspace, number })
  })));
  ipcMain.handle('gh:pr-create', (_e, { workspace = '', title = '', body = '', base = '', draft } = {}) => gitIpc(async () => (
    ghService.prCreate({ cwd: workspace, title, body, base, draft: typeof draft === 'boolean' ? draft : require('../git-preferences').normalizeGitPreferences(ctx.config.load().git).draftPr })
  )));
  ipcMain.handle('gh:issue-list', (_e, { workspace = '' } = {}) => gitIpc(async () => ({
    issues: await ghService.issueList({ cwd: workspace })
  })));
  ipcMain.handle('gh:issue-create', (_e, { workspace = '', title = '', body = '' } = {}) => gitIpc(async () => (
    ghService.issueCreate({ cwd: workspace, title, body })
  )));
}

module.exports = { registerGhIpc };

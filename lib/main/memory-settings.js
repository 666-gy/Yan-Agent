'use strict';
function registerMemorySettings({ ipcMain, getMainWindow, configStore, sessionStore, longTermMemory, continualHarness, memoryRuntime, activeRuns, admissions }) {
  ipcMain.handle('memory:clear', async event => {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('无权删除记忆');
    if (activeRuns.size || admissions.size || memoryRuntime.isReviewing() || configStore.memoryDeleting) throw new Error('请等待正在运行的任务和记忆整理完成后再删除。');
    configStore.memoryDeleting = true;
    try {
      const sessions = await sessionStore.listSessionSummaries();
      const cfg = configStore.loadConfig();
      const workspaces = new Set([cfg.workspace, ...(cfg.memoryWorkspaces || []), ...sessions.map(session => session.workspace)].filter(Boolean));
      for (const workspace of workspaces) {
        longTermMemory.clear({ workspace, scope: 'workspace' });
        await continualHarness.clear({ workspace, scope: 'workspace' });
      }
      longTermMemory.clear();
      await continualHarness.clear();
      return { ok: true };
    } finally { configStore.memoryDeleting = false; }
  });
}
module.exports = { registerMemorySettings };

'use strict';

// IPC: Sessions (plan T3.1). Thin channel shells over the session store in
// lib/session-store.js; the store owns every cache and file operation.

function registerSessionIpc(ctx, store, skillsRuntime, lifecycle = {}) {
  const { ipcMain } = ctx;
  const sessionWindows = require('./windows/session-windows');
  require('./project-files').registerProjectFilesIpc(ctx, store, skillsRuntime);

  ipcMain.handle('session:archived', event => sessionWindows.owner(event) ? [] : store.listSessionSummaries({ archived: true }));
  ipcMain.handle('session:archive', (_e, { ids, archived }) => {
    if (sessionWindows.owner(_e)) throw Error('请在主窗口管理会话归档');
    return store.setSessionArchivedRecord(ids, archived);
  });

  ipcMain.handle('session:list', async event => {
    const own = sessionWindows.owner(event);
    return (await store.listSessionSummaries()).filter(session => !own || session.id === own);
  });

  ipcMain.handle('session:directory', async (_e, id) => {
    sessionWindows.assertSession(_e, id);
    const session = await store.readSessionRecord(id, { messageLimit: 1 });
    if (!session) throw new Error('任务不存在');
    const directory = session.workspace || skillsRuntime.getNoWorkspaceAgentDirectory(session.id);
    if (!session.workspace) await require('fs/promises').mkdir(directory, { recursive: true });
    return directory;
  });

  ipcMain.handle('session:get', async (_e, id, options = {}) => {
    sessionWindows.assertSession(_e, id);
    return store.readSessionRecord(id, {
      messageLimit: options?.messageLimit,
      includeUsageStats: true
    });
  });

  ipcMain.handle('session:messages', async (_e, payload = {}) => {
    sessionWindows.assertSession(_e, payload.id || payload.sessionId);
    return store.getSessionMessages(payload);
  });

  ipcMain.handle('session:create', async (_e, options = {}) => {
    if (sessionWindows.owner(_e)) throw Error('子窗口绑定已有会话，请在主窗口创建任务');
    return store.createSession(options);
  });

  ipcMain.handle('session:save', async (_e, session) => {
    sessionWindows.assertSession(_e, session?.id);
    return store.saveSession(session);
  });

  ipcMain.handle('session:fork', async (event, id) => {
    sessionWindows.assertSession(event, id);
    if (sessionWindows.owner(event)) throw Error('请在主窗口创建聊天分支');
    return store.forkSession(id);
  });

  ipcMain.handle('session:export-json', async (event, { id, liveMessage } = {}) => {
    sessionWindows.assertSession(event, id);
    const owner = sessionWindows.windowFor(event, ctx.windows.getMainWindow());
    if (!owner || owner.isDestroyed() || event.sender.id !== owner.webContents.id) {
      return { ok: false, error: '无权导出任务' };
    }
    try {
      const stored = await store.readSessionRecord(id);
      if (!stored) return { ok: false, error: '任务不存在' };
      // Clone the full record so exporting never mutates the session cache.
      const session = JSON.parse(JSON.stringify(stored));
      if (liveMessage?.role === 'assistant' && liveMessage.agentRun?.runId && Array.isArray(liveMessage.agentRun.timeline)) {
        const index = session.messages.findIndex(message => message.agentRun?.runId === liveMessage.agentRun.runId);
        if (index >= 0) session.messages[index] = liveMessage;
        else session.messages.push(liveMessage);
      }
      const name = String(session.title || 'task').replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 80);
      const result = await ctx.dialog.showSaveDialog(owner, {
        title: '导出任务 JSON',
        defaultPath: require('path').join(ctx.app.getPath('downloads'), `Yan-Agent-${name}.json`),
        filters: [{ name: 'JSON', extensions: ['json'] }]
      });
      if (result.canceled || !result.filePath) return { canceled: true };
      const data = { schema: 'yan-agent.session', version: 1, exportedAt: new Date().toISOString(), session };
      await require('fs/promises').writeFile(result.filePath, JSON.stringify(data, null, 2), 'utf8');
      return { ok: true };
    } catch (error) { return { ok: false, error: error.message }; }
  });

  ipcMain.handle('session:set-workspace', async (_e, { id, workspace, activate = true }) => {
    sessionWindows.assertSession(_e, id);
    return store.setSessionWorkspace(id, workspace, activate);
  });

  ipcMain.handle('session:rename', async (_e, { id, title }) => {
    sessionWindows.assertSession(_e, id);
    return store.renameSessionRecord(id, title);
  });

  ipcMain.handle('session:set-pinned', async (_e, { id, pinned }) => {
    sessionWindows.assertSession(_e, id);
    return store.setSessionPinnedRecord(id, pinned);
  });

  ipcMain.handle('session:delete', async (_e, payload) => {
    const id = typeof payload === 'string' ? payload : payload?.id;
    sessionWindows.assertSession(_e, id);
    const confirmed = typeof payload === 'object' && !!payload?.confirmed;
    const result = await store.deleteSessionRecord(id, { confirmed, archivedOnly: payload?.archivedOnly === true, cleanupDays: payload?.cleanupDays });
    if (result?.ok) lifecycle.onDeleted?.(id);
    return result;
  });
}

module.exports = { registerSessionIpc };

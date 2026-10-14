'use strict';

// P1 cleanup: existing IPC contracts, with main-owned state injected.
const workspaceSandbox = require('../workspace-sandbox');
const { runReviewTask } = require('../review-worker');
const fs = require('fs');
const fsp = require('fs/promises');
const { isSafeSessionId } = require('../session-store');
const { sameWorkspace } = require('../session-handoff');

function registerYanagentIpc(ctx, deps) {
  const { ipcMain } = ctx;
  const { configStore, yanagent, sessionStore } = deps;

  ipcMain.handle('yanagent:ensure', async (_e, workspace) => {
    const ws = workspace || configStore.loadConfig().workspace;
    if (!ws) return { ok: false, error: '未设置工作区' };
    const root = yanagent.ensureYanagent(ws);
    return { ok: true, path: root };
  });

  ipcMain.handle('yanagent:run-changes', async (_e, { sessionId, runId, workspace, includeDiff = false, documentPath = '', allRuns = false, paths = null }) => {
    const session = await sessionStore.readSessionRecord(sessionId);
    const ws = workspaceSandbox.normalizeWorkspace(session?.workspace);
    if (!ws || !session || (!allRuns && !yanagent.isSafePathSegment(runId))) return { count: 0, additions: 0, deletions: 0, files: [] };
    if (allRuns) {
      try {
        const changes = await yanagent.loadSessionChangeHistory(ws, sessionId);
        return await runReviewTask('legacyChanges', ws, changes, { includeDiff: !!includeDiff, documentPath, paths });
      } catch {
        return { count: 0, additions: 0, deletions: 0, files: [] };
      }
    }
    const snapPath = yanagent.runSnapshotPath(ws, sessionId, runId);
    if (!fs.existsSync(snapPath)) return { count: 0, additions: 0, deletions: 0, files: [] };
    try {
      const data = JSON.parse(await fsp.readFile(snapPath, 'utf8'));
      return await runReviewTask('legacyChanges', ws, data.changes || [], { includeDiff: !!includeDiff, documentPath, paths });
    } catch {
      return { count: 0, additions: 0, deletions: 0, files: [] };
    }
  });

  ipcMain.handle('yanagent:rollback-run', async (_e, { sessionId, runId, workspace }) => {
    const session = await sessionStore.readSessionRecord(sessionId);
    const ws = workspaceSandbox.normalizeWorkspace(session?.workspace);
    if (!session || !ws || !isSafeSessionId(sessionId) || !yanagent.isSafePathSegment(runId)) {
      return { ok: false, error: '会话、工作区或 runId 无效' };
    }
    if (workspace && !sameWorkspace(ws, workspace)) return { ok: false, error: '工作区与会话不匹配' };
    const snapPath = yanagent.runSnapshotPath(ws, sessionId, runId);
    if (!fs.existsSync(snapPath)) return { ok: false, error: '该轮对话没有可撤销的文件改动' };
    let data;
    try {
      data = JSON.parse(await fsp.readFile(snapPath, 'utf8'));
    } catch (e) {
      return { ok: false, error: e.message };
    }
    if (String(data.sessionId || '') !== String(sessionId) || String(data.runId || '') !== String(runId)) {
      return { ok: false, error: '回滚快照归属不匹配' };
    }
    const changes = data.changes || [];
    const results = await yanagent.applySnapshotRollback(changes, ws);
    try { await fsp.unlink(snapPath); } catch {}
    yanagent.appendYanagentLog(ws, `[rollback] run ${runId} (session ${sessionId}): ${results.length} file(s)`);
    return { ok: true, results, count: changes.length, runId };
  });
}

module.exports = { registerYanagentIpc };

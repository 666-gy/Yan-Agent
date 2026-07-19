const fs = require('fs');
const path = require('path');

function parseOpenWorkspaceArg(argv = process.argv) {
  const idx = argv.indexOf('--open-workspace');
  if (idx === -1) return undefined;
  return argv[idx + 1] ?? '';
}

function parseYanxiRequestIdArg(argv = process.argv) {
  const idx = argv.indexOf('--yanxi-request-id');
  if (idx === -1) return '';
  const value = String(argv[idx + 1] || '').trim();
  return /^[a-zA-Z0-9_-]{1,160}$/.test(value) ? value : '';
}

function createYanxiCodeReceiver(deps) {
  const {
    dataDir,
    getMainWindow,
    isRendererReady = () => true,
    focusMainWindow,
  } = deps;

  /** 冷启动时窗口尚未就绪，延后到渲染进程 loadSession 后再应用 */
  let pendingWorkspaceForRenderer = null;
  const recentRequests = new Map();
  const REQUEST_DEDUPE_TTL_MS = 30_000;

  function clearYanxiSyncFile(requestId = '') {
    const syncPath = path.join(dataDir, 'yanxi-sync.json');
    try {
      let current = null;
      if (fs.existsSync(syncPath)) {
        try { current = JSON.parse(fs.readFileSync(syncPath, 'utf8')); } catch {}
      }
      if (requestId && current?.requestId && current.requestId !== requestId) return;
      fs.writeFileSync(
        syncPath,
        JSON.stringify({
          source: 'yanxi-code',
          requestId: requestId || current?.requestId || '',
          consumed: true,
          at: Date.now(),
        }, null, 2),
        'utf8',
      );
    } catch {
      // ignore
    }
  }

  function consumePendingWorkspaceForRenderer() {
    const payload = pendingWorkspaceForRenderer;
    pendingWorkspaceForRenderer = null;
    return payload;
  }

  function makeRequestKey(requestId, workspace) {
    return requestId || `legacy:${String(workspace || '').toLowerCase()}`;
  }

  function acceptRequest(requestId, workspace) {
    const now = Date.now();
    for (const [key, acceptedAt] of recentRequests) {
      if (now - acceptedAt > REQUEST_DEDUPE_TTL_MS) recentRequests.delete(key);
    }
    const key = makeRequestKey(requestId, workspace);
    if (recentRequests.has(key)) return false;
    recentRequests.set(key, now);
    return true;
  }

  async function applyWorkspaceFromYanxiCode(workspace, options = {}) {
    const ws = workspace ? path.resolve(String(workspace)) : '';
    const requestId = String(options.requestId || '').trim();
    if (ws && !fs.existsSync(ws)) {
      return { error: '工作区路径无效' };
    }

    const accepted = acceptRequest(requestId, ws);
    clearYanxiSyncFile(requestId);
    if (!accepted) {
      focusMainWindow?.();
      return { ok: true, workspace: ws, requestId, deduped: true };
    }

    const payload = { workspace: ws, requestId };

    const win = getMainWindow();
    if (win && !win.isDestroyed() && !win.webContents.isDestroyed() && isRendererReady()) {
      win.webContents.send('yanxi:workspace-sync', payload);
      focusMainWindow?.();
      return { ok: true, ...payload };
    }

    pendingWorkspaceForRenderer = payload;
    return { ok: true, ...payload, deferred: true };
  }

  function readPendingSyncFile() {
    const syncPath = path.join(dataDir, 'yanxi-sync.json');
    if (!fs.existsSync(syncPath)) return null;
    try {
      const payload = JSON.parse(fs.readFileSync(syncPath, 'utf8'));
      if (!payload || payload.source !== 'yanxi-code') return null;
      if (payload.consumed === true) return null;
      if (payload.scope && payload.scope !== 'current-session') return null;
      return {
        workspace: payload.workspace ?? '',
        requestId: String(payload.requestId || ''),
      };
    } catch {
      return null;
    }
  }

  let syncWatcher = null;
  let syncDebounce = null;

  function watchYanxiSyncFile() {
    const syncPath = path.join(dataDir, 'yanxi-sync.json');
    fs.mkdirSync(dataDir, { recursive: true });
    if (!fs.existsSync(syncPath)) {
      fs.writeFileSync(
        syncPath,
        JSON.stringify({ workspace: '', source: 'yanxi-code', consumed: true, at: 0 }, null, 2),
        'utf8',
      );
    }
    if (syncWatcher) {
      syncWatcher.close();
      syncWatcher = null;
    }
    try {
      syncWatcher = fs.watch(syncPath, () => {
        if (syncDebounce) clearTimeout(syncDebounce);
        syncDebounce = setTimeout(() => {
          syncDebounce = null;
          const payload = readPendingSyncFile();
          if (payload === null) return;
          applyWorkspaceFromYanxiCode(payload.workspace, { requestId: payload.requestId }).catch((e) => {
            console.error('[yanxi-sync]', e.message);
          });
        }, 120);
      });
    } catch (e) {
      console.error('[yanxi-sync] watch failed:', e.message);
    }
  }

  return {
    parseOpenWorkspaceArg,
    applyWorkspaceFromYanxiCode,
    readPendingSyncFile,
    watchYanxiSyncFile,
    consumePendingWorkspaceForRenderer,
  };
}

module.exports = {
  parseOpenWorkspaceArg,
  parseYanxiRequestIdArg,
  createYanxiCodeReceiver,
};

'use strict';

// P1 cleanup: existing IPC contracts, with main-owned state injected.


function registerBrowserIpc(ctx, deps) {
  const { ipcMain, session } = ctx;
  const { bridges, BROWSER_PARTITION, getMainWindow, browserAgentBridgePending, sessionAgentBridgePending } = deps;

  ipcMain.handle('browser:recover-network', (_e, url) => (
    bridges.refreshBrowserNetworkSession(url, { resetConnections: true })
  ));

  ipcMain.handle('browser:clear-data', async (_e, type) => {
    const browserSession = session.fromPartition(BROWSER_PARTITION);
    if (type === 'cache') {
      await browserSession.clearCache();
      return { ok: true, type };
    }
    if (type === 'cookies') {
      await browserSession.clearStorageData({ storages: ['cookies'] });
      return { ok: true, type };
    }
    return { ok: false, error: '不支持的浏览器数据类型' };
  });

  ipcMain.on('browser:agent-command-result', (event, payload = {}) => {
    if (!getMainWindow() || getMainWindow().isDestroyed() || event.sender.id !== getMainWindow().webContents.id) return;
    const requestId = String(payload.requestId || '');
    const pending = browserAgentBridgePending.get(requestId);
    if (!pending) return;
    browserAgentBridgePending.delete(requestId);
    clearTimeout(pending.timer);
    const result = payload.result && typeof payload.result === 'object'
      ? payload.result
      : { ok: false, error: '内置浏览器返回了无效结果。', code: 'YAN_BROWSER_INVALID_RESULT' };
    pending.resolve(result);
  });

  ipcMain.on('session:agent-command-result', (event, payload = {}) => {
    if (!getMainWindow() || getMainWindow().isDestroyed() || event.sender.id !== getMainWindow().webContents.id) return;
    const requestId = String(payload.requestId || '');
    const pending = sessionAgentBridgePending.get(requestId);
    if (!pending) return;
    sessionAgentBridgePending.delete(requestId);
    clearTimeout(pending.timer);
    pending.resolve({
      approved: payload.approved === true,
      error: String(payload.error || ''),
      code: String(payload.code || '')
    });
  });
}

module.exports = { registerBrowserIpc };

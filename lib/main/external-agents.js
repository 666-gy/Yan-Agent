'use strict';

function registerExternalAgents({ ipcMain, dialog, getMainWindow, service }) {
  function guard(event) {
    const main = getMainWindow();
    if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('无权访问外部协同任务');
  }
  ipcMain.handle('external-agents:status', event => { guard(event); return service.status(); });
  ipcMain.handle('external-agents:list', event => { guard(event); return service.list(); });
  ipcMain.handle('external-agents:result', (event, params = {}) => { guard(event); return service.result(null, params.id, params.offset, params.limit); });
  ipcMain.handle('external-agents:cancel', (event, id) => { guard(event); return service.cancel(null, id); });
  ipcMain.handle('external-agents:acknowledge-stop', async (event, id) => {
    guard(event);
    const record = service.record(id);
    if (record.status !== 'uncertain') throw new Error('仅失联任务需要手动确认');
    const result = await dialog.showMessageBox(getMainWindow(), { type: 'question',
      title: '确认外部任务已停止', message: '请先检查外部 Agent，确认原任务已经停止。',
      detail: `${record.title}\n${record.workspace}\n确认后会将任务标记为已中断，并允许该工作区的其他任务继续。此操作不会停止仍在外部运行的任务，也不会重新派发原任务。`,
      buttons: ['返回检查', '我已确认停止'], defaultId: 0, cancelId: 0 });
    return result.response === 1 ? service.acknowledgeStopped(id) : service.public(record);
  });
  ipcMain.handle('external-agents:choose-executable', async event => {
    guard(event);
    const result = await dialog.showOpenDialog(getMainWindow(), { title: '选择 Agent 桌面主程序（非 CLI）', properties: ['openFile'],
      ...(process.platform === 'win32' ? { filters: [{ name: '桌面应用', extensions: ['exe'] }] } : {}) });
    return result.canceled ? '' : result.filePaths[0];
  });
}
module.exports = { registerExternalAgents };

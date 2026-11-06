'use strict';

// IPC shell over lib/scheduled-tasks-store.js. The store owns validation and
// persistence; handlers shape payloads and notify the scheduler on changes.

function registerScheduledTasksIpc(ctx, store, { onChange } = {}) {
  const { ipcMain } = ctx;
  const changed = () => { try { onChange?.(); } catch { /* scheduling must not fail the IPC call */ } };
  ipcMain.handle('scheduled-tasks:list', () => store.list());
  ipcMain.handle('scheduled-tasks:get', (_event, id) => store.get(id));
  ipcMain.handle('scheduled-tasks:create', (_event, input = {}) => {
    const task = store.create(input);
    changed();
    return task;
  });
  ipcMain.handle('scheduled-tasks:update', (_event, payload = {}) => {
    const task = store.update(payload.id, payload.patch || {});
    changed();
    return task;
  });
  ipcMain.handle('scheduled-tasks:remove', (_event, id) => {
    const removed = store.remove(id);
    if (removed) changed();
    return removed;
  });
}

module.exports = { registerScheduledTasksIpc };

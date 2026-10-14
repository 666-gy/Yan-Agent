'use strict';

window.YanTaskLinks = (() => {
  let queue = Promise.resolve();
  function enqueue(detail) {
    if (!detail) return queue;
    queue = queue.then(async () => {
      if (detail.error) { toast(detail.error); return; }
      const id = detail.sessionId;
      if (typeof id !== 'string' || !/^sess_[A-Za-z0-9_-]{4,160}$/.test(id)) return;
      await refreshSessions();
      const summary = state.sessions.find(session => session.id === id);
      if (!summary) { toast('任务不存在或已删除，无法打开此链接'); return; }
      if (summary.workspaceMissing) { toast('该任务的工作区已不存在，无法打开'); return; }
      closeSidebarContextMenu();
      await openTaskFromPet(id);
    }).catch(error => { console.error('[task-link]', error); toast('任务链接打开失败'); });
    return queue;
  }
  async function initialize() {
    api.onTaskLink(enqueue);
    await enqueue(await api.taskLinkReady());
  }
  return Object.freeze({ initialize });
})();

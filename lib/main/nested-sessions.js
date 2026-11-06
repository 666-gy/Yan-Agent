'use strict';
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { startRun } = require('../run-orchestrator');
const { createNestedSessions } = require('../nested-sessions/service');
const { normalize } = require('../nested-sessions/preferences');
const sessionWindows = require('./windows/session-windows');

function tileBounds(area, count) {
  const columns = count === 1 ? 1 : 2, rows = count > 2 ? 2 : 1;
  return Array.from({ length: count }, (_, i) => {
    const x = area.x + Math.floor((i % columns) * area.width / columns);
    const y = area.y + Math.floor(Math.floor(i / columns) * area.height / rows);
    return { x, y, width: Math.floor(area.width / columns), height: Math.floor(area.height / rows) };
  });
}
function registerNestedSessions({ app, ipcMain, BrowserWindow, screen, appRoot, dataDir, getMainWindow, runContext, configureBrowserGuest, windowIconPngPath }) {
  const windows = new Map(), repaint = new Map();
  const { sessionStore: sessions, configStore } = runContext;
  sessionWindows.configure(runId => runContext.openCodeActiveRuns.get(runId)?.yanSessionId
    || runContext.openCodeRunAdmissions.get(runId) || runContext.recovery.openCodeRunReconcile.get(runId)?.meta.yanSessionId || '');
  const adapter = () => runContext.getOpenCodeProviderAdapter(runContext.getOpenCodeSidecar());
  const active = id => [...runContext.openCodeActiveRuns.values()].some(r => r.yanSessionId === id)
    || [...runContext.openCodeRunAdmissions.values()].includes(id);
  const sender = event => {
    if (event.senderFrame !== event.sender.mainFrame) throw Error('只允许应用主框架');
    if (event.sender === getMainWindow()?.webContents) return '';
    const found = [...windows].find(([, win]) => !win.isDestroyed() && win.webContents === event.sender);
    if (!found) throw Error('未知 Nested Sessions 窗口');
    return found[0];
  };
  function changed(detail) {
    const id = detail.id;
    // Coalesce streaming UI updates; no polling/model calls while sleeping.
    if (repaint.has(id)) { if (!detail.live) repaint.get(id).detail = detail; return; }
    const pending = { detail };
    pending.timer = setTimeout(() => {
      repaint.delete(id);
      const win = windows.get(id);
      if (!pending.detail.live && win && !win.isDestroyed()) win.webContents.send('nested:changed', pending.detail);
      const main = getMainWindow();
      if (!pending.detail.live && main && !main.isDestroyed()) main.webContents.send('nested:changed', pending.detail);
    }, 120);
    repaint.set(id, pending);
  }
  async function openWindow(id) {
    if (!service.child(id)) throw Error('不是当前应用管理的子会话');
    let win = windows.get(id);
    if (win && !win.isDestroyed()) { win.show(); win.focus(); return { ok: true }; }
    const session = await sessions.readSessionRecord(id);
    win = new BrowserWindow({ title: session.title + ' · Yan Agent', width: 720, height: 680,
      minWidth: 420, minHeight: 300, show: false, backgroundColor: '#1a1a1a', autoHideMenuBar: true,
      frame: false, titleBarStyle: 'hidden', icon: windowIconPngPath?.(),
      webPreferences: { preload: path.join(appRoot, 'preload.js'), contextIsolation: true, nodeIntegration: false,
        sandbox: false, webviewTag: true, backgroundThrottling: false, additionalArguments: [`--yan-nested-session=${id}`] } });
    windows.set(id, win);
    sessionWindows.bind(id, win);
    win.webContents.on('did-attach-webview', (_event, guest) => configureBrowserGuest?.(guest));
    win.on('maximize', () => win.webContents.send('win:maximize-changed', true));
    win.on('unmaximize', () => win.webContents.send('win:maximize-changed', false));
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    win.on('closed', () => { if (windows.get(id) === win) windows.delete(id); });
    await win.loadFile(path.join(appRoot, 'renderer', 'index.html'), { query: { nestedSession: id } });
    const group = service.group(id);
    const siblings = group.children.map(c => windows.get(c.id)).filter(w => w && !w.isDestroyed());
    const area = screen.getDisplayMatching(getMainWindow()?.getBounds() || win.getBounds()).workArea;
    const bounds = tileBounds(area, siblings.length);
    siblings.forEach((window, index) => { window.setBounds(bounds[index]); window.show(); });
    return { ok: true };
  }
  const service = createNestedSessions({ dataDir, sessions, preferences: () => configStore.loadConfig().nestedSessions,
    workspaces: { ...require('../nested-sessions/workspace'),
      async freeze(record, id) {
        if (runContext.backgroundBash?.list(record.childID).some(j => ['queued', 'executing'].includes(j.phase))) throw Error('子会话仍有后台命令，尚不能生成稳定成果');
        return require('../nested-sessions/workspace').freeze(record, id);
      }
    }, busy: active, openWindow, changed,
    hasBackground: id => runContext.backgroundBash?.list(id).some(j => ['queued', 'executing'].includes(j.phase)),
    isArchived: async id => (await sessions.listSessionSummaries({ includeArchived: true })).find(s => s.id === id)?.archived === true,
    capacity: (admitted, kind) => runContext.openCodeActiveRuns.size + runContext.openCodeRunAdmissions.size + admitted
      < runContext.MAX_CONCURRENT_AGENT_RUNS - (kind === 'child' ? 1 : 0),
    cancel: id => {
      const run = runContext.openCodeActiveRuns.get(id);
      const sessionId = run?.yanSessionId || runContext.openCodeRunAdmissions.get(id);
      runContext.backgroundBash?.cancelRun(id);
      if (sessionId) runContext.backgroundBash?.cancelSession(sessionId);
      run?.visionAbortController?.abort();
      runContext.getYanCore().requestCancel(id, 'user_cancelled');
      return adapter().cancel(id);
    },
    steer: (id, text) => runContext.getOpenCodeSidecar().deliverInterjection(id, { kind: 'guidance', guidance: text }),
    execute: (session, job, shouldStart) => new Promise(resolve => {
      let completed;
      startRun(runContext, { ...job.request, runId: job.runId, yanSessionId: session.id, workspace: session.workspace,
        modelSelection: job.request?.modelSelection || session.modelSelection || undefined,
        openCodeSessionId: session.openCodeSessionId || '', prompt: job.prompt, attachments: [],
        ...(job.request?.attachments ? { attachments: job.request.attachments } : {}),
        history: job.request?.history || session.messages.filter(m => m.nestedDeliveryId !== `${job.id}:input`) },
      { nested: true, shouldStart, onCompleted: result => { completed = result; }, onSettled: result => resolve(completed || result || { status: 'error', error: '运行未返回结果' }) })
        .then(result => { if (!result.ok) resolve({ status: ['SESSION_BUSY', 'RUN_LIMIT'].includes(result.code) ? 'busy' : 'error', error: result.error }); else changed({ id: session.id, nested: true }); })
        .catch(error => resolve({ status: 'error', error: error.message }));
    })
  });
  sessions.setNestedPendingResolver(service.isPending);
  service.ready.then(() => service.pump()).catch(error => { service.close(); console.error('[nested]', error); });
  ipcMain.handle('nested:preferences', (event, value) => {
    if (sender(event)) throw Error('请在主窗口修改设置');
    const cfg = configStore.loadConfig();
    if (value !== undefined) { cfg.nestedSessions = normalize(value); configStore.saveConfig(cfg); }
    return normalize(cfg.nestedSessions);
  });
  ipcMain.handle('nested:open', async (event, id) => { const own = sender(event); if (own && own !== id) throw Error('窗口归属不匹配'); await service.ready; return openWindow(id); });
  ipcMain.handle('nested:state', async (event, id) => {
    const own = sender(event), target = own || id;
    const group = await service.inspect(target), session = await sessions.readSessionRecord(target, { messageLimit: 80 });
    return { session, group, child: group.children.find(c => c.id === target), theme: configStore.loadConfig().theme };
  });
  ipcMain.handle('nested:start', async (event, payload = {}) => {
    await service.ready;
    const own = sender(event);
    const target = own || String(payload.sessionId || '');
    if (!target) throw Error('缺少子会话');
    if (own && payload.sessionId && payload.sessionId !== own) throw Error('窗口归属不匹配');
    if (!own && !service.child(target)) throw Error('不是当前应用管理的子会话');
    return service.start(target, { modelSelection: payload.modelSelection, prompt: payload.prompt });
  });
  ipcMain.handle('nested:send', (event, { sessionId, text, requestKey, guide } = {}) => {
    const id = sender(event) || sessionId;
    return guide ? service.guide(id, text, requestKey) : service.send(id, id, text, requestKey || randomUUID());
  });
  ipcMain.handle('nested:stop', (event, sessionId) => {
    const id = sender(event) || sessionId;
    runContext.backgroundBash?.cancelSession(id);
    return service.stop(id);
  });
  ipcMain.handle('nested:answer', async (event, input = {}) => {
    const id = sender(event) || input.sessionId, group = await service.inspect(id);
    const child = group.children.find(c => c.id === id), live = child?.live;
    if (!live || !active(id)) throw Error('没有等待回答的运行');
    if (input.kind === 'permission' && live.permission?.id === input.id) {
      const result = await runContext.getOpenCodeSidecar().replyPermission({ runId: live.runId, requestId: input.id, reply: input.allow === true ? 'once' : 'reject' });
      if (result?.ok) service.observe(id, live.runId, { type: 'permission.replied' });
      return result;
    }
    if (input.kind === 'question' && live.question?.id === input.id) {
      const result = await runContext.getOpenCodeSidecar().replyQuestion({ runId: live.runId, requestId: input.id, answers: input.answers, reject: input.reject === true });
      if (result?.ok) service.observe(id, live.runId, { type: 'question.replied' });
      return result;
    }
    throw Error('请求已过期或不属于此窗口');
  });
  app.on('before-quit', () => { service.close(); for (const pending of repaint.values()) clearTimeout(pending.timer); for (const win of windows.values()) if (!win.isDestroyed()) win.destroy(); });
  return service;
}
module.exports = { registerNestedSessions, tileBounds };

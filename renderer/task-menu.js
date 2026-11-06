'use strict';

window.YanTaskMenu = (() => {
  let forking = false;
  async function forkChat(session) {
    if (forking) return;
    forking = true;
    try {
      if (state.activeRuns.has(session.id)) throw new Error('请等待当前任务完成或停止后再创建聊天分支');
      if (state.currentSession?.id === session.id) await saveCurrentSession();
      const fork = await api.forkSession(session.id);
      if (!fork?.id) throw new Error(fork?.error || '创建聊天分支失败');
      await refreshSessions();
      switchSidebarNav('tasks');
      await loadSession(fork.id, { record: fork });
      toast('已创建聊天分支');
    } finally { forking = false; }
  }
  function renderForkOrigin() {
    document.querySelectorAll('.chat-fork-origin').forEach(element => element.remove());
    const session = state.currentSession;
    const origin = session?.forkOrigin;
    if (!origin) return;
    const boundary = origin.messageCount - (Number(session.messagesStart) || 0);
    if (boundary < 0) return;
    const elements = [...document.querySelectorAll('#messages > [data-msg-index]')];
    if (boundary > 0 && elements.length && Number(elements[0].dataset.msgIndex) > boundary) return;
    const divider = document.createElement('div');
    divider.className = 'chat-fork-origin';
    const button = document.createElement('button');
    button.type = 'button';
    button.title = `返回：${origin.sourceTitle}`;
    button.innerHTML = `${svg('M6 9v6m0-3h9a3 3 0 0 0 3-3M9 6a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm12 0a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z')}<span>从聊天中继续</span>`;
    button.addEventListener('click', async () => {
      try {
        const source = await api.getSession(origin.sourceId, { messageLimit: 40 });
        if (!source) { toast('原任务已删除，无法返回'); return; }
        await loadSession(origin.sourceId, { record: source });
      } catch (error) { toast(error?.message || '无法返回原任务'); }
    });
    divider.append(button);
    const firstNew = elements.find(element => Number(element.dataset.msgIndex) >= boundary);
    if (firstNew) firstNew.before(divider);
    else document.getElementById('messages')?.append(divider);
  }
  const unreadKey = 'yan-task-unread';
  let unread;
  try { unread = new Set(JSON.parse(localStorage.getItem(unreadKey) || '[]')); }
  catch { unread = new Set(); }
  let root = null, child = null, trigger = null, childTrigger = null;
  const svg = path => `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const eye = svg('M2 12s3-7 10-7 10 7 10 7-3 7-10 7S2 12 2 12ZM15 12a3 3 0 1 1-6 0 3 3 0 0 1 6 0');
  const arrow = svg('M7 17 17 7M7 7h10v10');
  const chevron = svg('m9 6 6 6-6 6');
  function persistUnread() { localStorage.setItem(unreadKey, JSON.stringify([...unread])); }
  function markRead(id) {
    if (!id || !unread.delete(id)) return false;
    persistUnread();
    return true;
  }
  function markUnread(id) {
    if (!id || unread.has(id)) return false;
    unread.add(id);
    persistUnread();
    return true;
  }
  // A completed task that is not on screen behaves like an unread task. The
  // caller decides whether the task page is actually focused; this module only
  // owns the durable unread set so the sidebar and rail dot share one source.
  function markCompleted(id, focused) { return focused ? markRead(id) : markUnread(id); }
  function closeChild() {
    child?.remove(); child = null;
    childTrigger?.setAttribute('aria-expanded', 'false'); childTrigger = null;
  }
  function close() {
    closeChild(); root?.remove(); root = null;
    trigger?.setAttribute('aria-expanded', 'false'); trigger = null;
  }
  function position(menu, anchor, submenu = false) {
    const a = anchor.getBoundingClientRect(), m = menu.getBoundingClientRect();
    let x = submenu ? a.right + 3 : a.right - m.width;
    if (submenu && x + m.width > innerWidth - 8) x = a.left - m.width - 3;
    const y = submenu ? a.top - 6 : (a.bottom + m.height + 5 <= innerHeight - 8 ? a.bottom + 5 : a.top - m.height - 5);
    menu.style.left = `${Math.max(8, Math.min(x, innerWidth - m.width - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(y, innerHeight - m.height - 8))}px`;
  }
  function makeMenu(items, label) {
    const menu = document.createElement('div');
    menu.className = 'sidebar-context-menu task-context-menu rect-hover-menu';
    menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', label);
    for (const item of items) {
      if (item.separator) {
        const line = document.createElement('div'); line.className = 'task-context-separator';
        line.setAttribute('role', 'separator'); menu.append(line); continue;
      }
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'sidebar-context-menu-item';
      button.setAttribute('role', 'menuitem'); button.disabled = !!item.disabled;
      button.setAttribute('aria-label', item.label);
      button.innerHTML = `${item.icon || ''}<span>${escapeHtml(item.label)}</span>${item.children ? chevron : ''}`;
      if (item.title) button.title = item.title;
      if (item.children) {
        button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
        const show = () => {
          if (childTrigger === button) return;
          closeChild(); childTrigger = button; button.setAttribute('aria-expanded', 'true');
          child = makeMenu(item.children, item.label); document.body.append(child); position(child, button, true);
        };
        button.addEventListener('pointerenter', show);
        button.addEventListener('click', event => { event.stopPropagation(); show(); });
        button.addEventListener('keydown', event => {
          if (event.key === 'ArrowRight') { event.preventDefault(); show(); child.querySelector('button:not(:disabled)')?.focus(); }
        });
      } else {
        button.addEventListener('pointerenter', () => { if (menu === root) closeChild(); });
        button.addEventListener('click', async event => {
          event.stopPropagation(); const focus = trigger; close(); focus?.focus();
          try { await item.run(); } catch (error) { toast(error?.message || '操作失败'); }
        });
      }
      menu.append(button);
    }
    menu.addEventListener('keydown', event => {
      const buttons = [...menu.querySelectorAll('button:not(:disabled)')];
      const current = buttons.indexOf(document.activeElement);
      if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        event.preventDefault();
        const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
          : (current + (event.key === 'ArrowUp' ? -1 : 1) + buttons.length) % buttons.length;
        buttons[index]?.focus();
      } else if ((event.key === 'ArrowLeft' || event.key === 'Escape') && menu === child) {
        event.preventDefault(); event.stopPropagation(); const parent = childTrigger; closeChild(); parent?.focus();
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        const focus = trigger; close(); if (event.key === 'Escape') { event.preventDefault(); focus?.focus(); }
      }
    });
    return menu;
  }
  function messageText(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map(part => typeof part === 'string' ? part : part?.type === 'text' ? part.text
      : ['image', 'image_url'].includes(part?.type) ? '[图片]' : '').filter(Boolean).join('\n');
  }
  async function copyConversation(id) {
    const session = await api.getSession(id);
    if (!session) throw new Error('任务不存在');
    const roles = { user: '用户', assistant: '助手', system: '系统', tool: '工具' };
    const messages = session.messages || [];
    const markdown = [`# ${String(session.title || '新对话').replace(/[\r\n]+/g, ' ')}`];
    for (const message of messages) {
      const text = messageText(message.content);
      if (text) markdown.push(`## ${roles[message.role] || message.role || '消息'}\n\n${text}`);
    }
    await copyMarkdownCode(markdown.join('\n\n'));
    toast('已复制为 Markdown');
  }
  async function openWith(session, app) {
    const directory = await api.getSessionDirectory(session.id);
    const result = app === 'vscode' ? await api.launchVsCode(directory)
      : app === 'explorer' ? await api.openWorkspaceInExplorer(directory) : await api.openExternalPowerShell(directory);
    if (result?.ok === false) throw new Error(result.error || '打开失败');
  }
  async function exportJson(session) {
    const ctx = state.activeRuns.get(session.id)?.runCtx;
    let liveMessage;
    if (ctx?.activeAgentRun) {
      flushOpenCodeStreamDeltas(ctx);
      const timeline = [...(ctx.activeAgentRun.timeline || [])];
      if (ctx.streamingReasoning) timeline.push({ type: 'thinking', content: ctx.streamingReasoning, streaming: true });
      if (ctx.streamingContent) timeline.push({ type: 'text', content: ctx.streamingContent, streaming: true });
      liveMessage = { role: 'assistant', content: ctx.partialContent || '', ts: ctx.startedAt,
        agentRun: { ...ctx.activeAgentRun, timeline, runId: ctx.runId, modelId: ctx.modelId, modelName: ctx.modelName,
          startedAt: ctx.startedAt, status: ctx.shouldAbort ? 'interrupted' : 'working' } };
    }
    const result = await api.exportSessionJson({ id: session.id, liveMessage });
    if (result?.ok) toast('任务 JSON 已导出');
    else if (!result?.canceled) throw new Error(result?.error || '导出失败');
  }
  function open(anchor, session, { toolbar = false } = {}) {
    closeSidebarContextMenu(); trigger = anchor;
    const img = file => `<img src="assets/${file}" width="18" height="18" alt="">`;
    const vsCodeIcon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="#23a9f2" aria-hidden="true"><path d="m17 2 5 2v16l-5 2L7 14l-4 3-2-1V8l2-1 4 3L17 2Zm0 5-7 5 7 5V7ZM3 9v6l3-3-3-3Z"/></svg>';
    const openWithItem = { label: '打开方式', icon: arrow, children: [
      { label: 'VS Code', icon: vsCodeIcon, run: () => openWith(session, 'vscode') },
      { label: '文件资源管理器', icon: img('file-explorer.png'), run: () => openWith(session, 'explorer') },
      { label: '终端', icon: img('powershell.png'), run: () => openWith(session, 'terminal') }
    ] };
    const copyItem = { label: '复制', icon: ICONS.copy, children: [
      { label: '复制工作目录', icon: ICONS.copy, run: async () => {
        await copyMarkdownCode(await api.getSessionDirectory(session.id)); toast('已复制工作目录');
      } },
      { label: '复制深度链接', icon: ICONS.copy, run: async () => {
        await copyMarkdownCode(await api.getSessionDeepLink(session.id)); toast('已复制深度链接');
      } },
      { label: '复制为 Markdown', icon: ICONS.copy, run: () => copyConversation(session.id) }
    ] };
    const exportItem = { label: '导出 JSON', icon: svg('M12 3v12m-4-4 4 4 4-4M4 16v4h16v-4'), run: () => exportJson(session) };
    const forkItem = {
      label: '创建聊天分支',
      icon: svg('M6 9V15C6 13.34315 7.34315 12 9 12H15C16.65685 12 18 10.65685 18 9M6 3C7.65685 3 9 4.34315 9 6C9 7.65685 7.65685 9 6 9C4.34315 9 3 7.65685 3 6C3 4.34315 4.34315 3 6 3ZM18 3C19.6569 3 21 4.34315 21 6C21 7.65685 19.6569 9 18 9C16.3431 9 15 7.65685 15 6C15 4.34315 16.3431 3 18 3ZM6 15C7.65685 15 9 16.3431 9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.3431 4.34315 15 6 15Z').replace('<svg ', '<svg data-keyline-icon="git-fork" '),
      run: () => forkChat(session)
    };
    const sideChatIcon = svg('M4.57 16.35C2.92 14.88 2 12.97 2 11 2 6.58 6.48 3 12 3s10 3.58 10 8-4.48 8-10 8c-.82 0-1.63-.08-2.42-.24L5 21l-.43-4.65Z');
    const sidebarItems = [
      { label: '重命名', icon: ICONS.edit, run: () => openRenameTaskDialog(session) },
      { label: session.pinned ? '取消置顶' : '置顶', icon: ICONS.pin, run: () => toggleSessionPinnedFromSidebar(session) },
      { label: unread.has(session.id) ? '标记为已读' : '标记为未读', icon: eye, run: () => {
        if (unread.has(session.id)) unread.delete(session.id); else unread.add(session.id);
        persistUnread(); renderSessionList();
      } },
      { separator: true },
      forkItem,
      copyItem,
      exportItem,
      { separator: true },
      openWithItem,
      { separator: true },
      { label: '归档', icon: window.YanArchiveSettings.icon, run: () => window.YanArchiveSettings.archive([session.id]) },
      { label: '永久删除', icon: ICONS.trash, run: () => deleteSessionFromSidebar(session.id) }
    ];
    // 任务栏“更多”菜单：重命名任务 / 置顶任务 ── 创建聊天分支 / 复制 / 新建侧边会话 ── 打开方式 / 导出 JSON ── 归档本任务
    const toolbarItems = [
      { label: '重命名任务', icon: ICONS.edit, run: () => openRenameTaskDialog(session) },
      { label: session.pinned ? '取消置顶任务' : '置顶任务', icon: ICONS.pin, run: () => toggleSessionPinnedFromSidebar(session) },
      { separator: true },
      forkItem,
      copyItem,
      { label: '新建侧边会话', icon: sideChatIcon, run: () => startNewSideChat() },
      { separator: true },
      openWithItem,
      exportItem,
      { separator: true },
      { label: '归档本任务', icon: window.YanArchiveSettings.icon, run: () => window.YanArchiveSettings.archive([session.id]) }
    ];
    const items = toolbar ? toolbarItems : sidebarItems;
    root = makeMenu(items, '任务操作');
    if (toolbar) { root.id = 'taskActionsMenu'; root.classList.add('task-toolbar-menu'); }
    document.body.append(root); position(root, anchor);
    anchor.setAttribute('aria-expanded', 'true'); root.querySelector('button')?.focus({ preventScroll: true });
  }
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && root && !event.defaultPrevented) close(); });
  document.getElementById('sessionList')?.addEventListener('scroll', close, true);
  return Object.freeze({
    renderForkOrigin,
    open,
    close,
    closeToolbar: () => { if (root?.id === 'taskActionsMenu') close(); },
    isUnread: id => unread.has(id),
    hasUnread: () => unread.size > 0,
    markRead,
    markUnread,
    markCompleted
  });
})();

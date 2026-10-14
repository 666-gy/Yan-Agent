window.YanArchiveIcon = "<svg width=\"20\" height=\"20\" viewBox=\"0 0 24 24\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M4 4L20 4C21.1046 4 22 4.8954 22 6L22 7C22 8.1046 21.1046 9 20 9L4 9C2.8954 9 2 8.1046 2 7L2 6C2 4.8954 2.8954 4 4 4ZM4 9L4 17C4 18.6569 5.3431 20 7 20L17 20C18.6569 20 20 18.6569 20 17L20 9M10 13L14 13\"/></svg>";
(() => {
  const page = document.getElementById('tab-archived');
  const list = page.querySelector('#archivedChatList');
  const search = page.querySelector('#archiveSearch');
  const projectButton = page.querySelector('#archiveProject');
  const options = page.querySelector('#archiveProjectOptions');
  let records = [], project = null, sequence = 0, busy = false;
  const collapsedGroups = new Set();
  const ARCHIVE_CHEVRON = {
    collapsed: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6L15 12L9 18"/></svg>',
    expanded: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9L12 15L18 9"/></svg>'
  };
  const projectName = value => value ? value.replace(/[\\/]+$/, '').split(/[\\/]/).pop() : '无项目';
  function updateProjectLabel() {
    projectButton.replaceChildren();
    const icon = document.createElement('span'); icon.innerHTML = ICONS.folderOpen;
    const text = document.createElement('span'); text.textContent = project === null ? '所有项目' : projectName(project);
    const chevron = document.createElement('span'); chevron.innerHTML = "<svg width=\"17\" height=\"17\" viewBox=\"0 0 24 24\" aria-hidden=\"true\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"2\" stroke-linecap=\"round\" stroke-linejoin=\"round\"><path d=\"M6 9L12 15L18 9\"/></svg>";
    projectButton.append(icon, text, chevron);
  }
  function button(label, action, icon) {
    const el = document.createElement('button'); el.type = 'button';
    el.className = icon ? 'archive-circle' : 'conn-pill'; el.title = label; el.setAttribute('aria-label', label);
    if (icon) el.innerHTML = icon; else el.textContent = label;
    el.onclick = async () => {
      if (busy) return;
      busy = true; el.disabled = true;
      try { await action(); } catch (error) { toast(error.message); }
      finally { busy = false; el.disabled = false; }
    };
    return el;
  }
  const countLabel = (count, single, many) => count > 1 ? many.replace('{n}', count) : single;
  async function archive(ids) {
    try {
      const result = await api.setSessionsArchived(ids, true);
      if (!result?.ok) throw new Error(result?.error || '归档失败');
      await refreshSessions();
      if (ids.includes(state.currentSession?.id)) {
        if (state.sessions.length) await loadSession(state.sessions[0].id);
        else await newSession({ forceNew: true });
      }
      await refresh();
      toast(countLabel(ids.length, '任务已归档', '已归档 {n} 个任务'));
    } catch (error) { toast(error.message, { error: true }); }
  }
  async function restore(ids) {
    const result = await api.setSessionsArchived(ids, false);
    if (!result?.ok) throw new Error(result?.error || '取消归档失败');
    await refreshSessions(); await refresh();
    toast(countLabel(ids.length, '已取消归档', '已取消归档 {n} 个任务'));
  }
  async function remove(ids) {
    if (!ids.length || !await requestGenericConfirmation({ title: ids.length > 1 ? `永久删除这 ${ids.length} 个聊天？` : '永久删除此聊天？', description: '聊天记录将永久删除，无法恢复。项目文件不会被删除。', confirmLabel: '永久删除', danger: true })) return;
    // Revalidate archive membership before deleting; never include restored chats.
    const current = new Set((await api.listArchivedSessions()).map(item => item.id));
    const errors = []; let deleted = 0;
    for (const id of ids) {
      if (!current.has(id)) continue;
      const result = await api.deleteSession(id, true, true);
      if (!result?.ok) { errors.push(result?.error || '删除失败'); continue; }
      deleted += 1;
      await clearYanCoreQueuedIntentsForThread(id, 'session_removed');
      state.composerDrafts.delete(String(id)); state.queuedTurns.delete(String(id));
      if (state.currentSession?.id === id) { state.currentSession = null; clearMessages(); }
    }
    await refreshSessions();
    if (!state.currentSession) {
      if (state.sessions.length) await loadSession(state.sessions[0].id); else await newSession();
    }
    await refresh();
    if (deleted) toast(countLabel(deleted, '任务已永久删除', '已永久删除 {n} 个任务'));
    if (errors.length) toast([...new Set(errors)].join('；'), { error: true });
  }
  function render() {
    list.replaceChildren();
    const query = search.value.trim().toLocaleLowerCase();
    const filtered = records.filter(item => (project === null || (item.workspace || '') === project) && `${item.title || ''} ${item.workspace || ''}`.toLocaleLowerCase().includes(query));
    page.querySelector('#archiveDeleteAll').disabled = !records.length;
    if (!filtered.length) { const empty = document.createElement('p'); empty.className = 'archive-empty'; empty.textContent = records.length ? '没有匹配的聊天' : '暂无已归档的聊天'; list.append(empty); return; }
    const groups = new Map();
    for (const item of filtered) { const key = item.workspace || ''; if (!groups.has(key)) groups.set(key, []); groups.get(key).push(item); }
    for (const [workspace, chats] of groups) {
      const collapsed = collapsedGroups.has(workspace);
      const group = document.createElement('section');
      group.className = 'archive-group';
      group.classList.toggle('is-collapsed', collapsed);
      const header = document.createElement('div'); header.className = 'archive-group-header';
      const toggle = button(collapsed ? '展开该文件夹' : '收起该文件夹', () => {
        if (collapsedGroups.has(workspace)) collapsedGroups.delete(workspace);
        else collapsedGroups.add(workspace);
        render();
      }, collapsed ? ARCHIVE_CHEVRON.collapsed : ARCHIVE_CHEVRON.expanded);
      toggle.className = 'archive-group-toggle';
      toggle.setAttribute('aria-expanded', String(!collapsed));
      const folder = document.createElement('span'); folder.className = 'archive-group-folder'; folder.innerHTML = ICONS.folderOpen;
      const title = document.createElement('strong'); title.textContent = projectName(workspace); title.title = workspace;
      const count = document.createElement('span'); count.className = 'archive-count'; count.textContent = `${chats.length} 个聊天`;
      const more = button('项目操作', () => openSidebarContextMenu(more, [
        { label: '永久删除该项目的所有归档聊天', icon: ICONS.trash, danger: true, onSelect: () => remove(records.filter(item => (item.workspace || '') === workspace).map(item => item.id)) }
      ]), '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>');
      header.append(toggle, folder, title, count, more); group.append(header);
      for (const chat of chats) {
        const row = document.createElement('div'); row.className = 'archive-chat'; row.dataset.sessionId = chat.id;
        const info = document.createElement('div'); info.className = 'archive-chat-info';
        const name = document.createElement('strong'); name.textContent = (chat.title || '新聊天') + (chat.deletionPending ? ' · 删除未完成' : '');
        const date = document.createElement('span'); date.textContent = new Date(chat.updatedAt || chat.createdAt).toLocaleString('zh-CN', { year:'numeric', month:'long', day:'numeric', hour:'2-digit', minute:'2-digit' });
        info.append(name, date);
        row.append(info, button(chat.deletionPending ? '重试永久删除' : '永久删除', () => remove([chat.id]), ICONS.trash));
        if (!chat.deletionPending) row.append(button('取消归档', () => restore([chat.id])));
        group.append(row);
      }
      list.append(group);
    }
  }
  async function refresh() {
    const version = ++sequence;
    try {
      const result = await api.listArchivedSessions(); if (version !== sequence) return;
      records = result;
      const workspaces = [...new Set(records.map(item => item.workspace || ''))];
      if (project !== null && !workspaces.includes(project)) project = null;
      updateProjectLabel();
      options.replaceChildren();
      for (const value of [null, ...workspaces]) {
        const option = button(value === null ? '所有项目' : projectName(value), () => {
          project = value; updateProjectLabel();
          options.querySelectorAll('button').forEach(item => item.setAttribute('aria-pressed', String(item === option)));
          options.hidden = true; projectButton.setAttribute('aria-expanded', 'false'); render();
        });
        option.className = 'archive-project-option';
        option.setAttribute('aria-pressed', String(value === project));
        option.title = value === null ? '所有项目' : value || '无项目'; options.append(option);
      }
      render();
    } catch (error) { list.textContent = `读取归档失败：${error.message}`; }
  }
  const deleteIcon = document.createElement('span'); deleteIcon.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/></svg>'; page.querySelector('#archiveDeleteAll').prepend(deleteIcon);
  search.oninput = render;
  projectButton.onclick = () => { options.hidden = !options.hidden; projectButton.setAttribute('aria-expanded', String(!options.hidden)); };
  page.addEventListener('keydown', event => { if (event.key === 'Escape') { options.hidden = true; projectButton.setAttribute('aria-expanded', 'false'); } });
  document.addEventListener('click', event => { if (!event.target.closest('.archive-project')) { options.hidden = true; projectButton.setAttribute('aria-expanded', 'false'); } });
  page.querySelector('#archiveDeleteAll').onclick = async () => {
    if (busy) return; busy = true;
    try { await remove(records.map(item => item.id)); } catch (error) { toast(error.message); } finally { busy = false; }
  };
  window.YanArchiveSettings = { refresh, archive, icon: window.YanArchiveIcon };
})();

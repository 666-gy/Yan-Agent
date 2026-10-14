(() => {
  'use strict';
  const dialog = document.createElement('dialog');
  dialog.id = 'storageCleanupDialog';
  dialog.className = 'storage-cleanup-dialog';
  dialog.setAttribute('aria-labelledby', 'storageCleanupTitle');
  dialog.setAttribute('aria-describedby', 'storageCleanupDescription');
  dialog.innerHTML = `
    <button id="storageCleanupClose" class="storage-cleanup-close" type="button" aria-label="关闭"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="m6 6 12 12M18 6 6 18"/></svg></button>
    <h2 id="storageCleanupTitle">检查旧聊天</h2>
    <p id="storageCleanupDescription">大小包含子智能体。删除聊天及其子智能体后将无法恢复。</p>
    <div class="storage-cleanup-filters">
      <div class="storage-cleanup-filter"><span>最后更新</span><div class="storage-cleanup-select"><button id="storageCleanupDays" class="storage-button" type="button" aria-haspopup="menu" aria-expanded="false"></button><div id="storageCleanupDaysMenu" class="storage-cleanup-menu" role="menu" aria-label="最后更新" hidden></div></div></div>
      <div class="storage-cleanup-filter"><span>包含</span><div class="storage-cleanup-select"><button id="storageCleanupScope" class="storage-button" type="button" aria-haspopup="menu" aria-expanded="false"></button><div id="storageCleanupScopeMenu" class="storage-cleanup-menu" role="menu" aria-label="包含的聊天" hidden></div></div></div>
    </div>
    <div id="storageCleanupList" class="storage-cleanup-list" aria-live="polite"></div>
    <p id="storageCleanupCount" class="storage-cleanup-count" aria-live="polite">已选择聊天：0 · 子智能体：0</p>
    <div class="storage-cleanup-footer"><button id="storageCleanupCancel" class="storage-button" type="button">取消</button><button id="storageCleanupDelete" class="storage-button storage-cleanup-delete" type="button" disabled>删除所选</button></div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector(`#${id}`);
  const list = $('storageCleanupList');
  const selected = new Set();
  const chevron = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>';
  const check = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m5 12 4 4 10-12"/></svg>';
  let days = 30, scope = 'archived', records = [], sequence = 0, busy = false, loading = false, loadError = '';
  const bytes = value => {
    const unit = value ? Math.min(4, Math.floor(Math.log(value) / Math.log(1024))) : 0;
    return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unit ? 1 : 0 }).format(value / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
  };
  function closeMenus() {
    for (const name of ['Days', 'Scope']) { $(`storageCleanup${name}Menu`).hidden = true; $(`storageCleanup${name}`).setAttribute('aria-expanded', 'false'); }
  }
  function updateCount() {
    const chosen = records.filter(item => selected.has(item.id));
    $('storageCleanupCount').textContent = `已选择聊天：${chosen.length} · 子智能体：${chosen.reduce((sum, item) => sum + item.subagents, 0)}`;
    $('storageCleanupDelete').disabled = busy || loading || !chosen.length;
  }
  function filters() {
    for (const [name, choices, value] of [
      ['Days', [30, 90, 180, 365].map(value => [value, `超过 ${value} 天`]), days],
      ['Scope', [['archived', '已归档聊天'], ['all', '所有聊天']], scope]
    ]) {
      const button = $(`storageCleanup${name}`), menu = $(`storageCleanup${name}Menu`);
      button.innerHTML = `<span>${choices.find(item => item[0] === value)[1]}</span>${chevron}`;
      button.disabled = busy;
      menu.replaceChildren();
      for (const [option, label] of choices) {
        const el = document.createElement('button'); el.type = 'button';
        el.setAttribute('role', 'menuitemradio'); el.setAttribute('aria-checked', String(value === option));
        el.innerHTML = `<span>${label}</span>${value === option ? check : ''}`;
        el.addEventListener('click', () => {
          if (busy) return;
          if (name === 'Days') days = option; else scope = option;
          closeMenus(); filters(); button.focus(); void load();
        });
        menu.append(el);
      }
      button.onclick = () => {
        const open = menu.hidden; closeMenus(); menu.hidden = !open; button.setAttribute('aria-expanded', String(open));
        if (open) menu.querySelector('[aria-checked="true"]')?.focus();
      };
    }
  }
  function render() {
    list.replaceChildren();
    if (loadError) { list.textContent = loadError; updateCount(); return; }
    if (!records.length) {
      const empty = document.createElement('p'); empty.className = 'storage-cleanup-empty'; empty.textContent = '没有符合筛选条件的聊天'; list.append(empty);
    } else {
      const allLabel = document.createElement('label'); allLabel.className = 'storage-cleanup-select-all';
      const all = document.createElement('input'); all.type = 'checkbox'; all.id = 'storageCleanupSelectAll';
      all.checked = records.every(item => selected.has(item.id)); all.indeterminate = selected.size > 0 && !all.checked; all.disabled = busy;
      all.addEventListener('change', () => { selected.clear(); if (all.checked) for (const item of records) selected.add(item.id); render(); });
      allLabel.append(all, document.createTextNode('全选')); list.append(allLabel);
      for (const item of records) {
        const row = document.createElement('label'); row.className = 'storage-cleanup-chat'; row.dataset.sessionId = item.id;
        const input = document.createElement('input'); input.type = 'checkbox'; input.checked = selected.has(item.id); input.disabled = busy;
        input.setAttribute('aria-label', `选择 ${item.title}`);
        input.onchange = () => { if (input.checked) selected.add(item.id); else selected.delete(item.id); render(); };
        const info = document.createElement('span'); info.className = 'storage-cleanup-chat-info';
        const title = document.createElement('strong'); title.textContent = item.title;
        const detail = document.createElement('span'); detail.textContent = `${new Date(item.updatedAt).toLocaleDateString('zh-CN')} · 子智能体：${item.subagents}${item.archived ? ' · 已归档' : ''}`;
        info.append(title, detail);
        const size = document.createElement('span'); size.className = 'storage-cleanup-chat-size'; size.textContent = bytes(item.bytes);
        row.append(input, info, size); list.append(row);
      }
    }
    updateCount();
  }
  async function load() {
    const version = ++sequence;
    loading = true; loadError = ''; records = []; selected.clear(); updateCount();
    list.textContent = '正在读取旧聊天…';
    list.setAttribute('aria-busy', 'true');
    try {
      const result = await api.storageReview({ days, scope });
      if (version !== sequence || !dialog.open) return;
      if (!result?.ok) throw new Error(result?.error || '读取旧聊天失败');
      records = result.chats; loading = false; render();
      if (result.skipped) toast(`${result.skipped} 个聊天文件无法识别或过大，未纳入清理列表。`, { error: true });
    } catch (error) {
      if (version !== sequence || !dialog.open) return;
      loadError = `读取失败：${error.message}。请重新选择筛选条件重试。`;
      list.textContent = loadError;
      toast(error.message, { error: true });
    } finally {
      if (version === sequence) { loading = false; list.setAttribute('aria-busy', 'false'); updateCount(); }
    }
  }
  function close() { if (!busy) { closeMenus(); sequence++; dialog.close(); } }
  $('storageCleanupClose').onclick = close; $('storageCleanupCancel').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); if (!$('storageCleanupDaysMenu').hidden || !$('storageCleanupScopeMenu').hidden) closeMenus(); else close(); });
  dialog.addEventListener('click', event => { if (!event.target.closest('.storage-cleanup-select')) closeMenus(); });
  dialog.addEventListener('keydown', event => {
    const menu = event.target.closest('[role="menu"]');
    if (!menu) return;
    const buttons = [...menu.querySelectorAll('button')];
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault(); const index = buttons.indexOf(document.activeElement);
      buttons[event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length].focus();
    }
  });
  $('storageCleanupDelete').onclick = async () => {
    const ids = records.filter(item => selected.has(item.id)).map(item => item.id);
    if (busy || loading || !ids.length) return;
    busy = true; closeMenus(); filters(); render();
    $('storageCleanupClose').disabled = true; $('storageCleanupCancel').disabled = true;
    try {
      // The existing confirmation is a document overlay. Leave the native
      // dialog top layer temporarily so that confirmation remains interactive.
      dialog.close();
      const confirmed = await requestGenericConfirmation({ title: `永久删除这 ${ids.length} 个聊天？`, description: '所选聊天及其子智能体将永久删除，无法恢复。项目文件不会被删除。', confirmLabel: '永久删除', danger: true });
      dialog.showModal();
      if (!confirmed) return;
      $('storageCleanupDelete').textContent = '正在删除…';
      let deleted = 0; const errors = [];
      for (const id of ids) {
        const result = await api.deleteSession(id, true, scope === 'archived', days);
        if (!result?.ok) { errors.push(result?.error || '删除失败'); continue; }
        deleted++;
        await clearYanCoreQueuedIntentsForThread(id, 'session_removed');
        state.composerDrafts.delete(String(id)); state.queuedTurns.delete(String(id));
        if (state.currentSession?.id === id) { state.currentSession = null; clearMessages(); }
      }
      await refreshSessions();
      if (!state.currentSession) {
        if (state.sessions.length) await loadSession(state.sessions[0].id); else await newSession();
      }
      await window.YanStorageSettings?.refresh();
      if (deleted) toast(`已永久删除 ${deleted} 个聊天及其子智能体`);
      if (errors.length) toast([...new Set(errors)].join('；'), { error: true });
      await load();
    } catch (error) { toast(error.message, { error: true }); }
    finally {
      busy = false; $('storageCleanupDelete').textContent = '删除所选';
      $('storageCleanupClose').disabled = false; $('storageCleanupCancel').disabled = false; filters(); render();
    }
  };
  window.YanStorageCleanup = { open() {
    if (dialog.open) return;
    days = 30; scope = 'archived'; filters(); dialog.showModal(); void load();
  } };
})();

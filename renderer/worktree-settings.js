/* Retain the root because the settings overlay is parked when closed. */
(() => {
  const page = document.querySelector('#tab-worktrees');
  const list = page.querySelector('#managedWorktreeList');
  let sequence = 0, saving = Promise.resolve();
  function sync(defaultRoot = '') {
    const prefs = { root: '', fetchBeforeCreate: false, autoCleanup: true, limit: 15, ...state.config?.worktrees };
    page.querySelectorAll('[data-worktree-setting]').forEach(control => {
      const key = control.dataset.worktreeSetting;
      if (control.type === 'checkbox') control.checked = prefs[key];
      else if (!control.dataset.dirty) control.value = prefs[key];
      if (key === 'root' && defaultRoot) { control.placeholder = defaultRoot; control.title = prefs.root || defaultRoot; }
      if (key === 'limit') control.disabled = !prefs.autoCleanup;
    });
  }
  async function refresh() {
    const version = ++sequence;
    const button = page.querySelector('#worktreeRefresh');
    button.disabled = true;
    try {
      const result = await api.managedWorktrees(state.currentSession?.workspace || state.config?.workspace || '');
      if (version !== sequence) return;
      if (!result?.ok) throw new Error(result?.error || '读取工作树失败');
      sync(result.defaultRoot);
      const records = result.worktrees || [];
      page.querySelector('#worktreeListTitle').textContent = records.length ? `工作树 · ${records.filter(item => !item.archived).length}` : '尚无工作树';
      list.replaceChildren();
      if (!records.length) { list.textContent = 'Yan Agent 创建的工作树将显示在此处'; return; }
      for (const record of records) {
        const row = document.createElement('div'); row.className = 'managed-worktree-row';
        const info = document.createElement('div');
        const title = document.createElement('strong'); title.textContent = record.taskId;
        const location = document.createElement('span'); location.textContent = record.path; location.title = record.path;
        const status = document.createElement('small'); status.textContent = record.archived ? '已归档 · 可恢复' : record.reason || (record.dirty ? '有未提交改动 · 不自动清理' : (Date.now() - record.createdAt < 3600000 ? '最近创建 · 暂不自动清理' : record.branch || '独立工作树'));
        info.append(title, location, status);
        const action = document.createElement('button'); action.className = 'conn-pill'; action.type = 'button';
        action.textContent = record.archived ? '恢复' : '归档'; action.disabled = !record.archived && !!record.reason;
        action.addEventListener('click', async () => {
          if (!record.archived && !await requestGenericConfirmation({ title: '归档工作树？', description: '保存 Git 快照后移除工作目录。已提交和未提交的文件内容可从这里恢复。', confirmLabel: '归档' })) return;
          action.disabled = true;
          try {
            const response = await (record.archived ? api.restoreWorktree(record.id) : api.archiveWorktree(record.id));
            if (!response?.ok) throw new Error(response?.error || '工作树操作失败');
            await refresh();
          } catch (error) { toast(error.message); action.disabled = false; }
        });
        row.append(info, action); list.append(row);
      }
    } catch (error) { if (version === sequence) list.textContent = `读取失败：${error.message}`; }
    finally { if (version === sequence) button.disabled = false; }
  }
  page.querySelectorAll('[data-worktree-setting]').forEach(control => {
    control.addEventListener('input', () => { control.dataset.dirty = 'true'; });
    control.addEventListener('change', () => {
      const key = control.dataset.worktreeSetting;
      const value = control.type === 'checkbox' ? control.checked : control.type === 'number' ? Number(control.value) : control.value;
      control.disabled = true;
      saving = saving.then(async () => {
        try {
          state.config = await api.setConfig({ worktrees: { [key]: value } });
          if (key === 'autoCleanup' || key === 'limit') {
            const result = await api.cleanupWorktrees();
            if (!result.ok) throw new Error(result.error);
          }
        } catch (error) { toast(`工作树设置保存失败：${error.message}`); }
        finally { delete control.dataset.dirty; control.disabled = false; sync(); await refresh(); }
      });
    });
  });
  page.querySelector('#worktreeRefresh').addEventListener('click', refresh);
  window.YanWorktreeSettings = { sync, refresh, saved: () => saving };
})();

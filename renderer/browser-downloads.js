(() => {
  const paths = { download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>', file: '<path d="M14 3H6a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9Zm0 0v6h6"/>', folder: '<path d="M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.842 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11"/>', pause: '<circle cx="12" cy="12" r="9"/><path d="M9 8v8m6-8v8"/>', close: '<path d="m6 6 12 12M6 18 18 6"/>', more: '<circle cx="5" cy="12" r=".7"/><circle cx="12" cy="12" r=".7"/><circle cx="19" cy="12" r=".7"/>' };
  const svg = key => `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[key]}</svg>`;
  paths.resume = '<path d="m9 5 11 7-11 7Z"/>';
  paths.open = '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>';
  const button = (label, key, action) => {
    const node = document.createElement('button'); node.type = 'button'; node.className = 'bd-icon'; node.title = label; node.setAttribute('aria-label', label); node.innerHTML = svg(key);
    node.onclick = async () => { try { await action(node); } catch (error) { toast(error.message); } }; return node;
  };
  const panel = document.createElement('div'); panel.className = 'bd-panel'; panel.setAttribute('popover', 'manual'); panel.setAttribute('aria-label', '下载'); document.body.append(panel);
  const menu = document.createElement('div'); menu.className = 'bd-menu'; menu.setAttribute('popover', 'manual'); document.body.append(menu);
  let records = [], anchor, loading = false, signature = '';
  const size = value => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.ceil((value || 0) / 1024)} KB`;
  function position(el, rect) { el.style.left = `${Math.max(8, Math.min(innerWidth - el.offsetWidth - 8, rect.right - el.offsetWidth))}px`; el.style.top = `${Math.max(8, Math.min(innerHeight - el.offsetHeight - 8, rect.bottom + 6))}px`; }
  function render() {
    menu.hidePopover(); panel.replaceChildren();
    const header = document.createElement('header'); const title = document.createElement('strong'); title.textContent = '下载';
    header.append(title, button('打开下载文件夹', 'folder', async () => { const error = await api.browserDownloadOpenFolder(); if (error) throw new Error(error); })); panel.append(header);
    if (!records.length) { const empty = document.createElement('p'); empty.className = 'bd-empty'; empty.textContent = '暂无下载内容'; panel.append(empty); }
    for (const item of records.slice(0, 20)) {
      const row = document.createElement('div'); row.className = 'bd-row';
      const file = document.createElement('span'); file.className = 'bd-file'; file.innerHTML = svg('file');
      const body = document.createElement('div'); body.className = 'bd-body';
      const name = document.createElement('div'); name.className = 'bd-name'; name.textContent = item.name; name.title = item.name;
      const status = document.createElement('div'); status.className = 'bd-status';
      const running = item.status === 'progressing';
      if (running) {
        const seconds = item.speed > 0 ? Math.ceil((item.total - item.received) / item.speed) : 0;
        status.textContent = `${item.stalled ? '等待数据（暂未收到新数据）' : `${size(item.speed)}/s`} · ${size(item.received)} / ${item.total ? size(item.total) : '未知大小'}${seconds > 0 ? ` · ${seconds >= 60 ? Math.ceil(seconds / 60) + ' 分钟' : seconds + ' 秒'}` : ''}`;
      } else status.textContent = `${({completed: '已完成', paused: '已暂停', cancelled: '已停止', interrupted: item.canResume ? '下载中断 · 可继续' : '下载失败 · 可重试'})[item.status] || '已停止'} · ${new Date(item.time).toLocaleTimeString('zh-CN', {hour:'2-digit',minute:'2-digit'})}`;
      status.title = item.error || (item.status === 'interrupted' ? '下载引擎报告中断，未提供具体网络或磁盘错误原因' : '');
      body.append(name, status);
      if (running) { const progress = document.createElement('progress'); progress.max = item.total || 1; progress.value = item.received || 0; if (!item.total) progress.removeAttribute('value'); body.append(progress); }
      const actions = document.createElement('div'); actions.className = 'bd-actions';
      if (running) {
        actions.append(button('暂停下载', 'pause', async () => { await api.browserDownloadControl({id:item.id,action:'pause'}); await refresh(); }), button('停止下载', 'close', async () => { await api.browserDownloadControl({id:item.id,action:'cancel'}); await refresh(); }));
      } else {
        if (item.status === 'paused' || (item.status === 'interrupted' && item.canResume)) actions.append(button('继续下载', 'resume', async () => { await api.browserDownloadControl({id:item.id,action:'resume'}); await refresh(); }));
        if (item.canRetry) actions.append(button('重新下载', 'resume', async () => { await api.browserDownloadControl({id:item.id,action:'retry'}); await refresh(); }));
        if (item.status === 'completed' && item.exists) actions.append(button('打开文件', 'open', () => api.browserDownloadFile({id:item.id,action:'open'})));
        actions.append(button('更多下载操作', 'more', trigger => {
          menu.replaceChildren();
          const add = (text, action) => { const option = document.createElement('button'); option.type = 'button'; option.textContent = text; option.onclick = async () => { menu.hidePopover(); try { await action(); await refresh(); } catch(error) { toast(error.message); } }; menu.append(option); };
          if (item.status === 'completed') {
            if (item.exists) add('在文件资源管理器中显示', () => api.browserDownloadFile({id:item.id,action:'reveal'}));
            add('复制地址', () => navigator.clipboard.writeText(item.url));
            if (item.path) add('复制路径', () => navigator.clipboard.writeText(item.path));
          }
          add('从列表中删除', () => api.browserRemoveDownloads([item.id]));
          menu.showPopover(); position(menu, trigger.getBoundingClientRect()); menu.querySelector('button').focus();
        }));
      }
      row.append(file, body, actions); panel.append(row);
    }
  }
  function mount() {
    document.querySelectorAll('.browser-toolbar-actions [data-browser-settings-wrap]').forEach(wrap => {
      if (wrap.parentElement.querySelector('.bd-trigger')) return;
      const trigger = button('下载', 'download', node => {
        if (panel.matches(':popover-open') && anchor === node) { panel.hidePopover(); return; }
        anchor = node; render(); panel.showPopover(); position(panel, node.getBoundingClientRect());
      });
      trigger.classList.add('bd-trigger', 'tool-panel-nav-btn'); trigger.setAttribute('aria-haspopup','dialog'); trigger.hidden = !records.length; wrap.before(trigger);
      trigger.insertAdjacentHTML('beforeend', '<svg class="bd-ring" viewBox="0 0 32 32" aria-hidden="true"><circle class="bd-ring-track" cx="16" cy="16" r="14"/><circle class="bd-ring-value" cx="16" cy="16" r="14" pathLength="100"/></svg>');
    });
    const running = records.some(item => item.status === 'progressing');
    const active = records.filter(item => ['progressing', 'paused'].includes(item.status));
    const total = active.reduce((sum, item) => sum + (item.total || 0), 0);
    const received = active.reduce((sum, item) => sum + (item.received || 0), 0);
    const percent = total ? Math.min(100, received / total * 100) : 0;
    document.querySelectorAll('.bd-trigger').forEach(trigger => {
      trigger.hidden = !records.length;
      trigger.classList.toggle('is-downloading', running);
      trigger.classList.toggle('has-progress', !!active.length);
      trigger.classList.toggle('is-indeterminate', running && active.some(item => !item.total));
      trigger.style.setProperty('--download-progress', String(percent));
      trigger.title = active.length ? `下载 · ${Math.round(percent)}%${running ? '' : ' · 已暂停'}` : '下载';
      trigger.setAttribute('aria-expanded', String(panel.matches(':popover-open') && trigger === anchor));
    });
  }
  async function refresh() {
    if (loading) return; loading = true;
    try { const next = await api.browserDownloads(); const nextSignature = JSON.stringify(next); records = next; if (!records.length) panel.hidePopover(); mount(); if (signature !== nextSignature) { signature = nextSignature; if (panel.matches(':popover-open') && !menu.matches(':popover-open')) { render(); if (anchor?.isConnected) position(panel, anchor.getBoundingClientRect()); } } }
    finally { loading = false; }
  }
  panel.addEventListener('toggle', () => { if (!panel.matches(':popover-open')) menu.hidePopover(); mount(); });
  document.addEventListener('pointerdown', event => {
    if (!menu.contains(event.target) && !event.target.closest('.bd-actions')) menu.hidePopover();
    if (!panel.contains(event.target) && !menu.contains(event.target) && !event.target.closest('.bd-trigger')) panel.hidePopover();
  });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && panel.matches(':popover-open')) { menu.hidePopover(); panel.hidePopover(); anchor?.focus(); } });
  menu.addEventListener('keydown', event => { if(event.key === 'Escape') {event.stopPropagation();menu.hidePopover();anchor?.focus();} });
  addEventListener('resize', () => { menu.hidePopover(); panel.hidePopover(); });
  // Poll fast only while a download is live or the panel is open; drop to a
  // ~1.8s cadence when idle and pause entirely while the window is hidden. An
  // unconditional 600ms IPC + JSON.stringify + mount() was idle churn even with
  // zero downloads and kept the renderer busy while minimized. A visibility
  // refresh restores the list the moment the window comes back.
  let idleTicks = 0;
  setInterval(() => {
    if (document.hidden) return;
    const live = panel.matches(':popover-open') || records.some(item => item.status === 'progressing');
    if (!live && (idleTicks = (idleTicks + 1) % 3) !== 0) return;
    refresh().catch(() => {});
  }, 600);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh().catch(() => {}); });
  refresh().catch(() => {});
})();

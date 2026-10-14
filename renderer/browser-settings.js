(() => {
  const page = document.querySelector('#tab-browser');
  const $ = selector => page.querySelector(selector);
  const dialog = $('#browserClearDialog');
  const selected = new Set();
  let history = [], range = 'hour', summaryRequest = 0;
  const error = (err, target = $('#browserSettingsError')) => { target.textContent = err?.message || ''; target.hidden = !err; };
  const icon = markup => { const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', '0 0 24 24'); svg.innerHTML = markup; return svg; };
  function showHistory(show) {
    document.querySelector('#browserPasswordsPage').hidden = true;
    $('#browserDownloadsPage').hidden = true;
    $('#browserPreferences').hidden = show;
    $('#browserHistoryPage').hidden = !show;
    settingsOverlay.classList.toggle('browser-history-open', show);
    if (!show) settingsOverlay.classList.remove('browser-history-open');
    settingsOverlay.querySelector('.sheet-content').scrollTop = 0;
  }
  function sync() {
    const prefs = state.config?.browser || {};
    $('#browserEnabled').checked = prefs.enabled !== false;
    $('#browserAgentExposure').value = prefs.agentExposure || 'always';
    $('#browserFullUrl').checked = prefs.showFullUrl === true;
    $('#browserAskDownload').checked = prefs.askDownloadLocation === true;
    $('#browserHistoryPolicy').value = prefs.historyPolicy || 'ask';
    $('#browserSiteTools').checked = prefs.siteToolsEnabled !== false;
    $('#browserDownloadLocation').textContent = prefs.downloadDirectory || '系统下载文件夹';
    api.browserDownloadLocation().then(path => { $('#browserDownloadLocation').title = path; }).catch(err => error(err));
    $('#browserWebTarget').value = prefs.webTarget || 'external';
    $('#browserLocalTarget').value = prefs.localTarget || 'builtin';
    window.YanAppearanceControls?.sync();
    showHistory(false);
  }
  for (const [id, key] of Object.entries({browserAgentExposure: 'agentExposure', browserAskDownload: 'askDownloadLocation', browserHistoryPolicy: 'historyPolicy', browserSiteTools: 'siteToolsEnabled', browserEnabled: 'enabled', browserFullUrl: 'showFullUrl', browserWebTarget: 'webTarget', browserLocalTarget: 'localTarget'})) {
    $(`#${id}`).addEventListener('change', async event => {
      const input = event.target; input.disabled = true; error(null);
      try {
        state.config = await api.setConfig({ browser: { [key]: input.type === 'checkbox' ? input.checked : input.value } });
        browserTabControllers.forEach(controller => syncBrowserAddressInput(controller));
      } catch (err) { error(err); sync(); }
      finally { input.disabled = false; window.YanAppearanceControls?.sync(); }
    });
  }
  async function loadHistory() {
    history = await api.browserHistory();
    const ids = new Set(history.map(item => item.id));
    for (const id of selected) if (!ids.has(id)) selected.delete(id);
    renderHistory();
  }
  function updateSelected() {
    $('#browserHistoryRemoveSelected').hidden = !selected.size;
    $('#browserHistoryRemoveSelected').textContent = `删除所选 (${selected.size})`;
  }
  async function remove(ids) {
    try { await api.browserRemoveHistory(ids); await loadHistory(); error(null); } catch (err) { error(err); }
  }
  function open(item) { closeSettings(); openBrowserUrlInNewTab(item.url); }
  function renderHistory() {
    const list = $('#browserHistoryList'); list.replaceChildren();
    const query = $('#browserHistorySearch').value.trim().toLocaleLowerCase();
    const entries = history.filter(item => `${item.title} ${item.url}`.toLocaleLowerCase().includes(query));
    const groups = new Map();
    for (const item of entries) {
      const day = new Date(item.time).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
      if (!groups.has(day)) groups.set(day, []);
      groups.get(day).push(item);
    }
    for (const [day, items] of groups) {
      const group = document.createElement('details'); group.className = 'browser-history-day'; group.open = true;
      const heading = document.createElement('summary'); heading.textContent = day; heading.insertAdjacentHTML('beforeend', '<span class="browser-history-chevron" aria-hidden="true"><svg class="chevron-down" viewBox="0 0 24 24"><path d="M6 9L12 15L18 9"/></svg><svg class="chevron-up" viewBox="0 0 24 24"><path d="M6 15L12 9L18 15"/></svg></span>'); group.append(heading);
      for (const item of items) {
        const row = document.createElement('div'); row.className = 'browser-history-row';
        const check = document.createElement('input'); check.type = 'checkbox'; check.className = 'browser-check'; check.checked = selected.has(item.id); check.setAttribute('aria-label', `选择 ${item.title || item.url}`);
        check.onchange = () => { check.checked ? selected.add(item.id) : selected.delete(item.id); updateSelected(); };
        const link = document.createElement('button'); link.type = 'button'; link.className = 'browser-history-link'; link.title = item.url; link.onclick = () => open(item);
        const globe = () => icon('<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c-5 5-5 13 0 18 5-5 5-13 0-18"/>');
        if (item.favicon && /^https?:|^data:image\//i.test(item.favicon)) {
          const img = document.createElement('img'); img.src = item.favicon; img.alt = ''; img.referrerPolicy = 'no-referrer'; img.onerror = () => img.replaceWith(globe()); link.append(img);
        } else link.append(globe());
        const title = document.createElement('span'); title.textContent = item.title || item.url;
        const domain = document.createElement('span'); domain.className = 'browser-history-domain';
        try { domain.textContent = new URL(item.url).host; } catch { domain.textContent = ''; }
        link.append(title, domain);
        const time = document.createElement('time'); time.dateTime = new Date(item.time).toISOString(); time.textContent = new Date(item.time).toLocaleTimeString('zh-CN', {hour: '2-digit', minute: '2-digit'});
        const more = document.createElement('button'); more.type = 'button'; more.className = 'browser-circle'; more.setAttribute('aria-label', `更多操作：${item.title || item.url}`); more.setAttribute('aria-haspopup', 'menu'); more.append(icon('<circle cx="5" cy="12" r=".7"/><circle cx="12" cy="12" r=".7"/><circle cx="19" cy="12" r=".7"/>'));
        const menu = document.createElement('div'); menu.className = 'browser-history-menu'; menu.setAttribute('popover', 'auto'); menu.setAttribute('role', 'menu');
        menu.addEventListener('keydown', event => {
          if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); menu.hidePopover(); more.focus(); }
        });
        for (const [label, markup, action] of [
          ['打开页面', '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>', () => open(item)],
          ['从历史记录中移除', '<path d="M10 2H14M4 7H20M6 7H18V19C18 20.6569 16.6569 22 15 22H9C7.34315 22 6 20.6569 6 19V7Z"/>', () => remove([item.id])]
        ]) {
          const button = document.createElement('button'); button.type = 'button'; button.setAttribute('role', 'menuitem'); button.append(icon(markup), document.createTextNode(label)); button.onclick = () => { menu.hidePopover(); action(); }; menu.append(button);
        }
        more.onclick = () => {
          menu.showPopover(); const rect = more.getBoundingClientRect();
          menu.style.left = `${Math.max(8, Math.min(innerWidth - menu.offsetWidth - 8, rect.right - menu.offsetWidth))}px`;
          menu.style.top = `${Math.max(8, Math.min(innerHeight - menu.offsetHeight - 8, rect.bottom + 4))}px`;
          menu.querySelector('button').focus();
        };
        row.append(check, link, time, more, menu); group.append(row);
      }
      list.append(group);
    }
    if (!entries.length) { const empty = document.createElement('div'); empty.className = 'browser-history-empty'; empty.textContent = query ? '没有找到匹配的浏览历史' : '尚无浏览历史记录'; list.append(empty); }
    updateSelected();
  }
  $('#browserManage').onclick = async () => { showHistory(true); $('#browserHistoryClose').focus(); try { await loadHistory(); error(null); } catch (err) { error(err); } };
  $('#browserHistoryClose').onclick = () => { showHistory(false); $('#browserManage').focus(); };
  $('#browserHistorySearch').oninput = renderHistory;
  $('#browserHistoryRemoveSelected').onclick = () => remove([...selected]);
  let downloads = [], downloadLoading = false;
  $('#browserDownloadChange').onclick = async () => {
    const button = $('#browserDownloadChange'); button.disabled = true;
    try {
      const directory = await api.browserChooseDownloadLocation();
      if (directory) { state.config = await api.setConfig({ browser: { downloadDirectory: directory } }); sync(); }
      error(null);
    } catch (err) { error(err); } finally { button.disabled = false; }
  };
  const downloadIcon = () => icon('<path d="M12 3v12m-5-5 5 5 5-5M4 16v4h16v-4"/>');
  const bytes = value => value >= 1048576 ? `${(value / 1048576).toFixed(1)} MB` : `${Math.ceil((value || 0) / 1024)} KB`;
  function renderDownloads() {
    const list = $('#browserDownloadsList'); list.replaceChildren();
    $('#browserDownloadsClear').disabled = !downloads.length;
    const query = $('#browserDownloadsSearch').value.trim().toLocaleLowerCase();
    const entries = downloads.filter(item => `${item.name || ''} ${item.url || ''}`.toLocaleLowerCase().includes(query));
    if (!entries.length) {
      const empty = document.createElement('div'); empty.className = 'browser-download-empty';
      const title = document.createElement('h2'); title.textContent = query ? '没有找到匹配的下载记录' : '暂无下载内容';
      const description = document.createElement('p'); description.textContent = query ? '试试其他文件名或网址' : '从内置浏览器下载的文件将显示在这里';
      empty.append(downloadIcon(), title, description); list.append(empty); return;
    }
    for (const item of entries) {
      const row = document.createElement('div'); row.className = 'browser-download-row';
      const detail = document.createElement('div'); detail.className = 'browser-download-detail';
      const title = document.createElement('strong'); title.textContent = item.name || '下载文件';
      const source = document.createElement('p'); source.textContent = item.url; source.title = item.url;
      const status = document.createElement('p');
      const labels = { completed: item.exists ? '已完成' : '文件已移动或删除', paused: '已暂停', cancelled: '已停止', interrupted: '下载中断', progressing: '下载中' };
      status.textContent = `${labels[item.status] || '下载中断'} · ${bytes(item.received)}${item.status === 'progressing' ? ` / ${bytes(item.total)}` : ''} · ${new Date(item.time).toLocaleString('zh-CN')}`;
      detail.append(title, source, status);
      if (item.status === 'progressing') { const progress = document.createElement('progress'); progress.max = item.total || 1; progress.value = item.received || 0; if (!item.total) progress.removeAttribute('value'); detail.append(progress); }
      const actions = document.createElement('div'); actions.className = 'browser-download-actions';
      for (const [label, action, markup] of [['打开文件', 'open', '<path d="M14 3h7v7m0-7L10 14M10 4H4v16h16v-6"/>'], ['在文件夹中显示', 'reveal', '<path d="M6 15L7.4472 12.1056C7.786 11.428 8.4785 11 9.2361 11L19.9978 11C21.4451 11 22.4132 12.4897 21.8254 13.8123L19.6032 18.8123C19.2822 19.5345 18.5659 20 17.7756 20L4 20C2.8954 20 2 19.1046 2 18L2 6C2 4.8954 2.8954 4 4 4L7.3787 4C7.7765 4 8.158 4.158 8.4393 4.4393L9.5607 5.5607C9.842 5.842 10.2235 6 10.6213 6L17 6C18.1046 6 19 6.8954 19 8L19 11"/>'], ['移除记录', 'remove', '<path d="M10 2H14M4 7H20M6 7H18V19C18 20.6569 16.6569 22 15 22H9C7.34315 22 6 20.6569 6 19V7Z"/>']]) {
        const button = document.createElement('button'); button.type = 'button'; button.className = 'browser-pill'; button.title = label; button.setAttribute('aria-label', label); button.innerHTML = `<svg viewBox="0 0 24 24">${markup}</svg>`;
        button.disabled = action !== 'remove' && (item.status !== 'completed' || !item.exists);
        button.onclick = async () => {
          button.disabled = true;
          try { if (action === 'remove') await api.browserRemoveDownloads([item.id]); else await api.browserDownloadFile({ id: item.id, action }); await loadDownloads(); error(null); }
          catch (err) { error(err); button.disabled = false; }
        };
        actions.append(button);
      }
      row.append(downloadIcon(), detail, actions); list.append(row);
    }
  }
  async function loadDownloads() {
    if (downloadLoading) return;
    downloadLoading = true;
    try {
      const next = await api.browserDownloads();
      if (JSON.stringify(next) !== JSON.stringify(downloads) || !$('#browserDownloadsList').childElementCount) { downloads = next; renderDownloads(); }
    } finally { downloadLoading = false; }
  }
  $('#browserDownloadsManage').onclick = async () => {
    showHistory(false); $('#browserPreferences').hidden = true; $('#browserDownloadsPage').hidden = false;
    settingsOverlay.classList.add('browser-history-open'); $('#browserDownloadsClose').focus();
    try { await loadDownloads(); error(null); } catch (err) { error(err); }
  };
  $('#browserDownloadsClose').onclick = () => { showHistory(false); $('#browserDownloadsManage').focus(); };
  $('#browserDownloadsSearch').oninput = renderDownloads;
  $('#browserDownloadsClear').onclick = async () => {
    try { await api.browserRemoveDownloads(downloads.map(item => item.id)); await loadDownloads(); error(null); } catch (err) { error(err); }
  };
  setInterval(() => {
    if (document.hidden) return;
    if (!settingsOverlay.classList.contains('hidden') && settingsOverlay.dataset.activeTab === 'browser' && !$('#browserDownloadsPage').hidden) loadDownloads().catch(err => error(err));
  }, 1000);
  async function refreshSummary() {
    const request = ++summaryRequest;
    try {
      const data = await api.browserDataSummary(range);
      if (request !== summaryRequest) return;
      $('[data-summary="history"]').textContent = data.history ? `${data.history} 条浏览记录` : '未访问任何网站';
      $('[data-summary="downloads"]').textContent = data.downloads ? `${data.downloads} 条下载记录` : '无下载记录';
      $('[data-summary="sites"]').textContent = `当前存储 Cookie 的网站：${data.sites.length ? data.sites.slice(0, 3).join('、') + (data.sites.length > 3 ? ` 等 ${data.sites.length} 个网站` : '') : '无'}`;
    } catch (err) { if (request === summaryRequest) error(err, $('#browserClearError')); }
  }
  page.querySelectorAll('[data-browser-clear]').forEach(button => button.onclick = () => { error(null, $('#browserClearError')); dialog.showModal(); refreshSummary(); });
  page.querySelectorAll('[data-range]').forEach(button => button.onclick = () => {
    range = button.dataset.range;
    page.querySelectorAll('[data-range]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
    refreshSummary();
  });
  $('#browserClearCancel').onclick = () => dialog.close();
  const checks = [...dialog.querySelectorAll('input:not(:disabled)')];
  checks.forEach(check => check.onchange = () => { $('#browserClearConfirm').disabled = !checks.some(item => item.checked); });
  $('#browserClearConfirm').onclick = async () => {
    const controls = [...dialog.querySelectorAll('button, input:not(:disabled)')];
    const types = checks.filter(input => input.checked).map(input => input.value);
    controls.forEach(input => { input.disabled = true; });
    try { await api.browserClearSelected({ range, types }); await loadHistory(); dialog.close(); }
    catch (err) { error(err, $('#browserClearError')); }
    finally { controls.forEach(input => { input.disabled = false; }); }
  };
  window.YanBrowserSettings = { sync };
})();

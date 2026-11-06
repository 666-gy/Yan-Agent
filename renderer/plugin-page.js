/* Package lifecycle using the existing Skill market templates and MCP controls. */
(() => {
  'use strict';
  const api = window.yan, templates = window.YanCapabilityTemplates;
  const page = document.getElementById('pagePluginPackages');
  const el = id => document.getElementById(id);
  let plugins = [], busy = false, sequence = 0, selectedId = '', expandedSkills = false;
  const PLUGIN_PAGE_ROWS = 8;
  const pluginNarrow = window.matchMedia('(max-width: 900px)');
  let pluginPageIndex = 1;
  const pluginPageSize = () => (pluginNarrow.matches ? 1 : 2) * PLUGIN_PAGE_ROWS;
  let sourceFilter = (() => {
    try { return localStorage.getItem('yan-plugin-source') === 'installed' ? 'installed' : 'market'; }
    catch { return 'market'; }
  })();
  const pending = new Set();
  let updatingId = '';
  let detailMarkup = '', refreshPending = false, lastProgress = '';
  let marketRefreshAttempted = false, marketRefreshing = false, marketRefreshPromise;
  const groups = [{ id: 'productivity', name: '效率工具', description: '电脑操控与日常应用工作流。' }, { id: 'creativity', name: '创意制作', description: '视频、动画与创意工作流。' }, { id: 'developer-tools', name: '开发者工具', description: '代码理解、符号编辑与浏览器自动化。' }, { id: 'installed', name: '已安装', description: '管理之前安装的插件。' }];
  const header = templates.marketHeader('plugin', '插件', '连接插件，让 Yan Agent 在你的各类工具中协同工作', { addLabel: '新插件' });
  page.replaceChildren(header);
  page.insertAdjacentHTML('beforeend', `<div class="skill-source-row">
    <div id="pluginSourceSwitch" class="skill-source-switch" role="tablist" aria-label="插件来源">
      <button type="button" role="tab" data-plugin-source="installed" aria-selected="false" tabindex="-1">已安装</button>
      <button type="button" role="tab" data-plugin-source="market" aria-selected="true">Yan Agent 插件市场</button>
    </div>
  </div>
  <div class="page-body capability-page-body">
    <section id="pluginMarketOverview" class="skill-workbench" aria-label="插件功能分组">
      <div id="pluginMarketGrid" class="skill-market-grid"></div>
    </section>
    <section id="pluginDetailView" class="skill-detail-view hidden" aria-labelledby="pluginDetailTitle"><div id="pluginDetailContent" class="skill-detail-content"></div></section>
  </div>
  <nav id="pluginPagination" class="plugin-pagination hidden" aria-label="插件分页">
    <div class="plugin-pagination-controls">
      <button type="button" class="pager-btn" data-plugin-pager="prev" aria-label="上一页" title="上一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M19 12H5M11 18l-6-6 6-6"/></svg></button>
      <div class="pager-pages" id="pluginPagerPages"></div>
      <span class="pager-current" id="pluginPagerCurrent" aria-live="polite"></span>
      <button type="button" class="pager-go" data-plugin-pager="go" aria-label="前往具体页码">Go</button>
      <button type="button" class="pager-btn" data-plugin-pager="next" aria-label="下一页" title="下一页"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg></button>
    </div>
  </nav>
  <dialog id="pluginPageJumpDialog" class="page-jump-dialog" aria-labelledby="pluginPageJumpTitle">
    <form id="pluginPageJumpForm" class="page-jump-card" novalidate>
      <h2 id="pluginPageJumpTitle">前往具体页码</h2>
      <div class="page-jump-row">
        <input id="pluginPageJumpInput" class="page-jump-input" type="text" inputmode="numeric" autocomplete="off" placeholder="输入具体页码" aria-label="输入具体页码">
        <button class="page-jump-submit" type="submit">前往</button>
      </div>
      <p id="pluginPageJumpError" class="page-jump-error" role="alert" hidden></p>
    </form>
  </dialog>`);
  const pluginPageBody = page.querySelector('.capability-page-body');
  if (pluginPageBody) new ResizeObserver(() => syncCapabilityScrollbar('pagePluginPackages')).observe(pluginPageBody);
  const jumpDialog = el('pluginPageJumpDialog');
  const jumpForm = el('pluginPageJumpForm');
  const jumpInput = el('pluginPageJumpInput');
  const jumpError = el('pluginPageJumpError');
  function openPluginPageJump() {
    if (!jumpDialog) return;
    jumpInput.value = '';
    jumpInput.removeAttribute('aria-invalid');
    jumpError.hidden = true;
    jumpError.textContent = '';
    jumpDialog.showModal();
    requestAnimationFrame(() => jumpInput.focus());
  }
  jumpForm?.addEventListener('submit', event => {
    event.preventDefault();
    const raw = jumpInput.value.trim();
    const target = Number(raw);
    const totalPages = Math.max(1, Math.ceil(visiblePlugins().length / pluginPageSize()));
    if (!/^\d+$/.test(raw) || target < 1 || target > totalPages) {
      jumpError.textContent = `请输入 1–${totalPages} 之间的页码`;
      jumpError.hidden = false;
      jumpInput.setAttribute('aria-invalid', 'true');
      jumpInput.focus();
      return;
    }
    pluginPageIndex = target;
    render();
    jumpDialog.close();
  });
  jumpDialog?.addEventListener('close', () => {
    jumpInput.value = '';
    jumpInput.removeAttribute('aria-invalid');
    jumpError.hidden = true;
    jumpError.textContent = '';
  });
  jumpDialog?.addEventListener('click', event => { if (event.target === jumpDialog) jumpDialog.close(); });
  pluginNarrow.addEventListener('change', () => render());
  const createButton = el('pluginImportBtn');
  createButton.textContent = '';
  createButton.innerHTML = '<span aria-hidden="true" style="font-size:24px;line-height:1">+</span>';
  createButton.title = '新插件';
  createButton.setAttribute('aria-label', '新插件');
  createButton.className = 'capability-circle-btn skill-action-btn';
  createButton.style.filter = 'grayscale(1)';
  const actions = header.querySelector('.capability-header-actions');
  const installButton = document.createElement('button');
  installButton.type = 'button'; installButton.id = 'pluginInstallBtn'; installButton.className = 'capability-circle-btn skill-action-btn';
  installButton.innerHTML = CAPABILITY_ACTION_ICONS.download; installButton.title = '安装官方插件'; installButton.setAttribute('aria-label', '安装插件（灰度）');
  installButton.style.filter = 'grayscale(1)'; installButton.dataset.pluginHeaderAction = 'install';
  const refreshButton = document.createElement('button');
  refreshButton.type = 'button'; refreshButton.id = 'pluginMarketRefreshBtn'; refreshButton.className = 'capability-circle-btn skill-action-btn';
  refreshButton.innerHTML = document.querySelector('#worktreeRefresh svg')?.outerHTML || '';
  refreshButton.title = '刷新官方插件市场'; refreshButton.setAttribute('aria-label', '刷新官方插件市场');
  refreshButton.style.filter = 'grayscale(1)'; refreshButton.dataset.pluginHeaderAction = 'market-refresh';
  const installDialog = el('pluginInstallDialog');
  const installInput = el('pluginInstallInput');
  const installConfirm = el('pluginInstallConfirm');
  const installError = el('pluginInstallError');
  function openPluginInstallDialog() {
    if (!installDialog) return;
    installInput.value = '';
    installError.textContent = '';
    installError.hidden = true;
    installConfirm.disabled = true;
    installDialog.showModal();
    installInput.focus({ preventScroll: true });
  }
  installButton.addEventListener('click', openPluginInstallDialog);
  el('pluginInstallCloseBtn')?.addEventListener('click', () => installDialog?.close());
  installDialog?.addEventListener('click', event => { if (event.target === installDialog) installDialog.close(); });
  installDialog?.addEventListener('cancel', event => { event.preventDefault(); installDialog.close(); });
  installInput?.addEventListener('input', () => {
    installError.hidden = true;
    installConfirm.disabled = !installInput.value.trim();
  });
  installConfirm?.addEventListener('click', async () => {
    const name = installInput.value.trim();
    if (!name || installConfirm.disabled) return;
    installConfirm.disabled = true; installInput.disabled = true;
    installError.hidden = true; installConfirm.textContent = '正在校验并安装…';
    try {
      await refreshOfficialMarket(false);
      const response = await result(api.pluginsCatalog());
      const item = response.plugins.find(item => item.officialMarket && item.id === name);
      if (!item) throw new Error('此弹窗仅支持官方市场插件。外部插件请在对话中讨论或尝试兼容安装。');
      await result(api.pluginsInstallCatalog(item.id));
      installDialog.close(); status('插件已安装，默认关闭；请在插件页启用。'); await show();
    } catch (error) { installError.textContent = error.message; installError.hidden = false; }
    finally { installConfirm.textContent = '安装'; installInput.disabled = false; installConfirm.disabled = !installInput.value.trim(); }
  });
  const helpDialog = document.createElement('dialog');
  helpDialog.id = 'pluginMarketHelpDialog';
  helpDialog.className = 'plugin-market-help-dialog';
  helpDialog.setAttribute('aria-labelledby', 'pluginMarketHelpTitle');
  helpDialog.innerHTML = `<header class="titlebar"><h2 id="pluginMarketHelpTitle">Yan Agent 插件市场命名规则</h2><button class="close" type="button" data-plugin-help-close aria-label="关闭说明弹窗">×</button></header>
    <div class="body"><div class="fluid"><div class="fluid-brand"><div class="plugin-name-examples"><span>√ YanPlugin-Ramol</span><span>× Ramol/Codex-Ramol/dsh-Ramol</span></div></div></div>
      <p>要在Yan Agent官方插件市场上传你的插件，必须以YanPlugin-xxx命名你的插件</p>
    </div>
    <footer class="footer"><button class="install" type="button" data-plugin-help-close>明白了</button></footer>`;
  document.body.append(helpDialog);
  const questionIcon = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-keyline-icon="circle-question"><path d="M12 2C17.5228 2 22 6.47715 22 12C22 17.5228 17.5228 22 12 22C6.47715 22 2 17.5228 2 12C2 6.47715 6.47715 2 12 2Z"/><path d="M9.6 9.4C9.6 8.0745 10.6745 7 12 7C13.3255 7 14.4 8.0745 14.4 9.4C14.4 10.3689 13.8174 11.2427 12.9231 11.6154C12.3641 11.8483 12 12.3944 12 13"/><path d="M13 17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17C11 16.4477 11.4477 16 12 16C12.5523 16 13 16.4477 13 17Z" fill="currentColor" stroke="none"/></svg>';
  const communityButton = document.createElement('button');
  communityButton.type = 'button'; communityButton.className = 'ghost-btn plugin-community-btn'; communityButton.innerHTML = `${questionIcon}<span>让 Yan Agent 插件社区看见你的插件？</span>`;
  communityButton.title = '让 Yan Agent 插件社区看见你的插件？'; communityButton.setAttribute('aria-label', '让 Yan Agent 插件社区看见你的插件？');
  communityButton.style.borderRadius = '999px'; communityButton.style.filter = 'grayscale(1)'; communityButton.dataset.pluginHeaderAction = 'community';
  communityButton.addEventListener('click', () => helpDialog.showModal());
  helpDialog.querySelectorAll('[data-plugin-help-close]').forEach(button => button.addEventListener('click', () => helpDialog.close()));
  helpDialog.addEventListener('click', event => { if (event.target === helpDialog) helpDialog.close(); });
  helpDialog.addEventListener('cancel', event => { event.preventDefault(); helpDialog.close(); });
  actions?.insertBefore(communityButton, actions.firstChild);
  actions?.insertBefore(refreshButton, communityButton.nextSibling);
  actions?.insertBefore(installButton, refreshButton.nextSibling);
  createButton.addEventListener('click', () => {
    void window.YanCapabilityExamples.openDraft('Create a new plugin：', () => {
      const creator = installedSkillPickerItems().find(skill => skill.id === 'plugin-creator')
        || { id: 'plugin-creator', name: 'Plugin Creator', desc: '创建原生 Yan 插件包', tags: ['agent-rules'] };
      setComposerSkills([creator]);
    }).catch(error => status(error.message, 'error'));
  });
  function status(message, state = '') { if (message) toast(message, { error: state === 'error' }); }
  async function result(promise) { const response = await promise; if (!response?.ok) throw new Error(response?.error || '插件操作失败'); return response; }
  function refreshOfficialMarket(notify = true) {
    if (!marketRefreshPromise) marketRefreshPromise = performMarketRefresh(notify).finally(() => { marketRefreshPromise = null; });
    return marketRefreshPromise;
  }
  async function performMarketRefresh(notify) {
    if (marketRefreshing || typeof api.pluginsOfficialMarketRefresh !== 'function') return;
    marketRefreshAttempted = true;
    marketRefreshing = true;
    refreshButton.disabled = true; refreshButton.setAttribute('aria-busy', 'true'); page.setAttribute('aria-busy', 'true');
    try {
      await result(api.pluginsOfficialMarketRefresh());
      if (notify) status('官方插件市场已刷新');
      await show();
    } catch (error) {
      if (notify || marketRefreshAttempted) status(`官方插件市场刷新失败：${error.message}`, 'error');
    } finally {
      marketRefreshing = false; refreshButton.disabled = false; refreshButton.setAttribute('aria-busy', 'false'); updateBusy();
    }
  }
  function updateBusy() { page.setAttribute('aria-busy', String(busy || marketRefreshing || pending.size > 0)); }
  function setBusy(value) {
    busy = value; updateBusy();
    page.querySelectorAll('[data-plugin-action]').forEach(button => {
      const disabled = value || button.hasAttribute('data-fixed-disabled');
      if (button.disabled !== disabled) button.disabled = disabled;
      const active = String(value || pending.has(actionKey(button.dataset.pluginAction, button.dataset.pluginId || selectedId, button.dataset.skillId || button.dataset.linkKind || '')));
      if (button.getAttribute('aria-busy') !== active) button.setAttribute('aria-busy', active);
    });
  }
  function circle(item, action, label, icon) {
    return `<button type="button" class="capability-circle-btn skill-action-btn ${action === 'remove' ? 'is-delete' : action === 'install' ? 'is-install' : 'skill-open-detail-btn'}" data-plugin-action="${action}" data-plugin-id="${escapeAttr(item.id)}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}">${icon}</button>`;
  }
  function renderCard(item) {
    return templates.card({ attributes: `data-plugin-open="${escapeAttr(item.id)}"`, name: item.name, description: item.description,
      logo: skillLogoHtml(item), label: `查看 ${item.name} 的插件详情`, actions: item.installed
        ? circle(item, 'remove', `卸载 ${item.name}`, CAPABILITY_ACTION_ICONS.trash) + circle(item, 'open', `打开 ${item.name}`, MCP_ARROW_UP_RIGHT_ICON)
        : circle(item, 'install', `安装 ${item.name}`, CAPABILITY_ACTION_ICONS.download) });
  }
  function visiblePlugins() {
    return sourceFilter === 'installed' ? plugins.filter(item => item.installed === true)
      : plugins.filter(item => item.catalogSource === 'bundled' || item.catalogSource === 'official-market');
  }
  function pluginPageItems(totalPages) {
    if (totalPages <= 8) return Array.from({ length: totalPages }, (_, index) => index + 1);
    const windowSize = 7;
    let start = Math.max(1, pluginPageIndex - 3);
    let end = Math.min(totalPages, start + windowSize - 1);
    start = Math.max(1, end - windowSize + 1);
    const items = [];
    if (start > 1) { items.push(1); if (start > 2) items.push('…'); }
    for (let value = start; value <= end; value++) items.push(value);
    if (end < totalPages) { if (end < totalPages - 1) items.push('…'); items.push(totalPages); }
    return items;
  }
  function renderPluginPagination(totalPages) {
    const nav = el('pluginPagination');
    if (!nav) return;
    nav.classList.toggle('hidden', totalPages <= 1);
    if (totalPages <= 1) return;
    el('pluginPagerPages').innerHTML = pluginPageItems(totalPages).map(value => value === '…'
      ? '<span class="pager-ellipsis" aria-hidden="true">…</span>'
      : `<button type="button" class="pager-page${value === pluginPageIndex ? ' is-active' : ''}" data-plugin-pager-page="${value}" aria-label="第 ${value} 页"${value === pluginPageIndex ? ' aria-current="page"' : ''}>${value}</button>`).join('');
    el('pluginPagerCurrent').textContent = `第 ${pluginPageIndex} / ${totalPages} 页`;
    nav.querySelector('[data-plugin-pager="prev"]').disabled = pluginPageIndex === 1;
    nav.querySelector('[data-plugin-pager="next"]').disabled = pluginPageIndex === totalPages;
  }
  function syncSourceSwitch() {
    page.querySelectorAll('#pluginSourceSwitch [data-plugin-source]').forEach(button => {
      const active = button.dataset.pluginSource === sourceFilter;
      button.setAttribute('aria-selected', String(active));
      button.tabIndex = active ? 0 : -1;
    });
  }
  function selectSource(next) {
    const value = next === 'installed' ? 'installed' : 'market';
    if (value === sourceFilter) return;
    sourceFilter = value;
    try { localStorage.setItem('yan-plugin-source', value); } catch { /* storage can be unavailable */ }
    selectedId = '';
    pluginPageIndex = 1;
    // Keep the first-entry refresh guard for this app session.
    syncSourceSwitch();
    render();
    if (value === 'market') void show();
  }
  page.querySelector('.skill-source-row')?.addEventListener('click', event => {
    const button = event.target.closest('[data-plugin-source]');
    if (button) selectSource(button.dataset.pluginSource);
  });
  page.querySelector('.skill-source-row')?.addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const buttons = [...page.querySelectorAll('#pluginSourceSwitch [data-plugin-source]')];
    const current = buttons.indexOf(document.activeElement);
    const index = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
      : (current + (event.key === 'ArrowLeft' ? -1 : 1) + buttons.length) % buttons.length;
    buttons[index]?.focus(); buttons[index]?.click();
  });
  function render() {
    const visible = visiblePlugins();
    const size = pluginPageSize();
    const totalPages = Math.max(1, Math.ceil(visible.length / size));
    pluginPageIndex = Math.min(Math.max(1, pluginPageIndex), totalPages);
    const start = (pluginPageIndex - 1) * size;
    const visiblePage = visible.slice(start, start + size);
    el('pluginMarketGrid').innerHTML = visiblePage.length
      ? `<div class="skill-installed-list">${visiblePage.map(renderCard).join('')}</div>`
      : `<div class="workbench-empty"><div class="workbench-empty-copy"><strong>${sourceFilter === 'installed' ? '暂无已安装插件' : '插件市场暂无插件'}</strong></div></div>`;
    renderPluginPagination(totalPages);
    const selected = plugins.find(item => item.id === selectedId);
    if (!selected) selectedId = '';
    page.classList.toggle('is-detail', !!selected);
    el('pluginPagination').classList.toggle('hidden', !!selected || totalPages <= 1);
    header.classList.toggle('hidden', !!selected);
    page.querySelector('.skill-source-row')?.classList.toggle('hidden', !!selected);
    el('pluginMarketOverview').classList.toggle('hidden', !!selected); el('pluginDetailView').classList.toggle('hidden', !selected);
    if (selected) renderDetail(selected);
    syncSourceSwitch();
    syncCapabilityScrollbar('pagePluginPackages');
    bindSkillLogoFallbacks(page); setBusy(busy);
  }
  function detailHtml(item) {
    return window.YanPluginDetails.render(item, {
      expanded: expandedSkills, group: groups.find(group => group.id === item.category)?.name || '插件',
      remove: circle(item, 'remove', `卸载 ${item.name}`, CAPABILITY_ACTION_ICONS.trash)
    });
  }
  function renderDetail(item) {
    const markup = detailHtml(item);
    if (markup === detailMarkup) return;
    el('pluginDetailContent').innerHTML = markup; detailMarkup = markup;
  }
  function actionKey(name, id, detail) { return JSON.stringify([name, id, detail]); }
  function syncSwitches(item) {
    if (selectedId !== item.id) return;
    page.querySelectorAll('#pluginDetailContent input[role="switch"]').forEach(input => {
      if (pending.has(actionKey(input.dataset.pluginAction, item.id, input.dataset.skillId || ''))) return;
      const checked = input.dataset.pluginAction === 'toggle' ? !!item.installation?.enabled : item.installation?.skills.find(skill => skill.id === input.dataset.skillId)?.enabled !== false;
      if (input.checked !== checked) input.checked = checked;
    });
    const current = item.installation;
    el('pluginDetailState').textContent = current ? (current.ready ? (current.enabled ? '已启用' : '已关闭') : '需要处理') : '未安装';
    detailMarkup = detailHtml(item);
  }
  async function localAction(name, item, detail, control) {
    const key = actionKey(name, item.id, detail);
    if (pending.has(key)) return;
    pending.add(key); ++sequence; updateBusy();
    control.setAttribute('aria-busy', 'true'); control.setAttribute('aria-disabled', 'true'); status('');
    try {
      if (name === 'directory') await result(api.pluginsOpenDirectory(item.id));
      else if (name === 'link') await result(api.pluginsOpenLink(item.id, detail));
      else {
        const changes = name === 'toggle' ? { enabled: control.checked } : { skill: { id: detail, enabled: control.checked } };
        const response = await result(api.pluginsUpdate({ id: item.id, ...changes }));
        // Independent switches may finish in a different order; apply only this edit.
        if (name === 'toggle') item.installation.enabled = response.plugin.enabled;
        else {
          item.installation.skills.find(skill => skill.id === detail).enabled = response.plugin.skills.find(skill => skill.id === detail).enabled;
          item.installation.disabledSkills = item.installation.skills.filter(skill => skill.enabled === false).map(skill => skill.id);
        }
      }
    } catch (error) { status(error.message, 'error'); }
    finally {
      pending.delete(key);
      control.setAttribute('aria-busy', 'false'); control.removeAttribute('aria-disabled');
      if (name === 'toggle' || name === 'skill') syncSwitches(item);
      updateBusy();
      if (!pending.size && refreshPending) { refreshPending = false; void show(); }
    }
  }
  async function show() {
    const ticket = ++sequence;
    try {
      const response = await result(api.pluginsCatalog());
      if (ticket !== sequence) return;
      plugins = response.plugins; render();
      if (sourceFilter === 'market' && !marketRefreshAttempted) {
        marketRefreshAttempted = true;
        void refreshOfficialMarket(false);
      }
    }
    catch (error) { if (ticket === sequence) status(error.message, 'error'); }
  }
  async function action(name, id, detail = '', control) {
    if (busy) return;
    const item = plugins.find(item => item.id === id);
    if (name === 'back') { selectedId = ''; status(''); render(); return; }
    if (!item) return;
    if (name === 'open') { selectedId = id; expandedSkills = false; status(''); render(); page.scrollTop = 0; page.querySelector('.page-body').scrollTop = 0; return; }
    if (name === 'expand') { expandedSkills = !expandedSkills; render(); page.querySelector('[data-plugin-action="expand"]')?.focus({ preventScroll: true }); return; }
    if (name === 'install') {
      setBusy(true); status('正在校验并安装 Yan 插件…');
      try { await result(api.pluginsInstallCatalog(id)); status('插件已安装，默认关闭；启用前请检查其依赖。'); await show(); }
      catch (error) { status(error.message, 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (['toggle', 'skill', 'directory', 'link'].includes(name)) { await localAction(name, item, detail, control); return; }
    if (pending.size) return;
    if (name === 'check-update') {
      setBusy(true); updatingId = id;
      control.textContent = '正在检查…';
      try {
        const response = await result(api.pluginsCheckUpdate(id));
        status(response.updated ? `${item.name} 已更新至 ${response.plugin.version}` : `${item.name} 已为最新版本`);
        await show();
      } catch (error) { status(`更新失败：${error.message}`, 'error'); }
      finally { updatingId = ''; control.textContent = '检查更新'; setBusy(false); }
      return;
    }

    if (name === 'example') {
      setBusy(true);
      try { await window.YanPluginExamples.openDraft(item, Number(control.dataset.exampleIndex)); }
      catch (error) { status(error.message, 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (name === 'remove' && !await requestGenericConfirmation({ title: `卸载 ${item.name}？`, description: item.runtime ? '插件将停止向 Agent 提供能力，已下载的 Chromium 浏览器（约 440 MB）也会一并删除。' : '插件将停止向 Agent 提供能力。', confirmLabel: '卸载', danger: true })) return;
    const focused = document.activeElement?.dataset;
    const focusAction = focused?.pluginAction, focusSkill = focused?.skillId, focusLink = focused?.linkKind;
    setBusy(true); lastProgress = '';
    status(name === 'install' && item.runtime ? '正在从 Playwright 官方源下载 Chromium（约 440 MB），完成后逐个校验文件…' : name === 'install' && item.download ? '正在下载插件并校验文件，请稍候…' : '');
    try {
      if (name === 'connect') { const response = await result(api.pluginsConnectAccount(id)); status(response.account.message || (response.account.state === 'connected' ? '账号已连接。' : '已在系统浏览器打开官方授权页，请完成登录或注册。')); }
      else if (name === 'disconnect') { await result(api.pluginsDisconnectAccount(id)); status('账号已断开，插件已禁用。'); }
      else if (name === 'remove') { await result(api.pluginsRemove(id)); status('插件已卸载。'); }
      else if (name === 'prepare') { const response = await result(api.pluginsPrepare(id)); status(response.plugin.ready ? '插件文件准备检查通过。' : response.plugin.issues.join('；'), response.plugin.ready ? '' : 'error'); }
      await show();
    } catch (error) { render(); status(error.message, 'error'); }
    finally {
      setBusy(false);
      const target = [...page.querySelectorAll('[data-plugin-action]')].find(node => node.getClientRects().length && node.dataset.pluginAction === focusAction && node.dataset.skillId === focusSkill && node.dataset.linkKind === focusLink);
      target?.focus({ preventScroll: true });
    }
  }
  page.addEventListener('click', event => {
    const button = event.target.closest('[data-plugin-action]');
    if (button) {
      const name = button.dataset.pluginAction, id = button.dataset.pluginId || selectedId, detail = button.dataset.skillId || button.dataset.linkKind || '';
      if (busy || pending.has(actionKey(name, id, detail))) { event.preventDefault(); return; }
      void action(name, id, detail, button); return;
    }
    const card = event.target.closest('[data-plugin-open]');
    if (card && !busy) void action('open', card.dataset.pluginOpen);
  });
  page.addEventListener('click', event => {
    const pageButton = event.target.closest('[data-plugin-pager-page]');
    if (pageButton) { pluginPageIndex = Number(pageButton.dataset.pluginPagerPage); render(); return; }
    const pagerAction = event.target.closest('[data-plugin-pager]')?.dataset.pluginPager;
    if (!pagerAction) return;
    if (pagerAction === 'go') { openPluginPageJump(); return; }
    if (pagerAction === 'prev') pluginPageIndex -= 1;
    if (pagerAction === 'next') pluginPageIndex += 1;
    render();
  });
  page.addEventListener('keydown', event => {
    const card = event.target.closest('[data-plugin-open]');
    if (card && event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); void action('open', card.dataset.pluginOpen); }
  });
  api.onPluginsChanged(() => {
    if (page.classList.contains('hidden') || busy) return;
    if (pending.size) refreshPending = true;
    else void show();
  });
  refreshButton.addEventListener('click', () => void refreshOfficialMarket(true));
  // Runtime downloads report { id, phase, percent }; each distinct step refreshes
  // the toast so a 440 MB download never looks stalled.
  const phaseLabels = { download: '正在下载 Chromium', copy: '正在复制 Chromium', verify: '正在校验 Chromium 文件' };
  api.onPluginsProgress?.(event => {
    if (updatingId && event?.id === updatingId && event.phase === 'update') {
      const button = page.querySelector('[data-plugin-action="check-update"]');
      if (button) button.textContent = `正在更新 ${Math.max(0, Math.min(100, Math.round(Number(event.percent) || 0)))}%`;
      return;
    }
    if (!busy || !event || !phaseLabels[event.phase]) return;
    const name = plugins.find(item => item.id === event.id)?.name || event.id;
    const message = `${name}：${phaseLabels[event.phase]} ${Math.max(0, Math.min(100, Number(event.percent) || 0))}%`;
    if (message === lastProgress) return;
    lastProgress = message; status(message);
  });
  window.YanPluginsPage = { show };
})();

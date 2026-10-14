/* Share the plugin market, detail header and interactive example components. */
(() => {
  const page = document.getElementById('pageAgents');
  const catalog = window.YanAgentCatalog, templates = window.YanCapabilityTemplates;
  const header = templates.marketHeader('agent', '智能体', '委派任务，读取其他智能体的本机历史会话');
  // Keyline badge-question, original stroke artwork.
  const questionIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-keyline-icon="badge-question"><path d="M20.3692 8.5334C21.4021 9.3883 22 10.6592 22 12C22 13.3408 21.4021 14.6117 20.3692 15.4666C20.3825 15.6071 20.3891 15.748 20.3891 15.8891C20.3891 18.3744 18.3744 20.3891 15.8891 20.3891C15.748 20.3891 15.6071 20.3825 15.4666 20.3692C14.6117 21.4021 13.3408 22 12 22C10.6592 22 9.3883 21.4021 8.5334 20.3692C8.3929 20.3825 8.252 20.3891 8.1109 20.3891C5.6256 20.3891 3.6109 18.3744 3.6109 15.8891C3.6109 15.748 3.6175 15.6071 3.6308 15.4666C2.5979 14.6117 2 13.3408 2 12C2 10.6592 2.5979 9.3883 3.6308 8.5334C3.6175 8.3929 3.6109 8.252 3.6109 8.1109C3.6109 5.6256 5.6256 3.6109 8.1109 3.6109C8.252 3.6109 8.3929 3.6175 8.5334 3.6308C9.3883 2.5979 10.6592 2 12 2C13.3408 2 14.6117 2.5979 15.4666 3.6308C15.6071 3.6175 15.748 3.6109 15.8891 3.6109C18.3744 3.6109 20.3891 5.6256 20.3891 8.1109C20.3891 8.252 20.3825 8.3929 20.3692 8.5334Z"/><path d="M9.6 9.4C9.6 8.0745 10.6745 7 12 7C13.3255 7 14.4 8.0745 14.4 9.4C14.4 10.3689 13.8174 11.2427 12.9231 11.6154C12.3641 11.8483 12 12.3944 12 13"/><path d="M13 17C13 17.5523 12.5523 18 12 18C11.4477 18 11 17.5523 11 17C11 16.4477 11.4477 16 12 16C12.5523 16 13 16.4477 13 17Z" fill="currentColor" stroke="none"/></svg>';
  let selected = null, busy = false;
  const versions = new Map();
  let versionRequest = null;
  page.append(header);
  page.insertAdjacentHTML('beforeend', '<div class="page-body capability-page-body"><section id="agentMarketOverview" class="skill-workbench"><div class="skill-group-grid" id="agentMarketGrid"></div></section><section id="agentDetailView" class="skill-detail-view hidden" aria-labelledby="agentDetailTitle"><div id="agentDetailContent" class="skill-detail-content"></div></section></div>');
  const el = id => document.getElementById(id);
  function render() {
    header.classList.toggle('hidden', !!selected);
    el('agentMarketOverview').classList.toggle('hidden', !!selected);
    el('agentDetailView').classList.toggle('hidden', !selected);
    page.classList.toggle('is-detail', !!selected);
    if (selected) {
      el('agentDetailContent').innerHTML = templates.compactDetailHead({
        titleId: 'agentDetailTitle', name: selected.name, description: selected.description, logo: skillLogoHtml(selected),
        actions: `<input type="checkbox" role="switch" class="switch" data-agent-action="toggle" aria-label="启用 ${selected.name}" ${catalog.enabled(selected) ? 'checked' : ''}>`,
        actionLabel: '智能体操作', closeAttribute: 'data-agent-action', closeLabel: '关闭智能体详情'
      }) + window.YanCapabilityExamples.render(selected, selected.examples, 'data-agent-action')
        + `<p class="plugin-detail-description">${escapeHtml(selected.longDescription)}</p>
          <section class="plugin-info-section" aria-labelledby="agentInfoTitle"><h2 id="agentInfoTitle">信息</h2><dl>
            <div class="plugin-info-row"><dt>开发者</dt><dd>${escapeHtml(selected.developer)}</dd></div>
            <div class="plugin-info-row"><dt>版本</dt><dd class="agent-version-value"><span data-agent-version title="本机安装的桌面应用版本">${escapeHtml(versions.get(selected.provider) || '正在检测…')}</span><button type="button" class="ghost-btn agent-source-picker" data-agent-action="source" aria-label="不是这个？选择 ${selected.name} 桌面源程序" title="${escapeAttr(state.config?.externalAgents?.providers?.[selected.provider]?.executable || '选择桌面源程序')}">${questionIcon}<span>不是这个？</span></button></dd></div>
            <div class="plugin-info-row"><dt>网站</dt><dd><button type="button" class="plugin-info-link icon-btn" data-agent-action="website" aria-label="打开 ${selected.name} 官方网站" title="${escapeAttr(selected.website)}">${MCP_ARROW_UP_RIGHT_ICON}</button></dd></div>
          </dl></section>`;
    } else {
      el('agentMarketGrid').innerHTML = catalog.items.map(item => templates.card({
        attributes: `data-agent-open="${item.id}"`, name: item.name, description: item.description, logo: skillLogoHtml(item),
        label: `查看 ${item.name} 的智能体详情`,
        actions: `<button type="button" class="capability-circle-btn skill-open-detail-btn" data-agent-open="${item.id}" aria-label="打开 ${item.name}">${MCP_ARROW_UP_RIGHT_ICON}</button>`
      })).join('');
    }
    bindSkillLogoFallbacks(page);
  }
  function setBusy(value) {
    busy = value; page.setAttribute('aria-busy', String(value));
    page.querySelectorAll('[data-agent-action]').forEach(node => { node.disabled = value; });
  }
  async function show() {
    try { await catalog.refresh(); if (!busy) render(); void detectVersions(); }
    catch (error) { toast(`读取智能体失败：${error.message}`, { error: true }); }
  }
  function detectVersions() {
    if (versionRequest) return versionRequest;
    versionRequest = (async () => {
      try {
        const status = await api.externalAgentsStatus();
        for (const item of catalog.items) {
          const provider = status.providers?.find(provider => provider.provider === item.provider);
          versions.set(item.provider, !provider ? '无法读取版本' : provider.installed
            ? provider.version || '版本未知' : '未检测到桌面应用');
        }
        return status;
      } catch { for (const item of catalog.items) versions.set(item.provider, '无法读取版本'); }
      finally {
        const label = page.querySelector('[data-agent-version]');
        if (label && selected) label.textContent = versions.get(selected.provider);
        versionRequest = null;
      }
    })();
    return versionRequest;
  }
  page.addEventListener('click', async event => {
    if (busy) return;
    const control = event.target.closest('[data-agent-action]');
    if (control) {
      const action = control.dataset.agentAction;
      if (action === 'back') { const id = selected?.id; selected = null; render(); page.querySelector(`[data-agent-open="${id}"]`)?.focus(); return; }
      if (!selected) return;
      const item = selected;
      setBusy(true);
      try {
        if (action === 'source') {
          const executable = await api.externalAgentsChooseExecutable();
          if (!executable) return;
          await catalog.setExecutable(item, executable);
          // Finish any previous probe before starting one for the saved path.
          await versionRequest;
          versions.set(item.provider, '正在检测…'); render(); setBusy(true);
          const status = await detectVersions();
          const provider = status?.providers?.find(provider => provider.provider === item.provider);
          if (provider && !provider.installed) toast(provider.error || '未检测到桌面应用，请重新选择源程序。', { error: true });
        }
        if (action === 'toggle') { await catalog.setEnabled(selected, control.checked); render(); }
        if (action === 'website') {
          const url = selected.website, result = await api.browserOpenLink(url);
          if (result.target === 'builtin') { switchSidebarNav('tasks'); openBrowserUrlInNewTab(url); }
        }
        if (action === 'example') await window.YanCapabilityExamples.openDraft(selected.examples[Number(control.dataset.exampleIndex)], () => window.YanComposerPlugins.set([selected]));
      } catch (error) { toast(error.message, { error: true }); if (action === 'toggle') render(); }
      finally { setBusy(false); }
      return;
    }
    const card = event.target.closest('[data-agent-open]');
    if (card) { selected = catalog.find(card.dataset.agentOpen); render(); page.querySelector('.page-body').scrollTop = 0; page.querySelector('[data-agent-action="back"]')?.focus({ preventScroll: true }); }
  });
  page.addEventListener('keydown', event => {
    const card = event.target.closest('article[data-agent-open]');
    if (event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); card.click(); }
  });
  window.YanAgentsPage = { show };
})();

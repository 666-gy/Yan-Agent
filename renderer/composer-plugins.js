/* Plugin mentions share the composer token, picker, caret and draft primitives. */
window.YanComposerPlugins = (() => {
  const selector = '[data-composer-plugin-id]';
  const menu = document.getElementById('attachmentMenu');
  const view = document.getElementById('composerPluginView');
  const list = document.getElementById('composerPluginMenuList');
  let catalog = [], loading = false, failure = '', generation = 0, signature = '';
  const isOpen = () => !menu.classList.contains('hidden') && menu.dataset.view === 'main';
  const workspaceKey = value => String(value || '').replaceAll('\\', '/').replace(/\/$/, '').toLowerCase();
  function normalize(items) {
    return [...new Map((Array.isArray(items) ? items : []).map(item => ({
      id: String(item?.id || '').trim(), name: String(item?.nickname || item?.name || item?.id || ''),
      logo: skillLogoPath(item || {}), logoDark: item?.logoDark ? skillLogoPath({ logo: item.logoDark }) : '',
      desc: String(item?.description || item?.desc || '')
    })).filter(item => item.id).map(item => [item.id, item])).values()];
  }
  function installed() {
    return [...catalog.filter(item => item.installation
      && (item.installation.scope !== 'workspace' || workspaceKey(item.installation.workspace) === workspaceKey(state.currentSession?.workspace))), ...window.YanAgentCatalog.items];
  }
  function unavailableReason(item) {
    const agent = window.YanAgentCatalog.find(item?.id);
    if (agent) return window.YanAgentCatalog.reason(agent);
    const current = item?.installation;
    if (!current) return '尚未安装，请先在扩展中安装';
    if (current.scope === 'workspace' && workspaceKey(current.workspace) !== workspaceKey(state.currentSession?.workspace)) return '不属于当前工作区';
    if (!current.enabled) return '已关闭，请先在扩展中启用';
    if (!current.ready) return current.issues?.join('；') || '尚未就绪，请在扩展中检查';
    return '';
  }
  async function load() {
    const ticket = ++generation; loading = true; failure = ''; render();
    try {
      const [response] = await Promise.all([window.yan.pluginsCatalog(), window.YanAgentCatalog.refresh()]);
      if (!response?.ok) throw new Error(response?.error || '读取插件失败');
      if (ticket === generation) catalog = response.plugins;
    } catch (error) { if (ticket === generation) { catalog = []; failure = error.message; } }
    finally { if (ticket === generation) { loading = false; signature = ''; render(); } }
  }
  function token(item) {
    const node = document.createElement('span');
    node.className = 'composer-skill-token composer-plugin-token'; node.contentEditable = 'false'; node.spellcheck = false;
    node.dataset.composerPluginId = item.id; node.dataset.composerPluginName = item.name;
    node.setAttribute('role', 'group'); node.setAttribute('aria-label', `${window.YanAgentCatalog.find(item.id) ? '智能体' : '插件'}：${item.name}，按退格键取消`);
    node.title = `${item.name} · 按 Backspace 取消`;
    node.innerHTML = `<span class="composer-plugin-logo" aria-hidden="true">${skillLogoHtml(item)}</span><span class="composer-skill-name">${escapeHtml(item.name)}</span>`;
    return node;
  }
  function set(items) {
    state.selectedPlugins = normalize(items);
    input.querySelectorAll(selector).forEach(node => node.remove());
    const fragment = document.createDocumentFragment(); state.selectedPlugins.forEach(item => fragment.append(token(item)));
    input.prepend(fragment); input.normalize(); bindSkillLogoFallbacks(input); render(); updateSendState();
  }
  function sync() {
    input.querySelectorAll(selector).forEach(node => {
      const name = node.dataset.composerPluginName || '';
      if (node.textContent === name && node.querySelector('.composer-plugin-logo') && node.querySelector('.composer-skill-name')) return;
      node.replaceWith(document.createTextNode(composerSkillInsertedInterference(name, node.textContent || '')));
      invalidateComposerTextCache();
    });
    const known = new Map([...normalize([...catalog, ...window.YanAgentCatalog.items]), ...state.selectedPlugins].map(item => [item.id, item]));
    state.selectedPlugins = normalize([...input.querySelectorAll(selector)].map(node => known.get(node.dataset.composerPluginId) || {
      id: node.dataset.composerPluginId, name: node.dataset.composerPluginName
    }));
  }
  function hide() { view.classList.add('hidden'); }
  function refresh() { render(); }
  function choose(item) {
    if (!item || !installed().some(plugin => plugin.id === item.id)) return;
    const start = Math.min(getComposerText().length, Math.max(0, composerLastCaretTextOffset));
    set([...state.selectedPlugins, item]);
    composerLastCaretTextOffset = start; input.focus({ preventScroll: true }); setComposerCaretByTextOffset(start);
    setAttachmentMenuOpen(false); autoGrow(); captureComposerDraftForSession();
  }
  function render() {
    if (!isOpen()) return;
    const candidates = installed();
    const items = candidates.map(item => ({ ...normalize([item])[0], status: unavailableReason(item) }))
      .filter(item => !state.selectedPlugins.some(selected => selected.id === item.id));
    const next = JSON.stringify([loading, failure, items]);
    if (signature === next) return; signature = next;
    if (loading) { list.innerHTML = '<div class="skill-call-loading" role="status" aria-label="正在读取插件"></div>'; return; }
    if (!items.length) {
      const empty = candidates.length ? '当前候选项均已选择。'
        : catalog.some(item => item.installation) ? '当前工作区没有适用的已安装插件。' : '尚未安装插件，请先在扩展中安装。';
      list.innerHTML = `<div class="skill-call-empty">${escapeHtml(failure || empty)}</div>`; return;
    }
    list.innerHTML = items.map(item => `<button type="button" class="skill-call-item" data-composer-plugin-choice="${escapeAttr(item.id)}" role="menuitem"><span class="composer-plugin-logo" aria-hidden="true">${skillLogoHtml(item)}</span><span class="skill-call-text"><span class="skill-call-name">${escapeHtml(item.name)}</span><span class="skill-call-desc">${escapeHtml([item.status, item.desc].filter(Boolean).join(' · '))}</span></span></button>`).join('');
    bindSkillLogoFallbacks(list);
    list.querySelectorAll('[data-composer-plugin-choice]').forEach(button => {
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => choose(items.find(item => item.id === button.dataset.composerPluginChoice)));
    });
  }
  function open() {
    if (menu.classList.contains('hidden')) { setAttachmentMenuOpen(true); return; }
    if (menu.classList.contains('hidden')) return;
    if (menu.dataset.view !== 'main') resetComposerAddMenuView();
    view.classList.remove('hidden');
    signature = ''; void load();
  }
  async function validate(items = state.selectedPlugins) {
    const selected = normalize(items); if (!selected.length) return true;
    await load();
    for (const item of selected) {
      const agent = window.YanAgentCatalog.find(item.id);
      const reason = (agent ? '' : failure) || unavailableReason(agent || catalog.find(plugin => plugin.id === item.id));
      if (reason) { toast(`${agent ? '智能体' : '插件'} ${item.name}：${reason}。`, { error: true }); return false; }
    }
    return true;
  }
  function messageHtml(items) {
    return normalize(items).map(item => `<span class="msg-skill-call composer-plugin-token"><span class="composer-plugin-logo" aria-hidden="true">${skillLogoHtml(item)}</span><span>${escapeHtml(item.name)}</span></span>`).join('');
  }
  list.addEventListener('keydown', event => {
    const buttons = [...list.querySelectorAll('button')], index = buttons.indexOf(document.activeElement);
    if (event.key === 'Escape') { setAttachmentMenuOpen(false); input.focus(); return; }
    if (!['ArrowDown', 'ArrowUp'].includes(event.key) || !buttons.length) return;
    event.preventDefault(); buttons[(index + (event.key === 'ArrowDown' ? 1 : buttons.length - 1)) % buttons.length].focus();
  });
  window.yan.onPluginsChanged(() => { if (isOpen()) void load(); });
  return { normalize, set, sync, open, hide, refresh, validate, messageHtml };
})();

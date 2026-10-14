/* Package lifecycle using the existing Skill market templates and MCP controls. */
(() => {
  'use strict';
  const api = window.yan, templates = window.YanCapabilityTemplates;
  const page = document.getElementById('pagePluginPackages');
  const el = id => document.getElementById(id);
  let plugins = [], markets = [], busy = false, sequence = 0, selectedId = '', expandedSkills = false;
  const pending = new Set();
  let detailMarkup = '', refreshPending = false, lastProgress = '';
  const groups = [{ id: 'productivity', name: '效率工具', description: '电脑操控与日常应用工作流。' }, { id: 'creativity', name: '创意制作', description: '视频、动画与创意工作流。' }, { id: 'developer-tools', name: '开发者工具', description: '浏览器自动化、游戏开发、持续集成与 Apple 应用开发。' }, { id: 'custom', name: '自定义市场', description: '从你添加的来源获取的插件。' }, { id: 'installed', name: '已安装', description: '管理之前安装的插件。' }];
  const header = templates.marketHeader('plugin', '插件', '连接插件，让 Yan Agent 在你的各类工具中协同工作', { addLabel: '添加插件市场' });
  page.replaceChildren(header);
  page.insertAdjacentHTML('beforeend', `<div class="page-body capability-page-body">
    <section id="pluginMarketSources" class="plugin-market-sources hidden" aria-label="已添加的插件市场"></section>
    <section id="pluginMarketOverview" class="skill-workbench" aria-label="插件功能分组"><div id="pluginMarketGrid" class="skill-market-grid"></div></section>
    <section id="pluginDetailView" class="skill-detail-view hidden" aria-labelledby="pluginDetailTitle"><div id="pluginDetailContent" class="skill-detail-content"></div></section></div>`);
  const marketDialog = document.createElement('dialog');
  marketDialog.id = 'pluginMarketDialog';
  marketDialog.className = 'capability-dialog plugin-market-dialog';
  marketDialog.setAttribute('aria-labelledby', 'pluginMarketTitle');
  marketDialog.innerHTML = `<form class="capability-dialog-shell">
    <header class="capability-dialog-head"><div><h3 id="pluginMarketTitle">添加插件市场</h3><p>从 GitHub 仓库、Git URL 或本地文件夹添加。</p></div></header>
    <div class="capability-dialog-body"><fieldset>
      <label for="pluginMarketSource">来源</label><input id="pluginMarketSource" class="input" required autocomplete="off" placeholder="openai/plugins 或 git@github.com:org/repo.git">
      <label for="pluginMarketRef">Git 引用</label><input id="pluginMarketRef" class="input" autocomplete="off" placeholder="主分支">
      <label for="pluginMarketPaths">稀疏路径</label><textarea id="pluginMarketPaths" class="input" rows="4" spellcheck="false" placeholder="plugins/codex"></textarea>
    </fieldset><p id="pluginMarketError" role="alert" hidden></p>
    <div class="provider-confirm-actions"><button type="button" class="secondary-btn" id="pluginMarketCancel">取消</button><button type="submit" class="primary-btn" id="pluginMarketSubmit" disabled>添加市场</button></div></div>
  </form>`;
  const marketClose = el('skillImportCloseBtn').cloneNode(true);
  marketClose.id = 'pluginMarketClose';
  marketClose.setAttribute('aria-label', '关闭添加插件市场');
  marketDialog.querySelector('header').append(marketClose);
  document.body.append(marketDialog);
  let marketAdding = false;
  const closeMarket = () => { if (!marketAdding) marketDialog.close(); };
  el('pluginImportBtn').addEventListener('click', () => marketDialog.showModal());
  marketClose.addEventListener('click', closeMarket);
  el('pluginMarketCancel').addEventListener('click', closeMarket);
  marketDialog.addEventListener('cancel', event => { if (marketAdding) event.preventDefault(); });
  marketDialog.addEventListener('close', () => el('pluginImportBtn').focus({ preventScroll: true }));
  el('pluginMarketSource').addEventListener('input', () => { el('pluginMarketSubmit').disabled = marketAdding || !el('pluginMarketSource').value.trim(); });
  marketDialog.querySelector('form').addEventListener('submit', async event => {
    event.preventDefault();
    if (marketAdding) return;
    marketAdding = true;
    marketDialog.setAttribute('aria-busy', 'true');
    marketDialog.querySelector('fieldset').disabled = true;
    for (const id of ['pluginMarketClose', 'pluginMarketCancel', 'pluginMarketSubmit']) el(id).disabled = true;
    el('pluginMarketError').hidden = true;
    el('pluginMarketSubmit').textContent = '正在添加…';
    try {
      const response = await result(api.pluginsAddMarketplace({ source: el('pluginMarketSource').value.trim(), ref: el('pluginMarketRef').value.trim(), sparsePaths: el('pluginMarketPaths').value }));
      await show();
      marketDialog.close();
      marketDialog.querySelector('form').reset();
      status(`已添加市场，共 ${response.count} 个插件${response.skipped?.length ? `，${response.skipped.length} 个内置插件已跳过` : ''}`);
    } catch (error) { el('pluginMarketError').textContent = error.message; el('pluginMarketError').hidden = false; }
    finally {
      marketAdding = false;
      marketDialog.setAttribute('aria-busy', 'false');
      marketDialog.querySelector('fieldset').disabled = false;
      for (const id of ['pluginMarketClose', 'pluginMarketCancel']) el(id).disabled = false;
      el('pluginMarketSubmit').disabled = !el('pluginMarketSource').value.trim();
      el('pluginMarketSubmit').textContent = '添加市场';
    }
  });
  function status(message, state = '') { if (message) toast(message, { error: state === 'error' }); }
  async function result(promise) { const response = await promise; if (!response?.ok) throw new Error(response?.error || '插件操作失败'); return response; }
  function updateBusy() { page.setAttribute('aria-busy', String(busy || pending.size > 0)); }
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
  function render() {
    el('pluginMarketGrid').innerHTML = plugins.length ? groups.map(group => {
      const grouped = plugins.filter(item => item.category === group.id);
      return grouped.length ? templates.group({ id: `plugin-group-${group.id}`, name: group.name, description: group.description, cards: grouped.map(renderCard).join('') }) : '';
    }).join('') : '<div class="workbench-empty"><div class="workbench-empty-copy"><strong>暂无可用插件</strong></div></div>';
    const selected = plugins.find(item => item.id === selectedId);
    if (!selected) selectedId = '';
    el('pluginMarketSources').innerHTML = markets.length ? `<div class="plugin-market-sources-head"><h3>已添加的市场</h3><p>从这些来源获取的插件显示在“自定义市场”。</p></div><ul class="plugin-market-source-list">${markets.map(market => `<li class="plugin-market-source"><div class="plugin-market-source-copy"><span class="plugin-market-source-name">${escapeHtml(market.source)}</span><span class="plugin-market-source-meta">${market.ref ? `${escapeHtml(market.ref)} · ` : ''}${Number(market.count) || 0} 个插件</span></div><button type="button" class="ghost-btn plugin-market-remove" data-plugin-action="remove-market" data-plugin-id="${escapeAttr(market.id)}" title="移除市场来源" aria-label="移除市场 ${escapeAttr(market.source)}">移除</button></li>`).join('')}</ul>` : '';
    page.classList.toggle('is-detail', !!selected);
    header.classList.toggle('hidden', !!selected); el('pluginMarketSources').classList.toggle('hidden', !markets.length || !!selected); el('pluginMarketOverview').classList.toggle('hidden', !!selected); el('pluginDetailView').classList.toggle('hidden', !selected);
    if (selected) renderDetail(selected);
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
      const [response, marketResponse] = await Promise.all([result(api.pluginsCatalog()), result(api.pluginsMarkets())]);
      if (ticket !== sequence) return;
      plugins = response.plugins; markets = marketResponse.markets || []; render();
    }
    catch (error) { if (ticket === sequence) status(error.message, 'error'); }
  }
  async function action(name, id, detail = '', control) {
    if (busy) return;
    if (name === 'remove-market') {
      const market = markets.find(item => item.id === id);
      if (!market) return;
      if (!await requestGenericConfirmation({ title: '移除市场来源？', description: `${market.source}\n已安装的插件不受影响，“已安装”分组中仍可管理。`, confirmLabel: '移除', danger: true })) return;
      setBusy(true); lastProgress = '';
      try { await result(api.pluginsRemoveMarketplace(id)); status('已移除市场来源。'); await show(); }
      catch (error) { status(error.message, 'error'); }
      finally { setBusy(false); }
      return;
    }
    const item = plugins.find(item => item.id === id);
    if (name === 'back') { selectedId = ''; status(''); render(); return; }
    if (!item) return;
    if (name === 'open') { selectedId = id; expandedSkills = false; status(''); render(); page.scrollTop = 0; page.querySelector('.page-body').scrollTop = 0; return; }
    if (name === 'expand') { expandedSkills = !expandedSkills; render(); page.querySelector('[data-plugin-action="expand"]')?.focus({ preventScroll: true }); return; }
    if (['toggle', 'skill', 'directory', 'link'].includes(name)) { await localAction(name, item, detail, control); return; }
    if (pending.size) return;
    if (name === 'example') {
      setBusy(true);
      try { await window.YanPluginExamples.openDraft(item, Number(control.dataset.exampleIndex)); }
      catch (error) { status(error.message, 'error'); }
      finally { setBusy(false); }
      return;
    }
    if (name === 'remove' && !await requestGenericConfirmation({ title: `卸载 ${item.name}？`, description: item.runtime ? '插件将停止向 Agent 提供能力，已下载的 Chromium 浏览器（约 440 MB）也会一并删除。你可以从目录重新安装。' : '插件将停止向 Agent 提供能力。你可以从目录重新安装。', confirmLabel: '卸载', danger: true })) return;
    const focused = document.activeElement?.dataset;
    const focusAction = focused?.pluginAction, focusSkill = focused?.skillId, focusLink = focused?.linkKind;
    setBusy(true); lastProgress = '';
    status(name === 'install' && item.runtime ? '正在从 Playwright 官方源下载 Chromium（约 440 MB），完成后逐个校验文件…' : name === 'install' && item.download ? '正在下载插件并校验文件，请稍候…' : '');
    try {
      if (name === 'install') { const response = await result(api.pluginsInstallCatalog(id)); selectedId = id; status(response.account ? (response.account.message || (response.account.state === 'connected' ? '安装完成，账号已连接。启用后即可按需使用。' : '安装完成。已在系统浏览器打开官方授权页，请完成登录或注册。')) : item.runtime ? '安装完成，Chromium 已校验，插件已启用。' : '安装完成。启用后，Agent 可按任务需要加载。'); }
      else if (name === 'connect') { const response = await result(api.pluginsConnectAccount(id)); status(response.account.message || (response.account.state === 'connected' ? '账号已连接。' : '已在系统浏览器打开官方授权页，请完成登录或注册。')); }
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
  page.addEventListener('keydown', event => {
    const card = event.target.closest('[data-plugin-open]');
    if (card && event.target === card && ['Enter', ' '].includes(event.key)) { event.preventDefault(); void action('open', card.dataset.pluginOpen); }
  });
  api.onPluginsChanged(() => {
    if (page.classList.contains('hidden') || busy) return;
    if (pending.size) refreshPending = true;
    else void show();
  });
  // Runtime downloads report { id, phase, percent }; each distinct step refreshes
  // the toast so a 440 MB download never looks stalled.
  const phaseLabels = { download: '正在下载 Chromium', copy: '正在复制 Chromium', verify: '正在校验 Chromium 文件' };
  api.onPluginsProgress?.(event => {
    if (!busy || !event || !phaseLabels[event.phase]) return;
    const name = plugins.find(item => item.id === event.id)?.name || event.id;
    const message = `${name}：${phaseLabels[event.phase]} ${Math.max(0, Math.min(100, Number(event.percent) || 0))}%`;
    if (message === lastProgress) return;
    lastProgress = message; status(message);
  });
  window.YanPluginsPage = { show };
})();

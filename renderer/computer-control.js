(() => {
  const $ = id => document.getElementById(id);
  const escape = value => String(value || '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const svg = (name, paths) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-keyline-icon="${name}">${paths}</svg>`;
  const fileIcon = svg('file-text', '<path d="M14 2H8C5.79086 2 4 3.79086 4 6V18C4 20.2091 5.79086 22 8 22H16C18.2091 22 20 20.2091 20 18V8L14 2ZM14 2V5C14 6.65685 15.3431 8 17 8H20M8 13H12M8 17H16"/>');
  const downloadIcon = svg('download', '<path d="M12 3V15M8 11L12 15L16 11M4 19H20"/>');
  const binIcon = svg('bin-2', '<path d="M10 2H14M4 7H20M6 7H18V19C18 20.6569 16.6569 22 15 22H9C7.34315 22 6 20.6569 6 19V7ZM10 11L10 18M14 11L14 18"/>');
  let data, pendingDelete, generation = 0;
  const logo = item => `<img class="computer-app-logo" src="${escape(/^data:image\/(png|jpeg|webp);base64,/i.test(item.icon || '') ? item.icon : 'assets/app-window.svg')}" alt="">`;
  function closeDetail() {
    generation++;
    $('computerControlMain').hidden = false; $('computerControlDetail').hidden = true;
    document.getElementById('settingsOverlay')?.classList.remove('computer-detail-open');
  }
  function error(message, target = 'computerControlError') {
    $(target).textContent = message || ''; $(target).hidden = !message;
  }
  const checked = result => { if (!result || result.error) throw new Error(result?.error || '无法读取电脑操控设置'); return result; };
  function render() {
    $('computerControlEnabled').checked = data.enabled;
    const rows = (items, history) => items.length ? items.map(item => `<div class="computer-app-row">${logo(item)}<div class="computer-app-info"><strong>${escape(item.name)}</strong><p title="${escape(item.path)}">${escape(item.path)}</p></div><div class="computer-app-actions">${history ? `<button class="icon-btn" type="button" data-computer-action="download" data-id="${item.id}" aria-label="下载 ${escape(item.name)} 的使用经验" title="下载使用经验（Markdown）">${downloadIcon}</button>` : ''}${history ? `<button class="icon-btn" type="button" data-computer-action="experience" data-id="${item.id}" aria-label="查看 ${escape(item.name)} 的使用经验" title="查看使用经验">${fileIcon}</button>` : ''}<button class="icon-btn" type="button" data-computer-action="${history ? 'delete' : 'disallow'}" data-id="${item.id}" aria-label="${history ? '删除应用记录' : '取消始终允许'}：${escape(item.name)}" title="${history ? '删除应用记录' : '取消始终允许'}">${binIcon}</button></div></div>`).join('') : '<div class="computer-empty">暂无</div>';
    $('computerControlAllowed').innerHTML = rows(data.allowedApps, false);
    $('computerControlHistory').innerHTML = rows(data.apps, true);
  }
  async function refresh() {
    closeDetail(); const version = generation;
    try { const result = checked(await window.yan.getComputerControlSettings()); if (version !== generation) return; data = result; render(); error(''); }
    catch (e) { if (version === generation) error(e.message); }
  }
  async function mutate(button, operation) {
    button.disabled = true;
    try { data = checked(await operation()); render(); error(''); } catch (e) { error(e.message); if (data) render(); }
    finally { button.disabled = false; }
  }
  async function openExperience(id, trigger = null) {
    const version = ++generation; if (trigger) trigger.disabled = true;
    try {
      const result = checked(await window.yan.getComputerControlExperience(id)); if (version !== generation) return;
      const detail = $('computerControlDetail'); detail.dataset.appId = id;
      detail.innerHTML = window.YanCapabilityTemplates.compactDetailHead({ titleId: 'computerExperienceTitle', name: result.app.name, description: result.app.path, logo: logo(result.app), actions: '', actionLabel: '应用使用经验', closeAttribute: 'data-computer-action', closeLabel: '返回电脑操控' }) + '<section class="skill-detail-content"><h2>自进化经验</h2><article class="msg-body computer-experience-markdown"></article></section>';
      detail.querySelector('article').innerHTML = result.markdown.trim() ? renderMarkdown(result.markdown, { softBreaks: true }) : '<p class="computer-empty">该应用暂无使用经验。</p>';
      $('computerControlMain').hidden = true; detail.hidden = false;
      document.getElementById('settingsOverlay')?.classList.add('computer-detail-open');
      detail.querySelector('button')?.focus(); error('');
    } catch (e) { error(e.message); } finally { if (trigger) trigger.disabled = false; }
  }
  async function downloadExperience(id, trigger = null) {
    if (trigger) trigger.disabled = true;
    try {
      const result = await window.yan.downloadComputerControlExperience(id);
      if (result?.canceled) { error(''); return; }
      checked(result); error('');
    } catch (e) { error(e.message); } finally { if (trigger) trigger.disabled = false; }
  }
  $('computerControlEnabled').addEventListener('change', event => void mutate(event.target, () => window.yan.updateComputerControlSettings({ enabled: event.target.checked })));
  $('computerControlAdd').addEventListener('click', event => void mutate(event.currentTarget, () => window.yan.addComputerControlApp()));
  $('tab-computer-control').addEventListener('click', async event => {
    const button = event.target.closest('[data-computer-action]'); if (!button) return;
    const { computerAction: action, id } = button.dataset;
    if (action === 'back') { closeDetail(); document.querySelector(`[data-computer-action="experience"][data-id="${$('computerControlDetail').dataset.appId}"]`)?.focus(); return; }
    if (action === 'disallow') return mutate(button, () => window.yan.removeComputerControlAllowedApp(id));
    if (action === 'delete') {
      pendingDelete = id;
      $('computerControlDeleteDialog').dataset.pendingId = id || '';
      error('', 'computerControlDeleteError'); $('computerControlDeleteDialog').showModal(); $('computerControlCancel').focus(); return;
    }
    if (action === 'download') return downloadExperience(id, button);
    if (action !== 'experience') return;
    return openExperience(id, button);
  });
  $('computerControlCancel').addEventListener('click', () => $('computerControlDeleteDialog').close());
  $('computerControlDeleteDialog').addEventListener('close', () => {
    pendingDelete = null;
    delete $('computerControlDeleteDialog').dataset.pendingId;
  });
  $('computerControlConfirm').addEventListener('click', async event => {
    const button = event.currentTarget; button.disabled = true;
    const id = pendingDelete || $('computerControlDeleteDialog').dataset.pendingId;
    try {
      if (!id) throw new Error('未选择应用记录');
      checked(await window.yan.deleteComputerControlExperience(id));
      await refresh();
      if (!data?.apps?.every(item => item.id !== id)) throw new Error('删除未完成，请重试');
      error('', 'computerControlDeleteError');
      $('computerControlDeleteDialog').close();
    }
    catch (e) { error(e.message, 'computerControlDeleteError'); } finally { button.disabled = false; }
  });
  window.YanComputerControl = { refresh, closeDetail, openExperience, fileIcon };
})();

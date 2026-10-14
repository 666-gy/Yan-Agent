window.YanSubagentSettings = (() => {
  const list = document.querySelector('#subagentModelList');
  const notice = document.querySelector('#subagentModelsNotice');
  let models = [], sequence = 0, busy = false;
  let openMenu = null;
  const key = model => JSON.stringify([model.providerId, model.supplierId || '', model.modelId || model.id]);
  function render() {
    openMenu?.close();
    list.innerHTML = SUBAGENT_ROLE_IDS.map(role => {
      const selection = state.config?.agent?.subagentModels?.[role];
      const selected = selection ? key(selection) : '';
      const missing = selection && !models.some(model => key(model) === selected);
      const model = models.find(item => key(item) === selected);
      const label = model ? model.name || model.id : missing ? `${selection.modelId}（已停用）` : '跟随主模型';
      return `<div class="subagent-settings-row">
        <span class="subagent-settings-icon composer-subagent-logo" data-agent-role="${role}">${window.YanSubagentPanel?.iconFor(role) || ''}</span>
        <div class="subagent-settings-info"><span class="subagent-settings-name" data-preserve-language>${escapeHtml(SUBAGENT_ROLE_LABELS[role])}</span><p>${escapeHtml(SUBAGENT_ROLE_DESCRIPTIONS[role])}</p></div>
        <button type="button" class="subagent-model-pill" id="subagent-model-${role}" data-subagent-model="${role}" data-model-value="${escapeAttr(selected)}" aria-label="${escapeAttr(SUBAGENT_ROLE_LABELS[role])} 模型" aria-haspopup="listbox" aria-expanded="false" title="${escapeAttr(label)}" ${busy ? 'disabled' : ''}>
          <span>${escapeHtml(label)}</span><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
        </button>
      </div>`;
    }).join('');
  }
  async function refresh() {
    const current = ++sequence;
    notice.textContent = '正在读取模型…';
    try {
      const payload = await api.listQuickModels();
      if (current !== sequence) return;
      models = (payload?.models || []).filter(model => model.modelType === 'text');
      notice.textContent = models.length ? '' : '暂无已启用的文本模型';
    } catch (error) {
      if (current !== sequence) return;
      notice.textContent = `读取模型失败：${error.message}`;
    }
    render();
  }
  async function choose(role, value) {
    if (busy) return;
    const model = models.find(item => key(item) === value);
    if (value && !model) return;
    openMenu?.close();
    busy = true;
    list.querySelectorAll('[data-subagent-model]').forEach(item => { item.disabled = true; });
    try {
      const config = await api.setConfig({ agent: { subagentModels: { [role]: model
        ? { providerId: model.providerId, supplierId: model.supplierId || '', modelId: model.id } : null } } });
      if (config?.error) throw new Error(config.error);
      state.config = config;
      notice.textContent = '';
    } catch (error) {
      notice.textContent = `保存失败：${error.message}`;
    } finally {
      busy = false;
      render();
      document.getElementById(`subagent-model-${role}`)?.focus({ preventScroll: true });
    }
  }
  function openPicker(trigger) {
    if (busy) return;
    if (openMenu?.trigger === trigger) { openMenu.close(); return; }
    openMenu?.close();
    const role = trigger.dataset.subagentModel;
    const selected = trigger.dataset.modelValue;
    const panel = document.createElement('div');
    panel.className = 'appearance-picker-panel subagent-model-menu';
    panel.setAttribute('popover', 'auto');
    panel.id = `subagent-model-${role}-options`;
    panel.setAttribute('role', 'listbox');
    panel.setAttribute('aria-label', trigger.getAttribute('aria-label'));
    panel.tabIndex = -1;
    const groups = new Map();
    for (const model of models) {
      const groupKey = JSON.stringify([model.providerId, model.supplierId || '']);
      if (!groups.has(groupKey)) groups.set(groupKey, { label: model.supplierName || model.providerName || model.providerId, models: [] });
      groups.get(groupKey).models.push(model);
    }
    let index = 0;
    const option = (label, value) => `<button type="button" tabindex="-1" role="option" class="appearance-picker-option" id="${panel.id}-${index++}" data-model-option="${escapeAttr(value)}" aria-selected="${value === selected}"><span>${escapeHtml(label)}</span><span class="appearance-picker-check" aria-hidden="true">${value === selected ? '✓' : ''}</span></button>`;
    panel.innerHTML = option('跟随主模型', '') + [...groups.values()].map(group =>
      `<div role="group" aria-label="${escapeAttr(group.label)}"><div class="subagent-model-group" aria-hidden="true">${escapeHtml(group.label)}</div>${group.models.map(model => option(model.name || model.id, key(model))).join('')}</div>`).join('');
    document.querySelector('#settingsOverlay').append(panel);
    const options = [...panel.querySelectorAll('[data-model-option]')];
    let active = Math.max(0, options.findIndex(item => item.getAttribute('aria-selected') === 'true'));
    function activate(next) {
      active = Math.max(0, Math.min(next, options.length - 1));
      options.forEach((item, i) => item.classList.toggle('is-active', i === active));
      panel.setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    }
    function position() {
      const rect = trigger.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight) { close(); return; }
      const width = Math.min(Math.max(rect.width, 260), innerWidth - 16);
      const below = innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const height = Math.max(40, Math.min(360, Math.max(below, above)));
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
      panel.style.top = `${below >= Math.min(height, panel.scrollHeight) || below >= above ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(height, panel.scrollHeight) - 6)}px`;
    }
    const onScroll = event => { if (!panel.contains(event.target)) position(); };
    function close() {
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-controls');
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', position);
      panel.remove();
      if (openMenu?.panel === panel) openMenu = null;
    }
    panel.addEventListener('toggle', event => { if (event.newState === 'closed') close(); });
    panel.addEventListener('click', event => {
      const item = event.target.closest('[data-model-option]');
      if (item) void choose(role, item.dataset.modelOption);
    });
    panel.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        if (event.key === 'Enter' || event.key === ' ') options[active].click();
        else activate(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : active + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Escape' || event.key === 'Tab') {
        if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); }
        close();
        trigger.focus({ preventScroll: true });
      }
    });
    openMenu = { panel, trigger, close };
    trigger.setAttribute('aria-expanded', 'true');
    trigger.setAttribute('aria-controls', panel.id);
    panel.showPopover();
    position();
    activate(active);
    panel.focus({ preventScroll: true });
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', position);
  }
  list.addEventListener('click', event => {
    const trigger = event.target.closest('[data-subagent-model]');
    if (trigger) openPicker(trigger);
  });
  list.addEventListener('keydown', event => {
    const trigger = event.target.closest('[data-subagent-model]');
    if (trigger && ['ArrowDown', 'ArrowUp'].includes(event.key)) { event.preventDefault(); openPicker(trigger); }
  });
  return { refresh };
})();

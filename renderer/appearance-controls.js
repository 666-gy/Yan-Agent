/* Custom presentation for appearance controls; native values keep the config contract. */
(() => {
  const controls = new Map();
  let openPanel;
  function optionLabel(label, option) {
    label.replaceChildren();
    if (option?.dataset.icon) {
      const icon = document.createElement('img');
      icon.src = option.dataset.icon;
      icon.alt = '';
      icon.className = 'settings-picker-icon';
      label.append(icon);
    }
    const text = document.createElement('span');
    text.textContent = option?.textContent || '请选择';
    label.append(text);
    label.classList.add('settings-picker-label');
  }

  function openPicker(select, trigger) {
    openPanel?.hidePopover();
    const searchable = /Font$/.test(select.id);
    const detailed = select.hasAttribute('data-picker-details');
    const panel = document.createElement('div');
    panel.className = 'appearance-picker-panel';
    panel.classList.toggle('settings-picker-detailed', detailed);
    panel.setAttribute('popover', 'auto');
    const list = document.createElement('div');
    list.className = 'appearance-picker-list';
    list.id = `${select.id}-options`;
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-label', select.getAttribute('aria-label'));
    list.tabIndex = -1;
    let search;
    let active = 0;
    let options = [];
    let typeahead = '';
    let typeaheadTimer;
    const focusHost = () => search || list;
    function activate(index) {
      if (!options.length) { focusHost().removeAttribute('aria-activedescendant'); return; }
      active = Math.max(0, Math.min(index, options.length - 1));
      options.forEach((option, i) => option.classList.toggle('is-active', i === active));
      focusHost().setAttribute('aria-activedescendant', options[active].id);
      options[active].scrollIntoView({ block: 'nearest' });
    }
    function choose(value) {
      select.value = value;
      sync();
      panel.hidePopover();
      trigger.focus({ preventScroll: true });
      select.dispatchEvent(new Event('change', { bubbles: true }));
    }
    function render() {
      const query = search?.value.trim().toLocaleLowerCase() || '';
      list.replaceChildren();
      options = [...select.options].filter(option => option.textContent.toLocaleLowerCase().includes(query)).map((option, index) => {
        const row = document.createElement('button');
        row.type = 'button';
        row.tabIndex = -1;
        row.className = 'appearance-picker-option';
        row.id = `${list.id}-${index}`;
        row.setAttribute('role', 'option');
        row.setAttribute('aria-selected', String(option.selected));
        row.disabled = option.disabled;
        const label = document.createElement('span');
        optionLabel(label, option);
        if (detailed && option.dataset.description) {
          const description = document.createElement('span');
          description.className = 'settings-picker-description';
          description.textContent = window.YanI18n?.translate(option.dataset.description) || option.dataset.description;
          label.append(description);
        }
        const check = document.createElement('span');
        check.className = 'appearance-picker-check';
        check.setAttribute('aria-hidden', 'true');
        check.textContent = option.selected ? '✓' : '';
        row.append(label, check);
        row.addEventListener('click', () => choose(option.value));
        list.append(row);
        return row;
      });
      if (!options.length) {
        const empty = document.createElement('div');
        empty.className = 'appearance-picker-empty';
        empty.setAttribute('role', 'status');
        empty.textContent = '没有匹配的字体';
        list.append(empty);
      }
      activate(Math.max(0, options.findIndex(option => option.getAttribute('aria-selected') === 'true')));
    }
    if (searchable) {
      search = document.createElement('input');
      search.type = 'search';
      search.className = 'appearance-picker-search';
      search.placeholder = '搜索字体…';
      search.setAttribute('aria-label', '搜索字体');
      search.setAttribute('role', 'combobox');
      search.setAttribute('aria-controls', list.id);
      search.setAttribute('aria-expanded', 'true');
      search.setAttribute('aria-autocomplete', 'list');
      search.addEventListener('input', render);
      panel.append(search);
    }
    panel.append(list);
    document.querySelector('#settingsOverlay').append(panel);
    trigger.setAttribute('aria-controls', list.id);
    trigger.setAttribute('aria-expanded', 'true');
    function position() {
      const rect = trigger.getBoundingClientRect();
      const minimumWidth = detailed ? 300 : select.id === 'snapshotShortcut' ? 240 : select.id === 'generalTerminalShell'
        ? 250
        : ['generalLanguage', 'generalCompletionNotification', 'configurationAccessMode', 'configurationVerbosity', 'configurationReasoningSummary', 'ttsVoice', 'contextMetric'].includes(select.id)
          ? 200
          : 132;
      const width = Math.min(searchable ? Math.max(rect.width, 240) : Math.max(rect.width, minimumWidth), innerWidth - 16);
      const below = innerHeight - rect.bottom - 12;
      const above = rect.top - 12;
      const maximumHeight = detailed ? 400 : 280;
      const height = Math.min(maximumHeight, Math.max(below, above));
      panel.style.width = `${width}px`;
      panel.style.maxHeight = `${height}px`;
      panel.style.left = `${Math.max(8, Math.min(rect.right - width, innerWidth - width - 8))}px`;
      panel.style.top = `${below >= Math.min(maximumHeight, panel.scrollHeight) || below >= above ? rect.bottom + 6 : Math.max(8, rect.top - Math.min(height, panel.scrollHeight) - 6)}px`;
    }
    panel.addEventListener('keydown', event => {
      if (['ArrowDown', 'ArrowUp', 'Home', 'End', 'Enter'].includes(event.key) && (!search || !['Home', 'End'].includes(event.key))) {
        event.preventDefault();
        if (event.key === 'Enter') options[active]?.click();
        else activate(event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1 : active + (event.key === 'ArrowDown' ? 1 : -1));
      } else if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        panel.hidePopover();
        trigger.focus({ preventScroll: true });
      } else if (event.key === 'Tab') {
        panel.hidePopover();
        trigger.focus({ preventScroll: true });
      } else if (!search && event.key.length === 1) {
        clearTimeout(typeaheadTimer);
        typeahead += event.key.toLocaleLowerCase();
        activate(options.findIndex(option => option.textContent.toLocaleLowerCase().startsWith(typeahead)));
        typeaheadTimer = setTimeout(() => { typeahead = ''; }, 600);
      }
    });
    const onScroll = event => { if (!panel.contains(event.target)) position(); };
    panel.addEventListener('toggle', event => {
      if (event.newState !== 'closed') return;
      trigger.setAttribute('aria-expanded', 'false');
      trigger.removeAttribute('aria-controls');
      document.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', position);
      clearTimeout(typeaheadTimer);
      panel.remove();
      if (openPanel === panel) openPanel = null;
    });
    render();
    panel.showPopover();
    openPanel = panel;
    position();
    activate(active);
    focusHost().focus({ preventScroll: true });
    document.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', position);
  }

  function sync() {
    document.querySelectorAll('.appearance-page select, select[data-settings-picker]').forEach(select => {
      let control = controls.get(select);
      if (!control) {
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.id = `${select.id}-trigger`;
        trigger.className = 'appearance-picker-trigger';
        trigger.classList.toggle('appearance-picker-font', /Font$/.test(select.id));
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        trigger.setAttribute('aria-label', select.getAttribute('aria-label'));
        const label = document.createElement('span');
        const arrow = document.createElement('span');
        arrow.className = 'appearance-picker-chevron';
        arrow.setAttribute('aria-hidden', 'true');
        trigger.append(label, arrow);
        select.hidden = true;
        select.after(trigger);
        trigger.addEventListener('click', () => {
          if (trigger.getAttribute('aria-expanded') === 'true') openPanel?.hidePopover();
          else openPicker(select, trigger);
        });
        trigger.addEventListener('keydown', event => {
          if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); openPicker(select, trigger); }
        });
        control = { trigger, label };
        controls.set(select, control);
      }
      optionLabel(control.label, select.selectedOptions[0]);
      control.trigger.disabled = select.disabled;
      control.trigger.title = control.label.textContent;
    });
    const color = document.querySelector('#appearanceAccent');
    const button = document.querySelector('#appearanceAccentButton');
    if (color && button) {
      const rgb = color.value.match(/[\da-f]{2}/gi).map(value => parseInt(value, 16));
      button.querySelector('.appearance-color-value').textContent = `RGB ${rgb.join(', ')}`;
      button.querySelector('.appearance-color-dot').style.backgroundColor = color.value;
      button.setAttribute('aria-label', `手动调色，RGB ${rgb.join(', ')}`);
      if (!button.dataset.bound) {
        button.dataset.bound = 'true';
        button.addEventListener('click', () => color.showPicker ? color.showPicker() : color.click());
        color.addEventListener('input', sync);
      }
    }
  }
  window.YanAppearanceControls = { sync };
})();

'use strict';

window.YanAgentPresets = (() => {
  const host = document.createElement('div');
  host.id = 'agentPresetPicker';
  host.className = 'agent-preset-picker';
  host.innerHTML = `<button id="agentPresetButton" class="new-task-branch-btn" type="button" aria-haspopup="menu" aria-expanded="false" aria-controls="agentPresetMenu"><span class="agent-preset-icon" aria-hidden="true"></span><span id="agentPresetLabel">标准模式</span></button>
    <div id="agentPresetMenu" class="agent-preset-menu hidden" role="menu" aria-label="Agent 模式">
      <button type="button" role="menuitemradio" data-preset="standard" aria-checked="true"><span class="agent-preset-icon" aria-hidden="true"></span><span class="agent-preset-copy"><span class="agent-preset-name">标准模式</span><span class="agent-preset-description">完全开发环境，开放所有工具，默认模式。</span></span><span class="agent-preset-check" aria-hidden="true">✓</span></button>
      <button type="button" role="menuitemradio" data-preset="minimal" aria-checked="false"><span class="agent-preset-icon" aria-hidden="true"></span><span class="agent-preset-copy"><span class="agent-preset-name">极简模式</span><span class="agent-preset-description">极少上下文和极少的工具暴露，适合游乐场测试</span></span><span class="agent-preset-check" aria-hidden="true">✓</span></button>
      <button type="button" role="menuitemradio" data-preset="creative" aria-checked="false"><span class="agent-preset-icon" aria-hidden="true"></span><span class="agent-preset-copy"><span class="agent-preset-name">创造模式</span><span class="agent-preset-description">创建新的插件/技能/宠物或新的智能体，个性化定制你的Yan Agent</span></span><span class="agent-preset-check" aria-hidden="true">✓</span></button>
      <button type="button" role="menuitemradio" data-preset="daily" aria-checked="false"><span class="agent-preset-icon" aria-hidden="true"></span><span class="agent-preset-copy"><span class="agent-preset-name">日常模式</span><span class="agent-preset-description">适合日常聊天，联网搜索，生图生视频等，开发请转标准模式。</span></span><span class="agent-preset-check" aria-hidden="true">✓</span></button>
      <button type="button" role="menuitemradio" data-preset="uncensored" aria-checked="false"><span class="agent-preset-icon" aria-hidden="true"></span><span class="agent-preset-copy"><span class="agent-preset-name">无审查模式</span><span class="agent-preset-description">无审查系统提示词，开放所有工具，责任自担。</span></span><span class="agent-preset-check" aria-hidden="true">✓</span></button>
    </div>`;
  document.getElementById('newTaskWorkspace').append(host);
  const trigger = host.querySelector('#agentPresetButton');
  const menu = host.querySelector('#agentPresetMenu');
  let options = [...menu.querySelectorAll('[data-preset]')];
  let icons = {};
  let saving = false;
  let confirming = false;
  let sessionId = '';
  const presetLabels = { standard: '标准模式', minimal: '极简模式', creative: '创造模式', daily: '日常模式', uncensored: '无审查模式' };
  const presetIcons = { standard: 'badge-terminal', minimal: 'badge-minus', creative: 'badge-plus', daily: 'badge-check', uncensored: 'badge-alert' };
  const customAgents = () => Array.isArray(state.config?.customAgents)
    ? state.config.customAgents.filter(agent => /^custom-[a-z0-9][a-z0-9-]{0,55}$/.test(agent?.id || '')) : [];
  const customAgent = id => customAgents().find(agent => agent?.id === id);
  const presetLabel = preset => presetLabels[preset] || customAgent(preset)?.name || '标准模式';
  const presetIcon = preset => presetIcons[preset] || 'badge-terminal';
  const current = () => {
    const selected = state.currentSession?.agentPreset;
    return ['daily', 'minimal', 'creative', 'uncensored'].includes(selected) || customAgent(selected)
      ? selected : 'standard';
  };
  const icon = preset => icons[presetIcon(preset)] || '';
  function syncOptions() {
    const existing = new Map([...menu.querySelectorAll('[data-preset]')].map(option => [option.dataset.preset, option]));
    for (const agent of customAgents()) {
      if (!agent?.id || !agent.name) continue;
      let option = existing.get(agent.id);
      if (!option) {
        option = document.createElement('button');
        option.type = 'button';
        option.setAttribute('role', 'menuitemradio');
        option.dataset.preset = agent.id;
        option.innerHTML = '<span class="agent-preset-icon" aria-hidden="true"></span><span class="agent-preset-copy"><span class="agent-preset-name"></span><span class="agent-preset-description"></span></span><span class="agent-preset-check" aria-hidden="true">✓</span>';
        menu.append(option);
      }
      option.querySelector('.agent-preset-name').textContent = agent.name;
      option.querySelector('.agent-preset-description').textContent = agent.description || '';
      option.querySelector('.agent-preset-icon').innerHTML = icon(agent.id);
      option.title = agent.description || agent.name;
      existing.delete(agent.id);
    }
    for (const option of existing.values()) {
      if (!['standard', 'minimal', 'creative', 'daily', 'uncensored'].includes(option.dataset.preset)) option.remove();
    }
    options = [...menu.querySelectorAll('[data-preset]')];
  }
  // An opened task shows the mode as a read-only label in the composer strip:
  // the mode is decided when the task starts and is not switchable afterwards.
  function syncReadOnlyModePill(preset) {
    const label = presetLabel(preset);
    for (const [pillId, labelId] of [
      ['taskComposerModePill', 'taskComposerModeLabel'],
      ['taskCapsuleModePill', 'taskCapsuleModeLabel']
    ]) {
      const pill = document.getElementById(pillId);
      if (!pill) continue;
      const iconEl = pill.querySelector('.agent-preset-icon');
      if (iconEl) iconEl.innerHTML = icon(preset);
      const labelEl = document.getElementById(labelId);
      if (labelEl) labelEl.textContent = label;
      pill.title = `当前任务模式：${label}`;
      pill.setAttribute('aria-label', `当前任务模式：${label}`);
    }
  }
  function close(focus = false) {
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    if (focus) trigger.focus();
  }
  function sync() {
    syncOptions();
    const nextId = state.currentSession?.id || '';
    if (sessionId !== nextId) close();
    sessionId = nextId;
    const preset = current();
    trigger.querySelector('.agent-preset-icon').innerHTML = icon(preset);
    trigger.querySelector('#agentPresetLabel').textContent = presetLabel(preset);
    syncReadOnlyModePill(preset);
    trigger.disabled = saving || !state.currentSession;
    trigger.title = '选择 Agent 模式（对下一次运行生效）';
    for (const option of options) {
      option.setAttribute('aria-checked', String(option.dataset.preset === preset));
      option.querySelector('.agent-preset-icon').innerHTML = icon(option.dataset.preset);
      option.disabled = saving;
    }
    window.YanVoiceInput?.syncCallAvailability?.();
  }
  function open() {
    if (trigger.disabled) return;
    closeNewTaskBranchMenu();
    closeWorkspaceChoiceMenu();
    setAttachmentMenuOpen(false);
    sync();
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    options.find(option => option.dataset.preset === current()).focus();
  }
  trigger.addEventListener('click', () => menu.classList.contains('hidden') ? open() : close());
  async function selectPreset(option) {
    const session = state.currentSession;
    if (!session || saving || confirming) return;
    if (option.dataset.preset === current()) { close(true); return; }
    if (option.dataset.preset === 'uncensored') {
      close(true);
      confirming = true;
      let confirmed;
      try {
        confirmed = await requestGenericConfirmation({
          title: '启用无审查模式？',
          description: '此模式使用独立系统提示词，开放全部已启用工具。请自行判断生成内容与操作结果，并承担使用责任。现有权限设置仍然生效，模型提供方的限制不会因此解除。',
          confirmLabel: '我已了解，启用',
          cancelLabel: '取消'
        });
      } finally { confirming = false; }
      if (!confirmed || state.currentSession?.id !== session.id || !isBlankNewChat(session)) return;
    }
    const previous = session.agentPreset;
    session.agentPreset = option.dataset.preset;
    saving = true;
    close(true);
    sync();
    updateContextInfo();
    try {
      const saved = await api.saveSession(buildSessionSavePayload(session));
      if (saved?.error || saved?.ok === false) throw new Error(saved.error || '保存失败');
      const summary = state.sessions.find(item => item.id === session.id);
      if (summary) summary.agentPreset = session.agentPreset;
    } catch (error) {
      session.agentPreset = previous;
      toast(`模式保存失败：${error.message || error}`);
    } finally { saving = false; sync(); updateContextInfo(); }
  }
  menu.addEventListener('click', event => {
    const option = event.target.closest('[data-preset]');
    if (option && menu.contains(option)) void selectPreset(option);
  });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); close(true); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      if (menu.classList.contains('hidden')) { open(); return; }
      const index = options.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? options.length - 1
        : (index + (event.key === 'ArrowUp' ? -1 : 1) + options.length) % options.length;
      options[next].focus();
    }
  });
  host.addEventListener('focusout', event => { if (event.relatedTarget && !host.contains(event.relatedTarget)) close(); });
  document.addEventListener('pointerdown', event => { if (!host.contains(event.target)) close(); });
  fetch('assets/agent-preset-icons.json').then(response => {
    if (!response.ok) throw new Error('Mode icons unavailable');
    return response.json();
  }).then(value => { icons = value; sync(); }).catch(error => console.warn('[agent-presets]', error));
  async function refresh() {
    state.config = await api.getConfig();
    sync();
    return customAgents();
  }
  sync();
  return { sync, close, refresh };
})();

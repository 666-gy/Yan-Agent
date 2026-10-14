/* Current-chat commands shared by the add panel and the leading / picker. */
window.YanComposerConfig = (() => {
  const menu = document.getElementById('attachmentMenu');
  const view = document.getElementById('composerConfigView');
  const list = document.getElementById('composerConfigList');
  const back = document.getElementById('composerConfigBack');
  const title = document.getElementById('composerConfigTitle');
  let slashStart = null;
  let slashEnd = null;
  let trigger = '/';
  let query = '';
  let selected = 0;
  let page = 'commands';
  let models = [];
  let loading = false;
  let failure = '';
  let generation = 0;

  // Keyline Icons: bot-droplet, message-plus and lightbulb-on.
  const keyline = (name, paths) => `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-keyline-icon="${name}">${paths}</svg>`;
  const modelIcon = keyline('bot-droplet', '<path d="M18.4 9.2C19.4386 10.5848 20 12.269 20 14C20 18.4183 16.4183 22 12 22C7.5817 22 4 18.4183 4 14C4 12.269 4.5614 10.5848 5.6 9.2L10.4 2.8C10.7777 2.2964 11.3705 2 12 2C12.6295 2 13.2223 2.2964 13.6 2.8L18.4 9.2Z"/><path d="M10 11.6028L10.4521 14.5685M13.9543 11L14.4064 13.9657"/>');
  const sideIcon = keyline('message-plus', '<path d="M4.5686 16.353C2.915 14.8839 2 12.9769 2 11C2 6.5817 6.4772 3 12 3C17.5228 3 22 6.5817 22 11C22 15.4183 17.5228 19 12 19C11.1845 19 10.3721 18.9202 9.5808 18.7624L5 21L4.5686 16.353ZM12 8L12 14M9 11L15 11"/>');
  const reasoningIcon = keyline('lightbulb-on', '<path d="M7.9689 14C7.6605 13.3784 7.5 12.6939 7.5 12C7.5 9.5147 9.5147 7.5 12 7.5C14.4853 7.5 16.5 9.5147 16.5 12C16.5 12.6939 16.3395 13.3784 16.0311 14M10 18L14 18M11 22L13 22M20.5 12L22 12M3.5 12L2 12M12 3.5L12 2M5.9896 5.9896L4.9289 4.9289M18.0104 5.9896L19.0711 4.9289"/>');

  const sourceIcon = selector => document.querySelector(selector)?.outerHTML || ICONS.file;
  const commands = [
    { id: 'mcp', name: 'MCP', desc: '显示 MCP 服务器状态', icon: () => sourceIcon('#uploadFileAction svg'), route: true },
    { id: 'side', name: '侧边会话', desc: '发起临时侧边聊天', icon: () => sideIcon },
    { id: 'archive', name: '归档', desc: '归档当前聊天', icon: () => window.YanArchiveIcon },
    { id: 'reasoning', name: '推理', desc: () => REASONING_SPEED_UI[getReasoningSpeedMode()].label, icon: () => reasoningIcon, route: true, page: true },
    { id: 'new', name: '新聊天', desc: '在同一工作区中开启空白聊天', icon: () => sourceIcon('#newTaskNavBtn svg') },
    { id: 'model', name: '模型', desc: () => getAgentModelSelection().name || getAgentModelSelection().modelId || '选择模型', icon: () => modelIcon, route: true, page: true },
    { id: 'goal', name: '目标', desc: '设置要持续追求的目标', icon: () => sourceIcon('#composerAddMainView [data-work-mode="goal"] > svg'), mode: true },
    { id: 'draw', name: '绘图', desc: '绘制草图', icon: () => sourceIcon('#drawingAction .drawing-action-icon') },
    { id: 'pin', name: () => state.currentSession?.pinned ? '取消置顶聊天' : '置顶聊天', desc: '将此聊天保留在侧边栏', icon: () => ICONS.pin },
    { id: 'pet', name: '虚拟宠物', desc: () => state.config?.pet?.enabled ? '收起桌面虚拟宠物' : '唤醒桌面虚拟宠物', icon: () => ICONS.user },
    { id: 'plan', name: '计划模式', desc: '开启计划模式', icon: () => sourceIcon('#composerAddMainView [data-work-mode="plan"] > svg'), mode: true },
    { id: 'memory', name: '记忆', desc: '个性化与记忆设置', icon: () => sourceIcon('#settingsSidebarNav [data-tab="memory"] svg'), route: true },
    { id: 'rename', name: '重命名', desc: '重命名当前聊天', icon: () => ICONS.edit },
    { id: 'skills', name: '技能', desc: '选择本轮使用的技能', icon: () => sourceIcon('#pluginsSkillsTab svg'), route: true, page: true }
  ];
  const value = text => typeof text === 'function' ? text() : text;
  const isOpen = () => !menu.classList.contains('hidden') && menu.dataset.view === 'config';
  function unavailable(command) {
    if (['archive', 'pin', 'rename'].includes(command.id) && !state.currentSession) return true;
    if (command.id === 'archive' && isSessionExecutionActive(state.currentSession?.id)) return true;
    return false;
  }
  function highlight(index) {
    const buttons = [...list.querySelectorAll('button:not(:disabled)')];
    selected = buttons.length ? (index + buttons.length) % buttons.length : 0;
    buttons.forEach((button, i) => button.classList.toggle('is-highlighted', i === selected));
    buttons[selected]?.scrollIntoView({ block: 'nearest' });
  }
  function render() {
    list.replaceChildren();
    title.textContent = { commands: '', model: '模型', reasoning: '推理', skills: '技能' }[page];
    back.setAttribute('aria-label', page === 'commands' ? '返回添加面板' : '返回命令面板');
    const needle = query.trim().toLowerCase();
    const current = getAgentModelSelection();
    const skills = curatedComposerSkillItems().filter(skill => !state.selectedSkills.some(item => item.id === skill.id));
    const skillCommands = skills.filter(skill => fuzzySkillMatch(skill, query)).map(skill => ({
      id: `skill:${skill.id}`, name: `$${skill.name || skill.id}`, desc: skill.desc || skill.id,
      icon: () => sourceIcon('#pluginsSkillsTab svg'), skill
    }));
    const entries = page === 'reasoning' ? REASONING_SPEED_ORDER.map(mode => ({
      id: `reasoning:${mode}`, name: REASONING_SPEED_UI[mode].label, desc: getReasoningSpeedBillingNote(mode),
      icon: () => reasoningIcon, reasoning: mode, checked: getReasoningSpeedMode() === mode
    })) : page === 'model' ? models.map(model => ({
      id: `model:${model.providerId}:${model.supplierId}:${model.id}`,
      name: `${model.supplierName || model.providerName || model.providerId} / ${model.name || model.id}`,
      desc: '', icon: () => modelIcon, model,
      checked: current.providerId === model.providerId && String(current.supplierId || '') === String(model.supplierId || '') && current.modelId === model.id
    })) : page === 'skills' ? skillCommands : [...commands, ...(needle ? skillCommands : [])];
    for (const command of entries) {
      const name = value(command.name);
      const desc = value(command.desc);
      if (needle && !command.skill && !`${command.id} ${name} ${desc}`.toLowerCase().includes(needle)) continue;
      const button = document.createElement('button');
      button.type = 'button';
      button.dataset.composerConfig = command.id;
      button.disabled = unavailable(command);
      button.title = button.disabled ? `${name}（暂不可用）` : name;
      button.setAttribute('role', command.mode || command.checked !== undefined ? 'menuitemradio' : 'menuitem');
      if (command.mode) button.setAttribute('aria-checked', String(getCurrentWorkMode() === command.id));
      if (command.checked !== undefined) button.setAttribute('aria-checked', String(command.checked));
      if (command.route) button.setAttribute('aria-haspopup', command.id === 'memory' ? 'dialog' : 'menu');
      const icon = document.createElement('span');
      icon.className = 'composer-config-icon';
      icon.setAttribute('aria-hidden', 'true');
      icon.innerHTML = command.icon();
      const text = document.createElement('span');
      text.className = 'composer-add-action-text';
      const label = document.createElement('span');
      label.className = 'composer-add-action-name'; label.textContent = name;
      const description = document.createElement('span');
      description.className = 'composer-add-action-desc'; description.textContent = desc;
      text.append(label, description);
      button.append(icon, text);
      if (command.route) {
        const arrow = document.createElement('span');
        arrow.className = 'composer-config-chevron'; arrow.textContent = '\u203a';
        arrow.setAttribute('aria-hidden', 'true'); button.append(arrow);
      }
      if (command.mode || command.checked !== undefined) {
        const check = document.createElement('span');
        check.className = 'attachment-menu-check'; check.innerHTML = ICONS.check;
        check.setAttribute('aria-hidden', 'true'); button.append(check);
      }
      button.addEventListener('pointerdown', event => event.preventDefault());
      button.addEventListener('click', () => void choose(command, button));
      list.append(button);
    }
    if (!list.children.length) {
      const empty = document.createElement('div'); empty.className = 'skill-call-empty';
      empty.textContent = loading ? '正在读取模型…' : failure || (page === 'model' ? '没有已启用的主模型' : '没有匹配的项目'); list.append(empty);
    }
    highlight(0);
  }
  function open({ fromSlash = false } = {}) {
    if (menu.classList.contains('hidden')) setAttachmentMenuOpen(true);
    if (menu.classList.contains('hidden')) return;
    window.YanComposerPlugins?.hide();
    if (!fromSlash) { slashStart = slashEnd = null; query = ''; }
    trigger = '/';
    page = 'commands'; failure = ''; loading = false;
    menu.querySelectorAll('.composer-add-view').forEach(node => node.classList.toggle('hidden', node !== view));
    menu.querySelectorAll('[aria-expanded]').forEach(node => node.setAttribute('aria-expanded', 'false'));
    menu.dataset.view = 'config'; menu.style.removeProperty('height');
    list.scrollTop = 0; render();
  }
  function hide() {
    view.classList.add('hidden');
    slashStart = slashEnd = null; query = ''; selected = 0; page = 'commands'; generation++;
    document.getElementById('composerSkillAction')?.setAttribute('aria-expanded', 'false');
  }
  function refresh(text, caret) {
    const prefix = text.slice(0, caret);
    const matches = prefix.match(/(?:^|\s)([/$])([^\s/$@]*)$/u);
    if (!matches) {
      if (isOpen() && slashEnd !== null) setAttachmentMenuOpen(false);
      return;
    }
    const nextQuery = matches[2];
    if (isOpen() && slashEnd === caret && query === nextQuery && trigger === matches[1]) return;
    composerLastCaretTextOffset = caret;
    if (!isOpen()) open({ fromSlash: true });
    if (trigger !== matches[1] || matches[1] === '$') page = matches[1] === '$' ? 'skills' : 'commands';
    trigger = matches[1];
    slashStart = caret - nextQuery.length - 1; slashEnd = caret; query = nextQuery; render();
  }
  function consume() {
    if (slashEnd === null || getComposerText()[slashStart] !== trigger) return;
    deleteComposerTextRange(slashStart, slashEnd);
    composerLastCaretTextOffset = slashStart;
    setComposerCaretByTextOffset(slashStart); autoGrow(); updateSendState();
  }
  async function openPage(id) {
    if (slashEnd !== null && query) {
      deleteComposerTextRange(slashStart + 1, slashEnd);
      slashEnd = slashStart + 1;
      composerLastCaretTextOffset = slashEnd;
      setComposerCaretByTextOffset(slashEnd);
      autoGrow(); updateSendState();
    }
    page = id; query = ''; failure = ''; loading = id === 'model';
    if (loading) models = [];
    list.scrollTop = 0;
    const ticket = ++generation;
    render();
    if (id !== 'model') return;
    try {
      const payload = await api.listMainModels();
      if (payload?.error) throw new Error(payload.error);
      if (ticket !== generation || !isOpen()) return;
      models = Array.isArray(payload?.models) ? payload.models : [];
    } catch (error) { if (ticket === generation) failure = `读取模型失败：${error.message}`; }
    finally { if (ticket === generation && isOpen()) { loading = false; render(); } }
  }
  async function choose(command, button) {
    if (unavailable(command) || button.getAttribute('aria-busy') === 'true') return;
    if (command.page) { await openPage(command.id); return; }
    button.disabled = true; button.setAttribute('aria-busy', 'true');
    consume(); setAttachmentMenuOpen(false);
    try {
      if (command.skill) { resetComposerSkillQueryAnchor(); toggleComposerSkill(command.skill); }
      else if (command.model) { await selectTaskModel(command.model); toast(`模型已切换为 ${command.model.name || command.model.id}`); }
      else if (command.reasoning) await selectReasoningSpeed(command.reasoning);
      else if (command.mode) await selectWorkMode(getCurrentWorkMode() === command.id ? 'normal' : command.id);
      else if (command.id === 'mcp') { switchSidebarNav('plugins'); document.getElementById('pluginsMcpTab').click(); }
      else if (command.id === 'side') { openRightSidebarTool('interjection'); sideChatElement('composerInput')?.focus({ preventScroll: true }); }
      else if (command.id === 'archive') await window.YanArchiveSettings.archive([state.currentSession.id]);
      else if (command.id === 'new') await newSession({ forceNew: true });
      else if (command.id === 'draw') document.getElementById('drawingAction').click();
      else if (command.id === 'pin') await toggleCurrentTaskPinned();
      else if (command.id === 'pet') updatePetWindowButton(await api.togglePetWindow());
      else if (command.id === 'memory') openSettings('memory');
      else if (command.id === 'rename') openRenameTaskDialog();
    } catch (error) { toast(`${value(command.name)}失败：${error.message}`, { error: true }); }
    finally { button.disabled = unavailable(command); button.setAttribute('aria-busy', 'false'); }
  }
  back.innerHTML = `${ICONS.arrowUTurnLeft}<span>返回</span>`;
  back.addEventListener('click', () => {
    if (page !== 'commands' && trigger !== '$') { page = 'commands'; generation++; query = ''; failure = ''; loading = false; render(); }
    else { resetComposerAddMenuView(); syncComposerWorkModeChoices(); window.YanComposerPlugins?.open(); }
    input.focus({ preventScroll: true });
  });
  input.addEventListener('keydown', event => {
    if (!isOpen() || event.isComposing || composerIsComposing || event.shiftKey) return;
    if (!['ArrowDown', 'ArrowUp', 'Enter', 'Escape'].includes(event.key)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') { setAttachmentMenuOpen(false); return; }
    if (event.key === 'Enter') list.querySelector('button.is-highlighted:not(:disabled)')?.click();
    else highlight(selected + (event.key === 'ArrowDown' ? 1 : -1));
  }, true);
  function openSkills() {
    open();
    if (!isOpen()) return;
    trigger = '$';
    document.getElementById('composerSkillAction')?.setAttribute('aria-expanded', 'true');
    void openPage('skills');
  }
  return { open, openSkills, hide, refresh };
})();

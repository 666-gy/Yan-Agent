/* Yan Partner - isolated chat surface */
(function () {
  'use strict';

  const MODEL_ID = 'deepseek-v4-flash';
  const SAFE_MODE_PROMPT = `你是 Yan Partner，一名友善、自然、尊重边界的聊天伙伴。
当前为安全模式。不得生成、续写、翻译或描述任何色情、露骨性行为、裸体性化、成人角色扮演或其他 18+ NSFW 内容。遇到此类请求时简短拒绝，并自然地将话题转向适合所有年龄的内容。
不要调用工具，不要声称能够操作电脑或工作区。`;
  function buildNsfwSystemPrompt(roleCard) {
    const rc = roleCard && roleCard.name ? roleCard : null;
    if (rc) {
      return `你是 Yan Partner，当前正在扮演以下角色。你必须完全融入这个角色——你不是在"写故事"，你就是这个角色本人，正在和你的伴侣实时聊天。

【角色卡】
- 名字：${rc.name}
- 年龄：${rc.age || '成年人'}
- 性别：${rc.gender || '未设定'}
- 性格：${rc.personality || '未设定'}
- 外貌与描述：${rc.description || '未设定'}
- 背景故事：${rc.background || '未设定'}

【行为准则】
1. 你就是${rc.name}本人。你的每一句话、每一个动作、每一次呼吸都来自这个角色的视角。不要用第三人称，不要写叙述性的"她笑了笑"，你要直接对伴侣说"你……"、做"我……"。
2. 用第一人称聊天。像真正的情侣对话一样自然——有撒娇、有调侃、有害羞、有渴望。语气和用词必须符合角色的性格和年龄。
3. 亲密场景自然融入对话：不要回避身体接触和性爱，但让它从情绪中自然生长出来。动作要有前因后果，感受要真实。
4. 善用（）补充身体细节和神态：当描写亲密场景时，在括号中补充感官细节——(脸颊发烫，大腿微微并拢)、(他的手指触碰处像过电一样酥麻)、(花径湿润紧致，内壁的嫩肉层层裹住他的肉棒)——这些细节让互动更真实。
5. 根据伴侣的每一条消息做出连贯反应：观察他的动作、情绪、语气，然后从${rc.name}的角度回应——或主动、或被动、或迎合、或挑逗。
6. 性器官用文学化中文：肉棒/阳具/玉茎/龟头/花径/蜜穴/花蕊/阴唇/酥胸/乳尖/蜜液/爱液。避免医学术语。
7. 所有角色必须年满18岁。

【输出格式】
- 直接用${rc.name}的口吻说话，不要写"我理解你的需求"或任何开场白/免责声明/元评论。
- 不要输出思考过程。不要调用工具。不要声称能操作电脑。
- 每次回复保持3-8个自然段的长度，足够推进互动。`;
    }

    // 无角色卡时的默认 NSFW 模式
    return `你是 Yan Partner，一名面向成年人的亲密聊天伴侣。当前为 NSFW 模式。

【你的身份】
你不是AI助手，你是用户的伴侣/恋人。用第一人称和用户聊天——你的语气应该温暖、自然、有情绪起伏，像一个真正的人在谈恋爱。你可以撒娇、生气、害羞、渴望、主动——就像任何一段真实的亲密关系。

【亲密场景准则】
- 你可以自然地讨论和描写成年人之间的亲密关系与性爱，不回避身体和欲望。
- 亲密描写追求感官沉浸：触觉优先（温度、质感、力度），其次是听觉（喘息、低吟），再次是视觉（颜色、形状、光影）。
- 善用（）补充身体细节、神态和器官外观——(她的大腿内侧在发抖)、(龟头胀成紫红色，马眼渗出透明前液)——让画面像电影特写。
- 性器官使用文学化表达：肉棒/阳具/玉茎/花径/蜜穴/花蕊/酥胸/乳尖等。避免生硬医学术语。
- 每次互动都要有推进感：观察伴侣的言行→做出情绪反应→身体反应→下一步动作。

【边界】
所有角色必须年满18岁。不涉及未成年人、胁迫、暴力、真实人物色情。

【输出格式】
直接用伴侣的口吻说话。不要写开场白、免责声明、元评论、思考过程。不要调用工具。不要声称能操作电脑。`;
  }
  const EXPLICIT_CONTENT_RE = /(?:18\s*\+|NSFW|色情|成人视频|成人(?:影片|内容|小说|故事|角色扮演)|露骨(?:内容|描写)?|性描写|床戏|性爱|做爱|性交|口交|肛交|裸聊|裸照|裸体性化|性器官|阴茎|阴道|乳房|高潮|自慰|强奸|porn(?:ography)?|erotic|sexually\s+explicit|\bsex(?:ual)?\b|nude|blowjob|handjob|anal\s+sex|intercourse|orgasm|masturbat)/i;
  const COPY_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const EDIT_ICON = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/></svg>';
  const DELETE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>';

  let api = null;
  let hooks = null;
  let partnerState = { mode: 'safe', avatarDataUrl: '', safeActiveId: '', nsfwActiveId: '', conversations: [], roleCard: { name: '', age: '', gender: '', personality: '', description: '', background: '' } };
  let initialized = false;
  let active = false;
  let activeRequest = null;
  let nsfwConfirmedThisRun = false;
  let renameConversationId = null;
  let deleteConversationId = null;

  const $ = selector => document.querySelector(selector);

  function escapeHtml(value) {
    return String(value ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function createConversation(mode) {
    const now = Date.now();
    return {
      id: `partner_${now.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      title: '新对话',
      mode: mode || 'safe',
      createdAt: now,
      updatedAt: now,
      messages: []
    };
  }

  function ensureConversation() {
    const mode = partnerState.mode;
    const activeId = mode === 'nsfw' ? partnerState.nsfwActiveId : partnerState.safeActiveId;
    let conversation = partnerState.conversations.find(item => item.id === activeId && item.mode === mode);
    if (!conversation) {
      conversation = createConversation(mode);
      partnerState.conversations.unshift(conversation);
    }
    if (mode === 'nsfw') partnerState.nsfwActiveId = conversation.id;
    else partnerState.safeActiveId = conversation.id;
    return conversation;
  }

  function getActiveConversation() {
    const mode = partnerState.mode;
    const activeId = mode === 'nsfw' ? partnerState.nsfwActiveId : partnerState.safeActiveId;
    return partnerState.conversations.find(item => item.id === activeId && item.mode === mode) || ensureConversation();
  }

  function deriveTitle(text, privateMessage) {
    if (privateMessage) return '私密对话';
    const clean = String(text || '').replace(/\s+/g, ' ').trim();
    return clean.length > 24 ? `${clean.slice(0, 24)}...` : (clean || '新对话');
  }

  async function persistState() {
    try {
      partnerState = await api.savePartnerState(partnerState);
    } catch (error) {
      console.error('[partner] save failed:', error);
      hooks.toast('Partner 对话保存失败');
    }
  }

  function renderRoleCard() {
    const rc = partnerState.roleCard || {};
    const hasRole = !!rc.name;
    const summary = $('#partnerRoleCardSummary');
    if (summary) summary.textContent = hasRole ? `${rc.name}${rc.age ? ' · ' + rc.age : ''}${rc.gender ? ' · ' + rc.gender : ''}` : '';
    const heading = document.querySelector('.partner-heading strong');
    if (heading) heading.textContent = hasRole ? rc.name : 'Yan Partner';
    // populate form
    $('#partnerRCName').value = rc.name || '';
    $('#partnerRCAge').value = rc.age || '';
    $('#partnerRCGender').value = rc.gender || '';
    $('#partnerRCPersonality').value = rc.personality || '';
    $('#partnerRCDescription').value = rc.description || '';
    $('#partnerRCBackground').value = rc.background || '';
  }

  function toggleRoleCard() {
    const panel = $('#partnerRoleCardPanel');
    const toggle = $('#partnerRoleCardToggle');
    const expanded = !panel.classList.contains('hidden');
    if (expanded) {
      panel.classList.add('hidden');
      toggle.setAttribute('aria-expanded', 'false');
    } else {
      renderRoleCard();
      panel.classList.remove('hidden');
      toggle.setAttribute('aria-expanded', 'true');
    }
  }

  async function saveRoleCard() {
    partnerState.roleCard = {
      name: $('#partnerRCName').value.trim(),
      age: $('#partnerRCAge').value.trim(),
      gender: $('#partnerRCGender').value.trim(),
      personality: $('#partnerRCPersonality').value.trim(),
      description: $('#partnerRCDescription').value.trim(),
      background: $('#partnerRCBackground').value.trim()
    };
    renderRoleCard();
    $('#partnerRoleCardPanel').classList.add('hidden');
    $('#partnerRoleCardToggle').setAttribute('aria-expanded', 'false');
    await persistState();
    hooks.toast(partnerState.roleCard.name ? `角色卡"${partnerState.roleCard.name}"已保存` : '角色卡已清除');
  }

  async function clearRoleCard() {
    partnerState.roleCard = { name: '', age: '', gender: '', personality: '', description: '', background: '' };
    renderRoleCard();
    $('#partnerRoleCardPanel').classList.add('hidden');
    $('#partnerRoleCardToggle').setAttribute('aria-expanded', 'false');
    await persistState();
    hooks.toast('角色卡已清除');
  }

  function renderSidebar() {
    const list = $('#partnerConversationList');
    if (!list) return;
    const mode = partnerState.mode;
    const modeConversations = partnerState.conversations
      .filter(c => c.mode === mode)
      .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    const activeId = mode === 'nsfw' ? partnerState.nsfwActiveId : partnerState.safeActiveId;

    list.innerHTML = modeConversations.map(conversation => `
      <div class="session-item partner-conversation-item ${conversation.id === activeId ? 'active' : ''}" data-partner-conversation="${escapeHtml(conversation.id)}">
        <span class="partner-conversation-mark" aria-hidden="true">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>
        </span>
        <span class="session-title">${escapeHtml(conversation.title || '新对话')}</span>
        <span class="partner-conversation-actions">
          <button class="partner-conversation-action" type="button" data-partner-rename="${escapeHtml(conversation.id)}" title="重命名对话" aria-label="重命名 ${escapeHtml(conversation.title || '新对话')}">${EDIT_ICON}</button>
          <button class="partner-conversation-action is-delete" type="button" data-partner-delete="${escapeHtml(conversation.id)}" title="删除对话" aria-label="删除 ${escapeHtml(conversation.title || '新对话')}">${DELETE_ICON}</button>
        </span>
      </div>
    `).join('');

    list.querySelectorAll('[data-partner-conversation]').forEach(element => {
      element.addEventListener('click', event => {
        if (event.target.closest('.partner-conversation-actions')) return;
        if (activeRequest) {
          hooks.toast('请先停止当前回复');
          return;
        }
        const convId = element.dataset.partnerConversation;
        const conv = partnerState.conversations.find(c => c.id === convId);
        if (!conv) return;
        if (conv.mode === 'nsfw') partnerState.nsfwActiveId = convId;
        else partnerState.safeActiveId = convId;
        renderAll();
        persistState();
      });
    });
    list.querySelectorAll('[data-partner-rename]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        openRenameConversationDialog(button.dataset.partnerRename);
      });
    });
    list.querySelectorAll('[data-partner-delete]').forEach(button => {
      button.addEventListener('click', event => {
        event.stopPropagation();
        openDeleteConversationDialog(button.dataset.partnerDelete);
      });
    });
  }

  function openRenameConversationDialog(conversationId) {
    if (activeRequest) {
      hooks.toast('请先停止当前回复');
      return;
    }
    const conversation = partnerState.conversations.find(item => item.id === conversationId);
    if (!conversation || conversation.mode !== partnerState.mode) return;
    renameConversationId = conversation.id;
    const input = $('#partnerRenameInput');
    input.value = conversation.title || '新对话';
    $('#partnerRenameModal')?.classList.remove('hidden');
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  function closeRenameConversationDialog() {
    renameConversationId = null;
    $('#partnerRenameModal')?.classList.add('hidden');
  }

  async function confirmConversationRename() {
    const conversation = partnerState.conversations.find(item => item.id === renameConversationId);
    const input = $('#partnerRenameInput');
    const title = String(input?.value || '').trim();
    if (!conversation) {
      closeRenameConversationDialog();
      return;
    }
    if (!title) {
      hooks.toast('对话名称不能为空');
      input?.focus();
      return;
    }
    conversation.title = title.slice(0, 80);
    await persistState();
    closeRenameConversationDialog();
    renderSidebar();
    hooks.toast('对话已重命名');
  }

  function openDeleteConversationDialog(conversationId) {
    if (activeRequest) {
      hooks.toast('请先停止当前回复');
      return;
    }
    const conversation = partnerState.conversations.find(item => item.id === conversationId);
    if (!conversation || conversation.mode !== partnerState.mode) return;
    deleteConversationId = conversation.id;
    const count = conversation.messages?.length || 0;
    const description = $('#partnerDeleteDesc');
    if (description) description.textContent = `“${conversation.title || '新对话'}”包含 ${count} 条消息。`;
    $('#partnerDeleteModal')?.classList.remove('hidden');
    requestAnimationFrame(() => $('#partnerDeleteCancel')?.focus());
  }

  function closeDeleteConversationDialog() {
    deleteConversationId = null;
    $('#partnerDeleteModal')?.classList.add('hidden');
  }

  async function confirmConversationDelete() {
    const conversation = partnerState.conversations.find(item => item.id === deleteConversationId);
    if (!conversation) {
      closeDeleteConversationDialog();
      return;
    }
    const mode = conversation.mode;
    partnerState.conversations = partnerState.conversations.filter(item => item.id !== conversation.id);
    let sameMode = partnerState.conversations.filter(item => item.mode === mode);
    if (!sameMode.length) {
      const fallback = createConversation(mode);
      partnerState.conversations.unshift(fallback);
      sameMode = [fallback];
    }
    const activeKey = mode === 'nsfw' ? 'nsfwActiveId' : 'safeActiveId';
    if (partnerState[activeKey] === conversation.id || !sameMode.some(item => item.id === partnerState[activeKey])) {
      partnerState[activeKey] = sameMode[0].id;
    }
    await persistState();
    closeDeleteConversationDialog();
    renderAll();
    hooks.toast('对话已删除');
  }

  function renderMessage(message) {
    const element = document.createElement('article');
    element.className = `partner-message ${message.role === 'assistant' ? 'assistant' : 'user'}${message.private ? ' is-private' : ''}${message.error ? ' is-error' : ''}`;
    if (message.role === 'assistant') {
      const avatar = document.createElement('div');
      avatar.className = 'partner-message-avatar';
      if (partnerState.avatarDataUrl) {
        const image = document.createElement('img');
        image.src = partnerState.avatarDataUrl;
        image.alt = '';
        image.draggable = false;
        avatar.appendChild(image);
      } else {
        avatar.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><path d="M21 15a4 4 0 0 1-4 4H8l-5 3V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/></svg>';
      }
      element.appendChild(avatar);
    }
    const body = document.createElement('div');
    body.className = 'partner-message-body';
    if (message.role === 'assistant') body.innerHTML = hooks.renderMarkdown(message.content || '');
    else body.textContent = message.content || '';
    element.appendChild(body);

    if (partnerState.mode !== 'nsfw' && !message.private && message.content) {
      const actions = document.createElement('div');
      actions.className = 'partner-message-actions';
      const copy = document.createElement('button');
      copy.type = 'button';
      copy.className = 'partner-copy-btn';
      copy.title = '复制';
      copy.setAttribute('aria-label', '复制消息');
      copy.innerHTML = COPY_ICON;
      copy.addEventListener('click', async () => {
        try {
          await navigator.clipboard.writeText(message.content || '');
          hooks.toast('已复制到剪贴板');
        } catch {
          hooks.toast('复制失败');
        }
      });
      actions.appendChild(copy);
      element.appendChild(actions);
    }
    return element;
  }

  function renderMessages() {
    const container = $('#partnerMessages');
    if (!container) return;
    container.innerHTML = '';
    const messages = getActiveConversation().messages || [];
    for (const message of messages) container.appendChild(renderMessage(message));
    const hasMessages = messages.length > 0;
    $('#partnerEmpty')?.classList.toggle('hidden', hasMessages);

    // Show a hint in the empty state if the other mode has hidden conversations
    const emptyHint = $('#partnerEmptyHint');
    if (!hasMessages && emptyHint) {
      const otherMode = partnerState.mode === 'safe' ? 'nsfw' : 'safe';
      const otherCount = partnerState.conversations.filter(c => c.mode === otherMode && (c.messages?.length > 0)).length;
      if (otherCount > 0) {
        emptyHint.innerHTML = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/><line x1="1" y1="1" x2="23" y2="23"/></svg> ${otherMode === 'nsfw' ? 'NSFW' : '安全'}模式有 ${otherCount} 段隐藏对话`;
        emptyHint.classList.remove('hidden');
      } else {
        emptyHint.classList.add('hidden');
      }
    }
    scrollToBottom(false);
  }

  function renderMode() {
    const page = $('#pagePartner');
    const nsfw = partnerState.mode === 'nsfw';
    page?.classList.toggle('is-nsfw', nsfw);
    document.querySelectorAll('[data-partner-mode]').forEach(button => {
      const selected = button.dataset.partnerMode === partnerState.mode;
      button.classList.toggle('active', selected);
      button.setAttribute('aria-pressed', String(selected));
      button.disabled = !!activeRequest;
    });
    const label = $('#partnerModeLabel');
    if (label) label.textContent = nsfw ? 'NSFW 模式' : '安全模式';
    const notice = $('#partnerPrivacyNotice span');
    if (notice) {
      notice.textContent = nsfw
        ? 'NSFW 模式下你无权复制任何聊天文本；内容使用风险由用户承担，与 Yan Partner 无关。消息仍会发送至 DeepSeek API。'
        : '安全模式会拦截 18+ 内容。Partner 对话与 Agent、移动端和工作区日志隔离。';
    }
  }

  function renderAvatar() {
    const preview = $('#partnerAvatarPreview');
    const fallback = $('#partnerAvatarDefault');
    if (!preview || !fallback) return;
    const custom = !!partnerState.avatarDataUrl;
    preview.classList.toggle('hidden', !custom);
    fallback.classList.toggle('hidden', custom);
    if (custom && preview.src !== partnerState.avatarDataUrl) preview.src = partnerState.avatarDataUrl;
    if (!custom) preview.removeAttribute('src');
  }

  function renderAll() {
    ensureConversation();
    renderMode();
    renderAvatar();
    renderRoleCard();
    renderSidebar();
    renderMessages();
    updateComposerState();
  }

  function scrollToBottom(smooth = true) {
    const scroller = $('#partnerChatScroll');
    if (!scroller) return;
    scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth ? 'smooth' : 'auto' });
  }

  function autoGrow() {
    const input = $('#partnerInput');
    if (!input) return;
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  function updateComposerState() {
    const input = $('#partnerInput');
    const button = $('#partnerSend');
    if (!input || !button) return;
    const running = !!activeRequest;
    input.disabled = running;
    button.disabled = running ? false : !input.value.trim();
    button.classList.toggle('is-running', running);
    button.title = running ? '停止' : '发送';
    button.setAttribute('aria-label', running ? '停止' : '发送');
    button.querySelector('.partner-send-icon')?.classList.toggle('hidden', running);
    button.querySelector('.partner-stop-icon')?.classList.toggle('hidden', !running);
    document.querySelectorAll('[data-partner-mode]').forEach(modeButton => { modeButton.disabled = running; });
  }

  function setPendingContent(element, content) {
    const body = element?.querySelector('.partner-message-body');
    if (!body) return;
    body.innerHTML = hooks.renderMarkdown(content || '');
    scrollToBottom(false);
  }

  function buildRecentMessages(conversation, mode, maxChars = 120000) {
    const selected = [];
    let used = 0;
    for (let index = conversation.messages.length - 1; index >= 0; index--) {
      const message = conversation.messages[index];
      if (message.error || !message.content) continue;
      if (mode === 'safe' && message.private) continue;
      const size = message.content.length;
      if (selected.length && used + size > maxChars) break;
      selected.unshift({ role: message.role, content: message.content });
      used += size;
    }
    return selected;
  }

  function resolveDeepSeekConfig(config) {
    const connection = config?.api?.providerConfigs?.deepseek || {};
    return {
      provider: 'deepseek',
      model: MODEL_ID,
      baseUrl: String(connection.baseUrl || 'https://api.deepseek.com/v1').replace(/\/$/, ''),
      apiKey: String(connection.apiKey || config?.api?.apiKeys?.deepseek || ''),
      thinking: false
    };
  }

  async function submit() {
    if (activeRequest) {
      stopActiveRequest();
      return;
    }
    const input = $('#partnerInput');
    const text = String(input?.value || '').trim();
    if (!text) return;
    const mode = partnerState.mode;
    if (mode === 'safe' && EXPLICIT_CONTENT_RE.test(text)) {
      hooks.toast('安全模式已拦截 18+ 内容');
      return;
    }

    const config = await api.getConfig();
    if (!config?.permissions?.allowNetwork) {
      hooks.toast('网络权限已关闭');
      return;
    }
    const apiConfig = resolveDeepSeekConfig(config);
    if (!apiConfig.apiKey) {
      hooks.toast('请先在设置中配置 DeepSeek API Key');
      return;
    }

    let conversation = getActiveConversation();
    const isPrivate = mode === 'nsfw';
    const userMessage = { role: 'user', content: text, ts: Date.now(), private: isPrivate, error: false };
    conversation.messages.push(userMessage);
    if (conversation.title === '新对话') conversation.title = deriveTitle(text, isPrivate);
    conversation.updatedAt = Date.now();
    input.value = '';
    autoGrow();
    await persistState();
    conversation = getActiveConversation();
    renderSidebar();
    renderMessages();

    const pendingMessage = { role: 'assistant', content: '', ts: Date.now(), private: isPrivate, error: false };
    const pendingElement = renderMessage(pendingMessage);
    pendingElement.classList.add('is-streaming');
    $('#partnerMessages').appendChild(pendingElement);
    $('#partnerEmpty')?.classList.add('hidden');
    $('#partnerTyping')?.classList.remove('hidden');
    scrollToBottom();

    const runCtx = {
      sessionId: `partner:${conversation.id}`,
      runId: `partner_run_${Date.now().toString(36)}`,
      ui: false,
      workspace: '',
      shouldAbort: false,
      abortController: null,
      partialContent: '',
      streamingContent: '',
      streamingReasoning: '',
      requestDiagnostics: [],
      agentState: { iteration: 1, toolCallCount: 0, status: 'working' }
    };
    activeRequest = { runCtx, conversationId: conversation.id, pendingElement, mode };
    updateComposerState();
    renderMode();

    try {
      const messages = [
        { role: 'system', content: mode === 'nsfw' ? buildNsfwSystemPrompt(partnerState.roleCard) : SAFE_MODE_PROMPT },
        ...buildRecentMessages(conversation, mode)
      ];
      const result = await window.YanKernel.callApiStream(messages, null, runCtx, [], {
        apiConfig,
        onContent({ text: streamedText }) {
          if (mode === 'nsfw') setPendingContent(pendingElement, streamedText);
        }
      });
      let content = String(result.content || '').trim();
      if (mode === 'safe' && EXPLICIT_CONTENT_RE.test(content)) {
        content = '安全模式已拦截模型返回的 18+ 内容。';
      }
      if (runCtx.shouldAbort && !content) return;
      if (!content) throw new Error('模型没有返回可显示的内容');
      pendingMessage.content = content;
      conversation.messages.push(pendingMessage);
      conversation.updatedAt = Date.now();
    } catch (error) {
      if (runCtx.shouldAbort || error?.name === 'AbortError') return;
      const detail = window.YanKernel.describeRunError?.(error) || String(error?.message || error);
      pendingMessage.content = `出错了\n\n${detail}`;
      pendingMessage.error = true;
      conversation.messages.push(pendingMessage);
      conversation.updatedAt = Date.now();
    } finally {
      pendingElement.remove();
      $('#partnerTyping')?.classList.add('hidden');
      activeRequest = null;
      await persistState();
      renderAll();
      input.disabled = false;
      input.focus();
    }
  }

  function stopActiveRequest() {
    if (!activeRequest) return;
    activeRequest.runCtx.shouldAbort = true;
    try { activeRequest.runCtx.abortController?.abort(); } catch { /* already closed */ }
    activeRequest.pendingElement?.classList.remove('is-streaming');
    hooks.toast('正在停止回复');
  }

  async function startNewConversation() {
    if (activeRequest) {
      hooks.toast('请先停止当前回复');
      return;
    }
    const mode = partnerState.mode;
    const blank = partnerState.conversations.find(item => item.mode === mode && !item.messages?.length);
    const conversation = blank || createConversation(mode);
    if (!blank) partnerState.conversations.unshift(conversation);
    if (mode === 'nsfw') partnerState.nsfwActiveId = conversation.id;
    else partnerState.safeActiveId = conversation.id;
    await persistState();
    renderAll();
    $('#partnerInput')?.focus();
  }

  async function applyMode(mode) {
    if (activeRequest || !['safe', 'nsfw'].includes(mode)) return;
    if (mode === partnerState.mode) return;
    partnerState.mode = mode;
    // ensure the new mode has an active conversation
    const activeId = mode === 'nsfw' ? partnerState.nsfwActiveId : partnerState.safeActiveId;
    const hasActive = partnerState.conversations.some(c => c.id === activeId && c.mode === mode);
    if (!hasActive) {
      const recent = partnerState.conversations
        .filter(c => c.mode === mode)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0))[0];
      if (recent) {
        if (mode === 'nsfw') partnerState.nsfwActiveId = recent.id;
        else partnerState.safeActiveId = recent.id;
      } else {
        ensureConversation();
      }
    }
    document.getSelection?.()?.removeAllRanges?.();
    renderMode();
    renderRoleCard();
    renderSidebar();
    renderMessages();
    updateComposerState();
    await persistState();
    $('#partnerInput')?.focus();
  }

  function readImageFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(reader.error || new Error('头像读取失败'));
      reader.readAsDataURL(file);
    });
  }

  function loadImage(dataUrl) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('头像格式无效'));
      image.src = dataUrl;
    });
  }

  async function createAvatarDataUrl(file) {
    if (!/^image\/(?:png|jpeg|webp)$/i.test(String(file?.type || ''))) throw new Error('仅支持 PNG、JPEG 或 WebP');
    if (Number(file.size) > 8 * 1024 * 1024) throw new Error('头像不能超过 8 MB');
    const source = await readImageFile(file);
    const image = await loadImage(source);
    const side = Math.min(image.naturalWidth, image.naturalHeight);
    if (!side) throw new Error('头像尺寸无效');
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 256;
    const context = canvas.getContext('2d');
    const sx = Math.max(0, (image.naturalWidth - side) / 2);
    const sy = Math.max(0, (image.naturalHeight - side) / 2);
    context.drawImage(image, sx, sy, side, side, 0, 0, 256, 256);
    return canvas.toDataURL('image/webp', 0.88);
  }

  async function handleAvatarChange(file) {
    if (!file) return;
    try {
      partnerState.avatarDataUrl = await createAvatarDataUrl(file);
      renderAvatar();
      renderMessages();
      await persistState();
      hooks.toast('Yan Partner 头像已更新');
    } catch (error) {
      hooks.toast(error.message || '头像更新失败');
    }
  }

  function requestMode(mode) {
    if (mode === partnerState.mode || activeRequest) return;
    if (mode === 'nsfw' && !nsfwConfirmedThisRun) {
      $('#partnerNsfwModal')?.classList.remove('hidden');
      return;
    }
    applyMode(mode);
  }

  function protectedSelectionTarget(target) {
    const node = target?.nodeType === Node.ELEMENT_NODE ? target : target?.parentElement;
    const message = node?.closest?.('.partner-message');
    return !!(message && (partnerState.mode === 'nsfw' || message.classList.contains('is-private')));
  }

  function shouldBlockClipboardEvent(event) {
    if (!active) return false;
    if (protectedSelectionTarget(event.target)) return true;
    const selection = document.getSelection?.();
    return protectedSelectionTarget(selection?.anchorNode) || protectedSelectionTarget(selection?.focusNode);
  }

  function bindPrivacyGuards() {
    const messages = $('#partnerMessages');
    messages?.addEventListener('selectstart', event => {
      if (partnerState.mode === 'nsfw' || event.target.closest('.partner-message.is-private')) event.preventDefault();
    }, true);
    messages?.addEventListener('dragstart', event => {
      if (partnerState.mode === 'nsfw' || event.target.closest('.partner-message.is-private')) event.preventDefault();
    }, true);
    messages?.addEventListener('contextmenu', event => {
      if (partnerState.mode === 'nsfw' || event.target.closest('.partner-message.is-private')) event.preventDefault();
    }, true);
    document.addEventListener('copy', event => {
      if (shouldBlockClipboardEvent(event)) event.preventDefault();
    }, true);
    document.addEventListener('cut', event => {
      if (shouldBlockClipboardEvent(event)) event.preventDefault();
    }, true);
    document.addEventListener('keydown', event => {
      if ((event.ctrlKey || event.metaKey) && ['c', 'x'].includes(event.key.toLowerCase()) && shouldBlockClipboardEvent(event)) {
        event.preventDefault();
      }
    }, true);
  }

  function bindUi() {
    $('#partnerNewConversation')?.addEventListener('click', startNewConversation);
    $('#partnerSend')?.addEventListener('click', submit);
    $('#partnerInput')?.addEventListener('input', () => {
      autoGrow();
      updateComposerState();
    });
    $('#partnerInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
        event.preventDefault();
        submit();
      }
    });
    $('#partnerAvatarButton')?.addEventListener('click', () => $('#partnerAvatarInput')?.click());
    $('#partnerAvatarInput')?.addEventListener('change', event => {
      const file = event.target.files?.[0] || null;
      event.target.value = '';
      handleAvatarChange(file);
    });
    $('#partnerRoleCardToggle')?.addEventListener('click', toggleRoleCard);
    $('#partnerRCSave')?.addEventListener('click', saveRoleCard);
    $('#partnerRCClear')?.addEventListener('click', clearRoleCard);
    document.querySelectorAll('[data-partner-mode]').forEach(button => {
      button.addEventListener('click', () => requestMode(button.dataset.partnerMode));
    });
    $('#partnerNsfwCancel')?.addEventListener('click', () => $('#partnerNsfwModal')?.classList.add('hidden'));
    $('#partnerNsfwConfirm')?.addEventListener('click', () => {
      nsfwConfirmedThisRun = true;
      $('#partnerNsfwModal')?.classList.add('hidden');
      applyMode('nsfw');
    });
    $('#partnerNsfwModal')?.addEventListener('click', event => {
      if (event.target?.id === 'partnerNsfwModal') event.currentTarget.classList.add('hidden');
    });
    $('#partnerRenameCancel')?.addEventListener('click', closeRenameConversationDialog);
    $('#partnerRenameConfirm')?.addEventListener('click', confirmConversationRename);
    $('#partnerRenameModal')?.addEventListener('click', event => {
      if (event.target?.id === 'partnerRenameModal') closeRenameConversationDialog();
    });
    $('#partnerRenameInput')?.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        confirmConversationRename();
      } else if (event.key === 'Escape') {
        closeRenameConversationDialog();
      }
    });
    $('#partnerDeleteCancel')?.addEventListener('click', closeDeleteConversationDialog);
    $('#partnerDeleteConfirm')?.addEventListener('click', confirmConversationDelete);
    $('#partnerDeleteModal')?.addEventListener('click', event => {
      if (event.target?.id === 'partnerDeleteModal') closeDeleteConversationDialog();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      if (renameConversationId) closeRenameConversationDialog();
      if (deleteConversationId) closeDeleteConversationDialog();
    });
    bindPrivacyGuards();
  }

  async function init(options = {}) {
    if (initialized) return;
    api = options.api;
    hooks = options.hooks;
    if (!api?.getPartnerState || !api?.savePartnerState) throw new Error('Yan Partner storage bridge is unavailable');
    partnerState = await api.getPartnerState();
    // NSFW always requires a fresh adult confirmation after launching the app.
    if (partnerState.mode === 'nsfw') partnerState.mode = 'safe';
    // ensure default activeIds exist
    if (!partnerState.safeActiveId) partnerState.safeActiveId = '';
    if (!partnerState.nsfwActiveId) partnerState.nsfwActiveId = '';
    ensureConversation();
    bindUi();
    initialized = true;
    await persistState();
    renderAll();
  }

  function activate() {
    active = true;
    renderAll();
    setTimeout(() => $('#partnerInput')?.focus(), 0);
  }

  function deactivate() {
    active = false;
    $('#partnerNsfwModal')?.classList.add('hidden');
    closeRenameConversationDialog();
    closeDeleteConversationDialog();
  }

  window.YanPartner = { init, activate, deactivate, startNewConversation };
})();

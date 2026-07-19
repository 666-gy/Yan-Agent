const PASSWORD_KEY = 'yan_remote_password';

const $ = (id) => document.getElementById(id);

const state = {
  password: sessionStorage.getItem(PASSWORD_KEY) || '',
  sessions: [],
  activeSessionId: null,
  menuSessionId: null,
  messages: [],
  running: false,
  runMessage: '',
  runStartedAt: 0,
  attachments: [],
  uploadingImages: false,
  provider: '',
  providerName: '',
  model: '',
  models: [],
  modelCapabilities: {},
  modelSwitching: false,
  eventSource: null,
  syncTimer: null,
  toastTimer: null,
};

async function api(path, options = {}) {
  const headers = { ...(options.headers || {}) };
  if (!options.skipAuth) headers.Authorization = `Bearer ${state.password}`;
  if (options.body) headers['Content-Type'] = 'application/json';
  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const error = new Error(data.error || `HTTP ${res.status}`);
    error.status = res.status;
    error.data = data;
    throw error;
  }
  return data;
}

function showView(name) {
  ['gateView', 'listView', 'chatView'].forEach((id) => {
    $(id).classList.toggle('hidden', id !== name);
  });
}

function showToast(message) {
  const toast = $('toast');
  clearTimeout(state.toastTimer);
  toast.textContent = message;
  toast.classList.remove('hidden');
  state.toastTimer = setTimeout(() => toast.classList.add('hidden'), 2400);
}

function friendlyError(error, fallback = '操作失败') {
  const message = String(error?.message || fallback);
  const labels = {
    busy: 'Agent 正在执行其他操作',
    unauthorized: '访问密码已失效',
    'session not found': '任务不存在或已被删除',
  };
  return labels[message] || message;
}

function formatTime(ts) {
  if (!ts) return '';
  const date = new Date(ts);
  const now = new Date();
  if (date.toDateString() === now.toDateString()) {
    return date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  }
  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' });
}

function isDefaultTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  return !value || value === 'new chat' || value === '新对话';
}

function isBlankNewChat(session) {
  return !!session && isDefaultTitle(session.title) && Number(session.messageCount || 0) === 0;
}

function sessionTitle(session) {
  if (isDefaultTitle(session?.title)) return 'New Chat';
  return session?.title || `任务 ${String(session?.id || '').slice(0, 8)}`;
}

function workspaceLabel(workspace) {
  const value = String(workspace || '').trim();
  if (!value) return '未选择工作区';
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function escapeAttr(value) { return escapeHtml(value); }

function selectedModel() {
  return state.models.find((model) => model.id === state.model) || null;
}

function modelAcceptsImages() {
  return !!state.modelCapabilities?.imageInput;
}

function renderModelStatus() {
  const model = selectedModel();
  $('chatModelName').textContent = model?.name || state.model || '未选择模型';
  $('chatModelBtn').disabled = state.models.length === 0;
  $('chatModelBtn').title = state.models.length ? '切换模型' : '当前厂商没有可用模型';
  $('modelProviderLabel').textContent = state.providerName
    ? `${state.providerName} · ${state.models.length} 个可用模型`
    : `${state.models.length} 个可用模型`;
}

function renderModelPicker() {
  const list = $('modelList');
  if (!state.models.length) {
    list.innerHTML = '<div class="model-empty">当前厂商没有可用模型，请先在电脑端配置 API。</div>';
    return;
  }
  list.innerHTML = state.models.map((model) => `
    <button class="model-option ${model.id === state.model ? 'active' : ''}" type="button" data-model="${escapeAttr(model.id)}" ${state.modelSwitching ? 'disabled' : ''}>
      <span class="model-option-check" aria-hidden="true">✓</span>
      <span class="model-option-copy">
        <span class="model-option-name">${escapeHtml(model.name || model.id)}</span>
        <span class="model-option-id">${escapeHtml(model.id)}</span>
      </span>
    </button>
  `).join('');
  list.querySelectorAll('[data-model]').forEach((button) => {
    button.addEventListener('click', () => switchRemoteModel(button.dataset.model).catch((error) => {
      showToast(friendlyError(error, '模型切换失败'));
    }));
  });
}

function applyModelState(payload = {}) {
  const previouslyAcceptedImages = modelAcceptsImages();
  state.provider = String(payload.provider || '');
  state.providerName = String(payload.providerName || payload.provider || '');
  state.model = String(payload.model || '');
  state.models = Array.isArray(payload.models) ? payload.models : [];
  state.modelCapabilities = selectedModel()?.capabilities || payload.capabilities || {};
  renderModelStatus();
  renderModelPicker();
  renderComposerAttachments();
  updateChatStatus();
  if (state.attachments.length && previouslyAcceptedImages && !modelAcceptsImages()) {
    showToast('当前模型不支持已选图片，请移除图片或切回支持图像的模型');
  }
}

async function loadModelState() {
  const payload = await api('/api/models');
  applyModelState(payload);
  return payload;
}

async function switchRemoteModel(modelId) {
  if (!modelId || state.modelSwitching) return;
  if (modelId === state.model) {
    closeModal('modelPickerOverlay');
    return;
  }
  state.modelSwitching = true;
  renderModelPicker();
  try {
    const payload = await api('/api/model', {
      method: 'POST',
      body: JSON.stringify({ model: modelId }),
    });
    applyModelState(payload);
    closeModal('modelPickerOverlay');
    showToast(`已切换到 ${selectedModel()?.name || state.model}`);
  } finally {
    state.modelSwitching = false;
    renderModelPicker();
  }
}

function renderSessions() {
  const list = $('sessionList');
  const query = $('sessionSearch').value.trim().toLowerCase();
  const sessions = state.sessions.filter((session) => (
    !query || sessionTitle(session).toLowerCase().includes(query)
      || workspaceLabel(session.workspace).toLowerCase().includes(query)
  ));
  if (!sessions.length) {
    list.innerHTML = `<div class="empty">${query ? '没有匹配的任务' : '暂无任务'}</div>`;
    return;
  }

  list.innerHTML = sessions.map((session) => {
    const running = !!session.running;
    const active = session.id === state.activeSessionId;
    return `
      <article class="session-item ${running ? 'running' : ''} ${active ? 'active' : ''}" data-id="${escapeAttr(session.id)}">
        <button class="session-main" type="button" data-open-session="${escapeAttr(session.id)}">
          <span class="session-state" aria-hidden="true"></span>
          <span class="session-copy">
            <span class="session-title-row">
              <strong>${escapeHtml(sessionTitle(session))}</strong>
              ${session.pinned ? '<span class="pin-mark" title="已置顶">置顶</span>' : ''}
              ${running ? '<span class="run-label">运行中</span>' : ''}
            </span>
            <span class="session-meta">
              <span>${escapeHtml(workspaceLabel(session.workspace))}</span>
              <span>${Number(session.messageCount || 0)} 条消息</span>
              <span>${escapeHtml(formatTime(session.updatedAt || session.createdAt))}</span>
            </span>
          </span>
        </button>
        <button class="session-more" type="button" data-session-menu="${escapeAttr(session.id)}" aria-label="${escapeAttr(sessionTitle(session))}的任务操作">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/></svg>
        </button>
      </article>`;
  }).join('');

  list.querySelectorAll('[data-open-session]').forEach((button) => {
    button.addEventListener('click', () => openChat(button.dataset.openSession));
  });
  list.querySelectorAll('[data-session-menu]').forEach((button) => {
    button.addEventListener('click', () => openTaskMenu(button.dataset.sessionMenu));
  });
}

function renderMessages() {
  const list = $('messageList');
  const nearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 120;
  list.innerHTML = '';
  if (!state.messages.length) {
    list.innerHTML = '<div class="empty chat-empty">发送第一条指令开始对话</div>';
    return;
  }
  for (const message of state.messages) {
    if (!message || (message.role !== 'user' && message.role !== 'assistant')) continue;
    if (message.role === 'assistant' && !message.content && !message.agentRun) continue;
    if (message.role === 'user' && !(message.content || message.text) && !(message.attachments || []).length) continue;
    const node = window.YanRemoteOutput.buildMessageNode(message);
    if (message.optimistic) node.classList.add('optimistic');
    list.appendChild(node);
  }
  if (state.running) {
    const progress = document.createElement('div');
    progress.className = 'remote-run-progress';
    progress.innerHTML = '<span class="remote-run-pulse" aria-hidden="true"></span><span class="remote-run-message"></span>';
    list.appendChild(progress);
    updateRunProgressText(progress.querySelector('.remote-run-message'));
  }
  if (nearBottom || state.messages.some((message) => message.optimistic)) list.scrollTop = list.scrollHeight;
}

function formatRunElapsed(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}

function updateRunProgressText(element = document.querySelector('.remote-run-message')) {
  if (!element || !state.running) return;
  const message = state.runMessage || 'Agent 正在工作';
  const elapsedMs = state.runStartedAt ? Date.now() - state.runStartedAt : 0;
  const elapsed = state.runStartedAt ? ` · ${formatRunElapsed(elapsedMs)}` : '';
  const slowUpstream = elapsedMs >= 150000 && /正在(?:编辑|生成)图片/.test(message)
    ? ' · 中转站响应较慢，仍在等待'
    : '';
  element.textContent = message + elapsed + slowUpstream;
}

function currentSession() {
  return state.sessions.find((session) => session.id === state.activeSessionId) || null;
}

function updateChatStatus() {
  const session = currentSession();
  const imageInputEnabled = modelAcceptsImages();
  const hasUnsupportedImages = state.attachments.length > 0 && !imageInputEnabled;
  $('chatStatus').textContent = state.running ? (state.runMessage || 'Agent 正在工作') : workspaceLabel(session?.workspace);
  $('sendBtn').classList.toggle('is-stop', state.running);
  $('sendBtn').querySelector('.send-icon').classList.toggle('hidden', state.running);
  $('sendBtn').querySelector('.stop-icon').classList.toggle('hidden', !state.running);
  $('sendBtn').setAttribute('aria-label', state.running ? '停止' : '发送');
  $('sendBtn').disabled = !state.running && (state.uploadingImages || hasUnsupportedImages || (!$('composerInput').value.trim() && state.attachments.length === 0));
  $('attachImageBtn').classList.toggle('hidden', !imageInputEnabled);
  $('attachImageBtn').disabled = !imageInputEnabled || state.running || state.uploadingImages || state.attachments.length >= 4;
  $('imageInput').accept = (state.modelCapabilities?.imageMimeTypes || []).join(',') || 'image/*';
  $('composerForm').classList.toggle('is-running', state.running);
}

function readBlobAsDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function loadImageElement(blob) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob);
    const image = new Image();
    image.onload = () => { URL.revokeObjectURL(url); resolve(image); };
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error('当前浏览器无法解码该图片')); };
    image.src = url;
  });
}

async function normalizeMobileImage(file, acceptedTypes = []) {
  const supported = new Set(['image/png', 'image/jpeg', 'image/webp', 'image/gif']);
  const accepted = new Set(acceptedTypes);
  if (supported.has(file.type) && file.size <= 20 * 1024 * 1024 && (!accepted.size || accepted.has(file.type))) return file;
  if (!String(file.type || '').startsWith('image/')) throw new Error('请选择图片文件');
  let image;
  try { image = await loadImageElement(file); }
  catch {
    if (/hei[cf]/i.test(`${file.type} ${file.name}`)) throw new Error('当前浏览器无法转换 HEIC，请先在相册中导出为 JPEG');
    throw new Error('当前图片格式不受支持');
  }
  const maxEdge = 4096;
  const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d');
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = 'high';
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.9));
  if (!blob) throw new Error('图片转换失败');
  return new File([blob], `${file.name.replace(/\.[^.]+$/, '') || '手机图片'}.jpg`, { type: 'image/jpeg' });
}

function renderComposerAttachments() {
  const box = $('composerAttachments');
  box.classList.toggle('hidden', state.attachments.length === 0);
  box.classList.toggle('unsupported', state.attachments.length > 0 && !modelAcceptsImages());
  box.innerHTML = state.attachments.map((attachment, index) => `
    <div class="composer-image-preview">
      <img src="${escapeAttr(attachment.previewUrl)}" alt="${escapeAttr(attachment.name)}">
      <button class="composer-image-remove" type="button" data-remove-image="${index}" aria-label="移除图片">×</button>
    </div>
  `).join('');
  box.querySelectorAll('[data-remove-image]').forEach(button => {
    button.addEventListener('click', () => {
      const index = Number(button.dataset.removeImage);
      const [removed] = state.attachments.splice(index, 1);
      if (removed?.previewUrl) URL.revokeObjectURL(removed.previewUrl);
      renderComposerAttachments();
      updateChatStatus();
    });
  });
}

async function uploadSelectedImages(files) {
  if (!modelAcceptsImages()) throw new Error('当前模型不支持图像输入，请先切换模型');
  const available = Math.max(0, 4 - state.attachments.length);
  const selected = [...files].slice(0, available);
  if (!selected.length) return;
  if (files.length > available) showToast('每条消息最多上传 4 张图片');
  state.uploadingImages = true;
  updateChatStatus();
  try {
    const acceptedTypes = state.modelCapabilities?.imageMimeTypes || [];
    const maxImageBytes = Number(state.modelCapabilities?.maxImageBytes) || 20 * 1024 * 1024;
    for (const file of selected) {
      const normalized = await normalizeMobileImage(file, acceptedTypes);
      if (acceptedTypes.length && !acceptedTypes.includes(normalized.type)) throw new Error('当前模型不支持这种图片格式');
      if (normalized.size > maxImageBytes) throw new Error('图片不能超过 20MB');
      const dataUrl = await readBlobAsDataUrl(normalized);
      const result = await api('/api/uploads/images', {
        method: 'POST',
        body: JSON.stringify({
          name: normalized.name,
          mimeType: normalized.type,
          data: dataUrl.slice(dataUrl.indexOf(',') + 1)
        })
      });
      state.attachments.push({ ...result, previewUrl: URL.createObjectURL(normalized) });
      renderComposerAttachments();
    }
  } finally {
    state.uploadingImages = false;
    $('imageInput').value = '';
    updateChatStatus();
  }
}

async function loadSessions() {
  const data = await api('/api/sessions');
  state.sessions = data.sessions || [];
  if (state.activeSessionId && !state.sessions.some((session) => session.id === state.activeSessionId)) {
    state.activeSessionId = null;
    state.messages = [];
    showView('listView');
  }
  renderSessions();
  updateChatStatus();
}

async function openChat(sessionId) {
  state.activeSessionId = sessionId;
  const session = state.sessions.find((item) => item.id === sessionId);
  $('chatTitle').textContent = session ? sessionTitle(session) : '对话';
  showView('chatView');
  await refreshChat();
}

async function refreshChat() {
  if (!state.activeSessionId) return;
  try {
    const [messageData, statusData] = await Promise.all([
      api(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/messages`),
      api(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/status`),
    ]);
    state.messages = messageData.messages || [];
    state.running = !!statusData.running;
    state.runMessage = state.running ? (statusData.message || state.runMessage || 'Agent 正在工作') : '';
    if (state.running && !state.runStartedAt) state.runStartedAt = Date.now();
    if (!state.running) state.runStartedAt = 0;
    renderMessages();
    updateChatStatus();
  } catch (error) {
    if (error.status === 404) await loadSessions();
    else throw error;
  }
}

function disconnectEvents() {
  state.eventSource?.close();
  state.eventSource = null;
}

function scheduleSync(includeChat = true) {
  clearTimeout(state.syncTimer);
  state.syncTimer = setTimeout(async () => {
    await loadSessions().catch(() => {});
    if (includeChat && state.activeSessionId) await refreshChat().catch(() => {});
  }, 120);
}

function connectEvents() {
  disconnectEvents();
  const source = new EventSource(`/api/events?password=${encodeURIComponent(state.password)}`);
  state.eventSource = source;
  source.onopen = () => {
    $('connLabel').textContent = '已连接';
    loadModelState().catch(() => {});
  };
  source.addEventListener('model-changed', (event) => {
    try { applyModelState(JSON.parse(event.data)); }
    catch { loadModelState().catch(() => {}); }
  });
  source.addEventListener('session-updated', () => scheduleSync(true));
  source.addEventListener('message-added', () => scheduleSync(true));
  source.addEventListener('run-status', (event) => {
    try {
      const payload = JSON.parse(event.data);
      if (payload.sessionId === state.activeSessionId) {
        state.running = !!payload.running;
        state.runMessage = state.running ? (payload.message || state.runMessage || 'Agent 正在工作') : '';
        if (state.running && !state.runStartedAt) state.runStartedAt = Date.now();
        if (!state.running) state.runStartedAt = 0;
        renderMessages();
        updateChatStatus();
        if (!payload.running) scheduleSync(true);
      }
      scheduleSync(false);
    } catch { /* ignore invalid events */ }
  });
  source.onerror = () => {
    source.close();
    $('connLabel').textContent = '正在重新连接';
    setTimeout(() => { if (state.password) connectEvents(); }, 2500);
  };
}

async function connect(password) {
  state.password = password.trim();
  if (state.password.length < 4) throw new Error('密码至少 4 位');
  const health = await api('/api/health', { skipAuth: true });
  if (!health.passwordSet) throw new Error('请先在电脑端设置访问密码');
  await api('/api/auth/verify', {
    method: 'POST',
    body: JSON.stringify({ password: state.password }),
  });
  sessionStorage.setItem(PASSWORD_KEY, state.password);
  showView('listView');
  await Promise.all([loadSessions(), loadModelState()]);
  connectEvents();
}

async function onConnectClick() {
  const error = $('gateError');
  error.classList.add('hidden');
  $('connectBtn').disabled = true;
  try {
    await connect($('passwordInput').value);
  } catch (cause) {
    error.textContent = friendlyError(cause, '连接失败');
    error.classList.remove('hidden');
  } finally {
    $('connectBtn').disabled = false;
  }
}

async function onNewChat() {
  const button = $('newChatBtn');
  button.disabled = true;
  try {
    const data = await api('/api/sessions', { method: 'POST', body: '{}' });
    await loadSessions();
    if (data.reused) showToast('已打开现有 New Chat');
    if (data.session?.id) await openChat(data.session.id);
  } finally {
    button.disabled = false;
  }
}

async function onSend(event) {
  event.preventDefault();
  if (state.running) return onAbort();
  if (state.uploadingImages) return;
  const input = $('composerInput');
  const text = input.value.trim();
  if ((!text && state.attachments.length === 0) || !state.activeSessionId) return;
  if (state.attachments.length && !modelAcceptsImages()) {
    showToast('当前模型不支持图像输入，请切换模型或移除图片');
    return;
  }

  const outgoingAttachments = state.attachments.slice();
  input.value = '';
  state.attachments = [];
  renderComposerAttachments();
  autoResizeTextarea(input);
  state.messages.push({ role: 'user', content: text, attachments: outgoingAttachments, ts: Date.now(), optimistic: true });
  state.running = true;
  state.runMessage = outgoingAttachments.length ? '正在同步消息与图片' : '正在同步消息';
  state.runStartedAt = Date.now();
  renderMessages();
  updateChatStatus();
  try {
    await api(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/messages`, {
      method: 'POST',
      body: JSON.stringify({
        text,
        attachments: outgoingAttachments.map(({ uploadId, name, size, mimeType, kind }) => ({ uploadId, name, size, mimeType, kind }))
      }),
    });
    outgoingAttachments.forEach(attachment => {
      if (attachment.previewUrl) URL.revokeObjectURL(attachment.previewUrl);
    });
    await loadSessions();
    await refreshChat();
  } catch (error) {
    state.messages = state.messages.filter((message) => !message.optimistic);
    state.running = false;
    state.runMessage = '';
    state.runStartedAt = 0;
    state.attachments = outgoingAttachments;
    if (!input.value) input.value = text;
    autoResizeTextarea(input);
    renderComposerAttachments();
    renderMessages();
    updateChatStatus();
    showToast(friendlyError(error, '发送失败'));
  }
}

async function onAbort() {
  if (!state.activeSessionId) return;
  try {
    const result = await api(`/api/sessions/${encodeURIComponent(state.activeSessionId)}/abort`, { method: 'POST', body: '{}' });
    if (result?.ok === false) throw new Error(result.error || '停止失败');
    state.running = false;
    state.runMessage = '';
    state.runStartedAt = 0;
    renderMessages();
    updateChatStatus();
    showToast('已停止任务');
  } catch (error) {
    showToast(friendlyError(error, '停止失败'));
  }
}

function openModal(id) { $(id).classList.remove('hidden'); }
function closeModal(id) { $(id).classList.add('hidden'); }

function openTaskMenu(sessionId) {
  const session = state.sessions.find((item) => item.id === sessionId);
  if (!session) return;
  state.menuSessionId = sessionId;
  $('taskMenuTitle').textContent = sessionTitle(session);
  $('pinTaskBtn').querySelector('span').textContent = session.pinned ? '取消置顶' : '置顶任务';
  $('deleteTaskBtn').disabled = state.sessions.length <= 1 || !!session.running;
  $('deleteTaskBtn').title = state.sessions.length <= 1
    ? '至少保留一个任务'
    : (session.running ? '任务运行中，无法删除' : '删除任务');
  openModal('taskMenuOverlay');
}

async function toggleTaskPinned() {
  const session = state.sessions.find((item) => item.id === state.menuSessionId);
  if (!session) return;
  const result = await api(`/api/sessions/${encodeURIComponent(session.id)}/pin`, {
    method: 'POST', body: JSON.stringify({ pinned: !session.pinned }),
  });
  closeModal('taskMenuOverlay');
  await loadSessions();
  showToast(result.session?.pinned ? '任务已置顶' : '已取消置顶');
}

function beginRename() {
  const session = state.sessions.find((item) => item.id === state.menuSessionId);
  if (!session) return;
  closeModal('taskMenuOverlay');
  $('renameInput').value = sessionTitle(session);
  openModal('renameOverlay');
  setTimeout(() => { $('renameInput').focus(); $('renameInput').select(); }, 50);
}

async function confirmRename() {
  const title = $('renameInput').value.trim();
  if (!title) { showToast('请输入任务名称'); return; }
  const result = await api(`/api/sessions/${encodeURIComponent(state.menuSessionId)}/rename`, {
    method: 'POST', body: JSON.stringify({ title }),
  });
  closeModal('renameOverlay');
  await loadSessions();
  if (state.activeSessionId === state.menuSessionId) $('chatTitle').textContent = sessionTitle(result.session);
  showToast('任务已重命名');
}

function beginDelete() {
  const session = state.sessions.find((item) => item.id === state.menuSessionId);
  if (!session) return;
  if (state.sessions.length <= 1) { showToast('至少保留一个任务'); return; }
  if (session.running) { showToast('任务运行中，无法删除'); return; }
  closeModal('taskMenuOverlay');
  if (isBlankNewChat(session)) return deleteSelectedTask(false);
  $('deleteDescription').textContent = `“${sessionTitle(session)}”包含 ${Number(session.messageCount || 0)} 条消息，删除后无法恢复。`;
  openModal('deleteOverlay');
}

async function deleteSelectedTask(confirmed) {
  const sessionId = state.menuSessionId;
  try {
    await api(`/api/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE', body: JSON.stringify({ confirmed }),
    });
    closeModal('deleteOverlay');
    if (state.activeSessionId === sessionId) {
      state.activeSessionId = null;
      state.messages = [];
      showView('listView');
    }
    await loadSessions();
    showToast('任务已删除');
  } catch (error) {
    showToast(friendlyError(error, '删除失败'));
  }
}

function autoResizeTextarea(element) {
  element.style.height = 'auto';
  element.style.height = `${Math.min(element.scrollHeight, 120)}px`;
}

$('connectBtn').addEventListener('click', onConnectClick);
$('passwordInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') onConnectClick(); });
$('newChatBtn').addEventListener('click', () => onNewChat().catch((error) => showToast(friendlyError(error))));
$('sessionSearch').addEventListener('input', renderSessions);
$('backBtn').addEventListener('click', () => { state.activeSessionId = null; showView('listView'); loadSessions().catch(() => {}); });
$('chatActionsBtn').addEventListener('click', () => { if (state.activeSessionId) openTaskMenu(state.activeSessionId); });
$('chatModelBtn').addEventListener('click', () => {
  renderModelPicker();
  openModal('modelPickerOverlay');
});
$('composerForm').addEventListener('submit', onSend);
$('composerInput').addEventListener('input', (event) => { autoResizeTextarea(event.target); updateChatStatus(); });
$('composerInput').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); $('composerForm').requestSubmit(); }
});
$('attachImageBtn').addEventListener('click', () => $('imageInput').click());
$('imageInput').addEventListener('change', (event) => {
  uploadSelectedImages(event.target.files || []).catch(error => {
    state.uploadingImages = false;
    event.target.value = '';
    updateChatStatus();
    showToast(friendlyError(error, '图片上传失败'));
  });
});
$('pinTaskBtn').addEventListener('click', () => toggleTaskPinned().catch((error) => showToast(friendlyError(error))));
$('renameTaskBtn').addEventListener('click', beginRename);
$('deleteTaskBtn').addEventListener('click', beginDelete);
$('confirmRenameBtn').addEventListener('click', () => confirmRename().catch((error) => showToast(friendlyError(error))));
$('renameInput').addEventListener('keydown', (event) => { if (event.key === 'Enter') confirmRename().catch((error) => showToast(friendlyError(error))); });
$('confirmDeleteBtn').addEventListener('click', () => deleteSelectedTask(true));

document.querySelectorAll('[data-close-modal]').forEach((button) => {
  button.addEventListener('click', () => closeModal(button.dataset.closeModal));
});
document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (event) => { if (event.target === overlay) closeModal(overlay.id); });
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape') return;
  document.querySelectorAll('.modal-overlay:not(.hidden)').forEach((overlay) => closeModal(overlay.id));
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && state.password) {
    scheduleSync(true);
    loadModelState().catch(() => {});
  }
});

setInterval(() => updateRunProgressText(), 1000);

if (state.password) {
  $('passwordInput').value = state.password;
  connect(state.password).catch(() => {
    sessionStorage.removeItem(PASSWORD_KEY);
    state.password = '';
    showView('gateView');
  });
} else {
  showView('gateView');
}

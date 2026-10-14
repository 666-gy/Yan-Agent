// Side Chat reuses the main composer by cloning its markup once. The clone keeps
// its own DOM, event handlers, draft, attachments, model and reasoning choices,
// so nothing here ever mutates the Agent composer or its configuration.
let sideChatEditorThread = null;
let sideChatSelection = null;
let sideChatReasoningSpeed = '';

function sideChatId(id) { return 'sideChat' + id[0].toUpperCase() + id.slice(1); }
function sideChatElement(id) { return document.getElementById(sideChatId(id)); }

// Model + reasoning are independent from the Agent side. They start from the
// Agent's current selection but are cached locally and never written back.
function newSideChatSelectionFromAgent() {
  const agent = getAgentModelSelection();
  return {
    providerId: String(agent.providerId || ''),
    supplierId: String(agent.supplierId || ''),
    modelId: String(agent.modelId || ''),
    modelType: 'text',
    name: String(agent.name || agent.modelId || '')
  };
}

function getSideChatSelection() {
  if (!sideChatSelection) sideChatSelection = newSideChatSelectionFromAgent();
  return sideChatSelection;
}

function getSideChatReasoningMode() {
  if (!REASONING_SPEED_UI[sideChatReasoningSpeed]) sideChatReasoningSpeed = getReasoningSpeedMode();
  return sideChatReasoningSpeed;
}

function sideChatReasoningBillingNote(mode) {
  const selection = getSideChatSelection();
  if (selection.modelId === 'kimi-k3') return 'Kimi K3 固定 Max · 档位仅调整 Agent 执行节奏';
  if (['high', 'xhigh', 'max'].includes(mode) && selection.providerId === 'moonshot' && selection.modelId === 'kimi-k2.7-code') {
    return '将使用 Kimi K2.7 HighSpeed（价格更高）';
  }
  if (['high', 'xhigh', 'max'].includes(mode) && selection.providerId === 'minimax' && selection.modelId === 'MiniMax-M2.7') {
    return '将使用 MiniMax M2.7 HighSpeed（价格更高）';
  }
  return '';
}

function syncSideChatDraft(thread) {
  const editor = sideChatElement('composerInput');
  if (!editor || sideChatEditorThread === thread) return;
  sideChatEditorThread = thread;
  editor.textContent = thread.draftText;
  closeSideChatMenus();
  renderSideChatAttachments();
  renderSideChatControls();
}

function setSideChatComposerText(text) {
  const thread = interjectionThreadFor(currentInterjectionRun());
  syncSideChatDraft(thread);
  thread.draftText = String(text || '');
  sideChatElement('composerInput').textContent = thread.draftText;
  syncInterjectionSendButton();
}

function renderSideChatAttachments() {
  const host = sideChatElement('attachments');
  if (!host) return;
  host.replaceChildren();
  const thread = sideChatEditorThread;
  host.classList.toggle('hidden', !thread?.attachments.length && !thread?.pendingAttachments);
  for (const attachment of thread?.attachments || []) {
    const chip = document.createElement('span');
    chip.className = 'attachment-chip';
    const name = document.createElement('span');
    name.textContent = attachment.name;
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'attachment-remove';
    remove.textContent = '×';
    remove.setAttribute('aria-label', `移除 ${attachment.name}`);
    remove.addEventListener('click', () => {
      thread.attachments = thread.attachments.filter(item => item !== attachment);
      renderSideChatAttachments();
      syncInterjectionSendButton();
    });
    chip.append(name, remove);
    host.append(chip);
  }
  if (thread?.pendingAttachments) {
    const loading = document.createElement('span');
    loading.textContent = '正在读取附件…';
    host.append(loading);
  }
}

async function addSideChatAttachments(files) {
  const thread = sideChatEditorThread;
  if (!thread || !files.length) return;
  if (thread.attachments.length + thread.pendingAttachments + files.length > 12) {
    toast('侧边聊天每条消息最多添加 12 个附件'); return;
  }
  thread.pendingAttachments += files.length;
  renderSideChatAttachments();
  syncInterjectionSendButton();
  for (const file of files) {
    try {
      if (file.size > 20 * 1024 * 1024) { toast('侧边聊天附件不能超过 20MB'); continue; }
      const data = await fileToBase64(file);
      thread.attachments.push({ name: file.name, size: file.size, data, mimeType: inferImageMimeType(file) || file.type || 'application/octet-stream' });
    } catch { toast('无法读取侧边聊天附件，请重试'); }
    finally {
      thread.pendingAttachments--;
      renderSideChatAttachments();
      syncInterjectionSendButton();
    }
  }
}

const SIDE_CHAT_MENUS = [['modelQuickMenu', 'modelPill']];
function closeSideChatMenus(except = '') {
  for (const [menuId, triggerId] of SIDE_CHAT_MENUS) {
    if (menuId === except) continue;
    sideChatElement(menuId)?.classList.add('hidden');
    sideChatElement(menuId)?.setAttribute('aria-hidden', 'true');
    sideChatElement(triggerId)?.setAttribute('aria-expanded', 'false');
  }
}

function toggleSideChatMenu(menuId, triggerId) {
  const menu = sideChatElement(menuId);
  const open = menu.classList.contains('hidden');
  closeSideChatMenus();
  menu.classList.toggle('hidden', !open);
  menu.setAttribute('aria-hidden', String(!open));
  sideChatElement(triggerId).setAttribute('aria-expanded', String(open));
  return open;
}

function renderSideChatControls() {
  if (!sideChatElement('composer')) return;
  const selection = getSideChatSelection();
  const reasoning = getSideChatReasoningMode();
  const reasoningLabel = REASONING_SPEED_UI[reasoning].label;
  const modelLabel = selection.name || selection.modelId || '未选择模型';
  for (const id of ['modelPillName', 'modelQuickRouteModel']) sideChatElement(id).textContent = modelLabel;
  for (const id of ['modelPillSpeed', 'modelQuickRouteReasoning']) sideChatElement(id).textContent = reasoningLabel;
  const pill = sideChatElement('modelPill');
  pill.dataset.reasoningMode = reasoning;
  pill.title = `模型：${modelLabel} · 推理强度：${reasoningLabel}`;
  pill.setAttribute('aria-label', pill.title);
  const progress = Math.max(0, REASONING_SPEED_ORDER.indexOf(reasoning)) / (REASONING_SPEED_ORDER.length - 1);
  sideChatElement('reasoningSpeedSlider').value = String(progress * 100);
  sideChatElement('reasoningSpeedSlider').setAttribute('aria-valuetext', reasoningLabel);
  sideChatElement('reasoningSpeedSliderShell').style.setProperty('--speed-progress', String(progress));
  sideChatElement('reasoningSpeedSliderShell').dataset.mode = reasoning;
  sideChatElement('modelQuickMenu').dataset.reasoningMode = reasoning;
  const billingNote = sideChatReasoningBillingNote(reasoning);
  sideChatElement('modelQuickBillingNote').textContent = billingNote;
  sideChatElement('modelQuickBillingNote').classList.toggle('is-empty', !billingNote);
}

async function showSideChatModels() {
  const list = sideChatElement('modelQuickList');
  sideChatElement('modelQuickDefaultView').classList.add('hidden');
  sideChatElement('modelQuickModelsView').classList.remove('hidden');
  sideChatElement('modelQuickMenu').dataset.view = 'models';
  list.textContent = '正在读取模型…';
  try {
    const payload = await api.listQuickModels();
    const models = (payload?.models || []).filter(model => !model.modelType || model.modelType === 'text');
    list.replaceChildren();
    for (const model of models) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'model-quick-item model-selector-option';
      const name = document.createElement('span');
      name.className = 'model-quick-name';
      name.textContent = model.name || model.id;
      const check = document.createElement('span');
      check.className = 'model-quick-check';
      check.setAttribute('aria-hidden', 'true');
      check.textContent = '✓';
      button.append(name, check);
      button.setAttribute('role', 'option');
      const selected = getSideChatSelection();
      const isSelected = selected.providerId === model.providerId && selected.modelId === model.id
        && (selected.supplierId || '') === (model.supplierId || '');
      button.setAttribute('aria-selected', String(isSelected));
      button.classList.toggle('is-selected', isSelected);
      button.addEventListener('click', () => {
        // Local-only switch: the Agent model and its config stay untouched.
        sideChatSelection = {
          providerId: String(model.providerId || ''),
          supplierId: String(model.supplierId || ''),
          modelId: String(model.id || ''),
          modelType: 'text',
          name: String(model.name || model.id || '')
        };
        renderSideChatControls();
        closeSideChatMenus();
      });
      list.append(button);
    }
    if (!models.length) list.textContent = '当前没有可用的文本模型。';
  } catch { list.textContent = '读取模型失败，请重新打开。'; }
}

function mountSideChatComposer() {
  if (sideChatElement('composer')) return true;
  const source = document.getElementById('composer');
  const host = document.getElementById('sideChatComposerHost');
  if (!source || !host) return false;
  const copy = source.cloneNode(true);
  // Side Chat uses a fixed-height editor and opens the file picker directly.
  for (const id of [
    'chatScrollResumeHost', 'todoProgressHost', 'workModeIndicator', 'composerSnapshots',
    'promptOptimizerStatus', 'modelPickerDialog', 'accessModeWrap', 'appSnapshotAction',
    'promptOptimizerPill', 'composerWorkModeAction', 'composerSkillAction',
    'composerPluginAction', 'composerSubagentAction', 'composerWorkModeView',
    'composerSkillView', 'composerPluginView', 'composerSubagentView',
    'attachmentMenu', 'composerResizeHandle'
  ]) copy.querySelector('#' + id)?.remove();
  const ids = new Map();
  for (const node of [copy, ...copy.querySelectorAll('[id]')]) {
    ids.set(node.id, sideChatId(node.id));
    node.id = sideChatId(node.id);
  }
  for (const node of [copy, ...copy.querySelectorAll('*')]) {
    for (const attr of ['for', 'aria-controls', 'aria-labelledby', 'aria-describedby', 'aria-owns', 'aria-activedescendant']) {
      if (node.hasAttribute(attr)) node.setAttribute(attr, node.getAttribute(attr).split(/\s+/).map(id => ids.get(id) || id).join(' '));
    }
    for (const attr of ['href', 'xlink:href', 'fill', 'stroke', 'clip-path', 'mask', 'filter']) {
      const value = node.getAttribute(attr);
      if (value) node.setAttribute(attr, value.replace(/#([\w-]+)/g, (match, id) => ids.has(id) ? '#' + ids.get(id) : match));
    }
    node.removeAttribute('inert');
    node.removeAttribute('data-bound');
    node.removeAttribute('disabled');
    node.removeAttribute('aria-disabled');
    if (node.hasAttribute('aria-busy')) node.setAttribute('aria-busy', 'false');
  }
  copy.className = 'composer side-chat-composer';
  copy.removeAttribute('style');
  copy.hidden = false;
  host.append(copy);
  const editor = sideChatElement('composerInput');
  editor.replaceChildren();
  editor.removeAttribute('style');
  editor.removeAttribute('aria-hidden');
  editor.setAttribute('contenteditable', 'true');
  editor.setAttribute('aria-label', '侧边聊天输入');
  editor.dataset.placeholder = '随心输入';
  const attachments = document.createElement('div');
  attachments.id = sideChatId('attachments');
  attachments.className = 'attachments hidden';
  copy.querySelector('.composer-editor').prepend(attachments);
  closeSideChatMenus();
  editor.addEventListener('input', () => {
    if (!sideChatEditorThread) return;
    sideChatEditorThread.draftText = editor.innerText.replace(/\r\n/g, '\n');
    syncInterjectionSendButton();
  });
  let composing = false;
  editor.addEventListener('compositionstart', () => { composing = true; });
  editor.addEventListener('compositionend', () => { composing = false; editor.dispatchEvent(new Event('input')); });
  editor.addEventListener('keydown', event => {
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || composing || event.keyCode === 229) return;
    event.preventDefault();
    event.stopPropagation();
    void sendInterjection();
  });
  editor.addEventListener('paste', event => {
    event.preventDefault();
    event.stopPropagation();
    const files = Array.from(event.clipboardData?.files || []);
    if (files.length) { void addSideChatAttachments(files); return; }
    document.execCommand('insertText', false, event.clipboardData?.getData('text/plain') || '');
    editor.dispatchEvent(new Event('input'));
  });
  copy.addEventListener('dragover', event => { event.preventDefault(); event.stopPropagation(); });
  copy.addEventListener('drop', event => {
    event.preventDefault();
    event.stopPropagation();
    void addSideChatAttachments(Array.from(event.dataTransfer?.files || []));
  });
  sideChatElement('sendBtn').addEventListener('click', () => {
    if (sideChatEditorThread?.pending) void stopInterjection();
    else void sendInterjection();
  });
  for (const [menuId, triggerId] of SIDE_CHAT_MENUS) sideChatElement(triggerId).addEventListener('click', () => {
    renderSideChatControls();
    if (menuId === 'modelQuickMenu') {
      sideChatElement('modelQuickDefaultView').classList.remove('hidden');
      sideChatElement('modelQuickModelsView').classList.add('hidden');
      sideChatElement(menuId).dataset.view = 'control';
    }
    toggleSideChatMenu(menuId, triggerId);
  });
  const attachButton = sideChatElement('attachBtn');
  attachButton.title = '添加附件';
  attachButton.setAttribute('aria-label', '添加附件');
  for (const attr of ['aria-haspopup', 'aria-controls', 'aria-expanded']) attachButton.removeAttribute(attr);
  attachButton.addEventListener('click', () => {
    closeSideChatMenus(); sideChatElement('fileInput').click();
  });
  sideChatElement('fileInput').addEventListener('change', event => {
    void addSideChatAttachments(Array.from(event.target.files || []));
    event.target.value = '';
  });
  sideChatElement('modelQuickModelRoute').addEventListener('click', () => { void showSideChatModels(); });
  const slider = sideChatElement('reasoningSpeedSlider');
  const sliderShell = sideChatElement('reasoningSpeedSliderShell');
  slider.addEventListener('input', () => sliderShell.style.setProperty('--speed-progress', String(Number(slider.value) / 100)));
  slider.addEventListener('change', () => {
    // Local-only reasoning change; the Agent's reasoning stays as configured.
    sideChatReasoningSpeed = reasoningModeFromProgress(Number(slider.value) / 100);
    renderSideChatControls();
  });
  document.addEventListener('pointerdown', event => { if (!copy.contains(event.target)) closeSideChatMenus(); });
  copy.addEventListener('keydown', event => {
    if (event.key === 'Escape') { closeSideChatMenus(); event.stopPropagation(); editor.focus(); }
  });
  renderSideChatControls();
  return true;
}

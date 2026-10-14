// Side Chat state is intentionally separate from saved sessions and run logs.
const interjectionThreads = new Map();
const interjectionRequests = new Map();
let interjectionUiTimer = 0;

function currentInterjectionRun() {
  const run = getRunCtx(state.currentSession?.id);
  return run && !run.shouldAbort && run.agentState?.status === 'working' ? run : null;
}

function interjectionThreadFor(runCtx, reset = false) {
  const sessionId = String(runCtx?.sessionId || state.currentSession?.id || 'side-chat');
  let thread = interjectionThreads.get(sessionId);
  if (!thread || (reset && !thread.pending)) {
    thread = { sessionId, runId: runCtx?.runId || '', items: [], pending: false, draftText: '', attachments: [], pendingAttachments: 0 };
    interjectionThreads.set(sessionId, thread);
  }
  return thread;
}

function sideChatEmptyMarkup() {
  return `<div class="side-chat-empty">${RIGHT_SIDEBAR_TOOLS.interjection.icon}<h2>侧边聊天</h2><p>侧边聊天是临时聊天，关闭应用后会消失。</p></div>`;
}

function createInterjectionMessageElement(item) {
  const message = document.createElement('div');
  message.className = `msg ${item.role === 'user' ? 'user' : 'assistant'}`;
  const body = document.createElement('div');
  body.className = 'msg-body' + (item.agentRun ? ' agent-output' : '');
  message.append(body);
  item.ui = { message, body };
  if (item.agentRun) {
    // Work-toggle actions are siblings of the body, inside the message.
    bindAgentWorkToggle(message);
    renderAgentRunBody(body, item.agentRun, item.text || '');
  } else if (item.role === 'user') {
    body.textContent = item.text || '';
  } else body.append(buildProgressNoteElement(item.text || ''));
  return message;
}

function renderInterjectionTranscript(runCtx = currentInterjectionRun()) {
  const transcript = document.getElementById('interjectionTranscript');
  if (!transcript) return;
  const thread = interjectionThreadFor(runCtx);
  transcript.replaceChildren();
  if (!thread.items.length) transcript.innerHTML = sideChatEmptyMarkup();
  else for (const item of thread.items) transcript.append(createInterjectionMessageElement(item));
  transcript.dataset.threadId = thread.sessionId;
  transcript.dataset.interjectionItemCount = String(thread.items.length);
}

function appendInterjectionItem(runCtx, item) {
  const thread = interjectionThreadFor(runCtx);
  const transcript = document.getElementById('interjectionTranscript');
  if (thread.sessionId !== String(state.currentSession?.id || 'side-chat')) return;
  if (transcript.dataset.threadId !== thread.sessionId) return renderInterjectionTranscript(runCtx);
  transcript.querySelector('.side-chat-empty')?.remove();
  transcript.append(createInterjectionMessageElement(item));
  transcript.dataset.interjectionItemCount = String(thread.items.length);
  const scroll = document.getElementById('interjectionScroll');
  scroll.scrollTop = scroll.scrollHeight;
}

function syncInterjectionUi(options = {}) {
  if (options.defer) {
    if (!interjectionUiTimer) interjectionUiTimer = setTimeout(() => { interjectionUiTimer = 0; syncInterjectionUi(); }, 80);
    return;
  }
  const thread = interjectionThreadFor(currentInterjectionRun());
  syncSideChatDraft(thread);
  const transcript = document.getElementById('interjectionTranscript');
  if (transcript && (transcript.dataset.threadId !== thread.sessionId || Number(transcript.dataset.interjectionItemCount) !== thread.items.length)) renderInterjectionTranscript();
  syncInterjectionSendButton();
}

function syncInterjectionSendButton() {
  const button = sideChatElement('sendBtn');
  if (!button) return;
  const thread = interjectionThreadFor(currentInterjectionRun());
  syncConversationSubmitButton(button, {
    active: !!thread.pending, stopping: !!thread.stopping,
    sendDisabled: !!thread.pendingAttachments || (!thread.draftText.trim() && !thread.attachments.length),
    sendTitle: '发送侧边聊天',
    stopTitle: '停止侧边回复'
  });
}

function updateInterjectionSendState() { syncInterjectionSendButton(); }

function buildInterjectionSnapshot(runCtx) {
  return {
    active: !!runCtx && !runCtx.shouldAbort,
    capturedAt: Date.now(), currentRequest: runCtx?.currentRequest || '',
    phase: runCtx?.openCodePhase || 'idle',
    elapsedMs: runCtx ? Date.now() - runCtx.startedAt : 0,
    timeline: (runCtx?.activeAgentRun?.timeline || []).slice(-32).map(item => ({
      type: item.type, name: item.name, content: String(item.content || '').slice(-4000),
      args: item.args, output: String(item.output || '').slice(-4000), ok: item.ok
    })),
    todos: runCtx?.agentState?.todos || []
  };
}

function updateInterjectionStreamItem(item) {
  if (!item?.ui?.body?.isConnected || !item.agentRun) return;
  const scroll = document.getElementById('interjectionScroll');
  const pinned = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 64;
  renderAgentRunBody(item.ui.body, item.agentRun, item.text);
  if (pinned) scroll.scrollTop = scroll.scrollHeight;
}

function finalizeInterjectionItem(item, status = 'done', error = '') {
  if (!item?.agentRun) return;
  item.streaming = false;
  Object.assign(item.agentRun, { status, error, completedAt: Date.now(), durationMs: Date.now() - item.agentRun.startedAt });
  for (const part of item.agentRun.timeline) part.streaming = false;
  item.agentRun.uiTimelineRevision++;
  updateInterjectionStreamItem(item);
}

function handleInterjectionStreamEvent(detail = {}) {
  const request = interjectionRequests.get(String(detail.requestId || ''));
  if (!request || String(detail.runId || '') !== request.runId) return;
  const { item } = request;
  const { type, data = {} } = detail.event || {};
  if (type === 'text.delta' || type === 'reasoning.delta') {
    const kind = type === 'text.delta' ? 'text' : 'thinking';
    const run = item.agentRun;
    run.responseStartedAt ||= Date.now();
    let part = run.timeline.at(-1);
    if (!part || part.type !== kind) {
      if (part) part.streaming = false;
      part = { type: kind, content: '', streaming: true, stage: kind === 'text' ? 'summary' : 'work', openCodeKey: `${item.requestId}:${run.timeline.length}` };
      run.timeline.push(part);
    }
    part.content += String(data.delta || '');
    if (kind === 'text') { item.text += String(data.delta || ''); run.textContent = item.text; }
    run.uiTimelineRevision++;
    updateInterjectionStreamItem(item);
  } else if (type === 'completed') finalizeInterjectionItem(item);
  else if (type === 'cancelled') finalizeInterjectionItem(item, 'interrupted');
  else if (type === 'error') finalizeInterjectionItem(item, 'error', data.message);
}

async function sendInterjection() {
  const runCtx = currentInterjectionRun();
  const thread = interjectionThreadFor(runCtx);
  if (thread.pending || thread.pendingAttachments) return;
  const text = thread.draftText.trim();
  const attachments = thread.attachments.map(item => ({ ...item }));
  if (!text && !attachments.length) return;
  const requestId = globalThis.crypto.randomUUID();
  const mode = 'auto';
  const context = (state.currentSession?.messages || []).slice(-20).map(message => ({
    role: message.role, content: String(message.content || message.agentRun?.textContent || '').slice(-16000)
  }));
  const history = thread.items.filter(item => ['user', 'agent'].includes(item.role) && item.text)
    .map(item => ({ role: item.role === 'agent' ? 'assistant' : 'user', content: item.text, attachments: item.attachments || [] }));
  const userItem = { role: 'user', text: [text, ...attachments.map(item => `附件：${item.name}`)].filter(Boolean).join('\n'), attachments };
  thread.pending = true;
  thread.requestId = requestId;
  thread.runId = runCtx?.runId || '';
  thread.items.push(userItem);
  appendInterjectionItem(runCtx, userItem);
  thread.draftText = '';
  thread.attachments = [];
  setSideChatComposerText('');
  renderSideChatAttachments();
  const sideChatControls = { selection: { ...getSideChatSelection() }, reasoningSpeed: getSideChatReasoningMode() };
  const item = {
    role: 'agent', text: '', streaming: true, requestId,
    agentRun: { runId: requestId, modelId: sideChatControls.selection.modelId, status: 'working', startedAt: Date.now(), timeline: [], textContent: '', uiTimelineRevision: 0, sideChat: true }
  };
  thread.items.push(item);
  appendInterjectionItem(runCtx, item);
  interjectionRequests.set(requestId, { thread, item, runId: thread.runId });
  syncInterjectionUi();
  try {
    const result = await api.openCodeInterject({ mode, runId: thread.runId, requestId, text, attachments, history, context, snapshot: buildInterjectionSnapshot(runCtx), ...sideChatControls });
    if (!item.text && result?.reply) handleInterjectionStreamEvent({ runId: thread.runId, requestId, event: { type: 'text.delta', data: { delta: result.reply } } });
    finalizeInterjectionItem(item, result?.ok ? (result.cancelled ? 'interrupted' : 'done') : 'error', result?.error || '');
  } catch {
    finalizeInterjectionItem(item, 'error', '侧边聊天发送失败，请重试。');
  } finally {
    thread.pending = false;
    thread.stopping = false;
    thread.requestId = null;
    interjectionRequests.delete(requestId);
    syncInterjectionUi();
  }
}

async function stopInterjection() {
  const thread = interjectionThreadFor(currentInterjectionRun());
  if (!thread.pending || thread.stopping) return;
  thread.stopping = true;
  syncInterjectionUi();
  try {
    const result = await api.openCodeCancelInterjection({ requestId: thread.requestId });
    if (!result?.ok) { thread.stopping = false; toast(result?.error || '停止失败，请重试'); }
  } catch { thread.stopping = false; toast('停止失败，请重试'); }
  syncInterjectionUi();
}

function bindInterjectionUi() {
  const panel = document.getElementById('rs-interjection');
  if (!panel || panel.dataset.bound === 'true') return;
  if (!mountSideChatComposer()) return;
  panel.dataset.bound = 'true';
  api.onOpenCodeInterjectionEvent?.(handleInterjectionStreamEvent);
  window.addEventListener('beforeunload', () => {
    for (const requestId of interjectionRequests.keys()) void api.openCodeCancelInterjection({ requestId });
    interjectionThreads.clear(); interjectionRequests.clear();
    sideChatEditorThread = null;
    sideChatElement('composerInput').replaceChildren();
    sideChatElement('attachments').replaceChildren();
  });
  renderInterjectionTranscript();
  syncInterjectionUi();
}

// 划词工具条：把左键选中的正文引用进侧边聊天，用户随后输入问题。
function askSelectionInSideChat(text) {
  const value = String(text || '').trim();
  if (!value) return;
  const quoted = value.split(/\r?\n/).map(line => `> ${line}`).join('\n');
  openRightSidebarTool('interjection');
  setSideChatComposerText(`${quoted}\n`);
  syncInterjectionUi();
  requestAnimationFrame(() => sideChatElement('composerInput')?.focus({ preventScroll: true }));
  toast('已在侧边聊天中引用选中内容');
}

// 新建侧边会话：清空当前临时会话记录，重新开始一段侧边聊天。
function startNewSideChat() {
  const thread = interjectionThreadFor(currentInterjectionRun());
  if (thread.pending) { toast('侧边聊天正在回复，请稍后再新建'); return; }
  thread.items = [];
  thread.draftText = '';
  thread.attachments = [];
  openRightSidebarTool('interjection');
  setSideChatComposerText('');
  renderInterjectionTranscript();
  syncInterjectionUi();
  requestAnimationFrame(() => sideChatElement('composerInput')?.focus({ preventScroll: true }));
  toast('已新建侧边会话');
}

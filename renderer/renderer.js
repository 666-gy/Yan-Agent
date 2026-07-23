/* ============================================================
   Yan — renderer logic
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const api = window.yan;

const state = {
  config: null,
  appMode: 'agent',
  sessions: [],
  currentSession: null,
  attachments: [],        // [{name, path, size}]
  skills: [],
  selectedSkills: [],
  activeRuns: new Map(),    // sessionId -> { sessionRef, runCtx, assistantEl } 所有运行中的任务（完全独立）
  automationRuns: new Set()   // 正在执行的自动化 id
};

const MAX_CONCURRENT_RUNS = 5;
let yanxiWorkspaceSyncQueue = Promise.resolve();
let pendingYanxiRendererSync = null;
const appliedYanxiRequestIds = new Set();

// --- 并发任务辅助函数 ---
function isSessionRunning(sessionId) {
  return !!(sessionId && state.activeRuns.has(sessionId));
}

function isCurrentSessionResponding() {
  return isSessionRunning(state.currentSession?.id);
}

function getRunCtx(sessionId) {
  return state.activeRuns.get(sessionId)?.runCtx;
}

function createIdleAgentState() {
  return {
    todos: [], todosFromTool: false,
    outcome: '', acceptanceCriteria: [], outcomeFromTool: false,
    iteration: 0, toolCallCount: 0, status: 'idle'
  };
}

function getSessionAgentState(session = state.currentSession) {
  const runCtx = session?.id ? getRunCtx(session.id) : null;
  if (runCtx?.agentState) return runCtx.agentState;

  const lastAssistant = [...(session?.messages || [])]
    .reverse()
    .find(message => message.role === 'assistant' && message.agentRun);
  const saved = lastAssistant?.agentRun;
  if (!saved) return createIdleAgentState();

  return {
    todos: Array.isArray(saved.todos) ? saved.todos.map(todo => ({
      text: todo.text,
      done: !!todo.done,
      inProgress: !!todo.inProgress
    })) : [],
    todosFromTool: !!saved.todosFromTool,
    outcome: saved.outcome || '',
    acceptanceCriteria: Array.isArray(saved.acceptanceCriteria) ? saved.acceptanceCriteria : [],
    outcomeFromTool: !!saved.outcomeFromTool,
    iteration: Number(saved.iteration) || 0,
    toolCallCount: Number(saved.toolCallCount) || 0,
    status: saved.status || 'done'
  };
}

function getCurrentAgentState() {
  return getSessionAgentState(state.currentSession);
}

function isAgentStateForCurrentSession(agentState) {
  if (!agentState) return true;
  for (const [sessionId, entry] of state.activeRuns) {
    if (entry.runCtx?.agentState === agentState) {
      return sessionId === state.currentSession?.id;
    }
  }
  return true;
}

function syncCurrentSessionAgentUi(session = state.currentSession) {
  if (!session || state.currentSession?.id !== session.id) return;
  const agentState = getSessionAgentState(session);
  renderTodos(agentState);
  updateContextInfo(agentState, session);
}

function canStartRun() {
  return state.activeRuns.size < MAX_CONCURRENT_RUNS;
}

// 切换会话时，旧会话的任务停止 DOM 渲染（任务继续后台运行，互不影响）
function pauseUiForSession(sessionId) {
  const entry = state.activeRuns.get(sessionId);
  if (entry) entry.runCtx.ui = false;
}

function bindActiveRunUi(sessionId) {
  const entry = state.activeRuns.get(sessionId);
  if (!entry || state.currentSession?.id !== sessionId) return null;

  const { runCtx } = entry;
  runCtx.ui = true;
  const assistantEl = appendMessage('assistant', '');
  entry.assistantEl = assistantEl;

  const timeline = [...(runCtx.activeAgentRun?.timeline || [])];
  if (runCtx.streamingReasoning) {
    timeline.push({ type: 'thinking', content: runCtx.streamingReasoning, streaming: true });
  }
  if (runCtx.streamingContent) {
    timeline.push({ type: 'text', content: runCtx.streamingContent, streaming: true });
  }

  const activeSnapshot = {
    ...runCtx.agentState,
    status: runCtx.shouldAbort ? 'interrupted' : 'working',
    changeCount: runCtx.fileChangeCount || 0,
    timeline
  };
  renderAgentRunBody(assistantEl.querySelector('.msg-body'), activeSnapshot, runCtx.partialContent || '');
  if (runCtx.shouldAbort) applyAbortRunUi(sessionId);
  showTyping(false);
  return assistantEl;
}

let petFocusedSessionId = null;
const petSupervisionRuns = new Map();

function getPetRunStats(runCtx) {
  return {
    iteration: Number(runCtx?.agentState?.iteration) || 0,
    toolCalls: Number(runCtx?.agentState?.toolCallCount) || 0,
    changes: Number(runCtx?.fileChangeCount) || 0
  };
}

function publishPetRunState(runCtx, overrides = {}) {
  if (!runCtx?.sessionId || petFocusedSessionId !== runCtx.sessionId) return;
  const monitor = petSupervisionRuns.get(runCtx.sessionId) || {};
  const session = runCtx.sessionRef || state.sessions.find(item => item.id === runCtx.sessionId);
  api.petUpdate?.({
    status: overrides.status || monitor.status || 'observing',
    sessionId: runCtx.sessionId,
    running: overrides.running ?? true,
    title: displaySessionTitle(session?.title || '新对话'),
    message: overrides.message || monitor.message || '正在监督任务',
    assessment: overrides.assessment || monitor.warning || monitor.assessment || '未发现异常',
    stats: getPetRunStats(runCtx)
  });
}

function syncPetFocusedSession(session = state.currentSession) {
  const sessionId = session?.id ? String(session.id) : null;
  petFocusedSessionId = sessionId;

  if (!sessionId) {
    api.petUpdate?.({
      status: 'idle',
      sessionId: null,
      running: false,
      title: 'Yan Agent',
      message: '随时待命',
      assessment: '本地监督已就绪',
      stats: { iteration: 0, toolCalls: 0, changes: 0 }
    });
    return;
  }

  const runCtx = getRunCtx(sessionId);
  if (runCtx) {
    runCtx.sessionRef = session;
    publishPetRunState(runCtx, { running: true });
    return;
  }

  api.petUpdate?.({
    status: 'idle',
    sessionId,
    running: false,
    title: displaySessionTitle(session.title || '新对话'),
    message: '当前任务待命',
    assessment: '等待 Agent 开始工作',
    stats: { iteration: 0, toolCalls: 0, changes: 0 }
  });
}

function startPetSupervision(runCtx, session) {
  if (!runCtx?.sessionId) return;
  runCtx.sessionRef = session || runCtx.sessionRef;
  petSupervisionRuns.set(runCtx.sessionId, {
    signatures: new Map(),
    failureStreak: 0,
    status: 'observing',
    message: '正在理解任务',
    assessment: '本地监督已开始',
    warning: ''
  });
  if (state.currentSession?.id === runCtx.sessionId) {
    petFocusedSessionId = runCtx.sessionId;
    publishPetRunState(runCtx);
  }
}

function clipPetText(value, limit = 42) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? text.slice(0, limit - 1) + '…' : text;
}

function describePetTool(name, args = {}) {
  const label = resolveToolUi(name).label;
  const rawTarget = args.path || args.filePath || args.directory || args.workspace || args.query || args.command || '';
  if (!rawTarget) return label;
  let target = String(rawTarget);
  if (/[/\\]/.test(target) && !args.command) target = target.split(/[/\\]/).filter(Boolean).pop() || target;
  return `${label} · ${clipPetText(target)}`;
}

function handlePetSupervisorEvent(event = {}, runCtx) {
  if (!runCtx?.sessionId) return;
  const monitor = petSupervisionRuns.get(runCtx.sessionId);
  if (!monitor) return;

  if (event.type === 'iteration') {
    const iteration = Number(event.iteration) || 0;
    monitor.message = iteration <= 1 ? '正在分析任务' : `正在进行第 ${iteration} 轮推理`;
    if (iteration >= 10 && !monitor.warning) monitor.warning = `任务已运行 ${iteration} 轮，建议关注是否偏离目标`;
  }

  if (event.type === 'tool-start') {
    if (event.name === 'generate_image') {
      const latestUser = [...(runCtx.sessionRef?.messages || [])].reverse().find(message => message?.role === 'user');
      const editing = (latestUser?.attachments || []).some(attachment => attachment?.kind === 'image');
      monitor.message = editing ? '正在编辑图片，服务响应可能需要几分钟' : '正在生成图片，服务响应可能需要几分钟';
    } else {
      monitor.message = describePetTool(event.name, event.args);
    }
    let signature = event.name || 'unknown';
    try { signature += ':' + JSON.stringify(event.args || {}); } catch { /* plain tool args expected */ }
    const repeats = (monitor.signatures.get(signature) || 0) + 1;
    monitor.signatures.set(signature, repeats);
    if (repeats >= 3) monitor.warning = `同一操作已重复 ${repeats} 次，可能没有取得进展`;

    if (event.name === 'execute_shell') {
      const command = String(event.args?.command || '');
      if (/\brm\s+-rf\b|Remove-Item\b.*-Recurse|git\s+reset\s+--hard|\bformat\b/i.test(command)) {
        monitor.warning = '检测到高风险 Shell，权限系统仍会进行拦截';
      }
    }
  }

  if (event.type === 'tool-finish') {
    if (event.ok) {
      monitor.failureStreak = 0;
      monitor.message = `${resolveToolUi(event.name).label}已完成`;
    } else {
      monitor.failureStreak += 1;
      monitor.message = `${resolveToolUi(event.name).label}执行失败`;
      if (monitor.failureStreak >= 2) monitor.warning = `已连续失败 ${monitor.failureStreak} 次，建议检查执行方向`;
    }
    if ((Number(runCtx.fileChangeCount) || 0) >= 10 && !monitor.warning) {
      monitor.warning = `修改范围已扩大到 ${runCtx.fileChangeCount} 处文件改动`;
    }
  }

  if (event.type === 'gate-blocked') {
    monitor.message = '正在补充验收证据';
    monitor.assessment = 'Outcome Gate 阻止了过早结束';
  }

  monitor.status = monitor.warning ? 'warning' : 'observing';
  runCtx.remoteStatusMessage = monitor.message;
  remoteNotify('run-status', {
    sessionId: runCtx.sessionId,
    running: true,
    phase: event.type,
    message: monitor.message
  });
  publishPetRunState(runCtx, { status: monitor.status });
}

function finishPetSupervision(runCtx, status, message) {
  if (!runCtx?.sessionId) return;
  const labels = {
    completed: { status: 'completed', message: message || '任务已完成', assessment: '运行结束，可以检查最终结果' },
    paused: { status: 'paused', message: message || '任务已停止', assessment: '执行已按要求中断' },
    error: { status: 'error', message: message || '任务出现异常', assessment: '建议打开任务查看错误信息' }
  };
  const next = labels[status] || labels.completed;
  publishPetRunState(runCtx, { ...next, running: false });

  setTimeout(() => {
    if (!state.activeRuns.has(runCtx.sessionId)) petSupervisionRuns.delete(runCtx.sessionId);
  }, 60000);

}

// ============================================================
// Icons (inline SVG strings)
// ============================================================
const ICONS = {
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  chevron: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="9 18 15 12 9 6"/></svg>',
  close: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"/></svg>',
  robot: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="12" cy="5" r="2"/><path d="M12 7v4"/><line x1="8" y1="16" x2="8" y2="16"/><line x1="16" y1="16" x2="16" y2="16"/></svg>',
  user: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>',
  copy: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  clock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>',
  undo: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/></svg>',
  pin: '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"><path d="M12 17v5"/><path d="M5 17h14"/><path d="M6 3h12l-2 7 3 3H5l3-3z"/></svg>',
  moon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
};

let skillMarketItems = [];
let installedSkillCatalog = [];
let skillMarketSearch = '';
let suppressChatAutoScroll = false;

const SKILL_LOGO_FALLBACK = 'assets/skill-logos/github.png';

function skillLogoPath(skill = {}) {
  const logo = String(skill.logo || '').trim();
  return /^assets\/skill-logos\/[a-z0-9._-]+$/i.test(logo)
    ? logo
    : SKILL_LOGO_FALLBACK;
}

function skillLogoHtml(skill) {
  return `<img class="skill-logo-image" data-skill-logo src="${escapeAttr(skillLogoPath(skill))}" alt="" aria-hidden="true" draggable="false">`;
}

function bindSkillLogoFallbacks(root) {
  root?.querySelectorAll?.('[data-skill-logo]').forEach((img) => {
    img.addEventListener('error', () => {
      if (img.getAttribute('src') === SKILL_LOGO_FALLBACK) return;
      img.setAttribute('src', SKILL_LOGO_FALLBACK);
    }, { once: true });
  });
}

// ============================================================
// Init
// ============================================================
async function init() {
  initKernelBridge();
  state.config = await api.getConfig();
  await refreshSkillPrompts();

  applyTheme(state.config.theme);
  renderModelBadge();
  await syncPetWindowButton();
  await refreshSessions();
  await renderRightSidebarFiles();
  updateContextInfo();

  updateGreeting();
  setInterval(updateGreeting, 60000);

  // 请求通知权限（任务完成时推送 Windows 通知）
  if (window.Notification && Notification.permission === 'default') {
    Notification.requestPermission();
  }

  bindUI();
  window.YanTerminal?.init({
    api,
    hooks: {
      closeBrowser: closeBrowserPanel,
      closeCodeMap: () => window.YanCodeMap?.close(),
      getWorkspace: () => state.currentSession?.workspace || state.config?.workspace || ''
    }
  });
  window.YanCodeMap?.init({
    api,
    hooks: {
      getWorkspace: () => state.currentSession?.workspace || state.config?.workspace || '',
      toast,
      closeBrowser: closeBrowserPanel,
      closeTerminal: () => window.YanTerminal?.close(),
      setRightSidebarOpen
    }
  });
  try {
    await window.YanPartner?.init({
      api,
      hooks: { renderMarkdown, toast }
    });
  } catch (error) {
    console.error('[partner] init failed:', error);
  }

  api.onMcpStatus?.(({ id, status, code }) => {
    if (status === 'crashed') {
      toast(`MCP 服务异常退出 (${id}, code ${code ?? '?'})`);
      if (currentMainPage === 'mcp') renderMcpPage();
    }
  });

  api.onWorkspaceChanged?.((detail) => {
    scheduleRightSidebarRefresh();
    window.YanCodeMap?.handleWorkspaceChanged(detail);
  });

  api.onYanxiWorkspaceSync?.((payload) => {
    scheduleYanxiWorkspaceSync(payload, state.currentSession?.id || null);
  });

  api.onSkillsChanged?.(async () => {
    await refreshInstalledSkillCatalog();
    if (currentMainPage === 'skills') await renderSkillMarket();
  });

  api.onRemoteInvoke?.(handleRemoteInvoke);
  api.onPetVisibility?.(({ visible }) => updatePetWindowButton(!!visible));
  api.onPetAction?.((action = {}) => {
    if (action.type === 'open-task' && action.sessionId) {
      openTaskFromPet(action.sessionId).catch(error => console.error('[pet-open-task]', error));
    }
    if (action.type === 'stop-task' && action.sessionId) {
      const result = abortSessionById(action.sessionId);
      if (!result.ok) {
        const runCtx = getRunCtx(action.sessionId);
        if (runCtx) finishPetSupervision(runCtx, 'error', '任务已经不在运行');
      }
    }
  });
  api.onSessionChanged?.((detail) => {
    applyExternalSessionChange(detail).catch((error) => {
      console.error('[session-sync]', error);
    });
  });
  api.onModelChanged?.(async () => {
    try {
      state.config = await api.getConfig();
      renderModelBadge();
      if (!settingsOverlay.classList.contains('hidden')) {
        currentProviderId = state.config.api.provider;
        renderModelGrid(state.config);
        updateDynamicProviderUi(state.config);
      }
    } catch (error) {
      console.error('[model-sync]', error);
    }
  });

  window.addEventListener('focus', () => {
    renderRightSidebarFiles();
    updateContextInfo();
  });

  // Auto-create first session if none
  if (state.sessions.length === 0) {
    await newSession();
  } else {
    await loadSession(state.sessions[0].id);
  }

  const pendingYanxiPayload = await api.consumePendingYanxiWorkspace?.();
  if (pendingYanxiPayload !== null && pendingYanxiPayload !== undefined) {
    await scheduleYanxiWorkspaceSync(pendingYanxiPayload, state.currentSession?.id || null);
  }
  if (pendingYanxiRendererSync && state.currentSession) {
    const queued = pendingYanxiRendererSync;
    pendingYanxiRendererSync = null;
    await scheduleYanxiWorkspaceSync(queued.payload, state.currentSession.id);
  }
  let initialAppMode = 'agent';
  try { initialAppMode = localStorage.getItem('yan-active-app') === 'partner' ? 'partner' : 'agent'; } catch {}
  setActiveApplication(initialAppMode, { persist: false });
}

async function openTaskFromPet(sessionId) {
  switchSidebarNav('tasks');
  if (state.currentSession?.id === sessionId) {
    renderSessionList();
    updateTaskBar();
    updateSendState();
    showTyping(isSessionRunning(sessionId));
    return state.currentSession;
  }
  return loadSession(sessionId);
}

// ============================================================
// Greeting (time-based)
// ============================================================
function updateGreeting() {
  const h = new Date().getHours();
  let part = 'evening';
  if (h < 12) part = 'morning';
  else if (h < 18) part = 'afternoon';
  const el = $('#greeting');
  if (el) el.textContent = `Good ${part}, Yanxi`;
}

// ============================================================
// Theme
// ============================================================
function applyTheme(theme) {
  const t = theme || 'dark';
  document.documentElement.setAttribute('data-theme', t);
  updateThemeToggleIcon(t);
}

function updatePetWindowButton(visible) {
  const button = $('#petWindowToggle');
  if (!button) return;
  button.classList.toggle('active', visible);
  button.setAttribute('aria-pressed', visible ? 'true' : 'false');
  button.setAttribute('aria-label', visible ? '关闭桌宠' : '打开桌宠');
  button.title = visible ? '关闭桌宠' : '打开桌宠';
}

async function syncPetWindowButton() {
  const visible = await api.getPetVisible?.().catch(() => false);
  updatePetWindowButton(!!visible);
}

$('#petWindowToggle')?.addEventListener('click', async () => {
  const visible = await api.togglePetWindow?.();
  updatePetWindowButton(!!visible);
});

function updateThemeToggleIcon(theme) {
  const btn = $('#themeToggle');
  if (!btn) return;
  // 浅色模式显示月亮（切换到深色）；深色模式显示太阳（切换到浅色）
  btn.innerHTML = theme === 'light' ? ICONS.moon : ICONS.sun;
}
$('#themeToggle').addEventListener('click', async () => {
  const next = state.config.theme === 'dark' ? 'light' : 'dark';
  state.config = await api.setConfig({ theme: next });
  applyTheme(next);
});

// ============================================================
// Sessions CRUD
// ============================================================
async function refreshSessions() {
  state.sessions = await api.listSessions();
  const blanks = state.sessions.filter(isBlankUnassignedNewChat);
  if (blanks.length > 1) {
    const currentBlank = blanks.find(session => session.id === state.currentSession?.id);
    const keepId = currentBlank?.id || blanks[0].id;
    await Promise.all(blanks
      .filter(session => session.id !== keepId)
      .map(session => api.deleteSession(session.id)));
    state.sessions = await api.listSessions();
  }
  renderSessionList();
}

async function applyExternalSessionChange(detail = {}) {
  const currentId = state.currentSession?.id || null;
  await refreshSessions();

  if (!currentId || detail.id !== currentId) return;
  const summary = state.sessions.find(session => session.id === currentId);
  if (!summary) {
    state.currentSession = null;
    syncPetFocusedSession(null);
    clearMessages();
    setEmptyState(true);
    if (state.sessions.length) {
      await loadSession(state.sessions[0].id);
    } else {
      updateTaskBar();
      updateSendState();
    }
    return;
  }

  const fresh = await api.getSession(currentId);
  if (!fresh) return;
  state.currentSession.title = fresh.title;
  state.currentSession.pinned = !!fresh.pinned;
  state.currentSession.workspace = fresh.workspace || '';
  state.currentSession.updatedAt = fresh.updatedAt;
  syncPetFocusedSession(state.currentSession);
  updateTaskBar();
  renderSessionList();
}

function isDefaultSessionTitle(title) {
  const value = String(title || '').trim().toLowerCase();
  return !value || value === 'new chat' || value === '新对话';
}

function getSessionMessageCount(session) {
  if (Array.isArray(session?.messages)) return session.messages.length;
  return Number(session?.messageCount) || 0;
}

function isBlankNewChat(session) {
  return !!session && isDefaultSessionTitle(session.title) && getSessionMessageCount(session) === 0;
}

function isBlankUnassignedNewChat(session) {
  return isBlankNewChat(session) && !String(session.workspace || '').trim();
}

function syncCurrentSessionWorkspace(workspace) {
  if (!state.currentSession) return;
  state.currentSession.workspace = workspace || '';
  const summary = state.sessions.find(session => session.id === state.currentSession.id);
  if (summary) summary.workspace = workspace || '';
  void window.YanTerminal?.syncWorkspace?.();
}

function normalizeYanxiWorkspacePayload(payload) {
  if (typeof payload === 'string') return { workspace: payload, requestId: '' };
  return {
    workspace: String(payload?.workspace || ''),
    requestId: String(payload?.requestId || ''),
  };
}

function scheduleYanxiWorkspaceSync(payload, targetSessionId) {
  const normalized = normalizeYanxiWorkspacePayload(payload);
  if (!targetSessionId) {
    pendingYanxiRendererSync = { payload: normalized };
    return Promise.resolve({ ok: true, deferred: true });
  }
  if (normalized.requestId && appliedYanxiRequestIds.has(normalized.requestId)) {
    return yanxiWorkspaceSyncQueue;
  }
  if (normalized.requestId) {
    appliedYanxiRequestIds.add(normalized.requestId);
    if (appliedYanxiRequestIds.size > 100) {
      appliedYanxiRequestIds.delete(appliedYanxiRequestIds.values().next().value);
    }
  }

  yanxiWorkspaceSyncQueue = yanxiWorkspaceSyncQueue
    .then(() => applyYanxiWorkspaceToSession(normalized, targetSessionId))
    .catch((error) => {
      if (normalized.requestId) appliedYanxiRequestIds.delete(normalized.requestId);
      console.error('[yanxi-workspace-ui]', error);
      toast(`Yanxi Code 工作区同步失败：${error.message || error}`);
      return { ok: false, error: String(error.message || error) };
    });
  return yanxiWorkspaceSyncQueue;
}

async function applyYanxiWorkspaceToSession(payload, targetSessionId) {
  const workspace = payload.workspace || '';
  const target = state.currentSession?.id === targetSessionId
    ? state.currentSession
    : await api.getSession(targetSessionId);
  if (!target) throw new Error('目标任务不存在');

  const updated = await api.setSessionWorkspace(targetSessionId, workspace, false);
  if (!updated) throw new Error('目标任务工作区写入失败');

  const summary = state.sessions.find(session => session.id === targetSessionId);
  if (summary) {
    summary.workspace = workspace;
    summary.updatedAt = updated.updatedAt;
  }

  if (state.currentSession?.id !== targetSessionId) {
    renderSessionList();
    return { ok: true, workspace, background: true };
  }

  state.currentSession.workspace = workspace;
  state.currentSession.updatedAt = updated.updatedAt;
  state.config = await api.activateWorkspace(workspace);
  syncCurrentSessionWorkspace(workspace);
  syncPetFocusedSession(state.currentSession);
  switchSidebarNav('tasks');
  closeSettings();
  window.YanCodeMap?.close();
  renderSessionList();
  await renderRightSidebarFiles();
  updateTaskBar();
  updateContextInfo();
  window.YanCodeMap?.handleWorkspaceChanged?.({ workspace });
  toast(workspace ? '已从 Yanxi Code 同步工作区' : '已从 Yanxi Code 清除当前任务工作区');
  return { ok: true, workspace };
}

let deleteSessionConfirmResolver = null;

function resolveDeleteSessionConfirmation(confirmed) {
  const resolver = deleteSessionConfirmResolver;
  deleteSessionConfirmResolver = null;
  $('#deleteSessionModal')?.classList.add('hidden');
  resolver?.(!!confirmed);
}

function requestSessionDeleteConfirmation(session) {
  if (deleteSessionConfirmResolver) resolveDeleteSessionConfirmation(false);
  const title = displaySessionTitle(session?.title);
  const count = getSessionMessageCount(session);
  $('#deleteSessionDesc').textContent = `“${title}”包含 ${count} 条消息。`;
  $('#deleteSessionModal').classList.remove('hidden');
  return new Promise(resolve => { deleteSessionConfirmResolver = resolve; });
}

function bindDeleteSessionDialog() {
  $('#deleteSessionCancel')?.addEventListener('click', () => resolveDeleteSessionConfirmation(false));
  $('#deleteSessionConfirm')?.addEventListener('click', () => resolveDeleteSessionConfirmation(true));
  $('#deleteSessionModal')?.addEventListener('click', e => {
    if (e.target?.id === 'deleteSessionModal') resolveDeleteSessionConfirmation(false);
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && deleteSessionConfirmResolver) resolveDeleteSessionConfirmation(false);
  });
}

function renderSessionList() {
  const list = $('#sessionList');
  const q = ($('#searchInput').value || '').trim().toLowerCase();
  const items = state.sessions.filter(s =>
    !q || (s.title || '').toLowerCase().includes(q)
  );

  if (items.length === 0) {
    list.innerHTML = `<div class="session-empty">${q ? '没有匹配的对话' : '暂无对话 · 点击上方开始'}</div>`;
    return;
  }

  list.innerHTML = items.map(s => {
    const running = isSessionRunning(s.id);
    return `
    <div class="session-item ${state.currentSession && s.id === state.currentSession.id ? 'active' : ''} ${running ? 'running' : ''} ${s.pinned ? 'pinned' : ''}" data-id="${s.id}">
      ${running ? '<span class="session-spinner"></span>' : ''}
      ${s.pinned ? `<span class="session-pin" title="已置顶">${ICONS.pin}</span>` : ''}
      <span class="session-title">${escapeHtml(displaySessionTitle(s.title))}</span>
      <button class="session-del" data-del="${s.id}" title="删除">${ICONS.trash}</button>
    </div>`;
  }).join('');

  list.querySelectorAll('.session-item').forEach(el => {
    el.addEventListener('click', (e) => {
      if (e.target.closest('[data-del]')) return;
      switchSidebarNav('tasks');
      loadSession(el.dataset.id);
    });
  });
  list.querySelectorAll('[data-del]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.del;
      // Prevent deleting the last remaining session
      if (state.sessions.length <= 1) {
        toast('至少保留一个任务');
        return;
      }
      const summary = state.sessions.find(session => session.id === id);
      const session = state.currentSession?.id === id
        ? state.currentSession
        : (await api.getSession(id).catch(() => null)) || summary;
      let confirmed = false;
      if (!isBlankNewChat(session)) {
        confirmed = await requestSessionDeleteConfirmation(session);
        if (!confirmed) return;
      }
      const result = await api.deleteSession(id, confirmed);
      if (result?.ok === false) { toast(result.error || '删除失败'); return; }
      if (state.currentSession && state.currentSession.id === id) {
        state.currentSession = null;
        clearMessages();
      }
      await refreshSessions();
      if (!state.currentSession && state.sessions.length > 0) {
        await loadSession(state.sessions[0].id);
      }
      toast('已删除任务');
    });
  });
}

$('#searchInput').addEventListener('input', renderSessionList);

let newSessionPromise = null;

async function newSession() {
  if (newSessionPromise) return newSessionPromise;
  newSessionPromise = createOrActivateNewSession();
  try {
    return await newSessionPromise;
  } finally {
    newSessionPromise = null;
  }
}

async function createOrActivateNewSession() {
  switchSidebarNav('tasks');
  const existing = state.sessions.find(isBlankUnassignedNewChat);
  if (existing) {
    if (state.currentSession?.id !== existing.id) {
      if (state.currentSession?.id) pauseUiForSession(state.currentSession.id);
      await loadSession(existing.id);
    }
    return existing;
  }
  if (state.currentSession?.id) pauseUiForSession(state.currentSession.id);
  const s = await api.createSession();
  state.currentSession = s;
  syncPetFocusedSession(s);
  setComposerSkills([]);
  clearMessages();
  setEmptyState(true);
  state.config = await api.setConfig({ workspace: '' });
  await window.YanTerminal?.syncWorkspace?.();
  await renderRightSidebarFiles();
  syncCurrentSessionAgentUi(s);
  updateTaskBar();
  updateSendState();
  await refreshSessions();
}

async function loadSession(id) {
  if (state.currentSession?.id && state.currentSession.id !== id) pauseUiForSession(state.currentSession.id);
  const activeEntry = state.activeRuns.get(id);
  const s = activeEntry?.sessionRef || await api.getSession(id);
  if (!s) return;
  state.currentSession = s;
  syncPetFocusedSession(s);
  setComposerSkills([]);
  state.config = await api.setConfig({ workspace: s.workspace || '' });
  await window.YanTerminal?.syncWorkspace?.();
  renderMessages(s.messages || []);
  setEmptyState((s.messages || []).length === 0);

  const runCtx = getRunCtx(s.id);
  syncCurrentSessionAgentUi(s);
  if (runCtx) bindActiveRunUi(s.id);
  else showTyping(false);

  await renderRightSidebarFiles();
  updateTaskBar();
  updateSendState();
  renderSessionList();
}

async function saveCurrentSession(session = state.currentSession) {
  if (!session) return;
  if ((!session.title || session.title === 'New chat' || session.title === '新对话') &&
      session.messages && session.messages.length) {
    const firstUser = session.messages.find(m => m.role === 'user');
    if (firstUser) {
      const title = deriveTitle(firstUser.content);
      session.title = title;
      await api.renameSession(session.id, title);
      if (state.currentSession?.id === session.id) syncPetFocusedSession(session);
    }
  }
  await api.saveSession(session);
  await refreshSessions();
  if (state.currentSession?.id === session.id) updateTaskBar();
}

function deriveTitle(text) {
  const clean = String(text).replace(/\s+/g, ' ').trim();
  return clean.length > 30 ? clean.slice(0, 30) + '…' : clean;
}

function displaySessionTitle(title) {
  return isDefaultSessionTitle(title) ? '新对话' : title;
}

// ============================================================
// Sidebar toggle
// ============================================================
$('#sidebarToggle').addEventListener('click', () => {
  setLeftSidebarOpen($('#app').classList.contains('sidebar-hidden'));
});

// ============================================================
// Messages rendering
// ============================================================
function clearMessages() {
  $('#messages').innerHTML = '';
  renderTurnScaleNavigation();
}

function renderMessages(messages) {
  suppressChatAutoScroll = true;
  try {
    clearMessages();
    messages.forEach((m, i) => appendMessage(m.role, m.content, m.attachments, false, i, m.ts, m.duration, m.agentRun, m.skillCalls || m.skillCall));
    renderTurnScaleNavigation();
  } finally {
    suppressChatAutoScroll = false;
  }
  // 历史记录一次性渲染完成后再定位到底部，避免逐条消息触发平滑滚动。
  requestAnimationFrame(() => scrollChatToBottom({ instant: true }));
}

function setEmptyState(empty) {
  $('#pageChat').classList.toggle('empty', empty);
  scheduleTurnScaleUpdate();
}

let turnScaleFrame = 0;

function getConversationTurnElements() {
  return $$('#messages .msg.user');
}

function renderTurnScaleNavigation() {
  const nav = $('#turnScaleNav');
  const scroller = $('#chatScroll');
  if (!nav || !scroller) return;
  const turns = getConversationTurnElements();
  const shouldShow = turns.length >= 2 && scroller.scrollHeight > scroller.clientHeight + 24;
  nav.classList.toggle('hidden', !shouldShow);
  if (!shouldShow) {
    nav.innerHTML = '';
    return;
  }

  nav.innerHTML = turns.map((turn, index) => {
    const body = turn.querySelector('.msg-body')?.textContent?.replace(/\s+/g, ' ').trim() || '';
    const label = `第 ${index + 1} 回合${body ? `：${body.slice(0, 48)}` : ''}`;
    return `<button type="button" class="turn-scale-tick" data-turn-index="${index}" title="${escapeAttr(label)}" aria-label="${escapeAttr(label)}"></button>`;
  }).join('');

  nav.querySelectorAll('.turn-scale-tick').forEach(button => {
    button.addEventListener('click', () => {
      const target = turns[Number(button.dataset.turnIndex)];
      if (!target) return;
      scroller.scrollTo({ top: Math.max(0, target.offsetTop - 18), behavior: 'smooth' });
    });
  });
  updateTurnScaleNavigation();
}

function updateTurnScaleNavigation() {
  const nav = $('#turnScaleNav');
  const scroller = $('#chatScroll');
  if (!nav || nav.classList.contains('hidden') || !scroller) return;
  const turns = getConversationTurnElements();
  const ticks = $$('.turn-scale-tick', nav);
  if (turns.length !== ticks.length) {
    renderTurnScaleNavigation();
    return;
  }

  const contentHeight = Math.max(1, $('#messages').scrollHeight - 1);
  const anchor = scroller.scrollTop + Math.min(120, scroller.clientHeight * 0.28);
  let activeIndex = 0;
  turns.forEach((turn, index) => {
    const ratio = Math.max(0, Math.min(1, turn.offsetTop / contentHeight));
    ticks[index].style.top = `calc(${(ratio * 100).toFixed(3)}% - 6px)`;
    if (turn.offsetTop <= anchor) activeIndex = index;
  });
  ticks.forEach((tick, index) => {
    const active = index === activeIndex;
    tick.classList.toggle('active', active);
    if (active) tick.setAttribute('aria-current', 'step');
    else tick.removeAttribute('aria-current');
  });
}

function scheduleTurnScaleUpdate() {
  if (turnScaleFrame) cancelAnimationFrame(turnScaleFrame);
  turnScaleFrame = requestAnimationFrame(() => {
    turnScaleFrame = 0;
    const nav = $('#turnScaleNav');
    const scroller = $('#chatScroll');
    const turns = getConversationTurnElements();
    const shouldShow = turns.length >= 2 && scroller?.scrollHeight > scroller?.clientHeight + 24;
    if (!!nav && nav.classList.contains('hidden') === shouldShow) renderTurnScaleNavigation();
    else updateTurnScaleNavigation();
  });
}

// ============================================================
// Sidebar navigation & main pages
// ============================================================
let currentMainPage = 'chat';
let skillMarketFilter = 'all';

function syncSidebarAccessibility() {
  const leftOpen = !$('#app').classList.contains('sidebar-hidden');
  const rightOpen = !$('#app').classList.contains('rs-hidden');
  $('#sidebar')?.toggleAttribute('inert', !leftOpen);
  $('#rightSidebar')?.toggleAttribute('inert', !rightOpen);
  $('#sidebarToggle')?.setAttribute('aria-expanded', String(leftOpen));
  $('#rightSidebarToggleBtn')?.setAttribute('aria-expanded', String(rightOpen));
  $('#rightSidebarToggleBtn')?.classList.toggle('active', rightOpen);
}

function notifySidebarLayoutChanged() {
  requestAnimationFrame(() => {
    scheduleTurnScaleUpdate();
  });
}

let sidebarTransitionSeq = 0;
function runSidebarTransition(kind, update) {
  const root = document.documentElement;
  const transitionId = ++sidebarTransitionSeq;
  const reducedMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches;
  const applyUpdate = () => {
    update();
    syncSidebarAccessibility();
    notifySidebarLayoutChanged();
  };

  if (!document.startViewTransition || reducedMotion) {
    applyUpdate();
    return;
  }

  root.dataset.sidebarTransition = kind;
  const transition = document.startViewTransition(applyUpdate);
  transition.finished.finally(() => {
    if (transitionId === sidebarTransitionSeq) delete root.dataset.sidebarTransition;
    notifySidebarLayoutChanged();
  });
}

function setLeftSidebarOpen(open) {
  runSidebarTransition(open ? 'left-open' : 'left-close', () => {
    $('#app').classList.toggle('sidebar-hidden', !open);
  });
}

function setRightSidebarOpen(open) {
  runSidebarTransition(open ? 'right-open' : 'right-close', () => {
    $('#app').classList.toggle('rs-hidden', !open);
  });
}

function closeRightSidebar() {
  setRightSidebarOpen(false);
}

function showMainPage(page) {
  currentMainPage = page;
  $('#pageChat').classList.toggle('hidden', page !== 'chat');
  $('#pagePartner').classList.toggle('hidden', page !== 'partner');
  $('#pageSkills').classList.toggle('hidden', page !== 'skills');
  $('#pageMcp').classList.toggle('hidden', page !== 'mcp');
  $('#pageAutomation').classList.toggle('hidden', page !== 'automation');
  if (page !== 'chat') closeTaskActionsMenu();
  closeBrowserPanel();
  window.YanTerminal?.close();
  if (page !== 'chat') window.YanCodeMap?.close();

  if (page !== 'chat') closeRightSidebar();

  if (page === 'skills') renderSkillMarket();
  if (page === 'mcp') renderMcpPage();
  if (page === 'automation') renderAutomationPage();
}

function closeAppSwitcherMenu() {
  $('#appSwitcherMenu')?.classList.add('hidden');
  $('#appSwitcherButton')?.setAttribute('aria-expanded', 'false');
}

function setActiveApplication(mode, options = {}) {
  const nextMode = mode === 'partner' && window.YanPartner ? 'partner' : 'agent';
  state.appMode = nextMode;
  $('#app')?.classList.toggle('partner-mode', nextMode === 'partner');
  $('#agentSidebarNav')?.classList.toggle('hidden', nextMode !== 'agent');
  $('#sidebarTasksPanel')?.classList.toggle('hidden', nextMode !== 'agent');
  $('#partnerSidebarPanel')?.classList.toggle('hidden', nextMode !== 'partner');
  const brandName = $('#sidebarBrandName');
  if (brandName) brandName.textContent = nextMode === 'partner' ? 'Yan Partner' : 'Yan Agent';
  $$('.app-switcher-option').forEach(button => {
    button.classList.toggle('active', button.dataset.appMode === nextMode);
  });
  closeAppSwitcherMenu();

  if (nextMode === 'partner') {
    window.YanPartner?.activate();
    showMainPage('partner');
  } else {
    window.YanPartner?.deactivate();
    showMainPage('chat');
    renderSessionList();
    updateTaskBar();
    updateSendState();
  }
  if (options.persist !== false) {
    try { localStorage.setItem('yan-active-app', nextMode); } catch {}
  }
}

function switchSidebarNav(nav) {
  if (state.appMode !== 'agent') setActiveApplication('agent');
  $$('.sidebar-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.nav === nav));
  // 任务列表在能力页保持可见，用户可以从 Skill/MCP/自动化直接返回当前任务。
  $('#sidebarTasksPanel').classList.toggle('hidden', state.appMode !== 'agent');
  if (nav === 'tasks') {
    showMainPage('chat');
  } else {
    showMainPage(nav);
  }
}

$('#newTaskNavBtn').addEventListener('click', newSession);

$('#appSwitcherButton')?.addEventListener('click', event => {
  event.stopPropagation();
  const menu = $('#appSwitcherMenu');
  const open = menu?.classList.contains('hidden');
  menu?.classList.toggle('hidden', !open);
  event.currentTarget.setAttribute('aria-expanded', String(!!open));
});

$$('.app-switcher-option').forEach(button => {
  button.addEventListener('click', () => setActiveApplication(button.dataset.appMode));
});

document.addEventListener('click', event => {
  if (!event.target.closest('.sidebar-brand-shell')) closeAppSwitcherMenu();
});

document.addEventListener('keydown', event => {
  if (event.key === 'Escape') closeAppSwitcherMenu();
});

$$('.sidebar-nav-item[data-nav]').forEach(btn => {
  btn.addEventListener('click', () => switchSidebarNav(btn.dataset.nav));
});

async function refreshSkillPrompts() {
  await refreshInstalledSkillCatalog();
}

async function refreshInstalledSkillCatalog() {
  const installed = await api.listSkills();
  state.skills = installed;
  const sourceOrder = { builtin: 0, installed: 1 };
  installedSkillCatalog = installed.map(s => ({
      ...s,
      installed: true
    })).sort((a, b) => {
    const ao = sourceOrder[a.source === 'builtin' ? 'builtin' : 'installed'] ?? 9;
    const bo = sourceOrder[b.source === 'builtin' ? 'builtin' : 'installed'] ?? 9;
    if (ao !== bo) return ao - bo;
    return (a.name || a.id).localeCompare(b.name || b.id);
  });
}

async function loadSkillMarketItems() {
  try {
    skillMarketItems = await api.getSkillMarket?.() || [];
  } catch {
    skillMarketItems = typeof SKILL_MARKET !== 'undefined' ? SKILL_MARKET : [];
  }
  return skillMarketItems;
}

async function renderSkillMarket() {
  const grid = $('#skillMarketGrid');
  const customList = $('#customSkillList');
  const filters = $('#skillTagFilters');
  if (!grid || !customList) return;

  await loadSkillMarketItems();
  const market = skillMarketItems;
  const custom = await api.getCustomSkills();
  const installedSkills = await api.listSkills();
  const installedIds = new Set(installedSkills.map(s => s.id));
  const installedView = skillMarketFilter === 'installed';
  $('#skillInstalledSection')?.classList.toggle('hidden', installedView);
  const customCountEl = $('#customSkillCount');
  if (customCountEl) customCountEl.textContent = `${custom.length} 项`;

  if (filters) {
    const tags = [
      { id: 'all', label: '全部' },
      { id: 'installed', label: '已安装' },
      ...Object.entries(SKILL_TAG_LABELS).map(([id, label]) => ({ id, label }))
    ];
    filters.innerHTML = tags.map(t => `
      <button type="button" class="skill-tag-btn ${skillMarketFilter === t.id ? 'active' : ''}" data-tag="${t.id}" aria-pressed="${skillMarketFilter === t.id}">
        ${escapeHtml(t.label)}
        <span class="skill-tag-count">${t.id === 'all'
          ? market.length
          : t.id === 'installed'
            ? installedSkills.length
            : market.filter(s => s.tags?.includes(t.id)).length}</span>
      </button>
    `).join('');
    filters.querySelectorAll('.skill-tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        skillMarketFilter = btn.dataset.tag;
        renderSkillMarket();
      });
    });
  }

  let items;
  if (installedView) items = installedSkills;
  else if (skillMarketFilter === 'all') items = market;
  else items = market.filter(s => s.tags?.includes(skillMarketFilter));

  const q = skillMarketSearch.trim().toLowerCase();
  const filtered = q
    ? items.filter(s =>
      s.id.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      (s.desc || '').toLowerCase().includes(q)
    )
    : items;

  const countEl = $('#skillMarketCount');
  if (countEl) countEl.textContent = `${filtered.length} / ${items.length} 项 · ${installedSkills.length} 已安装`;

  grid.innerHTML = filtered.length ? filtered.map(s => {
    const tag = s.tags?.[0];
    const tagLabel = tag ? SKILL_TAG_LABELS[tag] : '';
    const installed = installedView || installedIds.has(s.id);
    const removable = installedView && s.source !== 'builtin';
    const sourceLabel = installedView
      ? (s.source === 'builtin' ? 'Yan Agent' : (s.source || '本地安装'))
      : s.repo;
    const sourceMeta = installedView
      ? (s.source === 'builtin' ? '内置能力' : '已安装')
      : `${s.stars || '—'} stars`;
    const action = removable ? 'remove' : installed ? 'installed' : 'install';
    return `
    <div class="skill-card" data-market-id="${escapeAttr(s.id)}">
      <div class="skill-card-logo">${skillLogoHtml(s)}</div>
      <div class="skill-card-primary">
        <div class="skill-card-name-row">
          <span class="skill-card-name">${escapeHtml(s.name)}</span>
          ${tagLabel ? `<span class="skill-card-tag">${escapeHtml(tagLabel)}</span>` : ''}
        </div>
        <p class="skill-card-desc">${escapeHtml(s.desc)}</p>
      </div>
      <div class="skill-card-source">
        <div class="skill-card-repo" title="${escapeAttr(sourceLabel)}">${escapeHtml(sourceLabel)}</div>
        <span class="skill-card-stars">${escapeHtml(sourceMeta)}</span>
      </div>
      <button type="button" class="ghost-btn skill-install-btn ${removable ? 'danger' : ''}" data-skill-action="${action}" ${action === 'installed' ? 'disabled aria-disabled="true"' : ''}>
        ${removable ? '移除' : installed ? '已安装' : '安装'}
      </button>
    </div>`;
  }).join('') : `
    <div class="workbench-empty">
      <span class="workbench-empty-mark" aria-hidden="true">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>
      </span>
      <div class="workbench-empty-copy">
        <strong>${q ? '没有匹配的 Skill' : '这个分类暂时为空'}</strong>
        <span>${q ? '换一个关键词，或清除搜索查看完整目录。' : '返回全部分类继续浏览。'}</span>
      </div>
      <button type="button" class="ghost-btn workbench-empty-action" data-skill-empty-reset>${q ? '清除搜索' : '查看全部'}</button>
    </div>`;
  bindSkillLogoFallbacks(grid);

  grid.querySelector('[data-skill-empty-reset]')?.addEventListener('click', () => {
    skillMarketSearch = '';
    skillMarketFilter = 'all';
    const search = $('#skillMarketSearch');
    if (search) search.value = '';
    renderSkillMarket();
  });

  grid.querySelectorAll('.skill-install-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.skill-card');
      const id = card.dataset.marketId;
      const action = btn.dataset.skillAction;
      if (action === 'installed') return;
      if (action === 'remove') {
        await api.removeCustomSkill(id);
      } else {
        const item = market.find(s => s.id === id);
        if (!item) return;
        const res = await api.addCustomSkill({ ...item, source: item.repo });
        if (res?.error) { toast(res.error); return; }
      }
      await refreshSkillPrompts();
      await renderSkillMarket();
    });
  });

  if (!custom.length) {
    customList.innerHTML = `
      <div class="workbench-empty">
        <span class="workbench-empty-mark" aria-hidden="true">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><path d="M12 3v18M3 12h18"/></svg>
        </span>
        <div class="workbench-empty-copy">
          <strong>还没有自定义 Skill</strong>
          <span>从目录安装，或导入本地 JSON 文件。</span>
        </div>
        <button type="button" class="ghost-btn workbench-empty-action" data-skill-import-empty>导入 Skill</button>
      </div>`;
    customList.querySelector('[data-skill-import-empty]')?.addEventListener('click', () => $('#skillImportInput')?.click());
    return;
  }
  customList.innerHTML = custom.map(s => {
    const tag = s.tags?.[0];
    const tagLabel = tag ? (SKILL_TAG_LABELS[tag] || tag) : '';
    return `
    <div class="skill-custom-item" data-id="${escapeAttr(s.id)}">
      <div class="skill-custom-logo">${skillLogoHtml(s)}</div>
      <div class="skill-custom-info">
        <div class="skill-custom-name-row">
          <span class="skill-custom-name">${escapeHtml(s.name)}</span>
          ${tagLabel ? `<span class="skill-card-tag">${escapeHtml(tagLabel)}</span>` : ''}
        </div>
        <div class="skill-custom-desc">${escapeHtml(s.desc || s.id)}</div>
      </div>
      <span class="skill-card-tag">${escapeHtml(s.source || '本地导入')}</span>
      <button class="msg-action-btn" data-skill-del title="移除" aria-label="移除 ${escapeAttr(s.name)}">${ICONS.trash}</button>
    </div>`;
  }).join('');
  bindSkillLogoFallbacks(customList);

  customList.querySelectorAll('[data-skill-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.skill-custom-item').dataset.id;
      await api.removeCustomSkill(id);
      await refreshSkillPrompts();
      await renderSkillMarket();
    });
  });
}

$('#skillImportBtn')?.addEventListener('click', () => $('#skillImportInput')?.click());
$('#skillMarketSearch')?.addEventListener('input', (e) => {
  skillMarketSearch = e.target.value || '';
  renderSkillMarket();
});
$('#skillImportInput')?.addEventListener('change', async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const text = await file.text();
    const data = JSON.parse(text);
    const skills = Array.isArray(data) ? data : [data];
    let ok = 0;
    for (const s of skills) {
      const res = await api.addCustomSkill(s);
      if (!res?.error) ok++;
    }
    await refreshSkillPrompts();
    await renderSkillMarket();
    toast(ok ? `成功导入 ${ok} 个 Skill` : '导入失败，请检查 JSON 格式');
  } catch {
    toast('JSON 解析失败');
  }
  e.target.value = '';
});

function openCapabilityDrawer(dialogId, firstFieldId) {
  const dialog = $('#' + dialogId);
  if (!dialog) return;
  if (!dialog.open) dialog.showModal();
  requestAnimationFrame(() => $('#' + firstFieldId)?.focus());
}

function closeCapabilityDrawer(dialogId) {
  const dialog = $('#' + dialogId);
  if (dialog?.open) dialog.close();
}

$('#mcpOpenCreateBtn')?.addEventListener('click', () => openCapabilityDrawer('mcpCreateDialog', 'mcpNewName'));
$('#mcpCloseCreateBtn')?.addEventListener('click', () => closeCapabilityDrawer('mcpCreateDialog'));
$('#autoOpenCreateBtn')?.addEventListener('click', () => openCapabilityDrawer('autoCreateDialog', 'autoNewName'));
$('#autoCloseCreateBtn')?.addEventListener('click', () => closeCapabilityDrawer('autoCreateDialog'));

['mcpCreateDialog', 'autoCreateDialog'].forEach(id => {
  const dialog = $('#' + id);
  dialog?.addEventListener('click', e => {
    if (e.target === dialog) dialog.close();
  });
});

async function renderMcpPage() {
  const list = $('#mcpPageList');
  const stats = $('#mcpStats');
  const registryHead = $('#mcpRegistryHead');
  if (!list) return;
  const servers = await api.mcpList();
  const enabled = servers.filter(s => s.enabled).length;
  if (stats) {
    stats.textContent = `${enabled} 个启用 · ${servers.length} 个服务`;
  }
  registryHead?.classList.toggle('hidden', !servers.length);
  if (!servers.length) {
    list.innerHTML = `
      <div class="workbench-empty workbench-empty-stage">
        <span class="workbench-empty-visual mcp-empty-visual" aria-hidden="true">
          <svg width="64" height="64" viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="7" y="20" width="18" height="24" rx="5"/><rect x="39" y="20" width="18" height="24" rx="5"/><path d="M25 28h14M25 36h14"/><circle cx="16" cy="32" r="2" fill="currentColor" stroke="none"/><circle cx="48" cy="32" r="2" fill="currentColor" stroke="none"/></svg>
        </span>
        <div class="workbench-empty-copy">
          <strong>还没有 MCP 服务</strong>
          <span>连接浏览器、数据库或本地工具，让 Agent 能真正执行操作。</span>
        </div>
        <button type="button" class="primary-btn workbench-empty-action" data-open-mcp-create>添加第一个服务</button>
      </div>`;
    list.querySelector('[data-open-mcp-create]')?.addEventListener('click', () => openCapabilityDrawer('mcpCreateDialog', 'mcpNewName'));
    return;
  }

  list.innerHTML = servers.map(s => {
    const cmdLine = [s.command, ...(s.args || [])].join(' ');
    return `
    <div class="mgmt-row mcp-card" data-id="${escapeAttr(s.id)}">
      <div class="mgmt-row-main">
        <div class="mgmt-row-titlebar">
          <span class="mgmt-row-title">${escapeHtml(s.name)}</span>
          <span class="mgmt-origin">${s.builtin ? '内置' : '自定义'}</span>
        </div>
        <code class="mgmt-cmd-line" title="${escapeAttr(cmdLine)}">${escapeHtml(cmdLine)}</code>
      </div>
      <div class="mgmt-row-state">
        <div class="mgmt-state-label">
          <span class="mgmt-state-dot" data-service-state data-state="${s.enabled ? 'on' : 'off'}" aria-hidden="true"></span>
          <span data-service-state-text>${s.enabled ? '已启用' : '已停用'}</span>
        </div>
        <div class="mgmt-inline-result idle" data-test-result aria-live="polite">尚未测试</div>
      </div>
      <div class="mgmt-row-actions">
        <button type="button" class="mgmt-action-btn is-primary" data-mcp-act="test">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          测试
        </button>
        <button type="button" class="mgmt-action-btn" data-mcp-act="toggle">${s.enabled ? '停用' : '启用'}</button>
        ${s.builtin ? '' : '<button type="button" class="mgmt-action-btn danger" data-mcp-act="delete">删除</button>'}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-mcp-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.mgmt-row');
      const id = card.dataset.id;
      const act = btn.dataset.mcpAct;
      const testEl = card.querySelector('[data-test-result]');

      if (act === 'test') {
        testEl.textContent = '测试中…';
        testEl.className = 'mgmt-inline-result testing';
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        try {
          const servers = await api.mcpList();
          const s = servers.find(x => x.id === id);
          if (!s?.enabled) {
            await api.mcpUpdate(id, { enabled: true });
            card.querySelector('[data-service-state]')?.setAttribute('data-state', 'on');
            const stateText = card.querySelector('[data-service-state-text]');
            if (stateText) stateText.textContent = '已启用';
          }
          await api.mcpStop(id);
          const res = await api.mcpStart(id);
          if (res.error) {
            testEl.textContent = '连接失败 · ' + res.error;
            testEl.className = 'mgmt-inline-result fail';
          } else {
            testEl.textContent = `连接成功 · ${res.tools?.length || 0} 个工具`;
            testEl.className = 'mgmt-inline-result ok';
          }
        } finally {
          btn.disabled = false;
          btn.removeAttribute('aria-busy');
        }
      } else if (act === 'delete') {
        await api.mcpRemove(id);
        await renderMcpPage();
      } else if (act === 'toggle') {
        const servers = await api.mcpList();
        const s = servers.find(x => x.id === id);
        if (!s) return;
        const enabled = !s.enabled;
        await api.mcpUpdate(id, { enabled });
        if (!enabled) await api.mcpStop(id);
        await renderMcpPage();
      }
    });
  });
}

async function renderAutomationPage() {
  const list = $('#autoList');
  const stats = $('#autoStats');
  const registryHead = $('#autoRegistryHead');
  if (!list) return;
  const autos = await api.autoList();
  const enabled = autos.filter(a => a.enabled).length;
  if (stats) {
    stats.textContent = `${enabled} 个启用 · ${autos.length} 个任务`;
  }
  registryHead?.classList.toggle('hidden', !autos.length);
  if (!autos.length) {
    list.innerHTML = `
      <div class="workbench-empty workbench-empty-stage">
        <span class="workbench-empty-visual automation-empty-visual" aria-hidden="true">
          <svg width="72" height="58" viewBox="0 0 72 58" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M9 42h54"/><circle cx="17" cy="42" r="5"/><circle cx="36" cy="42" r="5"/><circle cx="55" cy="42" r="5"/><path d="M17 37V22h19V12M36 37V26h19v11"/><path d="M31 12h10M36 7v10"/></svg>
        </span>
        <div class="workbench-empty-copy">
          <strong>还没有自动化任务</strong>
          <span>把重复工作交给调度器，Yan Agent 会在独立对话中按时执行。</span>
        </div>
        <button type="button" class="primary-btn workbench-empty-action" data-open-auto-create>创建第一个任务</button>
      </div>`;
    list.querySelector('[data-open-auto-create]')?.addEventListener('click', () => openCapabilityDrawer('autoCreateDialog', 'autoNewName'));
    return;
  }

  list.innerHTML = autos.map(a => {
    const sched = a.schedule || {};
    const typeLabel = { interval: '间隔', daily: '每日', once: '一次性' }[sched.type] || '未知';
    const statusClass = a.lastStatus === 'ok' ? 'ok' : a.lastStatus === 'error' ? 'fail' : a.enabled ? 'idle' : 'off';
    const statusText = describeAutoStatus(a);
    const running = state.automationRuns.has(a.id);
    const stateKey = running ? 'running' : a.enabled ? 'on' : 'off';
    const stateText = running ? '正在运行' : a.enabled ? '已启用' : '已暂停';
    return `
    <div class="mgmt-row auto-card" data-id="${escapeAttr(a.id)}">
      <div class="mgmt-row-main">
        <div class="mgmt-row-titlebar">
          <span class="mgmt-row-title">${escapeHtml(a.name)}</span>
          <span class="mgmt-schedule-kind">${typeLabel}</span>
        </div>
        <div class="auto-schedule-line">${escapeHtml(describeSchedule(a))}</div>
        <div class="auto-prompt-line" title="${escapeAttr(a.prompt)}">${escapeHtml(a.prompt)}</div>
      </div>
      <div class="mgmt-row-state">
        <div class="mgmt-state-label">
          <span class="mgmt-state-dot" data-state="${stateKey}" aria-hidden="true"></span>
          <span>${stateText}</span>
        </div>
        <div class="mgmt-status-line ${statusClass}">${escapeHtml(statusText)}</div>
      </div>
      <div class="mgmt-row-actions">
        <button type="button" class="mgmt-action-btn is-primary" data-auto-act="run" ${running ? 'disabled aria-disabled="true"' : ''}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          ${running ? '运行中' : '运行'}
        </button>
        <button type="button" class="mgmt-action-btn" data-auto-act="toggle">${a.enabled ? '暂停' : '启用'}</button>
        <button type="button" class="mgmt-action-btn danger" data-auto-act="delete">删除</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-auto-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const row = btn.closest('.mgmt-row');
      const id = row.dataset.id;
      const act = btn.dataset.autoAct;
      const autos = await api.autoList();
      const a = autos.find(x => x.id === id);
      if (!a) return;
      if (act === 'delete') {
        await api.autoRemove(id);
        await renderAutomationPage();
      } else if (act === 'toggle') {
        await api.autoUpdate(id, { enabled: !a.enabled });
        await renderAutomationPage();
      } else if (act === 'run') {
        if (!canStartRun()) { toast('并发任务已达上限（5个），请稍后再试'); return; }
        btn.disabled = true;
        btn.setAttribute('aria-busy', 'true');
        const stateDot = row.querySelector('.mgmt-state-dot');
        const stateLabel = row.querySelector('.mgmt-state-label span:last-child');
        if (stateDot) stateDot.dataset.state = 'running';
        if (stateLabel) stateLabel.textContent = '正在运行';
        runAutomation(a, { manual: true }).finally(() => renderAutomationPage());
      }
    });
  });
}

function appendUserAbortFooter(msgEl) {
  if (!msgEl || msgEl.querySelector('.msg-abort-note')) return;
  const note = document.createElement('div');
  note.className = 'msg-abort-note';
  note.textContent = '用户手动中止输出';
  msgEl.appendChild(note);
}

function formatTokenCount(n) {
  const num = Number(n) || 0;
  if (num >= 1_000_000) return (num / 1_000_000).toFixed(2).replace(/\.?0+$/, '') + 'M';
  if (num >= 10_000) return Math.round(num / 1000) + 'K';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return String(num);
}

function normalizeSkillCalls(value) {
  const source = Array.isArray(value) ? value : (value?.id ? [value] : []);
  const seen = new Set();
  return source.reduce((items, skill) => {
    const id = String(skill?.id || '').trim();
    if (!id || seen.has(id)) return items;
    seen.add(id);
    items.push(skill);
    return items;
  }, []);
}

function appendMessage(role, content, attachments = [], animate = true, msgIndex = -1, ts = null, duration = null, agentRun = null, skillCalls = []) {
  const wrap = $('#messages');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (msgIndex >= 0) el.dataset.msgIndex = msgIndex;
  if (ts) el.dataset.ts = ts;
  if (!animate) el.style.animation = 'none';

  const avatar = '';

  let attHtml = '';
  if (attachments && attachments.length) {
    attHtml = `<div class="msg-attachments">${attachments.map(a =>
      `<span class="msg-attachment ${isImageAttachmentMeta(a) ? 'image' : ''}">${isImageAttachmentMeta(a) ? ICONS.image : ICONS.file}${escapeHtml(a.name)}</span>`
    ).join('')}</div>`;
  }
  const selectedSkillCalls = normalizeSkillCalls(skillCalls);
  const skillHtml = role === 'user' && selectedSkillCalls.length
    ? `<div class="msg-skill-calls">${selectedSkillCalls.map(skill =>
      `<div class="msg-skill-call"><img data-skill-logo src="${escapeAttr(skillLogoPath(skill))}" alt="" aria-hidden="true"><span>${escapeHtml(skill.name || skill.id)}</span></div>`
    ).join('')}</div>`
    : '';

  let bodyHtml;
  if (role === 'assistant') {
    bodyHtml = '<div class="msg-body agent-output"></div>';
  } else {
    bodyHtml = `<div class="msg-body">${skillHtml}${attHtml}${escapeHtml(content)}</div>`;
  }

  const hasContent = !!(content || agentRun || selectedSkillCalls.length);
  let actionsHtml = '';
  if (hasContent && role === 'user') {
    actionsHtml = `
      <div class="msg-actions">
        <button class="msg-action-btn" data-act="copy" title="复制">${ICONS.copy}</button>
        <button class="msg-action-btn" data-act="edit" title="撤回重写">${ICONS.edit}</button>
        <button class="msg-action-btn" data-act="delete" title="删除">${ICONS.trash}</button>
      </div>`;
  } else if (role === 'assistant' && (hasContent || duration != null)) {
    actionsHtml = `<div class="msg-actions">${buildAssistantActionsHtml(agentRun, duration)}</div>`;
  }

  el.innerHTML = avatar + bodyHtml + actionsHtml;
  wrap.appendChild(el);
  bindSkillLogoFallbacks(el);

  if (role === 'assistant') {
    const body = el.querySelector('.msg-body');
    if (agentRun) {
      renderAgentRunBody(body, agentRun, content);
    } else if (content) {
      body.appendChild(buildTextRoundElement(content));
    }
  }

  el.querySelectorAll('.msg-action-btn').forEach(btn => {
    btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, el));
  });

  if (role === 'assistant' && agentRun?.status === 'interrupted') {
    appendUserAbortFooter(el);
  }

  if (role === 'user' && animate) renderTurnScaleNavigation();
  scrollChatToBottom();
  return el;
}

function formatDuration(ms) {
  if (ms < 1000) return ms + 'ms';
  if (ms < 60000) return (ms / 1000).toFixed(1) + 's';
  const m = Math.floor(ms / 60000);
  const s = Math.floor((ms % 60000) / 1000);
  return `${m}m ${s}s`;
}

async function handleMessageAction(action, el) {
  const msgIndex = Number(el.dataset.msgIndex);
  const msgs = state.currentSession?.messages || [];
  const msg = msgs[msgIndex];
  if (!msg) return;

  if (action === 'copy') {
    try {
      await navigator.clipboard.writeText(msg.content || '');
      toast('已复制到剪贴板');
    } catch { toast('复制失败'); }
  } else if (action === 'delete') {
    // 删除该用户消息及其后所有回复（包括对应的 assistant 回复）
    msgs.splice(msgIndex);
    // 先标记后续 DOM 消息再删除 el，避免 el.remove() 后无法匹配
    let found = false;
    $$('#messages .msg').forEach(m => {
      if (found) m.remove();
      if (m === el) { found = true; m.remove(); }
    });
    await saveCurrentSession();
    if (msgs.length === 0) setEmptyState(true);
    renderTurnScaleNavigation();
    toast('已删除消息');
  } else if (action === 'edit') {
    // 撤回重写：把内容填回输入框，删除该消息及之后所有消息
    input.value = msg.content || '';
    const restoredSkills = normalizeSkillCalls(msg.skillCalls || msg.skillCall).map(skill =>
      installedSkillPickerItems().find(item => item.id === skill.id) || skill
    );
    setComposerSkills(restoredSkills);
    msgs.splice(msgIndex);
    let found = false;
    $$('#messages .msg').forEach(m => {
      if (found) m.remove();
      if (m === el) { found = true; m.remove(); }
    });
    await saveCurrentSession();
    if (msgs.length === 0) setEmptyState(true);
    renderTurnScaleNavigation();
    autoGrow();
    updateSendState();
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
    toast('已撤回，可编辑后重发');
  } else if (action === 'rollback') {
    await rollbackMessageRun(msg, el);
  }
}

function scrollChatToBottom({ instant = false } = {}) {
  if (suppressChatAutoScroll) return;
  const sc = $('#chatScroll');
  if (!sc) return;
  if (instant) {
    const previousBehavior = sc.style.scrollBehavior;
    sc.style.scrollBehavior = 'auto';
    sc.scrollTop = sc.scrollHeight;
    sc.style.scrollBehavior = previousBehavior;
  } else {
    sc.scrollTop = sc.scrollHeight;
  }
  scheduleTurnScaleUpdate();
}

// ============================================================
// Composer
// ============================================================
const input = $('#composerInput');
const sendBtn = $('#sendBtn');

input.addEventListener('input', () => {
  autoGrow();
  updateSendState();
});
input.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
}
// 发送与中止共用同一个圆形按钮，只切换中心符号。
const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>';
const STOPPING_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" aria-hidden="true"><path d="M12 3a9 9 0 1 1-8.5 6"/></svg>';
const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>';


function updateSendState() {
  const runCtx = getRunCtx(state.currentSession?.id);
  if (runCtx) {
    // Agent 正在输出/工作：按钮变为中止按钮
    sendBtn.classList.add('stop-mode');
    sendBtn.classList.remove('send-mode');
    sendBtn.classList.toggle('stopping-mode', !!runCtx.shouldAbort);
    sendBtn.innerHTML = runCtx.shouldAbort ? STOPPING_ICON : STOP_ICON;
    sendBtn.disabled = !!runCtx.shouldAbort;
    sendBtn.title = runCtx.shouldAbort ? '正在停止任务' : '中止任务';
    sendBtn.setAttribute('aria-label', runCtx.shouldAbort ? '正在停止任务' : '中止任务');
  } else {
    sendBtn.classList.add('send-mode');
    sendBtn.classList.remove('stop-mode', 'stopping-mode');
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.disabled = !input.value.trim() && state.attachments.length === 0 && state.selectedSkills.length === 0;
    sendBtn.title = '发送';
    sendBtn.setAttribute('aria-label', '发送');
  }
}

sendBtn.addEventListener('click', () => {
  if (isCurrentSessionResponding()) {
    abortTask();
  } else {
    sendMessage();
  }
});

function abortTask() {
  const sessionId = state.currentSession?.id;
  abortSessionById(sessionId);
}

function abortSessionById(sessionId) {
  const runCtx = getRunCtx(sessionId);
  if (!runCtx) return { ok: false, error: 'not running' };
  if (runCtx.shouldAbort) {
    applyAbortRunUi(sessionId);
    return { ok: true, pending: true };
  }
  runCtx.shouldAbort = true;
  if (runCtx.abortController) {
    try { runCtx.abortController.abort(); } catch {}
  }
  if (runCtx.runId && window.yan.cancelImageGeneration) {
    window.yan.cancelImageGeneration(runCtx.runId).catch(() => {});
  }
  applyAbortRunUi(sessionId);
  if (window.Notification && Notification.permission === 'granted' && state.currentSession?.id === sessionId) {
    try {
      new Notification('Yan Agent', { body: '任务已被中断', icon: 'assets/logo.png' });
    } catch {}
  }
  if (state.currentSession?.id === sessionId) toast('任务已被中断');
  finishPetSupervision(runCtx, 'paused', '正在停止任务');
  return { ok: true };
}

function applyAbortRunUi(sessionId) {
  if (!sessionId) return;
  const entry = state.activeRuns.get(sessionId);
  if (!entry) return;
  const { assistantEl, runCtx } = entry;
  runCtx.abortedUiApplied = true;
  if (runCtx.agentState) runCtx.agentState.status = 'interrupted';

  if (state.currentSession?.id === sessionId) {
    showTyping(false);
    updateSendState();
    syncCurrentSessionAgentUi();
  }

  if (!assistantEl?.isConnected) return;
  const body = assistantEl.querySelector('.msg-body');
  if (body) {
    markRunningToolsInterrupted(body);
    renderAgentRunHeader(body, {
      status: 'interrupted',
      iteration: runCtx.agentState?.iteration || 0,
      toolCallCount: runCtx.agentState?.toolCallCount || 0
    });
  }
  appendUserAbortFooter(assistantEl);
}

function markRunningToolsInterrupted(bodyEl) {
  if (!bodyEl) return;
  bodyEl.querySelectorAll('.tool-step.is-running').forEach(cancelToolStepElement);
}

function cancelToolStepElement(step) {
  if (!step || step.classList.contains('is-interrupted')) return;
  step.classList.remove('is-running');
  step.classList.add('is-interrupted');
  step.open = false;
  const header = step.querySelector('.tc-header');
  if (header) {
    const oldBadge = header.querySelector('.tc-badge');
    if (oldBadge) oldBadge.remove();
    const badge = document.createElement('span');
    badge.className = 'tc-badge interrupted';
    badge.textContent = '—';
    badge.setAttribute('aria-label', '已中断');
    header.prepend(badge);
  }
}

// ============================================================
// Installed Skill picker
// ============================================================
function setComposerSkills(skills) {
  const selection = $('#composerSkillSelection');
  state.selectedSkills = normalizeSkillCalls(skills).map(skill => ({
    id: String(skill.id || ''),
    name: String(skill.name || skill.id || 'Skill'),
    desc: String(skill.desc || ''),
    logo: skillLogoPath(skill)
  }));
  if (selection) {
    selection.classList.toggle('hidden', state.selectedSkills.length === 0);
    selection.innerHTML = state.selectedSkills.map(skill => `
      <span class="composer-skill-chip" data-skill-id="${escapeAttr(skill.id)}">
        <img class="composer-skill-logo" data-skill-logo src="${escapeAttr(skill.logo)}" alt="" aria-hidden="true" draggable="false" />
        <span class="composer-skill-name">${escapeHtml(skill.name)}</span>
        <button class="composer-skill-remove" type="button" title="取消 ${escapeAttr(skill.name)}" aria-label="取消 ${escapeAttr(skill.name)}" data-remove-skill="${escapeAttr(skill.id)}">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>
        </button>
      </span>
    `).join('');
    bindSkillLogoFallbacks(selection);
    selection.querySelectorAll('[data-remove-skill]').forEach(button => {
      button.addEventListener('click', () => {
        const id = String(button.dataset.removeSkill || '');
        setComposerSkills(state.selectedSkills.filter(skill => skill.id !== id));
        renderSkillCallList();
        input.focus();
      });
    });
  }
  updateSendState();
}

async function resolveSkillCall(skill) {
  if (!skill?.id) return null;
  const fallback = { id: skill.id, name: skill.name, desc: skill.desc, logo: skill.logo, prompt: '' };
  try {
    const result = await api.readSkill?.(skill.id, '');
    if (result?.ok) {
      return {
        id: String(result.id || skill.id),
        name: String(result.name || skill.name || skill.id),
        desc: String(result.desc || skill.desc || ''),
        logo: skill.logo,
        prompt: String(result.prompt || '')
      };
    }
    console.warn('[skill-call]', result?.error || `Unable to load ${skill.id}`);
  } catch (error) {
    console.warn('[skill-call]', error);
  }
  return fallback;
}

function toggleComposerSkill(skill) {
  if (!skill?.id) return;
  const id = String(skill.id);
  const selected = state.selectedSkills.some(item => item.id === id);
  setComposerSkills(selected
    ? state.selectedSkills.filter(item => item.id !== id)
    : [...state.selectedSkills, skill]
  );
  input.focus();
}

function installedSkillPickerItems() {
  return (installedSkillCatalog.length ? installedSkillCatalog : state.skills)
    .filter(skill => skill?.installed !== false);
}

function renderSkillCallList() {
  const list = $('#skillCallList');
  const count = $('#skillCallCount');
  if (!list) return;
  const items = installedSkillPickerItems();
  if (count) count.textContent = `${items.length} 项`;
  if (!items.length) {
    list.innerHTML = '<div class="skill-call-empty">暂无已安装 Skill</div>';
    return;
  }
  list.innerHTML = items.map((skill, index) => {
    const selected = state.selectedSkills.some(item => item.id === skill.id);
    return `
    <button type="button" class="skill-call-item${selected ? ' is-selected' : ''}" data-skill-index="${index}" aria-pressed="${selected}">
      <span class="skill-call-icon">${skillLogoHtml(skill)}</span>
      <span class="skill-call-text">
        <span class="skill-call-name">${escapeHtml(skill.name || skill.id || '未命名 Skill')}</span>
        <span class="skill-call-desc">${escapeHtml(skill.desc || skill.id || '')}</span>
      </span>
      <span class="skill-call-selected" aria-hidden="true"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2"><polyline points="20 6 9 17 4 12"/></svg></span>
    </button>
  `;
  }).join('');
  bindSkillLogoFallbacks(list);
  list.querySelectorAll('[data-skill-index]').forEach(button => {
    button.addEventListener('click', () => {
      toggleComposerSkill(items[Number(button.dataset.skillIndex)]);
      renderSkillCallList();
    });
  });
}

async function setSkillCallMenuOpen(open) {
  const menu = $('#skillCallMenu');
  const button = $('#skillCallPill');
  if (!menu || !button) return;
  if (open) {
    try { await refreshInstalledSkillCatalog(); } catch (error) { console.error('[skills-picker]', error); }
    renderSkillCallList();
  }
  menu.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', String(open));
}

// ============================================================
// File attachments / upload
// ============================================================
function getSelectedModelCapabilities() {
  const modelId = state.config?.api?.model;
  return (state.config?.models || []).find(model => model.id === modelId)?.capabilities || {};
}

function isImageAttachmentMeta(attachment = {}) {
  if (attachment.kind === 'image' || /^image\//i.test(String(attachment.mimeType || ''))) return true;
  return /\.(?:png|jpe?g|webp|gif)$/i.test(String(attachment.name || attachment.path || ''));
}

function setAttachmentMenuOpen(open) {
  const menu = $('#attachmentMenu');
  const button = $('#attachBtn');
  if (!menu || !button) return;
  menu.classList.toggle('hidden', !open);
  button.setAttribute('aria-expanded', open ? 'true' : 'false');
}

function syncAttachmentMenu() {
  const capabilities = getSelectedModelCapabilities();
  const imageInputEnabled = !!capabilities.imageInput;
  $('#uploadImageAction')?.classList.toggle('hidden', !imageInputEnabled);
  const imageInput = $('#imageInput');
  if (imageInput) imageInput.accept = (capabilities.imageMimeTypes || ['image/png', 'image/jpeg']).join(',');
  setAttachmentMenuOpen(false);
  renderAttachments();
}

function inferImageMimeType(file) {
  const declared = String(file?.type || '').toLowerCase();
  if (declared.startsWith('image/')) return declared === 'image/jpg' ? 'image/jpeg' : declared;
  const ext = String(file?.name || '').split('.').pop().toLowerCase();
  return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[ext] || '';
}

$('#attachBtn').addEventListener('click', (event) => {
  event.stopPropagation();
  const open = $('#attachmentMenu')?.classList.contains('hidden');
  setAttachmentMenuOpen(!!open);
});
$('#uploadFileAction').addEventListener('click', () => {
  setAttachmentMenuOpen(false);
  $('#fileInput').click();
});
$('#uploadImageAction').addEventListener('click', () => {
  setAttachmentMenuOpen(false);
  $('#imageInput').click();
});
document.addEventListener('click', event => {
  if (!event.target.closest('.attachment-action-wrap')) setAttachmentMenuOpen(false);
});
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') setAttachmentMenuOpen(false);
});
$('#fileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    await addAttachment(f);
  }
  e.target.value = '';
});
$('#imageInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    await addAttachment(f, { imageOnly: true });
  }
  e.target.value = '';
});

async function addAttachment(file, { imageOnly = false } = {}) {
  const mimeType = inferImageMimeType(file);
  const isImage = !!mimeType;
  const capabilities = getSelectedModelCapabilities();
  if (imageOnly && !isImage) {
    toast('请选择 PNG、JPEG、WebP 或 GIF 图像');
    return;
  }
  if (isImage && !capabilities.imageInput) {
    toast('当前模型不支持图像输入，请切换多模态模型');
    return;
  }
  if (isImage && !(capabilities.imageMimeTypes || []).includes(mimeType)) {
    toast(`当前模型不支持 ${mimeType.replace('image/', '').toUpperCase()} 图像`);
    return;
  }
  if (isImage && file.size > (Number(capabilities.maxImageBytes) || 20 * 1024 * 1024)) {
    toast('图片不能超过 20MB');
    return;
  }
  try {
    const b64 = await fileToBase64(file);
    const meta = await api.uploadFile(file.name, b64, mimeType || file.type || '');
    if (meta?.error) {
      toast('上传失败：' + meta.error);
      return;
    }
    state.attachments.push({
      name: meta.name,
      path: meta.path,
      size: meta.size,
      kind: isImage ? 'image' : 'file',
      mimeType: mimeType || meta.mimeType || ''
    });
    renderAttachments();
    updateSendState();
  } catch (error) {
    toast('上传失败：' + error.message);
  }
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = r.result;
      resolve(result.substring(result.indexOf(',') + 1));
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function renderAttachments() {
  const box = $('#attachments');
  if (state.attachments.length === 0) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }
  box.classList.remove('hidden');
  const imageInputEnabled = !!getSelectedModelCapabilities().imageInput;
  box.innerHTML = state.attachments.map((a, i) => {
    const image = isImageAttachmentMeta(a);
    return `
    <div class="attachment-chip ${image ? 'image' : ''} ${image && !imageInputEnabled ? 'unsupported' : ''}" title="${image && !imageInputEnabled ? '当前模型不支持图像输入' : escapeHtml(a.name)}">
      <span class="attachment-kind-icon">${image ? ICONS.image : ICONS.file}</span>
      <span>${escapeHtml(a.name)}</span>
      <button class="remove" data-i="${i}" title="移除">${ICONS.close}</button>
    </div>`;
  }).join('');
  box.querySelectorAll('.remove').forEach(btn => {
    btn.addEventListener('click', () => {
      state.attachments.splice(Number(btn.dataset.i), 1);
      renderAttachments();
      updateSendState();
    });
  });
}

// Drag & drop
const composer = $('#composer');
['dragover', 'dragenter'].forEach(ev => {
  composer.addEventListener(ev, (e) => { e.preventDefault(); composer.classList.add('drag'); });
});
['dragleave', 'drop'].forEach(ev => {
  composer.addEventListener(ev, (e) => { e.preventDefault(); composer.classList.remove('drag'); });
});
composer.addEventListener('drop', async (e) => {
  const files = Array.from(e.dataTransfer.files || []);
  for (const f of files) await addAttachment(f);
});

// ============================================================
// Send message
// ============================================================
async function sendMessage() {
  const text = input.value.trim();
  if (!text && state.attachments.length === 0 && state.selectedSkills.length === 0) return;
  if (isCurrentSessionResponding()) return;
  if (state.attachments.some(isImageAttachmentMeta) && !getSelectedModelCapabilities().imageInput) {
    toast('当前模型不支持图像输入，请切换模型或移除图片');
    return;
  }

  const attachments = state.attachments.slice();
  const skillCalls = await Promise.all(state.selectedSkills.map(skill => resolveSkillCall(skill)));
  // 清空输入区（不调 updateSendState，submitMessage 会立即设置停止按钮）
  input.value = '';
  state.attachments = [];
  setComposerSkills([]);
  renderAttachments();
  autoGrow();

  await submitMessage(text, attachments, skillCalls.filter(Boolean));
}

async function attachAgentRunChangeSummary(agentRun, session) {
  if (!agentRun?.runId || !session?.id) return agentRun;
  const workspace = String(session.workspace || '');
  if (!workspace) return agentRun;
  try {
    const summary = await api.yanagentRunChanges(session.id, agentRun.runId, workspace);
    agentRun.changeCount = Number(summary?.count) || 0;
    if (agentRun.changeCount > 0) {
      agentRun.changeSummary = {
        count: agentRun.changeCount,
        additions: Number(summary.additions) || 0,
        deletions: Number(summary.deletions) || 0,
        files: (summary.files || []).map(file => ({
          path: String(file.path || ''),
          additions: Number(file.additions) || 0,
          deletions: Number(file.deletions) || 0,
          status: file.status || 'modified'
        }))
      };
    } else {
      delete agentRun.changeSummary;
    }
  } catch { /* summary is optional; rollback metadata remains available */ }
  return agentRun;
}

function remoteReply(requestId, result, error) {
  api.remoteResult?.({ requestId, result, error: error || null });
}

function remoteNotify(event, data) {
  api.remoteNotify?.({ event, data });
}

async function handleRemoteInvoke(payload) {
  const { requestId, type, sessionId, text, attachments = [] } = payload || {};
  try {
    if (type === 'get-running') {
      return remoteReply(requestId, { ids: [...state.activeRuns.keys()] });
    }
    if (type === 'get-status') {
      const runCtx = getRunCtx(sessionId);
      return remoteReply(requestId, {
        running: isSessionRunning(sessionId),
        message: runCtx?.remoteStatusMessage || (isSessionRunning(sessionId) ? 'Agent 正在工作' : '')
      });
    }
    if (type === 'abort') {
      const result = abortSessionById(sessionId);
      if (result.ok) remoteNotify('run-status', { sessionId, running: false });
      return remoteReply(requestId, result);
    }
    if (type === 'send-message') {
      const session = await api.getSession(sessionId);
      if (!session) return remoteReply(requestId, null, 'session not found');
      if (isSessionRunning(sessionId) || !canStartRun()) {
        return remoteReply(requestId, { ok: false, error: 'busy' });
      }
      remoteNotify('run-status', { sessionId, running: true, phase: 'saving', message: '正在同步消息与图片' });
      let resolveAccepted;
      const accepted = new Promise(resolve => { resolveAccepted = resolve; });
      const backgroundTask = submitMessageBackground(session, text, attachments, {
        onAccepted: error => resolveAccepted(error || null)
      });
      backgroundTask
        .then(() => {
          remoteNotify('run-status', { sessionId, running: false });
          remoteNotify('message-added', { sessionId });
          remoteNotify('session-updated', { sessionId });
        })
        .catch(() => {
          remoteNotify('run-status', { sessionId, running: false });
        });
      const acceptError = await accepted;
      if (acceptError) return remoteReply(requestId, { ok: false, error: acceptError.message || 'message save failed' });
      remoteNotify('run-status', {
        sessionId,
        running: true,
        phase: attachments.length ? 'image-ready' : 'working',
        message: attachments.length ? '图片已同步，正在交给 Agent' : '消息已同步，Agent 正在处理'
      });
      return remoteReply(requestId, { ok: true, accepted: true });
    }
    return remoteReply(requestId, null, 'unknown command');
  } catch (e) {
    return remoteReply(requestId, null, String(e?.message || e));
  }
}

// 后台运行（自动化任务等）：不渲染 UI，与前台任务完全独立
async function submitMessageBackground(session, text, attachments = [], lifecycle = {}) {
  const notifyAccepted = (() => {
    let notified = false;
    return (error) => {
      if (notified) return;
      notified = true;
      lifecycle.onAccepted?.(error || null);
    };
  })();
  if (!text && attachments.length === 0) {
    const error = new Error('empty');
    notifyAccepted(error);
    return { ok: false, error: 'empty' };
  }
  if (isSessionRunning(session.id) || !canStartRun()) {
    const error = new Error('busy');
    notifyAccepted(error);
    return { ok: false, error: 'busy' };
  }

  const runCtx = createRunCtx(session.id, false, session.workspace || '');
  runCtx.accessMode = getCurrentAccessMode();
  runCtx.sessionRef = session;
  state.activeRuns.set(session.id, { sessionRef: session, runCtx, assistantEl: null });
  startPetSupervision(runCtx, session);
  renderSessionList();
  const taskStart = Date.now();
  let backgroundTaskError = null;

  try {
    session.messages = session.messages || [];
    session.messages.push({ role: 'user', content: text, attachments, ts: Date.now() });
    await api.saveSession(session);
    const initialSync = syncBackgroundSessionUi(session, true);
    notifyAccepted();
    await initialSync;

    const loopResult = await runAgentLoop(session.messages, null, runCtx);
    await attachAgentRunChangeSummary(loopResult.agentRun, session);
    session.messages.push({
      role: 'assistant',
      content: loopResult.content,
      ts: Date.now(),
      duration: Date.now() - taskStart,
      agentRun: loopResult.agentRun
    });
    await compressCompletedSessionContext(session, runCtx);
    await api.saveSession(session);
    await syncBackgroundSessionUi(session, false);
    const petStatus = loopResult.agentRun?.status === 'interrupted'
      ? 'paused'
      : (loopResult.agentRun?.status === 'error' ? 'error' : 'completed');
    const loopError = loopResult.agentRun?.error || null;
    backgroundTaskError = loopError;
    finishPetSupervision(runCtx, petStatus, petStatus === 'error' ? loopError : undefined);
    return { ok: loopResult.agentRun?.status !== 'error', error: loopError };
  } catch (e) {
    notifyAccepted(e);
    const errorMessage = describeRunError(e);
    backgroundTaskError = errorMessage;
    runCtx.agentState.status = runCtx.shouldAbort ? 'interrupted' : 'error';
    const agentRun = finalizeAgentRun('', 'error', getActiveRun(runCtx), null, null, runCtx);
    agentRun.error = errorMessage;
    await attachAgentRunChangeSummary(agentRun, session);
    session.messages.push({
      role: 'assistant',
      content: `出错了\n\n${errorMessage}`,
      ts: Date.now(),
      duration: Date.now() - taskStart,
      agentRun
    });
    await api.saveSession(session);
    await syncBackgroundSessionUi(session, false);
    finishPetSupervision(runCtx, runCtx.shouldAbort ? 'paused' : 'error', runCtx.shouldAbort ? '后台任务已停止' : errorMessage);
    return { ok: false, error: errorMessage };
  } finally {
    const terminalStatus = runCtx.shouldAbort || runCtx.finalStatus === 'interrupted' || runCtx.agentState.status === 'interrupted'
      ? 'paused'
      : (runCtx.finalStatus === 'done' || runCtx.agentState.status === 'done' ? 'completed' : 'error');
    runCtx.agentState.status = terminalStatus === 'paused' ? 'interrupted' : (terminalStatus === 'completed' ? 'done' : 'error');
    finishPetSupervision(runCtx, terminalStatus, terminalStatus === 'error' ? (backgroundTaskError || '后台任务出现异常') : undefined);
    setComputerUseVisualState(false, { runCtx });
    state.activeRuns.delete(session.id);
    renderSessionList();
    if (state.currentSession?.id === session.id) {
      showTyping(false);
      updateSendState();
      syncCurrentSessionAgentUi(session);
    }
  }
}

async function syncBackgroundSessionUi(session, running) {
  if (state.currentSession?.id === session.id) {
    state.currentSession = session;
    renderMessages(session.messages || []);
    setEmptyState((session.messages || []).length === 0);
    syncCurrentSessionAgentUi(session);
    updateTaskBar();
    updateSendState();
    showTyping(!!running);
  }
  await refreshSessions();
}

// 核心发送流程：每个任务完全独立，互不影响。返回 { ok, error }
async function submitMessage(text, attachments = [], skillCalls = []) {
  const selectedSkillCalls = normalizeSkillCalls(skillCalls);
  if (!text && attachments.length === 0 && selectedSkillCalls.length === 0) return { ok: false, error: 'empty' };
  if (isCurrentSessionResponding()) return { ok: false, error: 'busy' };
  if (!canStartRun()) { toast('并发任务已达上限（5个），请稍后再试'); return { ok: false, error: 'busy' }; }

  if (!state.currentSession) await newSession();

  const runSession = state.currentSession;
  const runCtx = createRunCtx(runSession.id, true, runSession.workspace || '');
  runCtx.accessMode = getCurrentAccessMode();
  runCtx.sessionRef = runSession;
  state.activeRuns.set(runSession.id, { sessionRef: runSession, runCtx, assistantEl: null });
  startPetSupervision(runCtx, runSession);

  // 立即切换为停止按钮 + typing 指示 + 侧边栏 spinner
  updateSendState();
  showTyping(true);
  renderSessionList();

  const userMsg = { role: 'user', content: text, attachments, skillCalls: selectedSkillCalls, ts: Date.now() };
  runSession.messages = runSession.messages || [];
  runSession.messages.push(userMsg);
  syncCurrentSessionAgentUi(runSession);

  const userMsgIndex = runSession.messages.length - 1;
  appendMessage('user', text, attachments, true, userMsgIndex, userMsg.ts, null, null, selectedSkillCalls);
  setEmptyState(false);

  await saveCurrentSession(runSession);
  const taskStartTime = Date.now();
  let taskOk = true;
  let taskErr = null;
  let completionNotificationSent = false;
  let assistantEl = null;

  try {
    if (runCtx.ui && state.currentSession?.id === runSession.id) {
      assistantEl = appendMessage('assistant', '');
    }
    state.activeRuns.get(runSession.id).assistantEl = assistantEl;
    const loopResult = await runAgentLoop(runSession.messages, assistantEl, runCtx);
    const reply = loopResult.content;
    const agentRun = loopResult.agentRun;
    if (agentRun?.status === 'error') {
      taskOk = false;
      taskErr = agentRun.error || '模型请求失败';
    }
    await attachAgentRunChangeSummary(agentRun, runSession);
    const taskDuration = Date.now() - taskStartTime;
    assistantEl = getActiveAssistantElement(runSession.id) || assistantEl;
    const ui = !!getActiveAssistantBody(runSession.id);
    if (ui) showTyping(false);

    if (ui && agentRun) {
      renderAgentRunBody(assistantEl.querySelector('.msg-body'), agentRun, reply);
    }

    const assistantMsg = {
      role: 'assistant',
      content: reply,
      ts: Date.now(),
      duration: taskDuration,
      agentRun
    };
    runSession.messages.push(assistantMsg);
    await compressCompletedSessionContext(runSession, runCtx);

    if (ui) {
      assistantEl.dataset.msgIndex = runSession.messages.length - 1;
      const actionsContainer = document.createElement('div');
      actionsContainer.className = 'msg-actions';
      actionsContainer.innerHTML = buildAssistantActionsHtml(agentRun, taskDuration);
      actionsContainer.querySelectorAll('.msg-action-btn').forEach(btn => {
        btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, assistantEl));
      });
      assistantEl.appendChild(actionsContainer);
      if (agentRun?.status === 'interrupted') appendUserAbortFooter(assistantEl);
    }

    await saveCurrentSession(runSession);
    const petStatus = agentRun?.status === 'interrupted'
      ? 'paused'
      : (agentRun?.status === 'error' ? 'error' : 'completed');
    finishPetSupervision(runCtx, petStatus, petStatus === 'error' ? taskErr : undefined);

    if ((runSession.messages || []).length >= 4) {
      extractMemoryFacts(runSession.messages).then(facts => {
        if (facts.length > 0) {
          facts.forEach(content => {
            api.addMemoryFact({ content });
          });
        }
      }).catch(() => {});
    }
    if (window.Notification && Notification.permission === 'granted' && agentRun?.status !== 'interrupted') {
      try {
        const failed = agentRun?.status === 'error';
        new Notification(failed ? 'Yan Agent · 任务异常' : 'Yan Agent', {
          body: failed
            ? `「${runSession.title || '任务'}」已停止：${taskErr || '模型请求失败'}`
            : `「${runSession.title || '任务'}」已完成 · 耗时 ${formatDuration(taskDuration)}`,
          icon: 'assets/logo.png'
        });
        completionNotificationSent = true;
      } catch {}
    }
  } catch (err) {
    assistantEl = getActiveAssistantElement(runSession.id) || assistantEl;
    const ui = !!getActiveAssistantBody(runSession.id);
    if (err && (err.name === 'AbortError' || runCtx.shouldAbort)) {
      runCtx.agentState.status = 'interrupted';
      if (ui) showTyping(false);
      if (ui) {
        const taskDuration = Date.now() - taskStartTime;
        const body = assistantEl.querySelector('.msg-body');
        const partialContent = runCtx.partialContent || collectAssistantText(body) || '';
        const agentRun = finalizeAgentRun(partialContent, 'interrupted', getActiveRun(runCtx), body, null, runCtx);
        await attachAgentRunChangeSummary(agentRun, runSession);
        if (agentRun) renderAgentRunBody(body, agentRun, partialContent);

        assistantEl.dataset.msgIndex = runSession.messages.length;
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'msg-actions';
        actionsContainer.innerHTML = buildAssistantActionsHtml(agentRun, taskDuration);
        actionsContainer.querySelectorAll('.msg-action-btn').forEach(btn => {
          btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, assistantEl));
        });
        assistantEl.appendChild(actionsContainer);
        appendUserAbortFooter(assistantEl);

        runSession.messages.push({
          role: 'assistant',
          content: partialContent,
          ts: Date.now(),
          duration: taskDuration,
          agentRun
        });
        await saveCurrentSession(runSession);
      } else {
        const partialContent = runCtx.partialContent || '';
        const agentRun = finalizeAgentRun(partialContent, 'interrupted', getActiveRun(runCtx), null, null, runCtx);
        await attachAgentRunChangeSummary(agentRun, runSession);
        runSession.messages.push({
          role: 'assistant',
          content: partialContent,
          ts: Date.now(),
          agentRun
        });
        await saveCurrentSession(runSession);
      }
      finishPetSupervision(runCtx, 'paused');
    } else {
      taskOk = false;
      const errorMessage = describeRunError(err);
      taskErr = errorMessage;
      runCtx.agentState.status = 'error';
      if (ui) showTyping(false);
      const taskDuration = Date.now() - taskStartTime;
      const body = assistantEl?.querySelector('.msg-body') || null;
      const partialContent = runCtx.partialContent || collectAssistantText(body) || '';
      const agentRun = finalizeAgentRun(partialContent, 'error', getActiveRun(runCtx), body, null, runCtx);
      agentRun.error = errorMessage;
      await attachAgentRunChangeSummary(agentRun, runSession);
      const persistedContent = [partialContent, `出错了\n\n${errorMessage}`].filter(Boolean).join('\n\n');
      if (ui && body) renderAgentRunBody(body, agentRun, persistedContent);

      runSession.messages.push({
        role: 'assistant',
        content: persistedContent,
        ts: Date.now(),
        duration: taskDuration,
        agentRun
      });
      if (ui) {
        assistantEl.dataset.msgIndex = runSession.messages.length - 1;
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'msg-actions';
        actionsContainer.innerHTML = buildAssistantActionsHtml(agentRun, taskDuration);
        actionsContainer.querySelectorAll('.msg-action-btn').forEach(btn => {
          btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, assistantEl));
        });
        assistantEl.appendChild(actionsContainer);
      }
      await saveCurrentSession(runSession);
      finishPetSupervision(runCtx, 'error', taskErr || '任务执行出错');
    }
  } finally {
    const terminalStatus = runCtx.shouldAbort || runCtx.finalStatus === 'interrupted' || runCtx.agentState.status === 'interrupted'
      ? 'paused'
      : (runCtx.finalStatus === 'done' || runCtx.agentState.status === 'done' ? 'completed' : 'error');
    runCtx.agentState.status = terminalStatus === 'paused' ? 'interrupted' : (terminalStatus === 'completed' ? 'done' : 'error');
    finishPetSupervision(runCtx, terminalStatus, terminalStatus === 'error' ? (taskErr || '任务执行出错') : undefined);
    if (terminalStatus === 'error'
      && !completionNotificationSent
      && window.Notification
      && Notification.permission === 'granted') {
      try {
        new Notification('Yan Agent · 任务异常', {
          body: `「${runSession.title || '任务'}」已停止：${taskErr || '模型连接异常'}`,
          icon: 'assets/logo.png'
        });
      } catch {}
    }
    const liveBody = getActiveAssistantBody(runSession.id);
    if (liveBody) {
      renderAgentRunHeader(liveBody, {
        status: runCtx.agentState.status,
        iteration: runCtx.agentState.iteration || 0,
        toolCallCount: runCtx.agentState.toolCallCount || 0
      });
    }
    setComputerUseVisualState(false, { runCtx });
    state.activeRuns.delete(runSession.id);
    renderSessionList();
    if (state.currentSession?.id === runSession.id) {
      if (state.currentSession !== runSession) {
        state.currentSession = runSession;
        renderMessages(runSession.messages || []);
        setEmptyState((runSession.messages || []).length === 0);
      }
      showTyping(false);
      updateSendState();
      syncCurrentSessionAgentUi(runSession);
    }
  }
  return { ok: taskOk, error: taskErr };
}

function buildAssistantActionsHtml(agentRun, duration) {
  const durHtml = duration != null
    ? `<span class="msg-duration" title="任务耗时">${ICONS.clock} ${formatDuration(duration)}</span>`
    : '';
  const canRollback = agentRun?.runId && (agentRun?.changeCount > 0) && !agentRun?.rolledBack;
  const rollbackHtml = canRollback
    ? `<button class="msg-action-btn" data-act="rollback" title="撤销本轮 ${agentRun.changeCount} 处文件改动">${ICONS.undo}</button>`
    : (agentRun?.rolledBack ? '<span class="msg-rollback-badge">已撤销改动</span>' : '');
  return `${durHtml}<button class="msg-action-btn" data-act="copy" title="复制">${ICONS.copy}</button>${rollbackHtml}`;
}

async function rollbackMessageRun(msg, el) {
  const ws = state.config?.workspace;
  const sid = state.currentSession?.id;
  const runId = msg.agentRun?.runId;
  const count = msg.agentRun?.changeCount || 0;
  if (!ws) { toast('请先选择工作区'); return; }
  if (!runId || count <= 0) { toast('该轮对话没有可撤销的文件改动'); return; }
  if (msg.agentRun?.rolledBack) { toast('该轮改动已撤销'); return; }
  if (isCurrentSessionResponding()) { toast('任务执行中，请稍后再撤销'); return; }

  if (!confirm(`撤销本轮对话对 ${count} 个文件的改动？\n仅回滚这一轮，不影响之前对话的修改。`)) return;

  const res = await api.yanagentRollbackRun(sid, runId, ws);
  if (!res.ok) {
    toast('撤销失败: ' + (res.error || '未知错误'));
    return;
  }
  msg.agentRun.rolledBack = true;
  await saveCurrentSession();
  const okN = (res.results || []).filter(r => r.ok).length;
  toast(`已撤销本轮 ${okN}/${res.count} 处文件改动`);

  const actions = el.querySelector('.msg-actions');
  if (actions) {
    actions.innerHTML = buildAssistantActionsHtml(msg.agentRun, msg.duration);
    actions.querySelectorAll('.msg-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, el));
    });
  }
  renderRunChangeSummary(el.querySelector('.msg-body'), msg.agentRun);
  await renderRightSidebarFiles();
}

const SUBAGENT_TIER_CN = { auxiliary: '辅助型', specialist: '专项型' };

function getActiveAssistantElement(sessionId) {
  const entry = state.activeRuns.get(sessionId);
  if (!entry?.runCtx?.ui || state.currentSession?.id !== sessionId) return null;
  return entry.assistantEl?.isConnected ? entry.assistantEl : null;
}

function getActiveAssistantBody(sessionId) {
  return getActiveAssistantElement(sessionId)?.querySelector?.('.msg-body') || null;
}

function getRunningSubagentStep(sessionId) {
  const body = getActiveAssistantBody(sessionId);
  if (!body) return null;
  return body.querySelector('.tool-step.subagent-step.is-running')
    || body.querySelector('.tool-step.subagent-step:last-of-type');
}

function ensureSubagentLane(step) {
  const tcBody = step.querySelector('.tc-body');
  if (!tcBody) return null;
  let lane = tcBody.querySelector('.subagent-lane');
  if (!lane) {
    lane = document.createElement('div');
    lane.className = 'subagent-lane';
    lane.innerHTML = `
      <div class="lane-head">
        <span class="lane-badge sub">子 Agent 编队</span>
        <span class="lane-hint">以下由子 Agent 独立执行，主 Agent 等待汇总结果</span>
      </div>
      <div class="subagent-feed"></div>`;
    tcBody.prepend(lane);
    step.open = true;
  }
  return lane.querySelector('.subagent-feed');
}

function ensureSubagentUnit(feed, type, opts = {}) {
  const key = opts.key || type;
  let unit = feed.querySelector(`[data-subagent-key="${CSS.escape(key)}"]`);
  if (!unit) {
    const prof = YanKernel.SUBAGENT_PROFILES?.[type];
    unit = document.createElement('div');
    unit.className = 'subagent-unit' + (prof?.tier === 'specialist' ? ' is-specialist' : ' is-auxiliary');
    unit.dataset.subagentKey = key;
    const task = opts.task ? `<div class="subagent-unit-task">${escapeHtml(opts.task)}</div>` : '';
    unit.innerHTML = `
      <div class="subagent-unit-head">
        <span class="subagent-unit-icon">${prof?.icon || '◉'}</span>
        <span class="subagent-unit-name">${escapeHtml(prof?.label || type)}</span>
        <span class="subagent-unit-tier">${SUBAGENT_TIER_CN[prof?.tier] || '辅助型'}</span>
        <span class="subagent-unit-status running">执行中</span>
      </div>
      ${task}
      <div class="subagent-unit-log"></div>`;
    feed.appendChild(unit);
  }
  return unit;
}

function appendSubagentLog(unit, text, ok = null) {
  const log = unit?.querySelector('.subagent-unit-log');
  if (!log) return;
  const line = document.createElement('div');
  line.className = 'subagent-log-line' + (ok === false ? ' fail' : ok === true ? ' ok' : '');
  line.textContent = text;
  log.appendChild(line);
  if (log.children.length > 12) log.removeChild(log.firstChild);
}

function setSubagentUnitStatus(unit, status, detail = '') {
  const el = unit?.querySelector('.subagent-unit-status');
  if (!el) return;
  el.className = 'subagent-unit-status ' + status;
  const labels = { running: '执行中', done: '已完成', interrupted: '已中断', fail: '失败' };
  el.textContent = detail || labels[status] || status;
}

function renderSubagentToolTrace(feed, type, toolTrace, task) {
  if (!feed || !toolTrace?.length) return;
  const unit = ensureSubagentUnit(feed, type, { task });
  unit.querySelector('.subagent-unit-log')?.replaceChildren();
  for (const t of toolTrace) {
    const ui = resolveToolUi(t.tool);
    appendSubagentLog(unit, `${ui.label}${t.ok === false ? ' ✕' : t.ok === true ? ' ✓' : ''}`, t.ok);
  }
  setSubagentUnitStatus(unit, 'done');
}

function renderParallelSubagentSummary(feed, results) {
  if (!feed || !results?.length) return;
  results.forEach((r, i) => {
    const unit = ensureSubagentUnit(feed, r.type || 'explore', { key: `parallel-${i}-${r.type}` });
    setSubagentUnitStatus(unit, r.ok === false ? 'fail' : 'done', `${r.iterations ?? '?'} 轮 · ${r.toolCalls ?? 0} 工具`);
  });
}

function handleSubagentEvent(evt) {
  const { sessionId, phase, type, tool, task, count, summary, iterations, toolCalls, index } = evt || {};
  if (!sessionId) return;
  const step = getRunningSubagentStep(sessionId);
  if (!step) return;
  const feed = ensureSubagentLane(step);
  if (!feed) return;

  if (phase === 'parallel_start') {
    const note = feed.querySelector('.subagent-parallel-note');
    if (!note) {
      const el = document.createElement('div');
      el.className = 'subagent-parallel-note';
      el.textContent = `并行派出 ${count} 个子 Agent…`;
      feed.prepend(el);
    }
    return;
  }

  if (phase === 'start' && type) {
    const key = index != null ? `parallel-${index}-${type}` : type;
    ensureSubagentUnit(feed, type, { key, task: task || '' });
    return;
  }

  if (phase === 'tool' && type && tool) {
    const key = index != null ? `parallel-${index}-${type}` : type;
    const unit = ensureSubagentUnit(feed, type, { key });
    const ui = resolveToolUi(tool);
    appendSubagentLog(unit, ui.label);
    const status = unit.querySelector('.subagent-unit-status');
    if (status) status.textContent = `第 ${iterations || '?'} 轮 · ${toolCalls || 0} 工具`;
    return;
  }

  if ((phase === 'done' || phase === 'interrupted') && type) {
    const key = index != null ? `parallel-${index}-${type}` : type;
    const unit = ensureSubagentUnit(feed, type, { key });
    setSubagentUnitStatus(unit, phase === 'interrupted' ? 'interrupted' : 'done',
      `${iterations ?? '?'} 轮 · ${toolCalls ?? 0} 工具`);
    if (summary) appendSubagentLog(unit, summary.slice(0, 120) + (summary.length > 120 ? '…' : ''));
  }
}

function injectSubagentResultPanel(step, resultRaw) {
  try {
    const o = JSON.parse(resultRaw);
    const meta = o.meta || {};
    const feed = ensureSubagentLane(step);
    if (!feed) return;
    if (meta.parallel && meta.results?.length) {
      renderParallelSubagentSummary(feed, meta.results);
    } else if (meta.toolTrace?.length) {
      renderSubagentToolTrace(feed, meta.type, meta.toolTrace, meta.task);
    }
  } catch { /* ignore */ }
}

// ============================================================
// Agent kernel → renderer/kernel/*.js (backup: backup/pre-kernel-split-v1.0.0)
// ============================================================
function initKernelBridge() {
  YanKernel.init({
    api,
    getConfig: () => state.config,
    getCurrentSession: () => state.currentSession,
    getRunCtx,
    getCurrentAgentState,
    toast,
    hooks: {
      renderTodos,
      updateContextInfo,
      renderAgentRunHeader,
      getAgentActivityBody,
      getActiveAssistantBody,
      getComputerUseNarration,
      buildComputerUseNarrationElement,
      setComputerUseVisualState,
      buildToolStepElement,
      finishToolStepElement,
      renderRightSidebarFiles,
      updateTodos,
      agentOpenBuiltinBrowser,
      agentBrowserSnapshot,
      agentBrowserReadPage,
      agentBrowserClick,
      agentBrowserType,
      agentBrowserPress,
      agentBrowserScroll,
      agentBrowserWait,
      agentBrowserScreenshot,
      renderMarkdown,
      scrollChatToBottom,
      collectTimelineFromDom,
      requestWorkspacePermission,
      onWorkspaceAssigned: handleAgentWorkspaceAssigned,
      requestShellPermission,
      deferPendingTodos,
      clearDeferredTodosIfDone,
      onSupervisorEvent: handlePetSupervisorEvent,
      onSubagentEvent: handleSubagentEvent,
      onRunAborted(runCtx) {
        if (workspacePermRequest?.runCtx === runCtx) {
          settleWorkspacePermission({ approved: false, workspace: '' });
        }
        for (const [sid, entry] of state.activeRuns) {
          if (entry.runCtx === runCtx) {
            applyAbortRunUi(sid);
            return;
          }
        }
      },
      cancelToolStepElement,
      onContextCompressed: handleContextCompressed
    }
  });
}

const createRunCtx = (...a) => YanKernel.createRunCtx(...a);
const runAgentLoop = (...a) => YanKernel.runAgentLoop(...a);
const executeTool = (...a) => YanKernel.executeTool(...a);
const extractMemoryFacts = (...a) => YanKernel.extractMemoryFacts(...a);
const compressContextIfNeeded = (...a) => YanKernel.compressContextIfNeeded(...a);
const estimateTokens = (...a) => YanKernel.estimateTokens(...a);
const parseToolOutputOk = (...a) => YanKernel.parseToolOutputOk(...a);
const makeLoopResult = (...a) => YanKernel.makeLoopResult(...a);
const describeRunError = (...a) => YanKernel.describeRunError(...a);
const finalizeAgentRun = (...a) => YanKernel.finalizeAgentRun(...a);
const getActiveRun = (...a) => YanKernel.getActiveRun(...a);
const refreshMcpTools = (...a) => YanKernel.refreshMcpTools(...a);
const snapshotTools = (...a) => YanKernel.snapshotTools(...a);
const TOOL_ICONS = YanKernel.TOOL_ICONS;
const BUILT_IN_TOOLS = YanKernel.BUILT_IN_TOOLS;

// ============================================================
// Shell permission prompt (always / once / deny)
// ============================================================
let workspacePermRequest = null;

function settleWorkspacePermission(result) {
  if (!workspacePermRequest) return;
  const request = workspacePermRequest;
  workspacePermRequest = null;
  $('#workspacePermModal')?.classList.add('hidden');
  request.resolve(result);
}

async function requestWorkspacePermission(detail, runCtx) {
  const accessMode = runCtx?.accessMode || getCurrentAccessMode();
  if (accessMode === 'delegate' && detail?.suggestedPath) {
    toast('已按“替我审批”自动批准工作区申请');
    return { approved: true, workspace: detail.suggestedPath, automatic: true };
  }
  if (accessMode === 'full') {
    if (detail?.suggestedPath) {
      toast('已按“完全访问”自动批准工作区申请');
      return { approved: true, workspace: detail.suggestedPath, automatic: true };
    }
    const result = api.getKnownWorkspacePath
      ? await api.getKnownWorkspacePath('home')
      : null;
    if (result?.workspace) {
      toast('已按“完全访问”使用用户目录');
      return { approved: true, workspace: result.workspace, automatic: true };
    }
  }
  return new Promise(resolve => {
    if (workspacePermRequest) settleWorkspacePermission({ approved: false, workspace: '' });
    const modal = $('#workspacePermModal');
    if (!modal) {
      resolve({ approved: false, workspace: '' });
      return;
    }
    workspacePermRequest = { resolve, detail, runCtx };
    $('#workspacePermReason').textContent = detail.reason || 'Agent 需要创建或修改文件。';
    $('#workspacePermLabel').textContent = `建议位置：${detail.suggestedLabel || '工作区'}`;
    $('#workspacePermPath').textContent = detail.suggestedPath || '由你选择具体文件夹';
    const choose = $('#workspacePermChoose');
    const allow = $('#workspacePermAllow');
    choose?.classList.toggle('hidden', !detail.suggestedPath);
    if (allow) allow.textContent = detail.suggestedPath ? '允许' : '选择文件夹';
    modal.classList.remove('hidden');
    requestAnimationFrame(() => allow?.focus());
  });
}

async function chooseWorkspaceForPermission() {
  const request = workspacePermRequest;
  if (!request) return;
  const workspace = api.pickWorkspace ? await api.pickWorkspace() : await api.chooseWorkspace();
  if (workspace) settleWorkspacePermission({ approved: true, workspace });
}

function bindWorkspacePermDialog() {
  $('#workspacePermAllow')?.addEventListener('click', async () => {
    const request = workspacePermRequest;
    if (!request) return;
    if (request.detail.suggestedPath) {
      settleWorkspacePermission({ approved: true, workspace: request.detail.suggestedPath });
    } else {
      await chooseWorkspaceForPermission();
    }
  });
  $('#workspacePermChoose')?.addEventListener('click', chooseWorkspaceForPermission);
  $('#workspacePermDeny')?.addEventListener('click', () => settleWorkspacePermission({ approved: false, workspace: '' }));
  $('#workspacePermModal')?.addEventListener('click', event => {
    if (event.target?.id === 'workspacePermModal') settleWorkspacePermission({ approved: false, workspace: '' });
  });
}

async function handleAgentWorkspaceAssigned(workspace, runCtx) {
  const session = runCtx?.sessionRef || state.sessions.find(item => item.id === runCtx?.sessionId);
  if (session) session.workspace = workspace;
  const summary = state.sessions.find(item => item.id === runCtx?.sessionId);
  if (summary) summary.workspace = workspace;
  if (state.currentSession?.id !== runCtx?.sessionId) {
    renderSessionList();
    return;
  }
  syncCurrentSessionWorkspace(workspace);
  state.config = await api.getConfig();
  await renderRightSidebarFiles();
  updateTaskBar();
  updateContextInfo();
  renderSessionList();
}

let shellPermResolver = null;

function requestShellPermission({ command, sessionId }) {
  return new Promise((resolve) => {
    if (shellPermResolver) {
      shellPermResolver('deny');
      shellPermResolver = null;
    }
    const modal = $('#shellPermModal');
    const cmdEl = $('#shellPermCommand');
    if (!modal || !cmdEl) {
      resolve('deny');
      return;
    }
    cmdEl.textContent = command || '(empty command)';
    modal.classList.remove('hidden');
    shellPermResolver = (decision) => {
      modal.classList.add('hidden');
      shellPermResolver = null;
      if (decision === 'always') {
        toast('已开启 Shell 权限（总是允许）');
      } else if (decision === 'once') {
        toast('已允许本次 Shell 执行');
      } else {
        toast('已拒绝 Shell 执行，Agent 将尝试其他方式');
      }
      resolve(decision);
    };
  });
}

function bindShellPermDialog() {
  $('#shellPermAlways')?.addEventListener('click', () => shellPermResolver?.('always'));
  $('#shellPermOnce')?.addEventListener('click', () => shellPermResolver?.('once'));
  $('#shellPermDeny')?.addEventListener('click', () => shellPermResolver?.('deny'));
  $('#shellPermModal')?.addEventListener('click', (e) => {
    if (e.target?.id === 'shellPermModal') shellPermResolver?.('deny');
  });
}

async function deferPendingTodos(runCtx, pending) {
  const session = runCtx?.sessionRef || state.activeRuns.get(runCtx?.sessionId)?.sessionRef;
  if (!session || session.id !== runCtx?.sessionId) return;
  session.deferredTodos = pending.map(t => ({ text: t.text }));
  try { await api.saveSession(session); } catch (error) {
    console.error('[deferred-todos-save]', error);
    return;
  }
  if (state.currentSession?.id === session.id) {
    toast(`已推迟 ${pending.length} 项非必要 todo，将在后续对话中提醒`);
  }
}

async function handleContextCompressed(info, runCtx) {
  if (!info?.compressed) return;
  const session = runCtx?.sessionRef;
  if (state.currentSession?.id === runCtx?.sessionId) {
    updateContextInfo();
    const before = formatTokenCount(info.beforeTokens);
    const after = formatTokenCount(info.afterTokens);
    toast(`上下文已压缩：${before} → ${after} tokens`);
  }
  if (session) {
    try { await api.saveSession(session); } catch (error) {
      console.error('[context-compression-save]', error);
    }
  }
}

async function compressCompletedSessionContext(session, runCtx) {
  const result = await compressContextIfNeeded(session?.messages || []);
  if (!result.compressed) return result;
  session.messages.splice(0, session.messages.length, ...result.messages);
  await handleContextCompressed(result, runCtx);
  return result;
}

async function clearDeferredTodosIfDone(runCtx, as) {
  const session = runCtx?.sessionRef
    || state.activeRuns.get(runCtx?.sessionId)?.sessionRef
    || (!runCtx ? state.currentSession : null);
  if (!session?.deferredTodos?.length || !as?.todosFromTool) return;
  const texts = new Set(as.todos.filter(t => t.done).map(t => t.text));
  const remaining = session.deferredTodos.filter(d => !texts.has(d.text));
  if (remaining.length !== session.deferredTodos.length) {
    session.deferredTodos = remaining.length ? remaining : undefined;
    if (!session.deferredTodos) delete session.deferredTodos;
    try { await api.saveSession(session); } catch (error) {
      console.error('[deferred-todos-clear]', error);
    }
  }
}

// ============================================================
// Per-run rollback — see rollbackMessageRun() on assistant messages
// ============================================================

function collectAssistantText(bodyEl) {
  if (!bodyEl) return '';
  const directRounds = Array.from(bodyEl.children).filter(el => el.classList?.contains('msg-round'));
  const rounds = directRounds.length ? directRounds : Array.from(bodyEl.querySelectorAll('.msg-round'));
  const parts = rounds.map(el => el.textContent.trim());
  return parts.filter(Boolean).join('\n\n');
}

function collectTimelineFromDom(bodyEl) {
  const timeline = [];
  if (!bodyEl) return timeline;
  for (const child of bodyEl.querySelectorAll('.thinking-block, .msg-round, .computer-use-narration, .tool-step')) {
    if (child.classList.contains('thinking-block')) {
      const text = child.querySelector('.thinking-text')?.textContent || '';
      if (text) timeline.push({ type: 'thinking', content: text });
    } else if (child.classList.contains('msg-round')) {
      const text = child.textContent.trim();
      if (text) timeline.push({ type: 'text', content: text });
    } else if (child.classList.contains('computer-use-narration')) {
      const text = child.querySelector('.computer-use-narration-text')?.textContent.trim() || '';
      if (text) timeline.push({ type: 'computer_use', content: text });
    } else if (child.classList.contains('tool-step')) {
      const name = child.dataset.tool || '';
      const ok = child.dataset.ok === 'true';
      const argsRaw = child.dataset.args || '{}';
      let args = {};
      try { args = JSON.parse(argsRaw); } catch {}
      timeline.push({ type: 'tool_call', name, args });
      const output = child.querySelector('.tc-output')?.textContent || '';
      timeline.push({ type: 'tool_result', name, output, ok });
    }
  }
  return timeline;
}

function ensureAgentActivity(bodyEl) {
  if (!bodyEl) return null;
  let activity = Array.from(bodyEl.children).find(child => child.classList?.contains('agent-run-header'));
  if (activity) return activity;
  activity = document.createElement('details');
  activity.className = 'agent-run-header status-working';
  activity.open = true;
  activity.innerHTML = '<summary class="agent-run-summary"></summary><div class="agent-activity-body"></div>';
  bodyEl.prepend(activity);
  return activity;
}

function getAgentActivityBody(bodyEl) {
  return ensureAgentActivity(bodyEl)?.querySelector('.agent-activity-body') || null;
}

function renderAgentRunHeader(bodyEl, agentRun) {
  if (!bodyEl || !agentRun) return;
  const header = ensureAgentActivity(bodyEl);
  const summary = header.querySelector('.agent-run-summary');
  const activityBody = header.querySelector('.agent-activity-body');
  const previousStatus = header.dataset.status;
  const status = agentRun.status || 'working';
  if (status === 'working') showTyping(false);
  header.className = 'agent-run-header status-' + status;
  header.dataset.status = status;
  const statusLabel = {
    done: '已完成',
    interrupted: '已暂停',
    error: '运行失败',
    working: '执行中'
  }[status] || status;
  const stateMark = status === 'working'
    ? '<span class="run-pulse" aria-hidden="true"></span>'
    : `<span class="run-state-mark" aria-hidden="true">${status === 'done' ? '✓' : (status === 'error' ? '!' : '—')}</span>`;
  const stepCount = Number(agentRun.toolCallCount) || 0;
  const changeCount = Number(agentRun.changeCount) || 0;
  const meta = [
    stepCount ? `${stepCount} 步` : '',
    changeCount ? `${changeCount} 处改动` : ''
  ].filter(Boolean).join(' · ');
  summary.innerHTML = `
    ${stateMark}
    <span class="run-status ${escapeAttr(status)}">${escapeHtml(statusLabel)}</span>
    ${meta ? `<span class="run-meta">${escapeHtml(meta)}</span>` : ''}
    <span class="run-chevron" aria-hidden="true">›</span>
  `;
  summary.setAttribute('aria-label', [statusLabel, meta].filter(Boolean).join('，'));
  const hasActivity = !!activityBody?.children.length;
  header.hidden = status === 'done' && !hasActivity && stepCount === 0;
  if (status === 'working' && previousStatus == null) header.open = true;
  else if (previousStatus === 'working' || previousStatus == null) header.open = status === 'error';
}

function buildRunChangeSummaryElement(agentRun) {
  const changeSummary = agentRun?.changeSummary;
  const files = Array.isArray(changeSummary?.files) ? changeSummary.files : [];
  if (!files.length) return null;

  const count = Number(changeSummary.count) || files.length;
  const additions = Number(changeSummary.additions) || 0;
  const deletions = Number(changeSummary.deletions) || 0;
  const rolledBack = !!agentRun.rolledBack;
  const statusLabels = { created: '新增', deleted: '已删除', unknown: '未知' };
  const details = document.createElement('details');
  details.className = 'run-change-summary' + (rolledBack ? ' is-rolled-back' : '');
  details.open = true;
  details.innerHTML = `
    <summary class="run-change-header">
      <span class="run-change-title">
        <span class="run-change-chevron" aria-hidden="true">›</span>
        <span>${rolledBack ? '已撤销' : '已编辑'} <strong>${count}</strong> 个文件</span>
      </span>
      <span class="run-change-stats" aria-label="新增 ${additions} 行，删除 ${deletions} 行">
        <span class="run-change-add">+${additions}</span>
        <span class="run-change-del">-${deletions}</span>
      </span>
    </summary>
    <div class="run-change-list">
      ${files.map(file => {
        const fileAdditions = Number(file.additions) || 0;
        const fileDeletions = Number(file.deletions) || 0;
        const statusLabel = statusLabels[file.status] || '';
        return `
          <div class="run-change-file">
            <span class="run-change-path" title="${escapeAttr(file.path)}">${escapeHtml(file.path)}</span>
            ${statusLabel ? `<span class="run-change-status ${escapeAttr(file.status)}">${statusLabel}</span>` : '<span></span>'}
            <span class="run-change-add">+${fileAdditions}</span>
            <span class="run-change-del">-${fileDeletions}</span>
          </div>`;
      }).join('')}
    </div>`;
  return details;
}

function renderRunChangeSummary(bodyEl, agentRun) {
  if (!bodyEl) return;
  bodyEl.querySelector(':scope > .run-change-summary')?.remove();
  const summary = buildRunChangeSummaryElement(agentRun);
  if (summary) bodyEl.appendChild(summary);
}

function buildAgentErrorElement(errorMessage) {
  const errorEl = document.createElement('div');
  errorEl.className = 'msg-error';
  errorEl.innerHTML = renderMarkdown(`⚠️ **出错了**\n\n${errorMessage}`);
  return errorEl;
}

function renderAgentRunBody(bodyEl, agentRun, fallbackContent = '') {
  if (!bodyEl) return;
  bodyEl.innerHTML = '';
  renderAgentRunHeader(bodyEl, agentRun);
  const activityBody = getAgentActivityBody(bodyEl);
  const timeline = agentRun.timeline || [];
  if (timeline.length) {
    for (let i = 0; i < timeline.length; i++) {
      const item = timeline[i];
      if (item.type === 'tool_result') continue;
      if (item.type === 'thinking') activityBody?.appendChild(buildThinkingElement(item.content, false));
      else if (item.type === 'text') bodyEl.appendChild(buildTextRoundElement(item.content));
      else if (item.type === 'computer_use') bodyEl.appendChild(buildComputerUseNarrationElement(item.content));
      else if (item.type === 'tool_call') {
        const result = timeline.slice(i + 1).find(candidate => (
          candidate.type === 'tool_result' && (
            item.callId ? candidate.callId === item.callId : candidate.name === item.name
          )
        ));
        const output = result?.output || '';
        const ok = result ? result.ok : null;
        const phase = (!result && agentRun.status === 'working') || result?.interrupted ? 'running' : 'done';
        const step = buildToolStepElement(item.name, item.args, output, ok, phase);
        if (item.callId) step.dataset.callId = item.callId;
        activityBody?.appendChild(step);
      }
    }
  } else if (fallbackContent) {
    bodyEl.appendChild(buildTextRoundElement(fallbackContent));
  }
  if (agentRun.status === 'working') {
    const streamingThinking = activityBody?.querySelector('.thinking-block:last-of-type');
    const streamingRound = Array.from(bodyEl.children).filter(el => el.classList?.contains('msg-round')).at(-1);
    if (timeline.at(-1)?.type === 'thinking' && timeline.at(-1)?.streaming && streamingThinking) {
      streamingThinking.classList.add('streaming');
      streamingThinking.open = true;
      const summary = streamingThinking.querySelector('summary');
      if (summary) summary.innerHTML = '<span class="think-icon" aria-hidden="true"></span>思考中…';
    }
    if (timeline.at(-1)?.type === 'text' && timeline.at(-1)?.streaming && streamingRound) {
      streamingRound.classList.add('streaming');
      streamingRound.insertAdjacentHTML('beforeend', '<span class="stream-cursor" aria-hidden="true"></span>');
    }
  }
  for (const item of timeline) {
    if (item.type === 'tool_result' && item.ok) renderGeneratedImagePreview(bodyEl, item.output);
  }
  if (agentRun.error) bodyEl.appendChild(buildAgentErrorElement(agentRun.error));
  renderRunChangeSummary(bodyEl, agentRun);
  renderAgentRunHeader(bodyEl, agentRun);
  if (agentRun.todos?.length) {
    const as = { todos: agentRun.todos.map(t => ({
      text: t.text,
      done: !!t.done,
      inProgress: !!t.inProgress
    })), todosFromTool: !!agentRun.todosFromTool };
    renderTodos(as);
  }
}

function buildTextRoundElement(content) {
  const roundEl = document.createElement('div');
  roundEl.className = 'msg-round';
  roundEl.innerHTML = renderMarkdown(content || '');
  return roundEl;
}

function isComputerUseToolName(toolName, args = {}) {
  const name = String(toolName || '');
  if (/^mcp__.*windows.*__/i.test(name)) return true;
  return name === 'use_capability' && /^mcp:mcp__.*windows.*__/i.test(String(args.capability_id || ''));
}

function getComputerUseNarration(toolName, args) {
  if (!isComputerUseToolName(toolName, args)) return '';
  return '正在使用 Computer Use 操作电脑…';
}

function buildComputerUseNarrationElement(_content, active = false) {
  const note = document.createElement('div');
  note.className = 'computer-use-narration' + (active ? ' is-active' : '');
  note.innerHTML = '<span class="computer-use-narration-mark" aria-hidden="true"></span><span class="computer-use-narration-text"></span>';
  note.querySelector('.computer-use-narration-text').textContent = '正在使用 Computer Use 操作电脑…';
  return note;
}

const computerUseActiveRuns = new Set();
let computerUseOverlayVisible = false;

function setComputerUseVisualState(active, detail = {}) {
  const app = $('#app');
  if (!app) return;
  const runKey = String(detail.runCtx?.runId || detail.runCtx?.sessionId || 'foreground');
  if (active) {
    computerUseActiveRuns.add(runKey);
  } else {
    computerUseActiveRuns.delete(runKey);
  }
  const shouldShow = computerUseActiveRuns.size > 0;
  app.classList.toggle('computer-use-active', shouldShow);
  if (shouldShow) app.setAttribute('aria-busy', 'true');
  else app.removeAttribute('aria-busy');
  if (computerUseOverlayVisible !== shouldShow) {
    computerUseOverlayVisible = shouldShow;
    api.setComputerUseActive?.(shouldShow);
  }
}

function buildThinkingElement(content, open = false) {
  const thinkEl = document.createElement('details');
  thinkEl.className = 'thinking-block';
  thinkEl.open = open;
  const label = open ? '思考中…' : '思考过程';
  thinkEl.innerHTML = `<summary><span class="think-icon" aria-hidden="true"></span>${label}</summary><div class="thinking-text"></div>`;
  thinkEl.querySelector('.thinking-text').textContent = content || '';
  return thinkEl;
}

const TOOL_UI = {
  search_capabilities: { label: '搜索能力', icon: 'search' },
  use_capability: { label: '调用能力', icon: 'tool' },
  read_file: { label: '读取文件', icon: 'file' },
  read_file_range: { label: '读取片段', icon: 'file' },
  write_file: { label: '写入文件', icon: 'write' },
  edit_file: { label: '编辑文件', icon: 'edit' },
  apply_patch: { label: '应用补丁', icon: 'edit' },
  list_directory: { label: '列出目录', icon: 'folder' },
  search_files: { label: '搜索代码', icon: 'search' },
  search_symbols: { label: '搜索符号', icon: 'search' },
  get_file_outline: { label: '文件大纲', icon: 'file' },
  get_file_imports: { label: '分析依赖', icon: 'link' },
  find_symbol: { label: '查找符号', icon: 'search' },
  find_references: { label: '查找引用', icon: 'link' },
  find_related_files: { label: '关联文件', icon: 'link' },
  build_code_index: { label: '构建索引', icon: 'index' },
  scan_project: { label: '扫描项目', icon: 'folder' },
  trace_symbol: { label: '追踪符号', icon: 'search' },
  execute_shell: { label: '执行命令', icon: 'terminal' },
  todo_write: { label: '更新计划', icon: 'list' },
  spawn_subagent: { label: '子 Agent', icon: 'agent' },
  spawn_subagents: { label: '并行子 Agent', icon: 'agent' },
  generate_image: { label: '生成图片', icon: 'image' },
  change_workspace: { label: '切换工作区', icon: 'folder' },
  open_builtin_browser: { label: '打开预览', icon: 'browser' },
  git_status: { label: 'Git 状态', icon: 'git' },
  git_diff: { label: 'Git 差异', icon: 'git' },
  git_log: { label: 'Git 日志', icon: 'git' },
  git_commit: { label: 'Git 提交', icon: 'git' },
  git_push: { label: 'Git 推送', icon: 'git' },
  git_pull: { label: 'Git 拉取', icon: 'git' },
  git_clone: { label: 'Git 克隆', icon: 'git' },
  git_branch: { label: 'Git 分支', icon: 'git' }
};

const TOOL_ICON_SVG = {
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
  write: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
  edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
  folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
  search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
  link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
  index: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  terminal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
  list: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
  agent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
  browser: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
  image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
  git: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/></svg>',
  tool: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
  mcp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>'
};

function resolveToolUi(toolName) {
  const mcpMatch = toolName.match(/^mcp__(.+)__(.+)$/);
  if (mcpMatch) {
    return { label: 'MCP · ' + mcpMatch[2], icon: TOOL_ICON_SVG.mcp, iconKey: 'mcp' };
  }
  if (toolName === 'spawn_subagent') return null;
  if (toolName === 'spawn_subagents') return { label: '并行子 Agent', icon: TOOL_ICON_SVG.agent, iconKey: 'agent' };
  const ui = TOOL_UI[toolName];
  if (ui) return { label: ui.label, icon: TOOL_ICON_SVG[ui.icon] || TOOL_ICON_SVG.tool, iconKey: ui.icon };
  return { label: toolName, icon: TOOL_ICON_SVG.tool, iconKey: 'tool' };
}

function renderGeneratedImagePreview(body, resultRaw) {
  let result;
  try { result = JSON.parse(resultRaw); } catch { return; }
  const assetId = result?.meta?.generatedImageId;
  if (!assetId || [...body.querySelectorAll('.generated-image-result')].some(item => item.dataset.assetId === assetId)) return;

  const preview = document.createElement('div');
  preview.className = 'generated-image-result';
  preview.dataset.assetId = assetId;
  preview.tabIndex = 0;
  preview.setAttribute('role', 'button');
  preview.setAttribute('aria-label', '打开图片预览');
  preview.title = '打开图片预览';
  preview.innerHTML = '<div class="generated-image-loading">正在加载图片…</div>';
  body.appendChild(preview);
  const openViewer = () => api.openGeneratedImage(assetId).then(response => {
    if (response?.error) toast(response.error);
  }).catch(error => toast('无法打开图片：' + error.message));
  preview.addEventListener('click', openViewer);
  preview.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    openViewer();
  });
  api.readGeneratedImage(assetId).then(image => {
    if (image?.error || !image?.dataUrl || !preview.isConnected) {
      const loading = preview.querySelector('.generated-image-loading');
      if (loading) loading.textContent = image?.error || '会话图片已失效';
      return;
    }
    const img = document.createElement('img');
    img.src = image.dataUrl;
    img.alt = result?.meta?.name || 'Agent 生成的图片';
    img.draggable = false;
    img.className = 'generated-image-preview';
    preview.querySelector('.generated-image-loading')?.replaceWith(img);
  }).catch(() => {});
}

function finishToolStepElement(step, resultRaw, ok) {
  if (!step) return;
  step.classList.remove('is-running');
  if (ok != null) step.dataset.ok = String(!!ok);
  const parsedOk = ok != null ? ok : (resultRaw ? parseToolOutputOk(resultRaw) : null);
  const header = step.querySelector('.tc-header');
  if (header) {
    const oldBadge = header.querySelector('.tc-badge');
    if (oldBadge) oldBadge.remove();
    if (parsedOk != null) {
      const badge = document.createElement('span');
      badge.className = 'tc-badge ' + (parsedOk ? 'ok' : 'fail');
      badge.textContent = parsedOk ? '✓' : '✕';
      header.prepend(badge);
    }
  }
  const body = step.querySelector('.tc-body');
  if (!body || !resultRaw) return;
  if (!body.querySelector('.tc-args-block') && step.dataset.args) {
    try {
      const args = JSON.parse(step.dataset.args);
      const argLines = Object.entries(args).map(([k, v]) =>
        `<div class="tc-arg-line"><span class="tc-arg-key">${escapeHtml(k)}</span><span class="tc-arg-val">${escapeHtml(String(v).slice(0, 500))}</span></div>`
      ).join('');
      if (argLines) {
        const argsEl = document.createElement('div');
        argsEl.className = 'tc-args-block';
        argsEl.innerHTML = argLines;
        body.prepend(argsEl);
      }
    } catch { /* ignore */ }
  }
  let resultEl = body.querySelector('.tc-result');
  if (!resultEl) {
    resultEl = document.createElement('div');
    resultEl.className = 'tc-result';
    body.appendChild(resultEl);
  }
  const toolName = step.dataset.tool;
  if (toolName === 'spawn_subagent' || toolName === 'spawn_subagents') {
    try {
      const o = JSON.parse(resultRaw);
      const meta = o.meta || {};
      injectSubagentResultPanel(step, resultRaw);
      if (!body.querySelector('.tc-subagent-stats')) {
        const stats = document.createElement('div');
        stats.className = 'tc-subagent-stats';
        if (meta.parallel) {
          stats.textContent = `主 Agent 委派 · 并行 ${meta.count} 个 · 子 Agent 共 ${meta.totalToolCalls || 0} 次工具`;
        } else {
          const tier = meta.tier === 'specialist' ? '专项型' : '辅助型';
          stats.textContent = `主 Agent 委派 · ${meta.label || meta.type || '子 Agent'}（${tier}）· ${meta.iterations ?? '?'} 轮 · ${meta.toolCalls ?? 0} 工具`;
        }
        body.prepend(stats);
      }
    } catch { /* ignore */ }
  }
  resultEl.innerHTML = `<pre class="tc-output">${escapeHtml(formatToolResultForUi(resultRaw))}</pre>`;
}

function summarizeToolArgs(toolName, args) {
  if (!args || typeof args !== 'object') return '';
  if (toolName === 'use_capability' && args.capability_id) {
    return String(args.capability_id).replace(/^(?:native|skill|mcp):/, '').slice(0, 80);
  }
  if (toolName === 'spawn_subagent' && args.type) {
    const prof = YanKernel.SUBAGENT_PROFILES?.[args.type];
    const tag = prof ? `${prof.label || args.type}` : args.type;
    const task = String(args.task || '').slice(0, 56);
    return task ? `${tag} · ${task}` : tag;
  }
  if (toolName === 'spawn_subagents' && Array.isArray(args.agents)) {
    const types = args.agents.map(a => a.type || 'explore').join('+');
    return `并行 ×${args.agents.length} (${types})`;
  }
  if (args.path) return String(args.path);
  if (args.command) return String(args.command).slice(0, 80);
  if (args.query) return String(args.query);
  if (args.message) return String(args.message).slice(0, 60);
  const first = Object.values(args)[0];
  return first != null ? String(first).slice(0, 60) : '';
}

function buildToolStepElement(toolName, args, resultRaw = '', ok = null, phase = 'done') {
  const isSubagentSpawn = toolName === 'spawn_subagent' || toolName === 'spawn_subagents';
  const step = document.createElement('details');
  step.className = 'tool-step';
  if (phase === 'running') step.classList.add('is-running');
  if (isSubagentSpawn) {
    step.classList.add('subagent-step', 'delegation-step');
    const tier = args?.type && YanKernel.SUBAGENT_PROFILES?.[args.type]?.tier;
    if (tier === 'specialist') step.classList.add('subagent-specialist');
    if (toolName === 'spawn_subagents') step.classList.add('subagent-parallel');
  } else {
    step.classList.add('main-agent-step');
  }
  step.open = ok === false || (isSubagentSpawn && phase === 'running');
  step.dataset.tool = toolName;
  step.dataset.args = JSON.stringify(args || {});
  if (ok != null) step.dataset.ok = String(!!ok);

  let displayName;
  let iconSvg;
  let laneBadge;
  if (toolName === 'spawn_subagent' && args?.type) {
    const prof = YanKernel.SUBAGENT_PROFILES?.[args.type];
    displayName = prof ? `委派 · ${prof.label}` : `委派 · ${args.type}`;
    iconSvg = TOOL_ICON_SVG.agent;
    laneBadge = '<span class="lane-badge sub">子 Agent</span>';
  } else if (toolName === 'spawn_subagents') {
    const n = Array.isArray(args?.agents) ? args.agents.length : 0;
    displayName = `委派 · 并行子 Agent${n ? ` ×${n}` : ''}`;
    iconSvg = TOOL_ICON_SVG.agent;
    laneBadge = '<span class="lane-badge sub">子 Agent</span>';
  } else if (toolName === 'use_capability' && args?.capability_id) {
    const capabilityId = String(args.capability_id);
    const target = capabilityId.replace(/^(?:native|skill|mcp):/, '');
    displayName = `调用能力 · ${target}`;
    iconSvg = capabilityId.startsWith('mcp:') ? TOOL_ICON_SVG.mcp : TOOL_ICON_SVG.tool;
    laneBadge = '<span class="lane-badge main">主 Agent</span>';
  } else {
    const ui = resolveToolUi(toolName);
    displayName = ui.label;
    iconSvg = ui.icon;
    laneBadge = '<span class="lane-badge main">主 Agent</span>';
  }

  const parsedOk = phase === 'running' ? null : (ok != null ? ok : (resultRaw ? parseToolOutputOk(resultRaw) : null));
  let badge = '';
  if (phase === 'running') {
    badge = '<span class="tc-badge running" aria-label="运行中"></span>';
  } else if (parsedOk != null) {
    badge = parsedOk ? '<span class="tc-badge ok">✓</span>' : '<span class="tc-badge fail">✕</span>';
  }
  const preview = summarizeToolArgs(toolName, args);

  step.innerHTML = `
    <summary class="tc-header">
      ${badge}
      ${laneBadge}
      <span class="tc-icon-svg">${iconSvg}</span>
      <span class="tc-name">${escapeHtml(displayName)}</span>
      <span class="tc-preview">${escapeHtml(preview)}</span>
    </summary>
    <div class="tc-body"></div>
  `;

  const body = step.querySelector('.tc-body');
  if (isSubagentSpawn && phase === 'running') {
    ensureSubagentLane(step);
  }

  if (phase !== 'running' && args && Object.keys(args).length) {
    const argLines = Object.entries(args).map(([k, v]) =>
      `<div class="tc-arg-line"><span class="tc-arg-key">${escapeHtml(k)}</span><span class="tc-arg-val">${escapeHtml(String(v).slice(0, 500))}</span></div>`
    ).join('');
    const argsEl = document.createElement('div');
    argsEl.className = 'tc-args-block';
    argsEl.innerHTML = argLines;
    body.appendChild(argsEl);
  }

  if (resultRaw) finishToolStepElement(step, resultRaw, ok);

  return step;
}

// --- Tool call UI rendering ---
function formatToolResultForUi(raw) {
  try {
    const obj = JSON.parse(raw);
    const badge = obj.ok ? 'OK' : 'FAIL';
    const lines = [`[${badge}] ${obj.tool || 'tool'}`];
    if (obj.output) lines.push(String(obj.output));
    if (obj.error) lines.push(`error: ${obj.error}`);
    if (obj.meta?.exitCode != null) lines.push(`exitCode: ${obj.meta.exitCode}`);
    if (obj.meta?.verification) lines.push(`verified: ${obj.meta.verification.ok}`);
    return lines.join('\n');
  } catch {
    return raw;
  }
}

function showTyping(show) {
  const el = $('#typingIndicator');
  if (el) el.classList.toggle('hidden', !show);
  if (show) scrollChatToBottom();
}

// ============================================================
// Right sidebar: todo, context, files
// ============================================================

function updateContextInfo(as, session = state.currentSession) {
  if (as && !isAgentStateForCurrentSession(as)) return;
  if (!as) as = getCurrentAgentState();
  const m = state.config.api.model;
  const modelName = (state.config.models || []).find(x => x.id === m)?.name || m;
  const el = id => $('#' + id);
  if (el('ctxModel')) {
    el('ctxModel').textContent = modelName;
    el('ctxModel').title = modelName;
  }
  if (el('ctxIteration')) el('ctxIteration').textContent = as.iteration;
  if (el('ctxToolCalls')) el('ctxToolCalls').textContent = as.toolCallCount;
  if (el('ctxMsgCount')) el('ctxMsgCount').textContent = session?.messages?.length || 0;
  const status = String(as.status || 'idle');
  if (el('ctxStatus')) el('ctxStatus').textContent = { idle: '空闲', working: '执行中', done: '已完成', interrupted: '已暂停', error: '运行失败' }[status] || status;
  const contextInfo = el('contextInfo');
  if (contextInfo) contextInfo.dataset.status = status;

  const msgs = session?.messages || [];
  const tokens = estimateTokens(msgs);
  const activeBudget = session?.id ? getRunCtx(session.id)?.runBudget : null;
  const resolvedBudget = activeBudget || YanKernel.resolveModelBudget?.(state.config.api || {}) || {};
  const maxTokens = Number(resolvedBudget.contextWindow) || YanKernel.CONTEXT_TOKEN_MAX || 1_000_000;
  const compressAt = Math.min(maxTokens, Number(resolvedBudget.compressSoftThreshold) || YanKernel.CONTEXT_TOKEN_COMPRESS_SOFT || Math.floor(maxTokens * 0.7));
  const hardAt = Math.min(maxTokens, Number(resolvedBudget.compressHardThreshold) || YanKernel.CONTEXT_TOKEN_COMPRESS_THRESHOLD || Math.floor(maxTokens * 0.85));
  const pct = Math.min(100, (tokens / maxTokens) * 100);
  const percentLabel = tokens > 0 && pct < 1 ? '<1%' : `${Math.round(pct)}%`;
  if (el('ctxTokenUsed')) el('ctxTokenUsed').textContent = formatTokenCount(tokens);
  if (el('ctxTokenLimit')) el('ctxTokenLimit').textContent = formatTokenCount(maxTokens);
  if (el('ctxTokenPercent')) el('ctxTokenPercent').textContent = percentLabel;
  const budgetState = tokens >= hardAt ? 'critical' : (tokens >= compressAt ? 'warn' : 'normal');
  if (contextInfo) {
    contextInfo.dataset.budget = budgetState;
    contextInfo.style.setProperty('--ctx-compress-pct', `${Math.min(100, (compressAt / maxTokens) * 100)}%`);
  }
  const bar = el('ctxTokenBar');
  if (bar) {
    bar.style.setProperty('--ctx-token-ratio', String(Math.max(0, Math.min(1, pct / 100))));
  }
  const track = el('ctxTokenTrack');
  if (track) {
    track.setAttribute('aria-valuenow', String(Math.round(pct)));
    track.setAttribute('aria-valuetext', `${formatTokenCount(tokens)}，上限 ${formatTokenCount(maxTokens)}`);
  }
  const hint = el('ctxTokenHint');
  if (hint) {
    if (tokens >= hardAt) {
      hint.textContent = `已超过安全线 ${formatTokenCount(hardAt)}，下次请求会先压缩早期对话`;
    } else if (tokens >= compressAt) {
      hint.textContent = `已达到自动压缩线 ${formatTokenCount(compressAt)}`;
    } else {
      hint.textContent = `距离自动压缩还有 ${formatTokenCount(Math.max(0, compressAt - tokens))}`;
    }
  }
}

let rsRefreshTimer = null;
function scheduleRightSidebarRefresh() {
  if (rsRefreshTimer) clearTimeout(rsRefreshTimer);
  rsRefreshTimer = setTimeout(async () => {
    rsRefreshTimer = null;
    await renderRightSidebarFiles();
    updateContextInfo();
  }, 250);
}

function parseTodos(content) {
  const lines = content.split('\n');
  const todos = [];
  let inTodoSection = false;
  for (const line of lines) {
    const m = line.match(/^(\d+)[.、)]\s+(.+)/);
    if (m && inTodoSection) {
      todos.push({ text: m[2].trim(), done: false });
    } else if (line.includes('任务计划') || line.includes('## 计划') || line.match(/^##.*任务/)) {
      inTodoSection = true;
    } else if (line.startsWith('## ') && !line.includes('计划') && !line.includes('任务')) {
      inTodoSection = false;
    }
  }
  return todos;
}

function updateTodos(content, as, ui = true) {
  if (!as) as = getCurrentAgentState();
  if (as.todosFromTool) return;
  const newTodos = parseTodos(content);
  if (newTodos.length > 0) {
    as.todos = newTodos;
    if (ui) renderTodos(as);
  }
}

function renderTodos(as) {
  if (as && !isAgentStateForCurrentSession(as)) return;
  if (!as) as = getCurrentAgentState();
  const list = $('#todoList');
  if (!list) return;
  if (as.todos.length === 0) {
    list.innerHTML = '<div class="rs-empty">Agent 执行任务时，任务计划会显示在这里</div>';
    return;
  }
  list.innerHTML = as.todos.map((t, i) => `
    <div class="todo-item ${t.done ? 'done' : ''} ${t.inProgress ? 'in-progress' : ''}" data-i="${i}">
      <span class="todo-check">${t.done ? '✓' : (t.inProgress ? '◉' : '○')}</span>
      <span class="todo-text">${escapeHtml(t.text)}</span>
    </div>
  `).join('');
}

async function renderRightSidebarFiles() {
  const ws = await api.getWorkspace();
  const tree = $('#rsFileTree');
  if (!ws) { tree.innerHTML = '<div class="rs-empty">未设置工作区</div>'; return; }

  tree.innerHTML = '<div class="rs-empty">加载中…</div>';
  const entries = await api.listWorkspace(ws);
  if (!entries.length) { tree.innerHTML = '<div class="rs-empty">空目录</div>'; return; }
  tree.innerHTML = entries.map(e => rsFileNodeHtml(e)).join('');
  bindRsFileNodes(tree, ws);
}

function rsFileNodeHtml(entry) {
  const isDir = entry.isDirectory;
  return `
    <div class="rs-fs-node ${isDir ? 'dir' : 'file'}" data-path="${escapeAttr(entry.path)}">
      <span class="rs-fs-icon">${isDir ? '📁' : '📄'}</span>
      <span class="rs-fs-name">${escapeHtml(entry.name)}</span>
    </div>
  `;
}

function bindRsFileNodes(root, basePath) {
  root.querySelectorAll('.rs-fs-node.dir').forEach(node => {
    node.addEventListener('click', async (e) => {
      e.stopPropagation();
      const existing = node.nextElementSibling;
      if (existing && existing.classList.contains('rs-fs-children')) {
        existing.remove();
        return;
      }
      const children = await api.listWorkspace(node.dataset.path);
      const div = document.createElement('div');
      div.className = 'rs-fs-children';
      div.innerHTML = children.map(c => rsFileNodeHtml(c)).join('');
      node.after(div);
      bindRsFileNodes(div, node.dataset.path);
    });
  });
  root.querySelectorAll('.rs-fs-node.file').forEach(node => {
    node.addEventListener('click', async (e) => {
      e.stopPropagation();
      const path = node.dataset.path;
      const res = await api.readFile(path);
      if (res.error) {
        toast('读取失败: ' + res.error);
        return;
      }
      if (res.isBinary) {
        toast('无法显示，因为它是二进制文件');
        return;
      }
      openFilePreviewModal(path, res.content);
    });
  });
}

// ============================================================
// File preview modal (popup window for code preview)
// ============================================================
function openFilePreviewModal(filePath, content) {
  let modal = $('#filePreviewModal');
  if (!modal) {
    modal = document.createElement('div');
    modal.id = 'filePreviewModal';
    modal.className = 'overlay';
    modal.innerHTML = `
      <div class="file-preview-sheet">
        <div class="fps-header">
          <div class="fps-title">
            <span class="fps-icon">📄</span>
            <span id="fpsName" class="fps-name"></span>
          </div>
          <div class="fps-actions">
            <button id="fpsCopy" class="fps-btn" title="复制内容">复制</button>
            <button id="fpsClose" class="fps-close" title="关闭">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
            </button>
          </div>
        </div>
        <div class="fps-meta">
          <span id="fpsPath" class="fps-path"></span>
          <span class="fps-sep">·</span>
          <span id="fpsSize" class="fps-size"></span>
        </div>
        <pre id="fpsContent" class="fps-content"></pre>
      </div>
    `;
    document.body.appendChild(modal);
    modal.addEventListener('click', (e) => {
      if (e.target === modal) modal.classList.add('hidden');
    });
    modal.querySelector('#fpsClose').addEventListener('click', () => modal.classList.add('hidden'));
    modal.querySelector('#fpsCopy').addEventListener('click', async () => {
      const text = modal.querySelector('#fpsContent').textContent;
      try {
        await navigator.clipboard.writeText(text);
        toast('已复制到剪贴板');
      } catch {
        toast('复制失败');
      }
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !modal.classList.contains('hidden')) {
        modal.classList.add('hidden');
      }
    });
  }

  const fileName = filePath.split(/[\\/]/).pop();
  modal.querySelector('#fpsName').textContent = fileName;
  modal.querySelector('#fpsPath').textContent = filePath;
  const sizeEl = modal.querySelector('#fpsSize');
  const len = content.length;
  sizeEl.textContent = len > 1024 ? (len / 1024).toFixed(1) + ' KB' : len + ' B';
  const contentEl = modal.querySelector('#fpsContent');
  // Show full content (scrollable), no truncation in modal
  contentEl.textContent = content;
  modal.classList.remove('hidden');
}

// Right sidebar tab switching
$$('.rs-tab').forEach(btn => {
  btn.addEventListener('click', () => {
    $$('.rs-tab').forEach(b => b.classList.toggle('active', b === btn));
    $$('.rs-panel').forEach(p => p.classList.toggle('active', p.id === `rs-${btn.dataset.rsTab}`));
    const tab = btn.dataset.rsTab;
    if (tab === 'files') renderRightSidebarFiles();
    else if (tab === 'context') updateContextInfo();
  });
});

// Right sidebar toggle (button in task bar)
$('#rightSidebarToggleBtn').addEventListener('click', () => {
  const open = $('#app').classList.contains('rs-hidden');
  setRightSidebarOpen(open);
});

// ============================================================
// Settings sheet
// ============================================================
const settingsOverlay = $('#settingsOverlay');
$('#settingsBtn').addEventListener('click', () => openSettings());
$('#closeSettings').addEventListener('click', closeSettings);
settingsOverlay.addEventListener('click', (e) => {
  if (e.target === settingsOverlay) closeSettings();
});

function openSettings(tab = 'about') {
  populateSettings();
  settingsOverlay.classList.remove('hidden');
  switchTab(tab);
}

function closeSettings() {
  settingsOverlay.classList.add('hidden');
}

$$('.sheet-nav-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  $$('.sheet-nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  $$('.tab-panel').forEach(p => p.classList.toggle('active', p.id === `tab-${tab}`));
}

let currentProviderId = 'deepseek';
let providerCache = [];
const providerLogoIds = new Set([
  'openai', 'grok', 'deepseek', 'qwen', 'glm',
  'doubao', 'moonshot', 'stepfun', 'minimax'
]);

async function populateSettings() {
  const cfg = await api.getConfig();
  const perm = await api.getPermissions();

  currentProviderId = cfg.api.provider || 'deepseek';
  state.config = cfg;
  await renderProviderList(currentProviderId);
  updateApiKeyField(currentProviderId);

  $('#permRead').checked = perm.allowFileRead;
  $('#permWrite').checked = perm.allowFileWrite;
  $('#permShell').checked = perm.allowShell;
  $('#permNet').checked = perm.allowNetwork;

  renderModelGrid(cfg);
  updateDynamicProviderUi(cfg);
  await renderRemoteSettings();
}

async function renderProviderList(selectedId) {
  if (!providerCache.length) {
    providerCache = await api.listProviders();
  }
  const list = $('#providerList');
  if (!list) return;
  list.innerHTML = providerCache.map(p => {
    const logoStyle = providerLogoIds.has(p.id)
      ? ` style="--provider-logo: url('assets/provider-logos/${p.id}.png')"`
      : '';
    return `
    <div class="provider-item ${p.id === selectedId ? 'active' : ''}" data-provider="${p.id}"${logoStyle}>
      <div class="provider-info">
        <div class="provider-name">${escapeHtml(p.name)}</div>
        <div class="provider-models">${p.id === 'custom' && p.modelCount === 0
          ? '填写 Base URL、API Key 和模型 ID'
          : (p.dynamicModels && p.modelCount === 0 ? '保存 API Key 后加载模型' : `${p.modelCount} 个模型`)}</div>
      </div>
      <div class="provider-check">${p.id === selectedId ? ICONS.check : ''}</div>
    </div>
  `;
  }).join('');
  list.querySelectorAll('.provider-item').forEach(el => {
    el.addEventListener('click', async () => {
      const pid = el.dataset.provider;
      currentProviderId = pid;
      renderProviderList(pid);
      updateApiKeyField(pid);
    });
  });
}

async function updateApiKeyField(providerId) {
  const p = providerCache.find(x => x.id === providerId);
  if (!p) return;
  const inp = $('#cfgApiKey');
  if (inp) {
    inp.placeholder = p.apiKeyPlaceholder || 'sk-...';
    inp.value = state.config?.api?.providerConfigs?.[providerId]?.apiKey
      || state.config?.api?.apiKeys?.[providerId]
      || '';
  }
  const connection = state.config?.api?.providerConfigs?.[providerId] || {};
  const baseUrl = $('#cfgBaseUrl');
  if (baseUrl) baseUrl.value = connection.baseUrl || p.baseUrl || '';
  const baseUrlLabel = $('#cfgBaseUrlLabel');
  if (baseUrlLabel) baseUrlLabel.textContent = 'Base URL';
  const imageGenerationUrl = $('#cfgImageGenerationUrl');
  if (imageGenerationUrl) imageGenerationUrl.value = connection.imageGenerationUrl || '';
  const imageEditUrl = $('#cfgImageEditUrl');
  if (imageEditUrl) imageEditUrl.value = connection.imageEditUrl || '';
  const customModelField = $('#customModelField');
  customModelField?.classList.toggle('hidden', providerId !== 'custom');
  const customModelInput = $('#cfgCustomModelId');
  if (customModelInput) customModelInput.value = providerId === 'custom' ? (connection.customModelId || '') : '';
  const hint = $('#cfgBaseUrlHint');
  if (hint) {
    hint.textContent = `默认地址：${p.defaultBaseUrl || p.baseUrl || '用户自定义'}。支持 OpenAI 兼容网关。`;
  }
  const label = $('#cfgApiKeyLabel');
  if (label) {
    label.textContent = p.name + ' API Key';
  }
  const applyProviderNames = { openai: 'OpenAI', grok: 'Grok' };
  const applyProviderName = applyProviderNames[providerId];
  const applyHint = $('#apiApplyHint');
  applyHint?.classList.toggle('hidden', !applyProviderName);
  const applyName = $('#apiApplyProviderName');
  if (applyName) applyName.textContent = applyProviderName || '';
}

$('#apiApplyLink').addEventListener('click', async (event) => {
  event.preventDefault();
  const result = await api.openExternal('https://blankusing.com/');
  if (result?.error) toast('打开链接失败：' + result.error);
});

function updateDynamicProviderUi(cfg) {
  const provider = providerCache.find(item => item.id === cfg?.api?.provider);
  $('#refreshModels')?.classList.toggle('hidden', !provider?.dynamicModels);
}

async function renderRemoteSettings() {
  const info = await api.getRemoteInfo?.();
  if (!info) return;
  const enabledEl = $('#remoteEnabled');
  if (enabledEl) enabledEl.checked = !!info.enabled;
  const pwdEl = $('#remotePassword');
  if (pwdEl) pwdEl.value = '';
  const hintEl = $('#remotePasswordHint');
  if (hintEl) {
    hintEl.textContent = info.passwordSet
      ? '已设置访问密码，手机端连接时需输入'
      : '尚未设置密码，请设置至少 4 位密码后使用手机端';
  }
  const urlsEl = $('#remoteUrls');
  if (urlsEl) {
    const urls = info.urls?.length ? info.urls : (info.primaryUrl ? [info.primaryUrl] : []);
    urlsEl.innerHTML = urls.length
      ? urls.map((u) => `<div class="remote-url-item">${escapeHtml(u)}</div>`).join('')
      : '<div class="remote-url-item">服务未启动</div>';
  }
  const statusEl = $('#remoteStatus');
  if (statusEl) {
    const pwdNote = info.passwordSet ? '' : ' · 未设置密码';
    statusEl.textContent = info.running
      ? `服务运行中 · 端口 ${info.port || '—'}${pwdNote}`
      : (info.enabled ? `已启用，等待服务启动…${pwdNote}` : '已关闭移动端控制');
  }
}

$('#remoteEnabled')?.addEventListener('change', async (e) => {
  const enabled = !!e.target.checked;
  await api.setConfig({ remoteControl: { enabled } });
  await renderRemoteSettings();
  toast(enabled ? '移动端控制已开启' : '移动端控制已关闭');
});

$('#remoteSavePassword')?.addEventListener('click', async () => {
  const password = $('#remotePassword')?.value || '';
  if (password.length < 4) {
    toast('密码至少 4 位');
    return;
  }
  const result = await api.setRemotePassword?.(password);
  if (result?.error) {
    toast(result.error);
    return;
  }
  $('#remotePassword').value = '';
  await renderRemoteSettings();
  toast('访问密码已保存');
});

$('#remoteRestart')?.addEventListener('click', async () => {
  await api.restartRemote?.();
  await renderRemoteSettings();
  toast('移动端服务已重启');
});

function updateProviderModelCount(providerId, count) {
  const provider = providerCache.find(item => item.id === providerId);
  if (provider) provider.modelCount = Number(count) || 0;
}

// ============================================================
// MCP page (moved from settings)
// ============================================================
async function renderMcpList() {
  await renderMcpPage();
}

$('#mcpAddBtn')?.addEventListener('click', async () => {
  const name = $('#mcpNewName').value.trim();
  const command = $('#mcpNewCmd').value.trim();
  const argsStr = $('#mcpNewArgs').value.trim();
  if (!name || !command) {
    toast('请填写名称和命令');
    return;
  }
  // 支持 shell 引号解析：用 "..." 或 '...' 包裹含空格的参数
  // 例如: -y @mcp/server "C:\Program Files\path" → ['-y', '@mcp/server', 'C:\Program Files\path']
  const args = argsStr
    ? (argsStr.match(/"[^"]*"|'[^']*'|\S+/g) || []).map(s => s.replace(/^["']|["']$/g, ''))
    : [];
  const server = await api.mcpAdd({ name, command, args });
  $('#mcpNewName').value = '';
  $('#mcpNewCmd').value = '';
  $('#mcpNewArgs').value = '';
  closeCapabilityDrawer('mcpCreateDialog');
  // 添加后立即测试连接，给用户即时反馈
  toast('正在测试连接 ' + name + '...');
  const res = await api.mcpStart(server.id);
  if (res.error) {
    toast('MCP 启动失败: ' + res.error);
  } else if (res.ok) {
    toast('已添加并启动成功，加载了 ' + (res.tools?.length || 0) + ' 个工具');
  }
  await renderMcpPage();
});

// ============================================================
// Automations (定时自动任务)
// ============================================================
const AUTOMATION_TICK_MS = 30000;

function automationDue(a, now) {
  if (!a.enabled || !a.prompt) return false;
  const s = a.schedule || {};
  if (s.type === 'interval') {
    const every = Math.max(1, Number(s.everyMinutes) || 60) * 60000;
    const base = a.lastRun || a.createdAt || 0;
    return now - base >= every;
  }
  if (s.type === 'daily') {
    const [h, m] = String(s.time || '09:00').split(':').map(Number);
    const target = new Date();
    target.setHours(h || 0, m || 0, 0, 0);
    const targetMs = target.getTime();
    // 今天的触发点已过，且本触发点之后还没运行过（错过也会补跑）
    return now >= targetMs && (a.lastRun || 0) < targetMs;
  }
  if (s.type === 'once') {
    const at = new Date(s.datetime || 0).getTime();
    return !a.lastRun && Number.isFinite(at) && at > 0 && now >= at;
  }
  return false;
}

async function automationTick() {
  let autos = [];
  try { autos = await api.autoList(); } catch { return; }
  const now = Date.now();
  const slots = MAX_CONCURRENT_RUNS - state.activeRuns.size;
  if (slots <= 0) return;

  const due = autos.filter(a =>
    automationDue(a, now) &&
    !state.automationRuns.has(a.id)
  );
  if (!due.length) return;

  await Promise.all(due.slice(0, slots).map(a => runAutomation(a)));
}

async function runAutomation(auto, { manual = false } = {}) {
  if (state.automationRuns.has(auto.id)) return { ok: false, error: 'already_running' };
  if (!canStartRun()) return { ok: false, error: 'busy' };

  state.automationRuns.add(auto.id);
  let createdSessionId = null;
  try {
    await api.autoUpdate(auto.id, { lastRun: Date.now(), lastStatus: 'running' });

    const s = await api.createSession(true);
    createdSessionId = s.id;
    const title = `[自动] ${auto.name}`;
    s.title = title;
    await api.renameSession(s.id, title);
    await refreshSessions();

    const res = await submitMessageBackground(s, auto.prompt);

    if (res.error === 'busy' && createdSessionId) {
      try { await api.deleteSession(createdSessionId, true); } catch {}
      createdSessionId = null;
      await refreshSessions();
      if (manual) toast('并发任务已达上限（5个），请稍后再试');
      await api.autoUpdate(auto.id, { lastStatus: 'skipped' });
      return res;
    }

    const patch = { lastStatus: res && res.ok ? 'ok' : 'error' };
    if ((auto.schedule || {}).type === 'once') patch.enabled = false;
    await api.autoUpdate(auto.id, patch);

    if (window.Notification && Notification.permission === 'granted') {
      try {
        new Notification('Yan Agent · 自动化', {
          body: `「${auto.name}」${res && res.ok ? '运行完成' : '运行出错'}`,
          icon: 'assets/logo.png'
        });
      } catch {}
    }
    if (manual || document.querySelector('#pageAutomation:not(.hidden)')) {
      await renderAutomationPage();
    }
    return res;
  } catch (e) {
    try { await api.autoUpdate(auto.id, { lastStatus: 'error' }); } catch {}
    return { ok: false, error: e.message };
  } finally {
    state.automationRuns.delete(auto.id);
  }
}

setInterval(automationTick, AUTOMATION_TICK_MS);

function describeSchedule(a) {
  const s = a.schedule || {};
  if (s.type === 'interval') return `每 ${s.everyMinutes || 60} 分钟`;
  if (s.type === 'daily') return `每天 ${s.time || '09:00'}`;
  if (s.type === 'once') return `一次性 · ${s.datetime ? new Date(s.datetime).toLocaleString() : '未设置时间'}`;
  return '未知调度';
}

function describeAutoStatus(a) {
  if (!a.lastRun) return '尚未运行';
  const t = new Date(a.lastRun).toLocaleString();
  const badge = { ok: '✓ 成功', error: '✗ 出错', running: '… 运行中' }[a.lastStatus] || '';
  return `上次 ${t}${badge ? ' · ' + badge : ''}`;
}

async function renderAutomationList() {
  await renderAutomationPage();
}

// 调度类型切换时显示对应的参数输入框
function updateAutoScheduleFields() {
  const t = $('#autoNewType')?.value || 'interval';
  $('#autoFieldEvery')?.classList.toggle('hidden', t !== 'interval');
  $('#autoFieldTime')?.classList.toggle('hidden', t !== 'daily');
  $('#autoFieldDatetime')?.classList.toggle('hidden', t !== 'once');
}

$('#autoNewType')?.addEventListener('change', updateAutoScheduleFields);
updateAutoScheduleFields();

$('#autoAddBtn')?.addEventListener('click', async () => {
  const name = $('#autoNewName').value.trim();
  const prompt = $('#autoNewPrompt').value.trim();
  if (!name || !prompt) { toast('请填写名称和任务提示词'); return; }
  const type = $('#autoNewType').value;
  const schedule = { type };
  if (type === 'interval') {
    schedule.everyMinutes = Math.max(1, Math.floor(Number($('#autoNewEvery').value)) || 60);
  } else if (type === 'daily') {
    schedule.time = $('#autoNewTime').value || '09:00';
  } else if (type === 'once') {
    const v = $('#autoNewDatetime').value;
    if (!v) { toast('请选择运行时间'); return; }
    schedule.datetime = v;
  }
  await api.autoAdd({ name, prompt, schedule });
  $('#autoNewName').value = '';
  $('#autoNewPrompt').value = '';
  closeCapabilityDrawer('autoCreateDialog');
  await renderAutomationPage();
});

// API save
$('#saveApi').addEventListener('click', async () => {
  const apiKeyValue = $('#cfgApiKey').value.trim();
  const baseUrlValue = $('#cfgBaseUrl').value.trim();
  const imageGenerationUrl = $('#cfgImageGenerationUrl').value.trim();
  const imageEditUrl = $('#cfgImageEditUrl').value.trim();
  const customModelId = currentProviderId === 'custom' ? $('#cfgCustomModelId').value.trim() : '';
  if (currentProviderId === 'custom' && !customModelId) {
    toast('请填写自定义模型 ID');
    return;
  }
  const providerName = providerCache.find(p => p.id === currentProviderId)?.name || currentProviderId;
  const dynamicModels = !!providerCache.find(p => p.id === currentProviderId)?.dynamicModels;
  const button = $('#saveApi');
  const originalText = button.textContent;
  button.disabled = true;
  button.textContent = dynamicModels ? '正在加载模型…' : '正在保存…';
  try {
    const result = await api.configureProvider(currentProviderId, {
      apiKey: apiKeyValue,
      baseUrl: baseUrlValue,
      imageGenerationUrl,
      imageEditUrl,
      customModelId
    });
    if (result?.error) {
      toast(result.error);
      return;
    }
    state.config = result.config;
    currentProviderId = state.config.api.provider;
    updateProviderModelCount(currentProviderId, result.modelCount);
    updateApiKeyField(currentProviderId);
    await renderProviderList(currentProviderId);
    renderModelGrid(state.config);
    renderModelBadge();
    updateDynamicProviderUi(state.config);
    toast(dynamicModels
      ? `${providerName} 配置已保存，已加载 ${result.modelCount} 个模型`
      : `${providerName} 配置已保存`);
  } catch (error) {
    toast('保存失败：' + error.message);
  } finally {
    button.disabled = false;
    button.textContent = originalText;
  }
});

$('#toggleKey').addEventListener('click', () => {
  const inp = $('#cfgApiKey');
  if (inp.type === 'password') { inp.type = 'text'; $('#toggleKey').textContent = '隐藏'; }
  else { inp.type = 'password'; $('#toggleKey').textContent = '显示'; }
});

function renderModelGrid(cfg) {
  const grid = $('#modelGrid');
  const current = cfg.api.model;
  const models = cfg.models || [];

  if (models.length === 0) {
    const provider = providerCache.find(item => item.id === cfg.api.provider);
    grid.innerHTML = `<div class="session-empty">${provider?.dynamicModels ? '尚未从 API 加载到可用模型' : '暂无可用模型'}</div>`;
    return;
  }

  grid.innerHTML = models.map(m => `
    <div class="model-card ${m.id === current ? 'active' : ''}" data-model="${m.id}">
      <div class="mc-check">${ICONS.check}</div>
      <div class="mc-name">${escapeHtml(m.name)}</div>
      <div class="mc-id">${escapeHtml(m.id)}</div>
      ${m.price ? `<div class="mc-price">${escapeHtml(m.price)}</div>` : ''}
    </div>
  `).join('');
  grid.querySelectorAll('.model-card').forEach(card => {
    card.addEventListener('click', async () => {
      const id = card.dataset.model;
      const nextConfig = await api.setModel(id);
      if (nextConfig?.error) { toast(nextConfig.error); return; }
      state.config = nextConfig;
      renderModelGrid(state.config);
      renderModelBadge();
      const name = models.find(m => m.id === id)?.name || id;
      toast(`已切换到 ${name}`);
    });
  });
}

$('#refreshModels').addEventListener('click', async () => {
  const button = $('#refreshModels');
  button.disabled = true;
  try {
    const result = await api.refreshProviderModels(state.config.api.provider);
    if (result?.error) { toast(result.error); return; }
    state.config = result.config;
    updateProviderModelCount(state.config.api.provider, result.modelCount);
    await renderProviderList(state.config.api.provider);
    renderModelGrid(state.config);
    renderModelBadge();
    toast(`已刷新 ${result.modelCount} 个模型`);
  } catch (error) {
    toast('刷新失败：' + error.message);
  } finally {
    button.disabled = false;
  }
});

// Permissions
async function bindPermissions() {
  const map = { permRead: 'allowFileRead', permWrite: 'allowFileWrite', permShell: 'allowShell', permNet: 'allowNetwork' };
  Object.keys(map).forEach(id => {
    $('#' + id).addEventListener('change', async (e) => {
      const perm = await api.setPermissions({ [map[id]]: e.target.checked });
      state.config = await api.getConfig();
      toast(`权限已更新：${map[id]} = ${e.target.checked}`);
    });
  });
}

// ============================================================
// Model controls
// ============================================================
function renderModelBadge() {
  const m = state.config.api.model;
  const name = (state.config.models || []).find(x => x.id === m)?.name || m || '未选择模型';
  const pillName = $('#modelPillName');
  if (pillName) pillName.textContent = name;
  renderReasoningSpeedControl();
  renderWorkModeControl();
  renderAccessModeControl();
  syncAttachmentMenu();
  updateContextInfo();
}

const REASONING_SPEED_UI = Object.freeze({
  fast: { label: '高效', toast: '已切换到高效推理' },
  balanced: { label: '标准', toast: '已切换到标准推理' },
  smart: { label: '更智能', toast: '已切换到更智能推理' }
});
const REASONING_SPEED_MODES = Object.freeze(Object.keys(REASONING_SPEED_UI));

function getReasoningSpeedMode() {
  const apiConfig = state.config?.api || {};
  if (window.YanKernel?.getReasoningSpeed) return window.YanKernel.getReasoningSpeed(apiConfig);
  const value = String(apiConfig.reasoningSpeed || '');
  return REASONING_SPEED_UI[value] ? value : (apiConfig.thinking ? 'smart' : 'balanced');
}

function getReasoningSpeedBillingNote(mode) {
  const provider = String(state.config?.api?.provider || '');
  const model = String(state.config?.api?.model || '');
  if (model === 'kimi-k3') return 'Kimi K3 固定 Max · 档位仅调整 Agent 执行节奏';
  if (['fast', 'smart'].includes(mode) && provider === 'moonshot' && model === 'kimi-k2.7-code') {
    return '将使用 Kimi K2.7 HighSpeed（价格更高）';
  }
  if (['fast', 'smart'].includes(mode) && provider === 'minimax' && model === 'MiniMax-M2.7') {
    return '将使用 MiniMax M2.7 HighSpeed（价格更高）';
  }
  return '';
}

function renderReasoningSpeedControl(modeOverride, progressOverride) {
  const mode = REASONING_SPEED_UI[modeOverride] ? modeOverride : getReasoningSpeedMode();
  const meta = REASONING_SPEED_UI[mode] || REASONING_SPEED_UI.balanced;
  const pill = $('#reasoningSpeedPill');
  const slider = $('#reasoningSpeedSlider');
  const sliderShell = $('#reasoningSpeedSliderShell');
  const note = $('#reasoningSpeedBillingNote');
  const speedIndex = Math.max(0, REASONING_SPEED_MODES.indexOf(mode));
  const hasProgressOverride = Number.isFinite(progressOverride);
  const speedProgress = hasProgressOverride
    ? Math.max(0, Math.min(1, progressOverride))
    : speedIndex / (REASONING_SPEED_MODES.length - 1);
  if (pill) {
    pill.dataset.mode = mode;
    pill.title = `推理速度：${meta.label}`;
  }
  if ($('#reasoningSpeedPillName')) $('#reasoningSpeedPillName').textContent = meta.label;
  if ($('#reasoningSpeedMenuValue')) $('#reasoningSpeedMenuValue').textContent = meta.label;
  if (sliderShell) {
    sliderShell.dataset.mode = mode;
    sliderShell.style.setProperty('--speed-progress', String(speedProgress));
  }
  if (slider) {
    if (!hasProgressOverride) slider.value = String(speedIndex * 50);
    slider.setAttribute('aria-valuetext', meta.label);
  }
  const noteText = getReasoningSpeedBillingNote(mode);
  if (note) {
    note.textContent = noteText;
    note.classList.toggle('is-empty', !noteText);
  }
}

function setReasoningSpeedMenuOpen(open) {
  const menu = $('#reasoningSpeedMenu');
  const pill = $('#reasoningSpeedPill');
  if (!menu || !pill) return;
  menu.classList.toggle('hidden', !open);
  pill.setAttribute('aria-expanded', String(open));
  if (open) {
    setWorkModeMenuOpen(false);
    setAccessModeMenuOpen(false);
    renderReasoningSpeedControl();
    $('#reasoningSpeedSlider')?.focus({ preventScroll: true });
  } else {
    renderReasoningSpeedControl();
  }
}

async function selectReasoningSpeed(mode, { closeMenu = true } = {}) {
  if (!REASONING_SPEED_UI[mode] || mode === getReasoningSpeedMode()) {
    renderReasoningSpeedControl();
    if (closeMenu) setReasoningSpeedMenuOpen(false);
    return;
  }
  state.config = await api.setConfig({
    api: { reasoningSpeed: mode, thinking: mode === 'smart' }
  });
  renderReasoningSpeedControl();
  if (closeMenu) setReasoningSpeedMenuOpen(false);
  const billingNote = getReasoningSpeedBillingNote(mode);
  toast(billingNote || REASONING_SPEED_UI[mode].toast);
}

const WORK_MODE_UI = Object.freeze({
  normal: { label: '常规', toast: '工作方式：常规' },
  plan: { label: '计划', toast: '工作方式：计划' },
  goal: { label: '目标', toast: '工作方式：目标' }
});
const WORK_MODE_KEYS = Object.freeze(Object.keys(WORK_MODE_UI));

function getCurrentWorkMode() {
  if (window.YanKernel?.getWorkMode) return window.YanKernel.getWorkMode(state.config || {});
  const value = String(state.config?.agent?.workMode || '');
  return WORK_MODE_UI[value] ? value : 'normal';
}

function renderWorkModeControl(modeOverride, progressOverride) {
  const mode = WORK_MODE_UI[modeOverride] ? modeOverride : getCurrentWorkMode();
  const meta = WORK_MODE_UI[mode] || WORK_MODE_UI.normal;
  const index = Math.max(0, WORK_MODE_KEYS.indexOf(mode));
  const hasProgressOverride = Number.isFinite(progressOverride);
  const progress = hasProgressOverride
    ? Math.max(0, Math.min(1, progressOverride))
    : index / (WORK_MODE_KEYS.length - 1);
  const pill = $('#workModePill');
  const shell = $('#workModeSliderShell');
  const slider = $('#workModeSlider');
  if (pill) {
    pill.dataset.mode = mode;
    pill.title = `工作方式：${meta.label}`;
  }
  if ($('#workModePillName')) $('#workModePillName').textContent = meta.label;
  if ($('#workModeMenuValue')) $('#workModeMenuValue').textContent = meta.label;
  if (shell) {
    shell.dataset.mode = mode;
    shell.style.setProperty('--speed-progress', String(progress));
  }
  if (slider) {
    if (!hasProgressOverride) slider.value = String(index * 50);
    slider.setAttribute('aria-valuetext', meta.label);
  }
}

function setWorkModeMenuOpen(open) {
  const menu = $('#workModeMenu');
  const pill = $('#workModePill');
  if (!menu || !pill) return;
  menu.classList.toggle('hidden', !open);
  pill.setAttribute('aria-expanded', String(open));
  if (open) {
    setReasoningSpeedMenuOpen(false);
    setAccessModeMenuOpen(false);
    renderWorkModeControl();
    $('#workModeSlider')?.focus({ preventScroll: true });
  } else {
    renderWorkModeControl();
  }
}

async function selectWorkMode(mode, { closeMenu = true } = {}) {
  if (!WORK_MODE_UI[mode] || mode === getCurrentWorkMode()) {
    renderWorkModeControl();
    if (closeMenu) setWorkModeMenuOpen(false);
    return;
  }
  state.config = await api.setConfig({ agent: { workMode: mode } });
  renderWorkModeControl();
  if (closeMenu) setWorkModeMenuOpen(false);
  toast(WORK_MODE_UI[mode].toast);
}

const ACCESS_MODE_UI = Object.freeze({
  request: { label: '请求批准', toast: '权限访问：请求批准' },
  delegate: { label: '替我审批', toast: '权限访问：替我审批' },
  full: { label: '完全访问', toast: '权限访问：完全访问' }
});
const ACCESS_MODE_KEYS = Object.freeze(Object.keys(ACCESS_MODE_UI));

function getCurrentAccessMode() {
  const value = String(state.config?.agent?.accessMode || 'request');
  return ACCESS_MODE_UI[value] ? value : 'request';
}

function renderAccessModeControl() {
  const mode = getCurrentAccessMode();
  const meta = ACCESS_MODE_UI[mode];
  const pill = $('#accessModePill');
  if (pill) {
    pill.dataset.mode = mode;
    pill.title = `权限访问：${meta.label}`;
    pill.setAttribute('aria-label', `权限访问：${meta.label}`);
  }
  if ($('#accessModePillName')) $('#accessModePillName').textContent = meta.label;
  $$('.access-mode-option').forEach(option => {
    const selected = option.dataset.accessMode === mode;
    option.setAttribute('aria-pressed', String(selected));
  });
}

function setAccessModeMenuOpen(open) {
  const menu = $('#accessModeMenu');
  const pill = $('#accessModePill');
  if (!menu || !pill) return;
  menu.classList.toggle('hidden', !open);
  pill.setAttribute('aria-expanded', String(open));
  if (open) {
    setReasoningSpeedMenuOpen(false);
    setWorkModeMenuOpen(false);
    setSkillCallMenuOpen(false);
    renderAccessModeControl();
  }
}

let accessModeConfirmResolver = null;

function askAccessModeConfirmation() {
  return new Promise(resolve => {
    const modal = $('#accessModeConfirmModal');
    if (!modal) {
      resolve(false);
      return;
    }
    if (accessModeConfirmResolver) settleAccessModeConfirmation(false);
    accessModeConfirmResolver = resolve;
    modal.classList.remove('hidden');
    requestAnimationFrame(() => $('#accessModeConfirmAccept')?.focus());
  });
}

function settleAccessModeConfirmation(approved) {
  const resolve = accessModeConfirmResolver;
  accessModeConfirmResolver = null;
  $('#accessModeConfirmModal')?.classList.add('hidden');
  resolve?.(approved);
}

async function selectAccessMode(mode, { closeMenu = true } = {}) {
  if (!ACCESS_MODE_UI[mode]) return;
  if (mode === getCurrentAccessMode()) {
    renderAccessModeControl();
    if (closeMenu) setAccessModeMenuOpen(false);
    return;
  }
  if (mode === 'full' && !(await askAccessModeConfirmation())) {
    if (closeMenu) setAccessModeMenuOpen(false);
    return;
  }
  state.config = await api.setConfig({ agent: { accessMode: mode } });
  renderAccessModeControl();
  if (closeMenu) setAccessModeMenuOpen(false);
  toast(ACCESS_MODE_UI[mode].toast);
}
function closeTaskActionsMenu() {
  $('#taskActionsMenu')?.classList.add('hidden');
  const button = $('#taskBarMoreBtn');
  button?.classList.remove('active');
  button?.setAttribute('aria-expanded', 'false');
}

function syncTaskActionLabels() {
  const label = $('#taskPinActionLabel');
  if (label) label.textContent = state.currentSession?.pinned ? '取消置顶' : '置顶任务';
}

async function toggleCurrentTaskPinned() {
  const session = state.currentSession;
  if (!session) return;
  const next = !session.pinned;
  const updated = await api.setSessionPinned(session.id, next);
  if (!updated) {
    toast('置顶状态更新失败');
    return;
  }
  session.pinned = !!updated.pinned;
  await refreshSessions();
  updateTaskBar();
  toast(session.pinned ? '任务已置顶' : '已取消置顶');
}

let renameTaskSessionId = null;

function openRenameTaskDialog() {
  const session = state.currentSession;
  if (!session) return;
  renameTaskSessionId = session.id;
  const input = $('#renameTaskInput');
  input.value = displaySessionTitle(session.title);
  $('#renameTaskModal').classList.remove('hidden');
  requestAnimationFrame(() => {
    input.focus();
    input.select();
  });
}

function closeRenameTaskDialog() {
  renameTaskSessionId = null;
  $('#renameTaskModal')?.classList.add('hidden');
}

async function confirmTaskRename() {
  const id = renameTaskSessionId;
  const title = String($('#renameTaskInput')?.value || '').trim();
  if (!id) return;
  if (!title) {
    toast('任务名称不能为空');
    $('#renameTaskInput')?.focus();
    return;
  }
  const updated = await api.renameSession(id, title);
  if (!updated) {
    toast('重命名失败');
    return;
  }
  if (state.currentSession?.id === id) {
    state.currentSession.title = updated.title;
    syncPetFocusedSession(state.currentSession);
  }
  const summary = state.sessions.find(session => session.id === id);
  if (summary) summary.title = updated.title;
  closeRenameTaskDialog();
  await refreshSessions();
  updateTaskBar();
  toast('任务已重命名');
}

function bindTaskActions() {
  const moreButton = $('#taskBarMoreBtn');
  moreButton?.addEventListener('click', event => {
    event.stopPropagation();
    const menu = $('#taskActionsMenu');
    const opening = menu.classList.contains('hidden');
    closeTaskActionsMenu();
    if (opening) {
      syncTaskActionLabels();
      menu.classList.remove('hidden');
      moreButton.classList.add('active');
      moreButton.setAttribute('aria-expanded', 'true');
    }
  });
  $('#taskActionsMenu')?.addEventListener('click', async event => {
    const item = event.target.closest('[data-task-action]');
    if (!item) return;
    const action = item.dataset.taskAction;
    closeTaskActionsMenu();
    if (action === 'pin') await toggleCurrentTaskPinned();
    if (action === 'rename') openRenameTaskDialog();
  });
  $('#renameTaskCancel')?.addEventListener('click', closeRenameTaskDialog);
  $('#renameTaskConfirm')?.addEventListener('click', confirmTaskRename);
  $('#renameTaskModal')?.addEventListener('click', event => {
    if (event.target?.id === 'renameTaskModal') closeRenameTaskDialog();
  });
  $('#renameTaskInput')?.addEventListener('keydown', event => {
    if (event.key === 'Enter') {
      event.preventDefault();
      confirmTaskRename();
    } else if (event.key === 'Escape') {
      closeRenameTaskDialog();
    }
  });
  document.addEventListener('click', event => {
    if (!event.target.closest('.task-actions-wrap')) closeTaskActionsMenu();
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') closeTaskActionsMenu();
  });
}

// Update the task bar (title + folder + buttons)
function updateTaskBar() {
  const bar = $('#taskBar');
  if (!bar) return;
  closeTaskActionsMenu();
  if (!state.currentSession) {
    bar.classList.add('hidden');
    window.YanCodeMap?.bindWorkspace('');
    return;
  }
  bar.classList.remove('hidden');
  $('#taskBarTitle').textContent = displaySessionTitle(state.currentSession.title);
  const ws = state.config.workspace;
  window.YanCodeMap?.bindWorkspace(ws || '');
  const folderName = $('#taskBarFolderName');
  const openBtn = $('#taskBarOpenFolder');
  const yanxiBtn = $('#taskBarYanxiCode');
  if (ws) {
    folderName.textContent = ws.split(/[\\/]/).filter(Boolean).pop() || ws;
    openBtn.disabled = false;
    if (yanxiBtn && !yanxiBtn.classList.contains('is-launching')) yanxiBtn.disabled = false;
    api.yanagentEnsure?.(ws);
  } else {
    folderName.textContent = '选择文件夹';
    openBtn.disabled = true;
    if (yanxiBtn) yanxiBtn.disabled = true;
  }
  syncTaskActionLabels();
}

async function openCurrentWorkspaceInYanxiCode() {
  const workspace = state.currentSession?.workspace || state.config?.workspace || '';
  if (!workspace) {
    toast('请先选择工作区');
    return;
  }
  if (!api.launchYanxiCode) {
    toast('Yanxi Code 启动接口不可用');
    return;
  }

  const button = $('#taskBarYanxiCode');
  if (button?.classList.contains('is-launching')) return;
  button?.classList.add('is-launching');
  if (button) button.disabled = true;
  try {
    const result = await api.launchYanxiCode(workspace, 'workspace');
    if (result?.error) throw new Error(result.error);
    toast('正在打开 Yanxi Code 并同步当前工作区…');
  } catch (error) {
    toast(error.message || '启动 Yanxi Code 失败');
  } finally {
    button?.classList.remove('is-launching');
    if (button) button.disabled = !workspace;
  }
}

// ============================================================
// Helpers
// ============================================================
function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}
function escapeAttr(s) { return escapeHtml(s); }

// GFM 表格渲染：识别「表头 | 分隔行 | 数据行」结构，转成 <table>
// 输入应为已 escapeHtml 后的文本
function renderMarkdownTables(t) {
  const lines = t.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const header = lines[i];
    const sep = lines[i + 1];
    const isSep = sep != null && sep.includes('|') &&
      /-/.test(sep) && sep.replace(/[^|:\-\s]/g, '') === sep;
    if (header && header.includes('|') && isSep) {
      const parseRow = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map(c => c.trim());
      const headers = parseRow(header);
      const rows = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
        rows.push(parseRow(lines[j]));
        j++;
      }
      let html = '<table><thead><tr>' + headers.map(h => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
      html += rows.map(r => '<tr>' + r.map(c => `<td>${c}</td>`).join('') + '</tr>').join('');
      html += '</tbody></table>';
      out.push(html);
      i = j - 1;
    } else {
      out.push(header);
    }
  }
  return out.join('\n');
}

function renderMarkdown(text) {
  if (!text) return '';
  // 先抽出代码块，避免其内部内容被后续规则误处理
  const codeBlocks = [];
  let t = String(text).replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
    codeBlocks.push(code.replace(/\n$/, ''));
    return `\u0000CODE${codeBlocks.length - 1}\u0000`;
  });
  t = escapeHtml(t);
  // inline code
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold / italic
  t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>');
  // headers
  t = t.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  t = t.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  t = t.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  // tables (在列表/段落处理之前)
  t = renderMarkdownTables(t);
  // ordered lists — 用哨兵标记合并连续项为 <ol>
  t = t.replace(/^\s*\d+[.)]\s+(.*)$/gm, '\u0001$1\u0002');
  t = t.replace(/(\u0001[\s\S]*?\u0002(?:\s*\u0001[\s\S]*?\u0002)*)/g,
    m => '<ol>' + m.replace(/\u0001/g, '<li>').replace(/\u0002/g, '</li>').replace(/\s+/g, ' ') + '</ol>');
  // unordered lists — 合并连续的 <li> 为一个 <ul>
  t = t.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
  t = t.replace(/(<li>[\s\S]*?<\/li>(?:\s*<li>[\s\S]*?<\/li>)*)/g, '<ul>$1</ul>');
  // paragraphs
  t = t.split(/\n{2,}/).map(block => {
    const b = block.trim();
    if (!b) return '';
    if (/^<(h\d|ul|ol|pre|li|table|blockquote)/.test(b)) return block;
    if (/^\u0000CODE\d+\u0000$/.test(b)) return block;
    return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
  }).join('\n');
  // 还原代码块（内容做转义）
  t = t.replace(/\u0000CODE(\d+)\u0000/g, (_, i) =>
    `<pre><code>${escapeHtml(codeBlocks[Number(i)])}</code></pre>`);
  return t;
}

function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.remove('hidden');
  clearTimeout(toast._t);
  toast._t = setTimeout(() => t.classList.add('hidden'), 2200);
}

// ============================================================
// Sidebar resize handles (drag to adjust width)
// ============================================================
function setupResizeHandles() {
  const leftHandle = $('#leftResizeHandle');
  const rightHandle = $('#rightResizeHandle');

  // Left sidebar: drag right edge to resize
  let leftDragging = false;
  leftHandle.addEventListener('mousedown', (e) => {
    leftDragging = true;
    document.body.classList.add('resizing');
    e.preventDefault();
  });
  document.addEventListener('mousemove', (e) => {
    if (leftDragging) {
      const w = Math.max(180, Math.min(420, e.clientX));
      document.documentElement.style.setProperty('--sidebar-w', w + 'px');
    }
    if (rightDragging) {
      const w = Math.max(220, Math.min(560, window.innerWidth - e.clientX));
      document.documentElement.style.setProperty('--rs-w', w + 'px');
    }
  });
  document.addEventListener('mouseup', () => {
    if (leftDragging) { leftDragging = false; document.body.classList.remove('resizing'); }
    if (rightDragging) { rightDragging = false; document.body.classList.remove('resizing'); }
  });

  // Right sidebar: drag left edge to resize
  let rightDragging = false;
  rightHandle.addEventListener('mousedown', (e) => {
    rightDragging = true;
    document.body.classList.add('resizing');
    e.preventDefault();
  });
}

// ============================================================
// Bind UI (called once in init)
// ============================================================
function bindUI() {
  bindPermissions();
  bindWorkspacePermDialog();
  bindShellPermDialog();
  bindDeleteSessionDialog();
  bindTaskActions();
  $('#chatScroll')?.addEventListener('scroll', scheduleTurnScaleUpdate, { passive: true });
  window.addEventListener('resize', scheduleTurnScaleUpdate);

  // Task bar: folder button → choose workspace
  $('#taskBarFolder').addEventListener('click', async () => {
    const ws = await api.chooseWorkspace();
    if (ws) {
      state.config = await api.getConfig();
      // 保存到当前会话（会话隔离）
      if (state.currentSession) {
        await api.setSessionWorkspace(state.currentSession.id, ws);
        syncCurrentSessionWorkspace(ws);
      }
      await renderRightSidebarFiles();
      updateTaskBar();
      toast('工作区已更新');
    }
  });

  // Task bar: open folder in explorer
  $('#taskBarOpenFolder').addEventListener('click', async () => {
    const ws = state.config.workspace;
    if (ws) await api.revealFile(ws);
  });

  $('#taskBarYanxiCode')?.addEventListener('click', openCurrentWorkspaceInYanxiCode);

  // Model pill click → open settings on model tab
  $('#modelPill').addEventListener('click', () => {
    setReasoningSpeedMenuOpen(false);
    setWorkModeMenuOpen(false);
    openSettings('model');
  });

  $('#workModePill')?.addEventListener('click', event => {
    event.stopPropagation();
    const open = $('#workModeMenu')?.classList.contains('hidden');
    setWorkModeMenuOpen(!!open);
  });
  $('#workModeMenu')?.addEventListener('click', event => event.stopPropagation());
  const workModeSlider = $('#workModeSlider');
  const workModeSliderShell = $('#workModeSliderShell');
  workModeSlider?.addEventListener('pointerdown', () => workModeSliderShell?.classList.add('is-dragging'));
  workModeSlider?.addEventListener('input', () => {
    workModeSliderShell?.classList.add('is-dragging');
    const progress = Number(workModeSlider.value) / 100;
    const mode = WORK_MODE_KEYS[Math.round(progress * (WORK_MODE_KEYS.length - 1))] || 'normal';
    renderWorkModeControl(mode, progress);
  });
  workModeSlider?.addEventListener('change', async () => {
    const progress = Number(workModeSlider.value) / 100;
    const mode = WORK_MODE_KEYS[Math.round(progress * (WORK_MODE_KEYS.length - 1))] || 'normal';
    await selectWorkMode(mode, { closeMenu: false });
    workModeSliderShell?.classList.remove('is-dragging');
  });
  for (const eventName of ['pointerup', 'pointercancel', 'blur']) {
    workModeSlider?.addEventListener(eventName, () => workModeSliderShell?.classList.remove('is-dragging'));
  }

  $('#reasoningSpeedPill')?.addEventListener('click', event => {
    event.stopPropagation();
    const open = $('#reasoningSpeedMenu')?.classList.contains('hidden');
    setReasoningSpeedMenuOpen(!!open);
  });
  $('#reasoningSpeedMenu')?.addEventListener('click', event => event.stopPropagation());
  const reasoningSpeedSlider = $('#reasoningSpeedSlider');
  const reasoningSpeedSliderShell = $('#reasoningSpeedSliderShell');
  reasoningSpeedSlider?.addEventListener('pointerdown', () => reasoningSpeedSliderShell?.classList.add('is-dragging'));
  reasoningSpeedSlider?.addEventListener('input', () => {
    reasoningSpeedSliderShell?.classList.add('is-dragging');
    const progress = Number(reasoningSpeedSlider.value) / 100;
    const mode = REASONING_SPEED_MODES[Math.round(progress * (REASONING_SPEED_MODES.length - 1))] || 'balanced';
    renderReasoningSpeedControl(mode, progress);
  });
  reasoningSpeedSlider?.addEventListener('change', async () => {
    const progress = Number(reasoningSpeedSlider.value) / 100;
    const mode = REASONING_SPEED_MODES[Math.round(progress * (REASONING_SPEED_MODES.length - 1))] || 'balanced';
    await selectReasoningSpeed(mode, { closeMenu: false });
    reasoningSpeedSliderShell?.classList.remove('is-dragging');
  });
  for (const eventName of ['pointerup', 'pointercancel', 'blur']) {
    reasoningSpeedSlider?.addEventListener(eventName, () => reasoningSpeedSliderShell?.classList.remove('is-dragging'));
  }
  $('#accessModePill')?.addEventListener('click', event => {
    event.stopPropagation();
    const open = $('#accessModeMenu')?.classList.contains('hidden');
    setAccessModeMenuOpen(!!open);
  });
  $('#accessModeMenu')?.addEventListener('click', event => {
    event.stopPropagation();
    const option = event.target.closest('[data-access-mode]');
    if (option) selectAccessMode(option.dataset.accessMode);
  });
  $('#accessModeConfirmAccept')?.addEventListener('click', () => settleAccessModeConfirmation(true));
  $('#accessModeConfirmCancel')?.addEventListener('click', () => settleAccessModeConfirmation(false));
  $('#accessModeConfirmModal')?.addEventListener('click', event => {
    if (event.target?.id === 'accessModeConfirmModal') settleAccessModeConfirmation(false);
  });
  $('#skillCallPill')?.addEventListener('click', event => {
    event.stopPropagation();
    const open = $('#skillCallMenu')?.classList.contains('hidden');
    if (open) setAccessModeMenuOpen(false);
    setSkillCallMenuOpen(!!open);
  });
  $('#skillCallMenu')?.addEventListener('click', event => event.stopPropagation());
  document.addEventListener('click', event => {
    if (!event.target.closest('#reasoningSpeedWrap')) setReasoningSpeedMenuOpen(false);
    if (!event.target.closest('#workModeWrap')) setWorkModeMenuOpen(false);
    if (!event.target.closest('#skillCallWrap')) setSkillCallMenuOpen(false);
    if (!event.target.closest('#accessModeWrap')) setAccessModeMenuOpen(false);
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      if (accessModeConfirmResolver) settleAccessModeConfirmation(false);
      setReasoningSpeedMenuOpen(false);
      setWorkModeMenuOpen(false);
      setSkillCallMenuOpen(false);
      setAccessModeMenuOpen(false);
    }
  });

  renderWorkModeControl();
  renderReasoningSpeedControl();
  renderAccessModeControl();

  // Resize handles for both sidebars
  setupResizeHandles();

  // Initial right sidebar toggle button state
  syncSidebarAccessibility();

  // Window controls
  $('#winMin').addEventListener('click', () => api.window.minimize());
  $('#winMax').addEventListener('click', () => api.window.toggleMaximize());
  $('#winClose').addEventListener('click', () => api.window.close());

  // Sync maximize button icon with actual window state
  const maxIconRestore = '<svg width="11" height="11" viewBox="0 0 12 12"><rect x="2.5" y="1" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><rect x="1" y="3.5" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  const maxIconMax = '<svg width="11" height="11" viewBox="0 0 12 12"><rect x="1.5" y="1.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1"/></svg>';
  const setMaxIcon = (isMax) => { $('#winMax').innerHTML = isMax ? maxIconRestore : maxIconMax; };
  api.window.onMaximizeChange(setMaxIcon);
  api.window.isMaximized().then(setMaxIcon);

  // keyboard: Ctrl/Cmd+B toggle sidebar
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      setLeftSidebarOpen($('#app').classList.contains('sidebar-hidden'));
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#newTaskNavBtn').click();
    }
    if (e.key === 'Escape' && !settingsOverlay.classList.contains('hidden')) {
      closeSettings();
    }
  });

  // ===== Browser panel =====
  setupBrowserPanel();
}

// ============================================================
// Browser panel (agent + UI)
// ============================================================
let _browserNavigate = null;
let _browserAgent = null;

function setBrowserPanelOpen(open) {
  $('#browserPanel')?.classList.toggle('hidden', !open);
  $('#taskBarBrowser')?.classList.toggle('active', open);
}

function closeBrowserPanel() {
  setBrowserPanelOpen(false);
}

async function resolveBrowserUrl(input, runCtx) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^file:\/\//i.test(s)) return s;

  let abs = s;
  if (!/^[a-zA-Z]:[\\/]/.test(s) && !s.startsWith('\\\\')) {
    if (typeof window.YanKernel?.resolveWorkspacePath !== 'function') {
      throw new Error('工作区路径解析器尚未初始化');
    }
    abs = await window.YanKernel.resolveWorkspacePath(s, runCtx);
  }
  const norm = abs.replace(/\\/g, '/');
  return 'file:///' + encodeURI(norm.replace(/^([a-zA-Z]:)/, '$1'));
}

async function agentOpenBuiltinBrowser(urlOrPath, { background = false, runCtx = null } = {}) {
  const panel = $('#browserPanel');
  if (!panel) return { ok: false, error: '内置浏览器面板不可用' };
  let url = '';
  try {
    url = await resolveBrowserUrl(urlOrPath, runCtx);
  } catch (error) {
    return { ok: false, error: `无法解析预览地址：${error.message}` };
  }
  if (!url) return { ok: false, error: '请提供 URL 或文件路径' };

  if (background) {
    return { ok: true, url };
  }

  if (!_browserNavigate) return { ok: false, error: '浏览器尚未初始化，请稍后重试' };

  window.YanCodeMap?.close();
  window.YanTerminal?.close();
  switchSidebarNav('tasks');
  $('#pageChat')?.classList.remove('hidden');
  $('#pageSkills')?.classList.add('hidden');
  $('#pageMcp')?.classList.add('hidden');
  $('#pageAutomation')?.classList.add('hidden');

  setBrowserPanelOpen(true);
  try {
    const navigation = await _browserNavigate(url, { waitForLoad: true });
    return { ok: true, url: navigation?.url || url };
  } catch (error) {
    return { ok: false, error: `内置浏览器加载失败：${error.message}` };
  }
}

function setupBrowserPanel() {
  const panel = $('#browserPanel');
  const webview = $('#browserWebview');
  const urlInput = $('#browserUrl');
  // Electron's guest page already runs on Chromium; remove Electron/Yan branding
  // from the guest UA so sites use their normal Chromium compatibility path.
  if (webview) {
    const chromiumUserAgent = String(navigator.userAgent || '')
      .replace(/\s*Electron\/[^\s]+/gi, '')
      .replace(/\s*yan-agent\/[^\s]+/gi, '')
      .trim();
    if (chromiumUserAgent) webview.setAttribute('useragent', chromiumUserAgent);
  }
  _browserAgent = window.YanBrowserAgent?.init({
    webview,
    panel,
    status: $('#browserAgentStatus')
  }) || null;

  $('#taskBarBrowser').addEventListener('click', () => {
    const opening = panel.classList.contains('hidden');
    if (opening) {
      window.YanCodeMap?.close();
      window.YanTerminal?.close();
    }
    setBrowserPanelOpen(opening);
    if (opening) {
      urlInput.focus();
    }
  });

  $('#browserClose').addEventListener('click', closeBrowserPanel);

  function navigate(url, { waitForLoad = false } = {}) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) {
      if (/^[\w.-]+\.[a-z]{2,}/i.test(url)) {
        url = 'https://' + url;
      } else {
        url = 'https://www.bing.com/search?q=' + encodeURIComponent(url);
      }
    }
    urlInput.value = url;
    if (!waitForLoad) {
      webview.src = url;
      return { url };
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('加载超时（15 秒）')), 15000);
      const cleanup = () => {
        clearTimeout(timer);
        webview.removeEventListener('did-finish-load', onFinish);
        webview.removeEventListener('did-fail-load', onFail);
      };
      const finish = (error) => {
        cleanup();
        if (error) reject(error);
        else resolve({ url: webview.getURL?.() || url });
      };
      const onFinish = () => finish(null);
      const onFail = event => {
        if (event.isMainFrame === false || event.errorCode === -3) return;
        finish(new Error(event.errorDescription || `错误码 ${event.errorCode}`));
      };
      webview.addEventListener('did-finish-load', onFinish);
      webview.addEventListener('did-fail-load', onFail);
      if (webview.getURL?.() === url) webview.reload();
      else webview.src = url;
    });
  }

  _browserNavigate = navigate;

  $('#browserGo').addEventListener('click', () => navigate(urlInput.value.trim()));
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') navigate(urlInput.value.trim());
  });

  $('#browserBack').addEventListener('click', () => {
    if (webview.canGoBack()) webview.goBack();
  });
  $('#browserForward').addEventListener('click', () => {
    if (webview.canGoForward()) webview.goForward();
  });
  $('#browserReload').addEventListener('click', () => webview.reload());

  webview.addEventListener('did-navigate', (e) => {
    urlInput.value = e.url;
  });
  webview.addEventListener('did-navigate-in-page', (e) => {
    urlInput.value = e.url;
  });
}

async function agentBrowserSnapshot() {
  return _browserAgent?.snapshot?.() || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

async function agentBrowserReadPage() {
  return _browserAgent?.readPage?.() || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

async function agentBrowserClick(ref) {
  return _browserAgent?.click?.(ref) || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

async function agentBrowserType(ref, text) {
  return _browserAgent?.type?.(ref, text) || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

async function agentBrowserPress(key) {
  return _browserAgent?.press?.(key) || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

async function agentBrowserScroll(direction, amount) {
  return _browserAgent?.scroll?.(direction, amount) || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

async function agentBrowserWait(ms, text) {
  return _browserAgent?.wait?.(ms, text) || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

async function agentBrowserScreenshot() {
  return _browserAgent?.screenshot?.() || { ok: false, error: '内置浏览器 Agent 桥接尚未初始化。' };
}

// ============================================================
// Boot
// ============================================================
window.addEventListener('DOMContentLoaded', init);

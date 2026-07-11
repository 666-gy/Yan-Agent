/* ============================================================
   Yan — renderer logic
   ============================================================ */

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const api = window.yan;

const state = {
  config: null,
  sessions: [],
  currentSession: null,
  attachments: [],        // [{name, path, size}]
  skills: [],
  slashActive: false,
  slashIndex: 0,
  slashFilter: '',
  activeRuns: new Map(),    // sessionId -> { sessionRef, runCtx, assistantEl } 所有运行中的任务（完全独立）
  automationRuns: new Set()   // 正在执行的自动化 id
};

const MAX_CONCURRENT_RUNS = 5;

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

function getCurrentAgentState() {
  const sessionId = state.currentSession?.id;
  const runCtx = sessionId ? getRunCtx(sessionId) : null;
  return runCtx?.agentState || { todos: [], todosFromTool: false, iteration: 0, toolCallCount: 0, status: 'idle' };
}

function canStartRun() {
  return state.activeRuns.size < MAX_CONCURRENT_RUNS;
}

// 切换会话时，旧会话的任务停止 DOM 渲染（任务继续后台运行，互不影响）
function pauseUiForSession(sessionId) {
  const entry = state.activeRuns.get(sessionId);
  if (entry) entry.runCtx.ui = false;
}

// ============================================================
// Icons (inline SVG strings)
// ============================================================
const ICONS = {
  trash: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg>',
  file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"/><polyline points="13 2 13 9 20 9"/></svg>',
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
  moon: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/></svg>',
  sun: '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/></svg>'
};

// Skill prompt templates — click a skill to insert this into the composer.
// {{cursor}} marks where the caret should land after insertion.
const SKILL_PROMPTS = {
  'code-review': '请对以下代码进行审查，重点关注：可读性、性能、安全性、最佳实践，并给出具体改进建议：\n\n```\n{{cursor}}\n```',
  'refactor': '请重构以下代码，保持功能不变但提升代码结构、命名与可读性：\n\n```\n{{cursor}}\n```',
  'gen-test': '请为以下代码生成单元测试，覆盖主要分支和边界情况：\n\n```\n{{cursor}}\n```',
  'explain-code': '请详细解释以下代码的功能、工作原理和关键逻辑：\n\n```\n{{cursor}}\n```',
  'fix-bug': '以下代码存在 Bug，请帮我定位并修复，并解释原因：\n\n问题描述：\n{{cursor}}\n\n```\n\n```',
  'add-comments': '请为以下代码添加清晰的注释（函数说明、复杂逻辑、参数与返回值）：\n\n```\n{{cursor}}\n```',
  'gen-docs': '请为以下代码生成 API 文档（Markdown 格式，含调用示例）：\n\n```\n{{cursor}}\n```',
  'optimize': '请优化以下代码的性能（时间/空间复杂度、I/O、内存），并说明优化点：\n\n```\n{{cursor}}\n```',
  'security-audit': '请对以下代码进行安全审计，找出潜在漏洞（注入、XSS、CSRF、越权、敏感信息泄露等）：\n\n```\n{{cursor}}\n```',
  'convert-lang': '请将以下代码转换为指定语言，保持功能一致：\n\n目标语言：\n{{cursor}}\n\n```\n\n```',
  'commit-msg': '请为以下代码改动生成符合 Conventional Commits 规范的提交信息（type: scope: subject）：\n\n```\n{{cursor}}\n```',
  'pr-desc': '请根据以下代码改动生成 PR 描述，包含：改动摘要、影响范围、测试建议：\n\n```\n{{cursor}}\n```',
  'summarize': '请总结以上对话的要点、决策与待办事项：',
  'translate': '请将以下内容翻译为指定语言（保留代码块原样）：\n\n目标语言：\n{{cursor}}\n\n内容：\n\n',
  'rewrite': '请重写或润色以下文本，使其更清晰、专业、流畅：\n\n{{cursor}}'
};

// 取首字母作为图标徽章（统一风格，替代各种伪 logo）
function skillGlyph(skill) {
  const name = skill.name || skill.id;
  // 取第一个单词的首字母，大写
  return (name.trim().charAt(0) || '?').toUpperCase();
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
  await renderWorkspacePill();
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

  api.onMcpStatus?.(({ id, status, code }) => {
    if (status === 'crashed') {
      toast(`MCP 服务异常退出 (${id}, code ${code ?? '?'})`);
      if (currentMainPage === 'mcp') renderMcpPage();
    }
  });

  api.onWorkspaceChanged?.(() => scheduleRightSidebarRefresh());

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
  renderSessionList();
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
    <div class="session-item ${state.currentSession && s.id === state.currentSession.id ? 'active' : ''} ${running ? 'running' : ''}" data-id="${s.id}">
      ${running ? '<span class="session-spinner"></span>' : ''}
      <span class="session-title">${escapeHtml(s.title || 'New chat')}</span>
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
      await api.deleteSession(id);
      if (state.currentSession && state.currentSession.id === id) {
        state.currentSession = null;
        clearMessages();
      }
      await refreshSessions();
      if (!state.currentSession && state.sessions.length > 0) {
        await loadSession(state.sessions[0].id);
      }
      toast('已删除对话');
    });
  });
}

$('#searchInput').addEventListener('input', renderSessionList);
$('#newChatBtn').addEventListener('click', newSession);

async function newSession() {
  if (state.currentSession?.id) pauseUiForSession(state.currentSession.id);
  switchSidebarNav('tasks');
  const s = await api.createSession();
  state.currentSession = s;
  clearMessages();
  setEmptyState(true);
  state.config = await api.setConfig({ workspace: '' });
  await renderWorkspacePill();
  await renderRightSidebarFiles();
  updateTaskBar();
  updateSendState();
  await refreshSessions();
}

async function loadSession(id) {
  if (state.currentSession?.id && state.currentSession.id !== id) pauseUiForSession(state.currentSession.id);
  const s = await api.getSession(id);
  if (!s) return;
  state.currentSession = s;
  state.config = await api.setConfig({ workspace: s.workspace || '' });
  renderMessages(s.messages || []);
  setEmptyState((s.messages || []).length === 0);

  // 如果该会话有运行中的任务，从 runCtx 获取实时状态；否则从历史恢复
  const runCtx = getRunCtx(s.id);
  if (runCtx) {
    renderTodos(runCtx.agentState);
    updateContextInfo(runCtx.agentState);
    showTyping(true);
  } else {
    const lastAssistant = [...(s.messages || [])].reverse().find(m => m.role === 'assistant' && m.agentRun);
    const as = { todos: [], todosFromTool: false, iteration: 0, toolCallCount: 0, status: 'idle' };
    if (lastAssistant?.agentRun?.todos?.length) {
      as.todos = lastAssistant.agentRun.todos.map(t => ({
        text: t.text,
        done: !!t.done,
        inProgress: !!t.inProgress
      }));
      as.todosFromTool = !!lastAssistant.agentRun.todosFromTool;
      as.status = lastAssistant.agentRun.status || 'done';
      as.iteration = lastAssistant.agentRun.iteration || 0;
      as.toolCallCount = lastAssistant.agentRun.toolCallCount || 0;
    }
    renderTodos(as);
    updateContextInfo(as);
    showTyping(false);
  }

  await renderWorkspacePill();
  await renderRightSidebarFiles();
  updateTaskBar();
  updateSendState();
  renderSessionList();
}

async function saveCurrentSession(session = state.currentSession) {
  if (!session) return;
  if ((!session.title || session.title === 'New chat') &&
      session.messages && session.messages.length) {
    const firstUser = session.messages.find(m => m.role === 'user');
    if (firstUser) {
      const title = deriveTitle(firstUser.content);
      session.title = title;
      await api.renameSession(session.id, title);
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

// ============================================================
// Sidebar toggle
// ============================================================
$('#sidebarToggle').addEventListener('click', () => {
  $('#app').classList.toggle('sidebar-hidden');
});

// ============================================================
// Messages rendering
// ============================================================
function clearMessages() {
  $('#messages').innerHTML = '';
}

function renderMessages(messages) {
  clearMessages();
  messages.forEach((m, i) => appendMessage(m.role, m.content, m.attachments, false, i, m.ts, m.duration, m.agentRun));
}

function setEmptyState(empty) {
  $('#pageChat').classList.toggle('empty', empty);
}

// ============================================================
// Sidebar navigation & main pages
// ============================================================
let currentMainPage = 'chat';
let skillMarketFilter = 'all';

function setRightSidebarOpen(open) {
  $('#app').classList.toggle('rs-hidden', !open);
  $('#rightSidebarToggleBtn')?.classList.toggle('active', open);
}

function closeRightSidebar() {
  setRightSidebarOpen(false);
}

function showMainPage(page) {
  currentMainPage = page;
  $('#pageChat').classList.toggle('hidden', page !== 'chat');
  $('#pageSkills').classList.toggle('hidden', page !== 'skills');
  $('#pageMcp').classList.toggle('hidden', page !== 'mcp');
  $('#pageAutomation').classList.toggle('hidden', page !== 'automation');
  $('#browserPanel')?.classList.add('hidden');

  if (page !== 'chat') closeRightSidebar();

  if (page === 'skills') renderSkillMarket();
  if (page === 'mcp') renderMcpPage();
  if (page === 'automation') renderAutomationPage();
}

function switchSidebarNav(nav) {
  $$('.sidebar-nav-item').forEach(btn => btn.classList.toggle('active', btn.dataset.nav === nav));
  $('#sidebarTasksPanel').classList.toggle('hidden', nav !== 'tasks');
  if (nav === 'tasks') {
    showMainPage('chat');
  } else {
    showMainPage(nav);
  }
}

$$('.sidebar-nav-item').forEach(btn => {
  btn.addEventListener('click', () => switchSidebarNav(btn.dataset.nav));
});

async function refreshSkillPrompts() {
  state.skills = await api.listSkills();
  for (const s of state.skills) {
    if (s.prompt) SKILL_PROMPTS[s.id] = s.prompt;
  }
}

async function renderSkillMarket() {
  const grid = $('#skillMarketGrid');
  const customList = $('#customSkillList');
  const filters = $('#skillTagFilters');
  if (!grid || !customList) return;

  const custom = await api.getCustomSkills();
  const installedIds = new Set(custom.map(s => s.id));

  if (filters) {
    const tags = [
      { id: 'all', label: '全部' },
      ...Object.entries(SKILL_TAG_LABELS).map(([id, label]) => ({ id, label }))
    ];
    filters.innerHTML = tags.map(t => `
      <button class="skill-tag-btn ${skillMarketFilter === t.id ? 'active' : ''}" data-tag="${t.id}">
        ${escapeHtml(t.label)}
        ${t.id === 'all' ? `<span class="skill-tag-count">${SKILL_MARKET.length}</span>` : `<span class="skill-tag-count">${SKILL_MARKET.filter(s => s.tags?.includes(t.id)).length}</span>`}
      </button>
    `).join('');
    filters.querySelectorAll('.skill-tag-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        skillMarketFilter = btn.dataset.tag;
        renderSkillMarket();
      });
    });
  }

  const items = skillMarketFilter === 'all'
    ? SKILL_MARKET
    : SKILL_MARKET.filter(s => s.tags?.includes(skillMarketFilter));

  grid.innerHTML = items.length ? items.map(s => {
    const tag = s.tags?.[0];
    const tagLabel = tag ? SKILL_TAG_LABELS[tag] : '';
    return `
    <div class="skill-card" data-market-id="${escapeAttr(s.id)}">
      <div class="skill-card-top">
        <span class="skill-card-icon">${escapeHtml(skillGlyph(s))}</span>
        <div class="skill-card-meta">
          <div class="skill-card-name-row">
            <span class="skill-card-name">${escapeHtml(s.name)}</span>
            ${tagLabel ? `<span class="skill-card-tag skill-card-tag-${tag}">${escapeHtml(tagLabel)}</span>` : ''}
          </div>
          <div class="skill-card-repo">${escapeHtml(s.repo)} · ★ ${escapeHtml(s.stars)}</div>
        </div>
      </div>
      <p class="skill-card-desc">${escapeHtml(s.desc)}</p>
      <button class="ghost-btn skill-install-btn" data-installed="${installedIds.has(s.id)}">
        ${installedIds.has(s.id) ? '已安装' : '安装'}
      </button>
    </div>`;
  }).join('') : '<div class="mgmt-empty">该分类暂无 Skill</div>';

  grid.querySelectorAll('.skill-install-btn').forEach(btn => {
    btn.addEventListener('click', async () => {
      if (btn.dataset.installed === 'true') { toast('已安装'); return; }
      const card = btn.closest('.skill-card');
      const item = SKILL_MARKET.find(s => s.id === card.dataset.marketId);
      if (!item) return;
      const res = await api.addCustomSkill({ ...item, source: item.repo });
      if (res?.error) { toast(res.error); return; }
      toast('已安装 ' + item.name);
      await refreshSkillPrompts();
      await renderSkillMarket();
    });
  });

  if (!custom.length) {
    customList.innerHTML = '<div class="page-empty">暂无自定义 Skill，可从上方市场安装或导入 JSON</div>';
    return;
  }
  customList.innerHTML = custom.map(s => {
    const tag = s.tags?.[0];
    const tagLabel = tag ? (SKILL_TAG_LABELS[tag] || tag) : '';
    return `
    <div class="skill-custom-item" data-id="${escapeAttr(s.id)}">
      <div class="skill-custom-info">
        <div class="skill-custom-name-row">
          <span class="skill-custom-name">${escapeHtml(s.name)}</span>
          ${tagLabel ? `<span class="skill-card-tag skill-card-tag-${tag || 'code'}">${escapeHtml(tagLabel)}</span>` : ''}
        </div>
        <div class="skill-custom-desc">${escapeHtml(s.desc || s.id)}</div>
      </div>
      <button class="msg-action-btn" data-skill-del title="移除">${ICONS.trash}</button>
    </div>`;
  }).join('');

  customList.querySelectorAll('[data-skill-del]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.closest('.skill-custom-item').dataset.id;
      await api.removeCustomSkill(id);
      delete SKILL_PROMPTS[id];
      await refreshSkillPrompts();
      await renderSkillMarket();
      toast('已移除 Skill');
    });
  });
}

$('#skillImportBtn')?.addEventListener('click', () => $('#skillImportInput')?.click());
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

async function renderMcpPage() {
  const list = $('#mcpPageList');
  const stats = $('#mcpStats');
  if (!list) return;
  const servers = await api.mcpList();
  const enabled = servers.filter(s => s.enabled).length;
  if (stats) {
    stats.innerHTML = `<span>${enabled} 个启用</span><span>${servers.length} 个服务</span>`;
  }
  if (!servers.length) {
    list.innerHTML = '<div class="mgmt-empty">暂无 MCP 服务器，在右侧添加一个</div>';
    return;
  }

  list.innerHTML = servers.map(s => {
    const cmdLine = [s.command, ...(s.args || [])].join(' ');
    const initial = (s.name || '?').charAt(0).toUpperCase();
    return `
    <div class="mgmt-card mcp-card" data-id="${escapeAttr(s.id)}">
      <div class="mgmt-card-main">
        <div class="mgmt-card-icon">${escapeHtml(initial)}</div>
        <div class="mgmt-card-body">
          <div class="mgmt-card-title-row">
            <span class="mgmt-card-title">${escapeHtml(s.name)}</span>
            ${s.builtin ? '<span class="tag-builtin">预装</span>' : ''}
            <span class="status-pill ${s.enabled ? 'on' : 'off'}">${s.enabled ? '已启用' : '已禁用'}</span>
          </div>
          <code class="mgmt-cmd-line">${escapeHtml(cmdLine)}</code>
          <div class="mgmt-test-banner idle" data-test-result>尚未测试 — 点击「测试连接」验证</div>
        </div>
      </div>
      <div class="mgmt-card-actions">
        <button class="ghost-btn" data-mcp-act="test">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          测试连接
        </button>
        <button class="ghost-btn" data-mcp-act="toggle">${s.enabled ? '禁用' : '启用'}</button>
        ${s.builtin ? '' : '<button class="ghost-btn danger" data-mcp-act="delete">删除</button>'}
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-mcp-act]').forEach(btn => {
    btn.addEventListener('click', async () => {
      const card = btn.closest('.mgmt-card');
      const id = card.dataset.id;
      const act = btn.dataset.mcpAct;
      const testEl = card.querySelector('[data-test-result]');

      if (act === 'test') {
        testEl.textContent = '测试中…';
        testEl.className = 'mgmt-test-banner testing';
        const servers = await api.mcpList();
        const s = servers.find(x => x.id === id);
        if (!s?.enabled) await api.mcpUpdate(id, { enabled: true });
        await api.mcpStop(id);
        const res = await api.mcpStart(id);
        if (res.error) {
          testEl.textContent = '连接失败：' + res.error;
          testEl.className = 'mgmt-test-banner fail';
        } else {
          testEl.textContent = `连接成功 · 已加载 ${res.tools?.length || 0} 个工具`;
          testEl.className = 'mgmt-test-banner ok';
        }
      } else if (act === 'delete') {
        await api.mcpRemove(id);
        toast('已删除');
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
  if (!list) return;
  const autos = await api.autoList();
  const enabled = autos.filter(a => a.enabled).length;
  if (stats) {
    stats.innerHTML = `<span>${enabled} 个启用</span><span>${autos.length} 个任务</span>`;
  }
  if (!autos.length) {
    list.innerHTML = '<div class="mgmt-empty">暂无自动化任务，在右侧创建一个</div>';
    return;
  }

  const scheduleIcon = { interval: '⏱', daily: '📅', once: '🎯' };
  list.innerHTML = autos.map(a => {
    const sched = a.schedule || {};
    const typeLabel = { interval: '间隔', daily: '每日', once: '一次性' }[sched.type] || '未知';
    const statusClass = a.lastStatus === 'ok' ? 'ok' : a.lastStatus === 'error' ? 'fail' : a.enabled ? 'idle' : 'off';
    const statusText = describeAutoStatus(a);
    return `
    <div class="mgmt-card auto-card" data-id="${escapeAttr(a.id)}">
      <div class="mgmt-card-main">
        <div class="mgmt-card-icon auto-icon">${scheduleIcon[sched.type] || '⚡'}</div>
        <div class="mgmt-card-body">
          <div class="mgmt-card-title-row">
            <span class="mgmt-card-title">${escapeHtml(a.name)}</span>
            <span class="schedule-badge">${typeLabel}</span>
            <span class="status-pill ${a.enabled ? 'on' : 'off'}">${a.enabled ? '运行中' : '已暂停'}</span>
          </div>
          <div class="auto-schedule-line">${escapeHtml(describeSchedule(a))}</div>
          <div class="auto-prompt-box" title="${escapeAttr(a.prompt)}">${escapeHtml(a.prompt)}</div>
          <div class="mgmt-status-line ${statusClass}">${escapeHtml(statusText)}</div>
        </div>
      </div>
      <div class="mgmt-card-actions">
        <button class="ghost-btn" data-auto-act="run">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="5 3 19 12 5 21 5 3"/></svg>
          立即运行
        </button>
        <button class="ghost-btn" data-auto-act="toggle">${a.enabled ? '暂停' : '启用'}</button>
        <button class="ghost-btn danger" data-auto-act="delete">删除</button>
      </div>
    </div>`;
  }).join('');

  list.querySelectorAll('[data-auto-act]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.closest('.mgmt-card').dataset.id;
      const act = btn.dataset.autoAct;
      const autos = await api.autoList();
      const a = autos.find(x => x.id === id);
      if (!a) return;
      if (act === 'delete') {
        await api.autoRemove(id);
        toast('已删除');
        await renderAutomationPage();
      } else if (act === 'toggle') {
        await api.autoUpdate(id, { enabled: !a.enabled });
        await renderAutomationPage();
      } else if (act === 'run') {
        if (!canStartRun()) { toast('并发任务已达上限（5个），请稍后再试'); return; }
        toast('已在后台开始运行');
        runAutomation(a, { manual: true }).then(() => renderAutomationPage());
      }
    });
  });
}

function appendMessage(role, content, attachments = [], animate = true, msgIndex = -1, ts = null, duration = null, agentRun = null) {
  const wrap = $('#messages');
  const el = document.createElement('div');
  el.className = `msg ${role}`;
  if (msgIndex >= 0) el.dataset.msgIndex = msgIndex;
  if (ts) el.dataset.ts = ts;
  if (!animate) el.style.animation = 'none';

  const avatar = role === 'user'
    ? `<div class="msg-avatar">${ICONS.user}</div>`
    : `<div class="msg-avatar">${ICONS.robot}</div>`;

  let attHtml = '';
  if (attachments && attachments.length) {
    attHtml = `<div class="msg-attachments">${attachments.map(a =>
      `<span class="msg-attachment">${ICONS.file}${escapeHtml(a.name)}</span>`
    ).join('')}</div>`;
  }

  let bodyHtml;
  if (role === 'assistant') {
    bodyHtml = '<div class="msg-body agent-output"></div>';
  } else {
    bodyHtml = `<div class="msg-body">${attHtml}${escapeHtml(content)}</div>`;
  }

  const hasContent = !!(content || agentRun);
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
    toast('已删除消息');
  } else if (action === 'edit') {
    // 撤回重写：把内容填回输入框，删除该消息及之后所有消息
    input.value = msg.content || '';
    msgs.splice(msgIndex);
    let found = false;
    $$('#messages .msg').forEach(m => {
      if (found) m.remove();
      if (m === el) { found = true; m.remove(); }
    });
    await saveCurrentSession();
    if (msgs.length === 0) setEmptyState(true);
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

function scrollChatToBottom() {
  const sc = $('#chatScroll');
  sc.scrollTop = sc.scrollHeight;
}

// ============================================================
// Composer
// ============================================================
const input = $('#composerInput');
const sendBtn = $('#sendBtn');

input.addEventListener('input', () => {
  autoGrow();
  updateSendState();
  handleSlashTrigger();
});
input.addEventListener('keydown', (e) => {
  if (state.slashActive) {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSlash(1); return; }
    if (e.key === 'ArrowUp')   { e.preventDefault(); moveSlash(-1); return; }
    if (e.key === 'Enter')     { e.preventDefault(); chooseSlash(); return; }
    if (e.key === 'Escape')    { e.preventDefault(); closeSlash(); return; }
    if (e.key === 'Tab')       { e.preventDefault(); chooseSlash(); return; }
  }
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

function autoGrow() {
  input.style.height = 'auto';
  input.style.height = Math.min(input.scrollHeight, 200) + 'px';
}
// 中止按钮图标（方形停止符）
const STOP_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
// 发送按钮图标（纸飞机）
const SEND_ICON = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>';


function updateSendState() {
  if (isCurrentSessionResponding()) {
    // Agent 正在输出/工作：按钮变为中止按钮
    sendBtn.classList.add('stop-mode');
    sendBtn.classList.remove('send-mode');
    sendBtn.innerHTML = STOP_ICON;
    sendBtn.disabled = false;
    sendBtn.title = '中止任务';
  } else {
    sendBtn.classList.add('send-mode');
    sendBtn.classList.remove('stop-mode');
    sendBtn.innerHTML = SEND_ICON;
    sendBtn.disabled = !input.value.trim() && state.attachments.length === 0;
    sendBtn.title = '发送';
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
  const runCtx = getRunCtx(state.currentSession?.id);
  if (!runCtx) return;
  runCtx.shouldAbort = true;
  if (runCtx.abortController) {
    try { runCtx.abortController.abort(); } catch {}
  }
  // Windows 通知
  if (window.Notification && Notification.permission === 'granted') {
    try {
      new Notification('Yan Agent', { body: '任务已被中断', icon: 'assets/logo.png' });
    } catch {}
  }
  toast('任务已被中断');
}

// ============================================================
// Slash command menu
// ============================================================
function handleSlashTrigger() {
  const val = input.value;
  // Trigger only when "/" is the first character (left-only, like Claude)
  if (val.startsWith('/') && !val.includes('\n')) {
    const query = val.slice(1);
    openSlash(query);
  } else {
    closeSlash();
  }
}

function openSlash(filterText) {
  state.slashActive = true;
  state.slashFilter = filterText.toLowerCase();
  state.slashIndex = 0;
  renderSlashList();
  positionSlashMenu();
  $('#slashMenu').classList.remove('hidden');
}

function closeSlash() {
  state.slashActive = false;
  $('#slashMenu').classList.add('hidden');
}

function filteredSkills() {
  if (!state.slashFilter) return state.skills;
  return state.skills.filter(s =>
    s.name.toLowerCase().includes(state.slashFilter) ||
    s.id.toLowerCase().includes(state.slashFilter)
  );
}

function renderSlashList() {
  const list = $('#slashList');
  const items = filteredSkills();
  if (items.length === 0) {
    list.innerHTML = '<div class="slash-empty">没有匹配的技能</div>';
    return;
  }
  list.innerHTML = items.map((s, i) => `
    <div class="slash-item ${i === state.slashIndex ? 'active' : ''}" data-index="${i}">
      <div class="slash-icon">${escapeHtml(skillGlyph(s))}</div>
      <div class="slash-text">
        <div class="slash-name">${escapeHtml(s.name)}</div>
        <div class="slash-desc">${escapeHtml(s.desc || '')}</div>
      </div>
    </div>
  `).join('');
  list.querySelectorAll('.slash-item').forEach((el, i) => {
    // mouseenter 只更新 active 类，不重建 DOM，否则 click 事件会因 DOM 被替换而失效
    el.addEventListener('mouseenter', () => {
      state.slashIndex = i;
      list.querySelectorAll('.slash-item').forEach((e, j) => {
        e.classList.toggle('active', j === i);
      });
    });
    el.addEventListener('click', () => { state.slashIndex = i; chooseSlash(); });
  });
}

function moveSlash(dir) {
  const items = filteredSkills();
  if (!items.length) return;
  state.slashIndex = (state.slashIndex + dir + items.length) % items.length;
  // 只更新 active 类，不重建 DOM
  const list = $('#slashList');
  list.querySelectorAll('.slash-item').forEach((e, j) => {
    e.classList.toggle('active', j === state.slashIndex);
  });
  const active = list.querySelector('.slash-item.active');
  if (active) active.scrollIntoView({ block: 'nearest' });
}

function chooseSlash() {
  const items = filteredSkills();
  if (!items.length) { closeSlash(); return; }
  const skill = items[state.slashIndex];
  // 取该 skill 的 prompt 模板，没有则用默认占位
  const template = SKILL_PROMPTS[skill.id] || `${skill.name}：\n\n{{cursor}}`;
  // 定位光标到 {{cursor}} 处；若不存在则放到末尾
  const cursorMark = '{{cursor}}';
  const idx = template.indexOf(cursorMark);
  if (idx >= 0) {
    const before = template.slice(0, idx);
    const after = template.slice(idx + cursorMark.length);
    input.value = before + after;
    closeSlash();
    input.focus();
    // 把光标定位到原 {{cursor}} 位置
    input.setSelectionRange(idx, idx);
  } else {
    input.value = template;
    closeSlash();
    input.focus();
    const end = input.value.length;
    input.setSelectionRange(end, end);
  }
  autoGrow();
  updateSendState();
}

function positionSlashMenu() {
  const menu = $('#slashMenu');
  const rect = input.getBoundingClientRect();
  menu.style.left = rect.left + 'px';
  menu.style.top = (rect.top - menu.offsetHeight - 8) + 'px';
  // if not yet measured, reposition after paint
  requestAnimationFrame(() => {
    menu.style.top = (rect.top - menu.offsetHeight - 8) + 'px';
  });
}

document.addEventListener('click', (e) => {
  if (state.slashActive && !e.target.closest('#slashMenu') && !e.target.closest('#composerInput')) {
    closeSlash();
  }
});

// ============================================================
// File attachments / upload
// ============================================================
$('#attachBtn').addEventListener('click', () => $('#fileInput').click());
$('#fileInput').addEventListener('change', async (e) => {
  const files = Array.from(e.target.files || []);
  for (const f of files) {
    await addAttachment(f);
  }
  e.target.value = '';
});

async function addAttachment(file) {
  // Read file as base64 and copy into uploads dir via IPC
  const b64 = await fileToBase64(file);
  const meta = await api.uploadFile(file.name, b64);
  state.attachments.push({ name: meta.name, path: meta.path, size: meta.size });
  renderAttachments();
  updateSendState();
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
  box.innerHTML = state.attachments.map((a, i) => `
    <div class="attachment-chip">
      ${ICONS.file}
      <span>${escapeHtml(a.name)}</span>
      <button class="remove" data-i="${i}" title="移除">${ICONS.close}</button>
    </div>
  `).join('');
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
  if (!text && state.attachments.length === 0) return;
  if (isCurrentSessionResponding()) return;

  const attachments = state.attachments.slice();
  // 清空输入区（不调 updateSendState，submitMessage 会立即设置停止按钮）
  input.value = '';
  state.attachments = [];
  renderAttachments();
  autoGrow();
  closeSlash();

  await submitMessage(text, attachments);
}

// 后台运行（自动化任务等）：不渲染 UI，与前台任务完全独立
async function submitMessageBackground(session, text) {
  if (!text) return { ok: false, error: 'empty' };
  if (isSessionRunning(session.id)) return { ok: false, error: 'busy' };
  if (!canStartRun()) return { ok: false, error: 'busy' };

  const runCtx = createRunCtx(session.id, false);
  state.activeRuns.set(session.id, { sessionRef: session, runCtx, assistantEl: null });
  renderSessionList();
  const taskStart = Date.now();

  try {
    session.messages = session.messages || [];
    session.messages.push({ role: 'user', content: text, ts: Date.now() });
    await api.saveSession(session);

    const loopResult = await runAgentLoop(session.messages, null, runCtx);
    session.messages.push({
      role: 'assistant',
      content: loopResult.content,
      ts: Date.now(),
      duration: Date.now() - taskStart,
      agentRun: loopResult.agentRun
    });
    await api.saveSession(session);
    await refreshSessions();
    return { ok: loopResult.agentRun?.status !== 'error', error: null };
  } catch (e) {
    return { ok: false, error: e.message };
  } finally {
    state.activeRuns.delete(session.id);
    renderSessionList();
  }
}

// 核心发送流程：每个任务完全独立，互不影响。返回 { ok, error }
async function submitMessage(text, attachments = []) {
  if (!text && attachments.length === 0) return { ok: false, error: 'empty' };
  if (isCurrentSessionResponding()) return { ok: false, error: 'busy' };
  if (!canStartRun()) { toast('并发任务已达上限（5个），请稍后再试'); return { ok: false, error: 'busy' }; }

  if (!state.currentSession) await newSession();

  const runSession = state.currentSession;
  const runCtx = createRunCtx(runSession.id, true);
  state.activeRuns.set(runSession.id, { sessionRef: runSession, runCtx, assistantEl: null });

  // 立即切换为停止按钮 + typing 指示 + 侧边栏 spinner
  updateSendState();
  showTyping(true);
  renderSessionList();

  const userMsg = { role: 'user', content: text, attachments, ts: Date.now() };
  runSession.messages = runSession.messages || [];
  runSession.messages.push(userMsg);

  const userMsgIndex = runSession.messages.length - 1;
  appendMessage('user', text, attachments, true, userMsgIndex, userMsg.ts);
  setEmptyState(false);

  await saveCurrentSession(runSession);
  const taskStartTime = Date.now();
  let taskOk = true;
  let taskErr = null;
  let assistantEl = null;

  try {
    assistantEl = appendMessage('assistant', '');
    state.activeRuns.get(runSession.id).assistantEl = assistantEl;
    const loopResult = await runAgentLoop(runSession.messages, assistantEl, runCtx);
    const reply = loopResult.content;
    const agentRun = loopResult.agentRun;
    const taskDuration = Date.now() - taskStartTime;
    const ui = runCtx.ui && assistantEl?.isConnected;
    if (ui) showTyping(false);

    if (ui && agentRun) {
      renderAgentRunHeader(assistantEl.querySelector('.msg-body'), agentRun);
    }

    const assistantMsg = {
      role: 'assistant',
      content: reply,
      ts: Date.now(),
      duration: taskDuration,
      agentRun
    };
    runSession.messages.push(assistantMsg);

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
        new Notification('Yan Agent', { body: `「${runSession.title || '任务'}」已完成 · 耗时 ${formatDuration(taskDuration)}`, icon: 'assets/logo.png' });
      } catch {}
    }
  } catch (err) {
    const ui = runCtx.ui && assistantEl?.isConnected;
    if (err && (err.name === 'AbortError' || runCtx.shouldAbort)) {
      if (ui) showTyping(false);
      if (ui) {
        const taskDuration = Date.now() - taskStartTime;
        const body = assistantEl.querySelector('.msg-body');
        const partialContent = collectAssistantText(body) || '⚠️ **任务已被用户中断**';
        const agentRun = finalizeAgentRun(partialContent, 'interrupted', getActiveRun(runCtx), body, null, runCtx);
        if (agentRun) renderAgentRunHeader(body, agentRun);

        assistantEl.dataset.msgIndex = runSession.messages.length;
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'msg-actions';
        actionsContainer.innerHTML = buildAssistantActionsHtml(agentRun, taskDuration);
        actionsContainer.querySelectorAll('.msg-action-btn').forEach(btn => {
          btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, assistantEl));
        });
        assistantEl.appendChild(actionsContainer);

        runSession.messages.push({
          role: 'assistant',
          content: partialContent,
          ts: Date.now(),
          duration: taskDuration,
          agentRun
        });
        await saveCurrentSession(runSession);
      } else {
        const partialContent = '⚠️ **任务已被用户中断**';
        const agentRun = finalizeAgentRun(partialContent, 'interrupted', getActiveRun(runCtx), null, null, runCtx);
        runSession.messages.push({
          role: 'assistant',
          content: partialContent,
          ts: Date.now(),
          agentRun
        });
        await saveCurrentSession(runSession);
      }
    } else {
      taskOk = false;
      taskErr = err.message;
      if (ui) showTyping(false);
      if (ui) {
        const errHtml = renderMarkdown(`⚠️ **出错了**\n\n${err.message}`);
        const lastMsg = $('#messages').lastElementChild;
        if (lastMsg && lastMsg.classList.contains('assistant')) {
          let body = lastMsg.querySelector('.msg-body');
          if (!body) {
            body = document.createElement('div');
            body.className = 'msg-body';
            lastMsg.appendChild(body);
          }
          const errEl = document.createElement('div');
          errEl.className = 'msg-error';
          errEl.innerHTML = errHtml;
          body.appendChild(errEl);
        } else {
          appendMessage('assistant', `⚠️ **出错了**\n\n${err.message}`);
        }
      }
    }
  } finally {
    state.activeRuns.delete(runSession.id);
    renderSessionList();
    if (state.currentSession?.id === runSession.id) {
      showTyping(false);
      updateSendState();
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
  await renderRightSidebarFiles();
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
      buildToolStepElement,
      finishToolStepElement,
      renderRightSidebarFiles,
      updateTodos,
      agentOpenBuiltinBrowser,
      renderMarkdown,
      scrollChatToBottom,
      collectTimelineFromDom,
      requestShellPermission,
      deferPendingTodos,
      clearDeferredTodosIfDone,
      onSubagentEvent: null
    }
  });
}

const createRunCtx = (...a) => YanKernel.createRunCtx(...a);
const runAgentLoop = (...a) => YanKernel.runAgentLoop(...a);
const executeTool = (...a) => YanKernel.executeTool(...a);
const extractMemoryFacts = (...a) => YanKernel.extractMemoryFacts(...a);
const compressContextIfNeeded = (...a) => YanKernel.compressContextIfNeeded(...a);
const parseToolOutputOk = (...a) => YanKernel.parseToolOutputOk(...a);
const makeLoopResult = (...a) => YanKernel.makeLoopResult(...a);
const finalizeAgentRun = (...a) => YanKernel.finalizeAgentRun(...a);
const refreshMcpTools = (...a) => YanKernel.refreshMcpTools(...a);
const snapshotTools = (...a) => YanKernel.snapshotTools(...a);
const TOOL_ICONS = YanKernel.TOOL_ICONS;
const BUILT_IN_TOOLS = YanKernel.BUILT_IN_TOOLS;

// ============================================================
// Shell permission prompt (always / once / deny)
// ============================================================
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
  const session = state.currentSession;
  if (!session || session.id !== runCtx?.sessionId) return;
  session.deferredTodos = pending.map(t => ({ text: t.text }));
  await api.saveSession(session);
  toast(`已推迟 ${pending.length} 项非必要 todo，将在后续对话中提醒`);
}

async function clearDeferredTodosIfDone(as) {
  const session = state.currentSession;
  if (!session?.deferredTodos?.length || !as?.todosFromTool) return;
  const texts = new Set(as.todos.filter(t => t.done).map(t => t.text));
  const remaining = session.deferredTodos.filter(d => !texts.has(d.text));
  if (remaining.length !== session.deferredTodos.length) {
    session.deferredTodos = remaining.length ? remaining : undefined;
    if (!session.deferredTodos) delete session.deferredTodos;
    await api.saveSession(session);
  }
}

// ============================================================
// Per-run rollback — see rollbackMessageRun() on assistant messages
// ============================================================

function collectAssistantText(bodyEl) {
  if (!bodyEl) return '';
  const parts = [];
  bodyEl.querySelectorAll('.msg-round').forEach(el => {
    parts.push(el.textContent.trim());
  });
  return parts.filter(Boolean).join('\n\n');
}

function collectTimelineFromDom(bodyEl) {
  const timeline = [];
  if (!bodyEl) return timeline;
  for (const child of bodyEl.children) {
    if (child.classList.contains('agent-run-header')) continue;
    if (child.classList.contains('thinking-block')) {
      const text = child.querySelector('.thinking-text')?.textContent || '';
      if (text) timeline.push({ type: 'thinking', content: text });
    } else if (child.classList.contains('msg-round')) {
      const text = child.textContent.trim();
      if (text) timeline.push({ type: 'text', content: text });
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

function renderAgentRunHeader(bodyEl, agentRun) {
  if (!bodyEl || !agentRun) return;
  let header = bodyEl.querySelector('.agent-run-header');
  if (!header) {
    header = document.createElement('div');
    header.className = 'agent-run-header';
    bodyEl.insertBefore(header, bodyEl.firstChild);
  }
  const status = agentRun.status || 'working';
  header.className = 'agent-run-header status-' + status;
  const statusLabel = {
    done: '已完成',
    interrupted: '已中断',
    error: '出错',
    working: '执行中'
  }[status] || status;
  const pulse = status === 'working' ? '<span class="run-pulse" aria-hidden="true"></span>' : '';
  header.innerHTML = `
    ${pulse}
    <span class="run-status ${escapeAttr(status)}">${escapeHtml(statusLabel)}</span>
    <span class="run-meta">${agentRun.iteration || 0} 轮 · ${agentRun.toolCallCount || 0} 工具</span>
  `;
}

function renderAgentRunBody(bodyEl, agentRun, fallbackContent = '') {
  if (!bodyEl) return;
  bodyEl.innerHTML = '';
  renderAgentRunHeader(bodyEl, agentRun);
  const timeline = agentRun.timeline || [];
  if (timeline.length) {
    for (let i = 0; i < timeline.length; i++) {
      const item = timeline[i];
      if (item.type === 'tool_result') continue;
      if (item.type === 'thinking') bodyEl.appendChild(buildThinkingElement(item.content, false));
      else if (item.type === 'text') bodyEl.appendChild(buildTextRoundElement(item.content));
      else if (item.type === 'tool_call') {
        const next = timeline[i + 1];
        const output = next?.type === 'tool_result' ? next.output : '';
        const ok = next?.type === 'tool_result' ? next.ok : null;
        bodyEl.appendChild(buildToolStepElement(item.name, item.args, output, ok));
      }
    }
  } else if (fallbackContent) {
    bodyEl.appendChild(buildTextRoundElement(fallbackContent));
  }
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
      if (!body.querySelector('.tc-subagent-stats')) {
        const stats = document.createElement('div');
        stats.className = 'tc-subagent-stats';
        if (meta.parallel) stats.textContent = `并行 ${meta.count} 个 · 共 ${meta.totalToolCalls || 0} 次工具`;
        else stats.textContent = `${meta.label || meta.type || ''} · ${meta.tier === 'specialist' ? '专项' : '辅助'} · ${meta.iterations ?? '?'} 轮 · ${meta.toolCalls ?? 0} 工具`;
        body.prepend(stats);
      }
    } catch { /* ignore */ }
  }
  resultEl.innerHTML = `<pre class="tc-output">${escapeHtml(formatToolResultForUi(resultRaw))}</pre>`;
}

function summarizeToolArgs(toolName, args) {
  if (!args || typeof args !== 'object') return '';
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
  const step = document.createElement('details');
  step.className = 'tool-step';
  if (phase === 'running') step.classList.add('is-running');
  if (toolName === 'spawn_subagent' || toolName === 'spawn_subagents') {
    step.classList.add('subagent-step');
    const tier = args?.type && YanKernel.SUBAGENT_PROFILES?.[args.type]?.tier;
    if (tier === 'specialist') step.classList.add('subagent-specialist');
    if (toolName === 'spawn_subagents') step.classList.add('subagent-parallel');
  }
  step.open = ok === false;
  step.dataset.tool = toolName;
  step.dataset.args = JSON.stringify(args || {});
  if (ok != null) step.dataset.ok = String(!!ok);

  let displayName;
  let iconSvg;
  if (toolName === 'spawn_subagent' && args?.type) {
    const prof = YanKernel.SUBAGENT_PROFILES?.[args.type];
    displayName = prof ? `子 Agent · ${prof.label}` : `子 Agent · ${args.type}`;
    iconSvg = TOOL_ICON_SVG.agent;
  } else {
    const ui = resolveToolUi(toolName);
    displayName = ui.label;
    iconSvg = ui.icon;
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
      <span class="tc-icon-svg">${iconSvg}</span>
      <span class="tc-name">${escapeHtml(displayName)}</span>
      <span class="tc-preview">${escapeHtml(preview)}</span>
    </summary>
    <div class="tc-body"></div>
  `;

  const body = step.querySelector('.tc-body');
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

function updateContextInfo(as) {
  if (!as) as = getCurrentAgentState();
  const m = state.config.api.model;
  const modelName = (state.config.models || []).find(x => x.id === m)?.name || m;
  const el = id => $('#' + id);
  if (el('ctxModel')) el('ctxModel').textContent = modelName;
  if (el('ctxIteration')) el('ctxIteration').textContent = as.iteration;
  if (el('ctxToolCalls')) el('ctxToolCalls').textContent = as.toolCallCount;
  if (el('ctxMsgCount')) el('ctxMsgCount').textContent = state.currentSession?.messages?.length || 0;
  if (el('ctxStatus')) el('ctxStatus').textContent = { idle: '空闲', working: '执行中', done: '完成', error: '错误' }[as.status] || as.status;
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
// Welcome hint cards
// ============================================================
$$('.hint-card').forEach(card => {
  card.addEventListener('click', () => {
    input.value = card.dataset.prompt;
    autoGrow();
    updateSendState();
    input.focus();
  });
});

// ============================================================
// Settings sheet
// ============================================================
const settingsOverlay = $('#settingsOverlay');
$('#settingsBtn').addEventListener('click', () => openSettings());
$('#workspaceBtn').addEventListener('click', () => { openSettings('workspace'); });
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

async function populateSettings() {
  const cfg = await api.getConfig();
  const perm = await api.getPermissions();
  const ws = await api.getWorkspace();

  currentProviderId = cfg.api.provider || 'deepseek';
  await renderProviderList(currentProviderId);
  $('#cfgApiKey').value = cfg.api.apiKey || '';
  updateApiKeyField(currentProviderId);

  $('#wsPath').value = ws;

  $('#permRead').checked = perm.allowFileRead;
  $('#permWrite').checked = perm.allowFileWrite;
  $('#permShell').checked = perm.allowShell;
  $('#permNet').checked = perm.allowNetwork;

  renderModelGrid(cfg);
  await renderWsTree(ws);
}

async function renderProviderList(selectedId) {
  if (!providerCache.length) {
    providerCache = await api.listProviders();
  }
  const list = $('#providerList');
  if (!list) return;
  list.innerHTML = providerCache.map(p => `
    <div class="provider-item ${p.id === selectedId ? 'active' : ''}" data-provider="${p.id}">
      <div class="provider-info">
        <div class="provider-name">${escapeHtml(p.name)}</div>
        <div class="provider-models">${p.modelCount} 个模型</div>
      </div>
      <div class="provider-check">${p.id === selectedId ? ICONS.check : ''}</div>
    </div>
  `).join('');
  list.querySelectorAll('.provider-item').forEach(el => {
    el.addEventListener('click', async () => {
      const pid = el.dataset.provider;
      currentProviderId = pid;
      renderProviderList(pid);
      updateApiKeyField(pid);
    });
  });
}

function updateApiKeyField(providerId) {
  const p = providerCache.find(x => x.id === providerId);
  if (!p) return;
  const inp = $('#cfgApiKey');
  if (inp) {
    inp.placeholder = p.apiKeyPlaceholder || 'sk-...';
    inp.value = state.config?.api?.apiKeys?.[providerId] || '';
  }
  const hint = $('#cfgBaseUrlHint');
  if (hint) {
    hint.textContent = 'Base URL: ' + p.baseUrl;
  }
  const label = $('#cfgApiKeyLabel');
  if (label) {
    label.textContent = p.name + ' API Key';
  }
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

    const s = await api.createSession();
    createdSessionId = s.id;
    const title = `[自动] ${auto.name}`;
    s.title = title;
    await api.renameSession(s.id, title);
    await refreshSessions();

    const res = await submitMessageBackground(s, auto.prompt);

    if (res.error === 'busy' && createdSessionId) {
      try { await api.deleteSession(createdSessionId); } catch {}
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
  toast('已添加自动化任务');
  await renderAutomationPage();
});

// API save
$('#saveApi').addEventListener('click', async () => {
  const apiKeyValue = $('#cfgApiKey').value.trim();
  const partial = {
    api: {
      provider: currentProviderId,
      apiKeys: {}
    }
  };
  partial.api.apiKeys[currentProviderId] = apiKeyValue;
  state.config = await api.setConfig(partial);
  currentProviderId = state.config.api.provider;
  renderModelGrid(state.config);
  renderModelBadge();
  const providerName = providerCache.find(p => p.id === currentProviderId)?.name || currentProviderId;
  toast(`${providerName} 配置已保存`);
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
    grid.innerHTML = `<div class="session-empty">暂无可用模型</div>`;
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
      state.config = await api.setModel(id);
      renderModelGrid(state.config);
      renderModelBadge();
      const name = models.find(m => m.id === id)?.name || id;
      toast(`已切换到 ${name}`);
    });
  });
}

// Workspace tab
$('#wsChoose').addEventListener('click', async () => {
  const ws = await api.chooseWorkspace();
  if (ws) {
    $('#wsPath').value = ws;
    state.config = await api.getConfig();
    // 将工作区保存到当前会话（会话隔离）
    if (state.currentSession) {
      await api.setSessionWorkspace(state.currentSession.id, ws);
      state.currentSession.workspace = ws;
    }
    await renderWorkspacePill();
    await renderWsTree(ws);
    updateTaskBar();
    await renderRightSidebarFiles();
    toast('工作区已更新');
  }
});

async function renderWsTree(rootPath) {
  const tree = $('#wsTree');
  if (!rootPath) { tree.innerHTML = '<div class="session-empty">未设置工作区</div>'; return; }
  tree.innerHTML = '<div class="session-empty">加载中…</div>';
  const entries = await api.listWorkspace(rootPath);
  if (!entries.length) { tree.innerHTML = '<div class="session-empty">空目录</div>'; return; }
  tree.innerHTML = entries.map(e => wsNodeHtml(e)).join('');
  bindWsNodes(tree, rootPath);
}

function wsNodeHtml(entry) {
  const isDir = entry.isDirectory;
  return `
    <div class="ws-node ${isDir ? 'dir' : 'file'}" data-path="${escapeAttr(entry.path)}">
      ${isDir ? `<span class="ws-arrow">${ICONS.chevron}</span>` : '<span class="ws-arrow empty"></span>'}
      <span class="ws-icon">${isDir ? ICONS.folder : ICONS.file}</span>
      <span class="ws-name">${escapeHtml(entry.name)}</span>
      ${!isDir ? `<span class="ws-open">读取</span>` : ''}
    </div>
  `;
}

function bindWsNodes(root, basePath) {
  root.querySelectorAll('.ws-node.dir').forEach(node => {
    node.addEventListener('click', async (e) => {
      e.stopPropagation();
      const existing = node.nextElementSibling;
      if (existing && existing.classList.contains('ws-children')) {
        existing.remove();
        node.classList.remove('open');
        return;
      }
      node.classList.add('open');
      const childPath = node.dataset.path;
      const children = await api.listWorkspace(childPath);
      const div = document.createElement('div');
      div.className = 'ws-children';
      div.innerHTML = children.map(c => wsNodeHtml(c)).join('');
      node.after(div);
      bindWsNodes(div, childPath);
    });
  });
  root.querySelectorAll('.ws-node.file').forEach(node => {
    node.addEventListener('click', async (e) => {
      e.stopPropagation();
      const path = node.dataset.path;
      // open in Files tab
      switchTab('files');
      $('#filePathInput').value = path;
      await readFileIntoArea();
    });
  });
}

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

// Files tab
$('#openFileBtn').addEventListener('click', async () => {
  const p = await api.chooseOpenFile();
  if (p) { $('#filePathInput').value = p; await readFileIntoArea(); }
});
$('#saveFileBtn').addEventListener('click', async () => {
  const p = await api.chooseSaveFile();
  if (p) { $('#filePathInput').value = p; }
});
$('#readFileBtn').addEventListener('click', readFileIntoArea);
$('#writeFileBtn').addEventListener('click', writeFileFromArea);

async function readFileIntoArea() {
  const p = $('#filePathInput').value.trim();
  const status = $('#fileStatus');
  if (!p) { status.textContent = '请填写文件路径'; status.className = 'file-status err'; return; }
  status.textContent = '读取中…'; status.className = 'file-status';
  const res = await api.readFile(p);
  if (res.error) { status.textContent = '错误：' + res.error; status.className = 'file-status err'; return; }
  $('#fileContentInput').value = res.content;
  status.textContent = `已读取 ${res.size} 字节`; status.className = 'file-status ok';
}

async function writeFileFromArea() {
  const p = $('#filePathInput').value.trim();
  const content = $('#fileContentInput').value;
  const status = $('#fileStatus');
  if (!p) { status.textContent = '请填写文件路径'; status.className = 'file-status err'; return; }
  const res = await api.writeFile(p, content);
  if (res.error) { status.textContent = '错误：' + res.error; status.className = 'file-status err'; return; }
  status.textContent = `已写入 ${res.size} 字节`; status.className = 'file-status ok';
}

// ============================================================
// Model badge / workspace hint
// ============================================================
function renderModelBadge() {
  const m = state.config.api.model;
  const name = (state.config.models || []).find(x => x.id === m)?.name || m;
  const pillName = $('#modelPillName');
  if (pillName) pillName.textContent = name;
  updateContextInfo();
}

function renderThinkPill() {
  const pill = $('#thinkPill');
  if (pill) pill.classList.toggle('active', !!state.config.api.thinking);
}
async function renderWorkspacePill() {
  const ws = await api.getWorkspace();
  const nameEl = $('#wsPillName');
  const pill = $('#wsPill');
  if (ws) {
    // Show only the last path segment for a clean pill
    const short = ws.split(/[\\/]/).filter(Boolean).pop() || ws;
    nameEl.textContent = short;
    pill.title = ws;
  } else {
    nameEl.textContent = '未设置工作区';
    pill.title = '点击选择工作区';
  }
}

// Update the task bar (title + folder + buttons)
function updateTaskBar() {
  const bar = $('#taskBar');
  if (!bar) return;
  if (!state.currentSession) {
    bar.classList.add('hidden');
    return;
  }
  bar.classList.remove('hidden');
  $('#taskBarTitle').textContent = state.currentSession.title || 'New chat';
  const ws = state.config.workspace;
  const folderName = $('#taskBarFolderName');
  const openBtn = $('#taskBarOpenFolder');
  if (ws) {
    folderName.textContent = ws.split(/[\\/]/).filter(Boolean).pop() || ws;
    openBtn.disabled = false;
    api.yanagentEnsure?.(ws);
  } else {
    folderName.textContent = '选择文件夹';
    openBtn.disabled = true;
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
  bindShellPermDialog();

  // Workspace pill click → choose workspace
  $('#wsPill').addEventListener('click', async () => {
    const ws = await api.chooseWorkspace();
    if (ws) {
      state.config = await api.getConfig();
      // 保存到当前会话（会话隔离）
      if (state.currentSession) {
        await api.setSessionWorkspace(state.currentSession.id, ws);
        state.currentSession.workspace = ws;
      }
      await renderWorkspacePill();
      $('#wsPath').value = ws;          // keep settings panel in sync
      await renderWsTree(ws);
      await renderRightSidebarFiles();
      updateContextInfo();
      updateTaskBar();
      toast('工作区已更新');
    }
  });

  // Task bar: folder button → choose workspace
  $('#taskBarFolder').addEventListener('click', async () => {
    const ws = await api.chooseWorkspace();
    if (ws) {
      state.config = await api.getConfig();
      // 保存到当前会话（会话隔离）
      if (state.currentSession) {
        await api.setSessionWorkspace(state.currentSession.id, ws);
        state.currentSession.workspace = ws;
      }
      await renderWorkspacePill();
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

  // Model pill click → open settings on model tab
  $('#modelPill').addEventListener('click', () => openSettings('model'));

  // Thinking pill click → toggle deep-thinking mode (persisted in config)
  $('#thinkPill').addEventListener('click', async () => {
    const next = !state.config.api.thinking;
    state.config = await api.setConfig({ api: { thinking: next } });
    renderThinkPill();
    toast(next ? '已开启深度思考：更聪明，但响应更慢' : '已关闭深度思考');
  });
  renderThinkPill();

  // Resize handles for both sidebars
  setupResizeHandles();

  // Initial right sidebar toggle button state
  $('#rightSidebarToggleBtn').classList.toggle('active', !$('#app').classList.contains('rs-hidden'));

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
      $('#app').classList.toggle('sidebar-hidden');
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      $('#newChatBtn').click();
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

async function resolveBrowserUrl(input) {
  const s = String(input || '').trim();
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return s;
  if (/^file:\/\//i.test(s)) return s;

  let abs = s;
  if (!/^[a-zA-Z]:[\\/]/.test(s) && !s.startsWith('\\\\')) {
    abs = await resolveWorkspacePath(s);
  }
  const norm = abs.replace(/\\/g, '/');
  return 'file:///' + encodeURI(norm.replace(/^([a-zA-Z]:)/, '$1'));
}

async function agentOpenBuiltinBrowser(urlOrPath, { background = false } = {}) {
  const panel = $('#browserPanel');
  if (!panel) return { ok: false, error: '内置浏览器面板不可用' };
  const url = await resolveBrowserUrl(urlOrPath);
  if (!url) return { ok: false, error: '请提供 URL 或文件路径' };

  if (background) {
    return { ok: true, url };
  }

  if (!_browserNavigate) return { ok: false, error: '浏览器尚未初始化，请稍后重试' };

  switchSidebarNav('tasks');
  $('#pageChat')?.classList.remove('hidden');
  $('#pageSkills')?.classList.add('hidden');
  $('#pageMcp')?.classList.add('hidden');
  $('#pageAutomation')?.classList.add('hidden');

  panel.classList.remove('hidden');
  _browserNavigate(url);
  return { ok: true, url };
}

function setupBrowserPanel() {
  const panel = $('#browserPanel');
  const webview = $('#browserWebview');
  const urlInput = $('#browserUrl');

  $('#taskBarBrowser').addEventListener('click', () => {
    panel.classList.toggle('hidden');
    if (!panel.classList.contains('hidden')) {
      urlInput.focus();
    }
  });

  $('#browserClose').addEventListener('click', () => panel.classList.add('hidden'));

  function navigate(url) {
    if (!url) return;
    if (!/^https?:\/\//i.test(url) && !/^file:\/\//i.test(url)) {
      if (/^[\w.-]+\.[a-z]{2,}/i.test(url)) {
        url = 'https://' + url;
      } else {
        url = 'https://www.bing.com/search?q=' + encodeURIComponent(url);
      }
    }
    webview.src = url;
    urlInput.value = url;
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

// ============================================================
// Boot
// ============================================================
window.addEventListener('DOMContentLoaded', init);

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
  isResponding: false,
  abortController: null,   // 用于中止 fetch 请求
  shouldAbort: false,        // 中断标志，用于工具执行循环
  backgroundRuns: new Set(),  // 后台并行任务（自动化等）的 sessionId
  automationRuns: new Set()   // 正在执行的自动化 id
};

const MAX_BACKGROUND_RUNS = 3;

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
  clock: '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>'
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
  document.documentElement.setAttribute('data-theme', theme || 'dark');
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

  list.innerHTML = items.map(s => `
    <div class="session-item ${state.currentSession && s.id === state.currentSession.id ? 'active' : ''}" data-id="${s.id}">
      <span class="session-title">${escapeHtml(s.title || 'New chat')}</span>
      <button class="session-del" data-del="${s.id}" title="删除">${ICONS.trash}</button>
    </div>
  `).join('');

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
  switchSidebarNav('tasks');
  const s = await api.createSession();
  state.currentSession = s;
  clearMessages();
  setEmptyState(true);
  // 新会话从空工作区开始：必须同步清空全局 config.workspace，
  // 否则文件树/系统提示词/终端（走 getWorkspace 读全局）仍停留在上一个任务的工作区。
  // 各会话自己的工作区存在会话对象里，切换会话时会同步回全局，互不影响。
  state.config = await api.setConfig({ workspace: '' });
  await renderWorkspacePill();
  await renderRightSidebarFiles();
  updateTaskBar();
  await refreshSessions();
}

async function loadSession(id) {
  const s = await api.getSession(id);
  if (!s) return;
  state.currentSession = s;
  state.config = await api.setConfig({ workspace: s.workspace || '' });
  renderMessages(s.messages || []);
  setEmptyState((s.messages || []).length === 0);

  const lastAssistant = [...(s.messages || [])].reverse().find(m => m.role === 'assistant' && m.agentRun);
  if (lastAssistant?.agentRun?.todos?.length) {
    agentState.todos = lastAssistant.agentRun.todos.map(t => ({
      text: t.text,
      done: !!t.done,
      inProgress: !!t.inProgress
    }));
    agentState.todosFromTool = !!lastAssistant.agentRun.todosFromTool;
    agentState.status = lastAssistant.agentRun.status || 'done';
    agentState.iteration = lastAssistant.agentRun.iteration || 0;
    agentState.toolCallCount = lastAssistant.agentRun.toolCallCount || 0;
  } else {
    agentState.todos = [];
    agentState.todosFromTool = false;
    agentState.status = 'idle';
    agentState.iteration = 0;
    agentState.toolCallCount = 0;
  }
  renderTodos();
  updateContextInfo();

  await renderWorkspacePill();
  await renderRightSidebarFiles();
  updateTaskBar();
  renderSessionList();
}

async function saveCurrentSession() {
  if (!state.currentSession) return;
  // Auto-title from first user message
  if ((!state.currentSession.title || state.currentSession.title === 'New chat') &&
      state.currentSession.messages && state.currentSession.messages.length) {
    const firstUser = state.currentSession.messages.find(m => m.role === 'user');
    if (firstUser) {
      const title = deriveTitle(firstUser.content);
      state.currentSession.title = title;
      await api.renameSession(state.currentSession.id, title);
    }
  }
  await api.saveSession(state.currentSession);
  await refreshSessions();
  updateTaskBar();
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
        if (state.backgroundRuns.size >= MAX_BACKGROUND_RUNS) { toast('后台任务已满，请稍后再试'); return; }
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
    const durHtml = duration != null ? `<span class="msg-duration" title="任务耗时">${ICONS.clock} ${formatDuration(duration)}</span>` : '';
    actionsHtml = `
      <div class="msg-actions">
        ${durHtml}
        <button class="msg-action-btn" data-act="copy" title="复制">${ICONS.copy}</button>
      </div>`;
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
  if (state.isResponding) {
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
  if (state.isResponding) {
    abortTask();
  } else {
    sendMessage();
  }
});

// 中止当前任务
function abortTask() {
  if (!state.isResponding) return;
  state.shouldAbort = true;
  if (state.abortController) {
    try { state.abortController.abort(); } catch {}
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
  if (state.isResponding) return;

  const attachments = state.attachments.slice();
  // 清空输入区
  input.value = '';
  state.attachments = [];
  renderAttachments();
  autoGrow();
  updateSendState();
  closeSlash();

  await submitMessage(text, attachments);
}

// 后台运行：不切换 UI、不占用前台 isResponding，支持多任务并行
async function submitMessageBackground(session, text) {
  if (!text) return { ok: false, error: 'empty' };
  if (state.backgroundRuns.size >= MAX_BACKGROUND_RUNS) return { ok: false, error: 'busy' };

  const runCtx = createBackgroundRunCtx(session.id);
  state.backgroundRuns.add(session.id);
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
    state.backgroundRuns.delete(session.id);
  }
}

// 核心发送流程：手动发送与自动化任务共用。返回 { ok, error }
async function submitMessage(text, attachments = []) {
  if (!text && attachments.length === 0) return { ok: false, error: 'empty' };
  if (state.isResponding) return { ok: false, error: 'busy' };

  // Ensure session exists
  if (!state.currentSession) await newSession();

  const userMsg = { role: 'user', content: text, attachments, ts: Date.now() };
  state.currentSession.messages = state.currentSession.messages || [];
  state.currentSession.messages.push(userMsg);

  const userMsgIndex = state.currentSession.messages.length - 1;
  appendMessage('user', text, attachments, true, userMsgIndex, userMsg.ts);
  setEmptyState(false);

  await saveCurrentSession();

  // Respond
  state.isResponding = true;
  state.shouldAbort = false;
  state.abortController = null;
  updateSendState();
  showTyping(true);
  const taskStartTime = Date.now();
  let taskOk = true;
  let taskErr = null;
  let assistantEl = null;

  try {
    assistantEl = appendMessage('assistant', '');
    const loopResult = await runAgentLoop(state.currentSession.messages, assistantEl, getForegroundRunCtx());
    const reply = loopResult.content;
    const agentRun = loopResult.agentRun;
    const taskDuration = Date.now() - taskStartTime;
    showTyping(false);

    if (agentRun) renderAgentRunHeader(assistantEl.querySelector('.msg-body'), agentRun);

    const assistantMsgIndex = state.currentSession.messages.length;
    assistantEl.dataset.msgIndex = assistantMsgIndex;
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'msg-actions';
    actionsContainer.innerHTML = `<span class="msg-duration" title="任务耗时">${ICONS.clock} ${formatDuration(taskDuration)}</span><button class="msg-action-btn" data-act="copy" title="复制">${ICONS.copy}</button>`;
    actionsContainer.querySelectorAll('.msg-action-btn').forEach(btn => {
      btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, assistantEl));
    });
    assistantEl.appendChild(actionsContainer);

    const assistantMsg = {
      role: 'assistant',
      content: reply,
      ts: Date.now(),
      duration: taskDuration,
      agentRun
    };
    state.currentSession.messages.push(assistantMsg);
    await saveCurrentSession();
    // 后台提取长期记忆（不阻塞 UI）
    // 仅在对话有一定长度时提取，避免每次琐碎回复都额外发一次 API 请求
    if ((state.currentSession.messages || []).length >= 4) {
      extractMemoryFacts(state.currentSession.messages).then(facts => {
        if (facts.length > 0) {
          facts.forEach(content => {
            api.addMemoryFact({ content });
          });
        }
      }).catch(() => {});
    }
    // 任务完成通知（中断时不弹）
    if (window.Notification && Notification.permission === 'granted' && agentRun?.status !== 'interrupted') {
      try {
        new Notification('Yan Agent', { body: '任务已完成 · 耗时 ' + formatDuration(taskDuration), icon: 'assets/logo.png' });
      } catch {}
    }
  } catch (err) {
    if (err && (err.name === 'AbortError' || state.shouldAbort)) {
      showTyping(false);
      if (assistantEl) {
        const taskDuration = Date.now() - taskStartTime;
        const body = assistantEl.querySelector('.msg-body');
        const partialContent = collectAssistantText(body) || '⚠️ **任务已被用户中断**';
        const agentRun = finalizeAgentRun(partialContent, 'interrupted', getActiveRun(getForegroundRunCtx()), body, null, getForegroundRunCtx());
        if (agentRun) renderAgentRunHeader(body, agentRun);

        assistantEl.dataset.msgIndex = state.currentSession.messages.length;
        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'msg-actions';
        actionsContainer.innerHTML = `<span class="msg-duration" title="任务耗时">${ICONS.clock} ${formatDuration(taskDuration)}</span><button class="msg-action-btn" data-act="copy" title="复制">${ICONS.copy}</button>`;
        actionsContainer.querySelector('.msg-action-btn').forEach(btn => {
          btn.addEventListener('click', () => handleMessageAction(btn.dataset.act, assistantEl));
        });
        assistantEl.appendChild(actionsContainer);

        state.currentSession.messages.push({
          role: 'assistant',
          content: partialContent,
          ts: Date.now(),
          duration: taskDuration,
          agentRun
        });
        await saveCurrentSession();
      }
    } else {
    taskOk = false;
    taskErr = err.message;
    showTyping(false);
    // 保留原 assistantEl 中的部分流式内容，在其上追加错误信息，而非新建气泡
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
  } finally {
    state.isResponding = false;
    updateSendState();
  }
  return { ok: taskOk, error: taskErr };
}

// ============================================================
// Agent kernel: tools, system prompt, agentic loop, SSE streaming
// ============================================================

const BUILT_IN_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'todo_write',
      description: '创建或更新任务计划清单（会实时展示给用户）。任何需要 3 步以上的任务，动手前先调用它列出计划；之后每完成一步就再次调用更新状态。每次必须传完整清单。同一时刻只能有一项 in_progress。',
      parameters: {
        type: 'object',
        properties: {
          todos: {
            type: 'array',
            description: '完整的任务清单',
            items: {
              type: 'object',
              properties: {
                text: { type: 'string', description: '任务描述（简短）' },
                status: { type: 'string', enum: ['pending', 'in_progress', 'done'], description: '任务状态' }
              },
              required: ['text', 'status']
            }
          }
        },
        required: ['todos']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: '读取文件内容。可以传入绝对路径或相对于工作区的路径。编辑文件前必须先读取它。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' }
        },
        required: ['path']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'edit_file',
      description: '精确编辑已存在的文件：把 old_string 替换为 new_string。old_string 必须与文件内容逐字符完全一致（含缩进/换行），且在文件中只出现一次。单点修改用它；多处修改优先用 apply_patch。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          old_string: { type: 'string', description: '要被替换的原文（必须唯一匹配）' },
          new_string: { type: 'string', description: '替换后的新文本' }
        },
        required: ['path', 'old_string', 'new_string']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'apply_patch',
      description: '对同一个已存在文件执行多段精确替换。每个 edit 都是 old_string -> new_string，按顺序应用；每个 old_string 在应用时必须唯一匹配。适合一次完成同一文件的多处修改，写入后会自动回读校验。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          edits: {
            type: 'array',
            description: '按顺序执行的替换列表',
            items: {
              type: 'object',
              properties: {
                old_string: { type: 'string', description: '要被替换的原文（必须唯一匹配）' },
                new_string: { type: 'string', description: '替换后的新文本' }
              },
              required: ['old_string', 'new_string']
            }
          }
        },
        required: ['path', 'edits']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: '将内容写入文件（不存在则创建，存在则整体覆盖，自动创建目录）。仅用于新建文件或彻底重写；修改已有文件请用 edit_file 或 apply_patch。写入后会自动回读校验。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '文件路径' },
          content: { type: 'string', description: '要写入的内容' }
        },
        required: ['path', 'content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'list_directory',
      description: '列出指定目录下的文件和子目录。不传 path 则列出工作区根目录。',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: '目录路径（默认为工作区根目录）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'execute_shell',
      description: '执行 Shell 命令并返回输出。可用于运行脚本、安装依赖、编译代码等。',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: '要执行的命令' }
        },
        required: ['command']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: '在工作区文件中搜索包含指定文本的行。返回匹配的文件路径、行号和内容。',
      parameters: {
        type: 'object',
        properties: {
          query: { type: 'string', description: '要搜索的文本' }
        },
        required: ['query']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_status',
      description: '查看当前工作区的 Git 状态（修改、暂存、未跟踪的文件等）。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_diff',
      description: '查看 Git 差异（未暂存或已暂存的改动）。',
      parameters: {
        type: 'object',
        properties: {
          staged: { type: 'boolean', description: '是否查看已暂存的差异' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_log',
      description: '查看 Git 提交历史。',
      parameters: {
        type: 'object',
        properties: {
          limit: { type: 'number', description: '显示的提交数量（默认20）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_commit',
      description: '将所有改动添加到暂存区并提交。',
      parameters: {
        type: 'object',
        properties: {
          message: { type: 'string', description: '提交信息' }
        },
        required: ['message']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_push',
      description: '将本地提交推送到远程仓库。',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: '远程仓库名（默认 origin）' },
          branch: { type: 'string', description: '分支名（可选）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_pull',
      description: '从远程仓库拉取最新代码。',
      parameters: {
        type: 'object',
        properties: {
          remote: { type: 'string', description: '远程仓库名（默认 origin）' },
          branch: { type: 'string', description: '分支名（可选）' }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_clone',
      description: '克隆远程仓库到当前工作区。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '仓库 URL' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'git_branch',
      description: '列出所有本地和远程分支。',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_builtin_browser',
      description: '打开 Yan Agent 内置浏览器面板并导航到 URL 或本地 HTML 文件，供用户预览。写完 HTML/网页/Canvas 游戏等前端页面后，必须调用此工具在内置浏览器中打开验证；不要只用 read_file 代替视觉测试。支持 https URL 或文件路径（相对工作区或绝对路径，如 snake.html）。',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: '网址 (https://...) 或 HTML 文件路径' }
        },
        required: ['url']
      }
    }
  }
];

// Dynamic TOOLS: built-in + MCP tools (refreshed at the start of each agent run)
let TOOLS = [...BUILT_IN_TOOLS];
// Map: full tool name -> { serverId, toolName } for MCP tool routing
const mcpToolMap = new Map();

// 加载所有已启用的 MCP 服务器工具，合并进 TOOLS
async function refreshMcpTools() {
  mcpToolMap.clear();
  const errors = []; // 收集启动失败的服务器
  try {
    const mcpTools = await api.mcpListTools();
    if (!mcpTools || mcpTools.length === 0) {
      TOOLS = [...BUILT_IN_TOOLS];
      return;
    }
    const mcpToolDefs = [];
    for (const t of mcpTools) {
      // 错误条目：服务器启动失败
      if (t.error) {
        errors.push(`${t.serverName}: ${t.error}`);
        continue;
      }
      if (!t.tool) continue;
      const fullName = `mcp__${t.serverId}__${t.tool.name}`;
      mcpToolMap.set(fullName, { serverId: t.serverId, toolName: t.tool.name });
      mcpToolDefs.push({
        type: 'function',
        function: {
          name: fullName,
          description: `[MCP:${t.serverName}] ${t.tool.description || t.tool.name}`,
          parameters: t.tool.inputSchema || { type: 'object', properties: {} }
        }
      });
    }
    TOOLS = [...BUILT_IN_TOOLS, ...mcpToolDefs];
    console.log(`[MCP] 已加载 ${mcpToolDefs.length} 个 MCP 工具${errors.length ? '，' + errors.length + ' 个服务器失败' : ''}`);
    // 将错误信息通过 toast 反馈给用户
    if (errors.length > 0) {
      toast('MCP 启动失败: ' + errors[0] + (errors.length > 1 ? ` 等 ${errors.length} 个` : ''));
    }
  } catch (e) {
    console.log('[MCP] 加载工具失败:', e.message);
    TOOLS = [...BUILT_IN_TOOLS];
    toast('MCP 加载失败: ' + e.message);
  }
}

const TOOL_ICONS = {
  todo_write: '📋', read_file: '📄', edit_file: '🪄', apply_patch: '🧩', write_file: '✏️',
  list_directory: '📁', execute_shell: '⚡', search_files: '🔍',
  open_builtin_browser: '🌐',
  git_status: '📊', git_diff: '📋', git_log: '📝', git_commit: '✅',
  git_push: '⬆️', git_pull: '⬇️', git_clone: '📦', git_branch: '🌿'
};

// --- System prompt with workspace context ---
// 原创撰写的行为准则，复刻现代 Agent 内核（任务管理/精确编辑/写后验证/简洁输出）的设计思路
async function buildSystemPrompt() {
  const ws = await api.getWorkspace();
  const model = state.config.api.model;
  const modelName = (state.config.models || []).find(m => m.id === model)?.name || model;
  const now = new Date();

  let prompt = `You are Yan Agent, an autonomous coding and task agent running inside a Windows desktop client. You operate on the user's real file system with real shell access. Your job is to COMPLETE tasks end-to-end, not to describe how they could be done.

# Tone and style
- Be direct and concise. Lead with the result, not the process. No filler, no restating the question, no "好的，我将为您…" preambles.
- Keep responses short. One-sentence answers are fine for simple questions. Never pad with unnecessary summaries of what you just did — the user watched the tool calls happen.
- Use Markdown. Put code in fenced blocks with a language tag. Use tables for enumerable facts.
- Always respond in the user's language (Chinese if they write Chinese). Code, identifiers and commit messages stay in English unless asked otherwise.
- Never use emojis unless the user does first.

# Proactiveness
- When the user asks you to do something, DO it — including obvious follow-up actions required to finish the job. Do not stop halfway to ask for permission the user already implied.
- But do not surprise the user: if they ask a question, answer it first instead of jumping to edit files.
- If a step fails, read the error, fix the cause, and retry. Do not give up after one attempt, and do not silently swallow failures. After repeated failures (3+), stop and report exactly what blocks you.

# Task management (todo_write)
- For any task that needs 3 or more steps, FIRST call todo_write with the full plan, THEN execute step by step.
- Keep exactly one item in_progress at a time. The moment a step finishes, call todo_write again marking it done and the next one in_progress.
- Skip todos entirely for trivial one-step tasks.

# Doing work
- Understand before changing: use list_directory / search_files / read_file to learn the relevant code BEFORE editing. Never guess file contents.
- Prefer edit_file for one exact replacement and apply_patch for multiple replacements in the same file. Use write_file only for new files or full rewrites. Always read_file before editing.
- Tool results are structured JSON: { ok, output, error, meta }. Always read ok and output first; use meta for exitCode, verification, path, and edit stats.
- Match the existing code style, naming and conventions of the project. Reuse what is already there instead of inventing parallel structures.
- VERIFY your work: after writing code, run it, compile it, or at minimum read the result back. After shell commands, check the exit code and output. A task is not done until verified.
- **Built-in browser (open_builtin_browser)**: Yan Agent has an embedded browser panel in the UI (right side of chat). After creating or modifying any HTML page, web game, or frontend UI, you MUST call \`open_builtin_browser\` with the file path or URL so the user can see it running. Example: after writing \`snake.html\`, call \`open_builtin_browser({ url: "snake.html" })\`. Do not skip this step. For local static files prefer the built-in browser; use MCP Playwright only when you need automated interaction (click, form fill, E2E).
- Do exactly what was asked — no scope creep, no drive-by refactors, no extra features. Simple and correct beats clever.
- Do not add comments that merely narrate the code. Comment only non-obvious intent.
- When running shell commands, remember this is Windows PowerShell/cmd: use Windows path separators and Windows-appropriate commands.
- Git: review with git_status/git_diff before committing. Never push unless the user asked.
- If MCP tools are available (names starting with "mcp__"), use them for advanced browser automation (click, fill forms, E2E). For previewing local HTML you wrote, always use open_builtin_browser first.

# Environment
- OS: Windows (shell commands run via cmd/PowerShell)
- Date: ${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}
- Model: ${modelName}
- Workspace root: ${ws || '(not set — ask the user to pick one if the task needs files)'}
- Resolve relative paths against the workspace root.`;

  // Inject workspace file tree for context
  if (ws) {
    try {
      const tree = await api.getWorkspaceTree(ws, 2);
      if (tree.length > 0) {
        const fileList = tree.slice(0, 80).map(f =>
          f.isDirectory ? `[DIR]  ${f.relPath}` : `       ${f.relPath}`
        ).join('\n');
        prompt += `\n\n# Workspace structure (top 2 levels)\n\`\`\`\n${fileList}\n\`\`\``;
      }
    } catch (e) { /* ignore */ }
  }

  return prompt;
}

function clipToolText(text, max = 12000) {
  const s = String(text ?? '');
  if (s.length <= max) return s;
  return s.slice(0, max) + `\n...(${s.length - max} chars truncated)...`;
}

// 相对路径统一解析到 workspace root，避免模型传 src/foo.ts 时读写失败
async function resolveWorkspacePath(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return p;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) return p;
  const ws = await api.getWorkspace();
  if (!ws) return p;
  const sep = ws.includes('\\') ? '\\' : '/';
  const base = ws.replace(/[\\/]+$/, '');
  const rel = p.replace(/^[\\/]+/, '').replace(/\//g, sep);
  return `${base}${sep}${rel}`;
}

// 统一工具返回协议：{ ok, tool, output, error, meta }
function toolResult(ok, tool, { output = '', error = null, meta = {} } = {}) {
  return JSON.stringify({ ok, tool, output, error: ok ? null : (error || 'Tool failed'), meta }, null, 2);
}

function toolSuccess(tool, output, meta = {}) {
  return toolResult(true, tool, { output, meta });
}

function toolError(tool, error, meta = {}) {
  return toolResult(false, tool, { output: '', error: String(error || 'Unknown error'), meta });
}

function execToolResult(tool, res, fallbackOutput = '') {
  const stdout = clipToolText(res.stdout || '');
  const stderr = clipToolText(res.stderr || '');
  const exitCode = Number.isFinite(res.exitCode) ? res.exitCode : (res.error ? 1 : 0);
  // git diff 有改动时 exit code 为 1，不是失败
  const gitDiffHasChanges = tool === 'git_diff' && !res.error && exitCode === 1;
  const ok = !res.error && (exitCode === 0 || gitDiffHasChanges);
  const output = stdout || stderr || fallbackOutput;
  return toolResult(ok, tool, {
    output,
    error: res.error || (ok ? null : (stderr || `exit code ${exitCode}`)),
    meta: { exitCode, stderr: stderr || undefined, hasChanges: gitDiffHasChanges || undefined }
  });
}

function normalizeEdits(args) {
  if (Array.isArray(args.edits)) return args.edits;
  if (Array.isArray(args.replacements)) return args.replacements;
  return [{ old_string: args.old_string, new_string: args.new_string }];
}

function applyExactEdits(content, edits) {
  let updated = content;
  const stats = [];

  for (let i = 0; i < edits.length; i++) {
    const oldStr = String(edits[i]?.old_string ?? '');
    const newStr = String(edits[i]?.new_string ?? '');
    if (!oldStr) {
      return { error: `edit ${i + 1}: old_string is empty.` };
    }

    const first = updated.indexOf(oldStr);
    if (first < 0) {
      return {
        error: `edit ${i + 1}: old_string not found. Read the file again and copy the exact text, including whitespace and indentation.`,
        applied: stats.length
      };
    }
    if (updated.indexOf(oldStr, first + 1) >= 0) {
      return {
        error: `edit ${i + 1}: old_string matches multiple locations. Include more surrounding lines to make it unique.`,
        applied: stats.length
      };
    }

    updated = updated.slice(0, first) + newStr + updated.slice(first + oldStr.length);
    stats.push({
      index: i + 1,
      offset: first,
      removedChars: oldStr.length,
      addedChars: newStr.length
    });
  }

  return { updated, stats };
}

async function verifyTextFile(path, expectedContent) {
  const check = await api.readFile(path);
  if (check.error) return { ok: false, error: check.error };
  if (check.isBinary) return { ok: false, error: 'file became binary after write' };
  return {
    ok: check.content === expectedContent,
    size: check.size,
    error: check.content === expectedContent ? null : 'read-back content differs from expected content'
  };
}

async function editTextFile(tool, args) {
  const path = await resolveWorkspacePath(args.path);
  const edits = normalizeEdits(args);
  if (!path) return toolError(tool, 'path is required.');
  if (!edits.length) return toolError(tool, 'at least one edit is required.');

  const res = await api.readFile(path);
  if (res.error) return toolError(tool, res.error, { path });
  if (res.isBinary) return toolError(tool, 'cannot edit a binary file.', { path, size: res.size });

  const content = res.content ?? '';
  const applied = applyExactEdits(content, edits);
  if (applied.error) {
    return toolError(tool, applied.error, { path, applied: applied.applied || 0 });
  }

  const w = await api.writeFile(path, applied.updated);
  if (w.error) return toolError(tool, w.error, { path });

  const verification = await verifyTextFile(path, applied.updated);
  const removed = applied.stats.reduce((n, s) => n + s.removedChars, 0);
  const added = applied.stats.reduce((n, s) => n + s.addedChars, 0);
  const output = verification.ok
    ? `Applied ${applied.stats.length} edit(s) to ${path}. -${removed} +${added} chars, now ${w.size} bytes. Read-back verified.`
    : `Wrote ${path} but read-back verification failed.`;
  return toolResult(verification.ok, tool, {
    output,
    error: verification.ok ? null : verification.error,
    meta: { path, edits: applied.stats, size: w.size, verification }
  });
}

// --- Tool execution ---
async function executeTool(name, args, runCtx) {
  const as = runCtx?.agentState || agentState;
  const ui = runCtx?.ui !== false;
  switch (name) {
    case 'todo_write': {
      const todos = Array.isArray(args.todos) ? args.todos : [];
      as.todos = todos.map(t => ({
        text: String(t.text || ''),
        done: t.status === 'done',
        inProgress: t.status === 'in_progress'
      }));
      as.todosFromTool = true;
      if (ui) {
        renderTodos(as);
        updateContextInfo(as);
      }
      const doneCount = as.todos.filter(t => t.done).length;
      return toolSuccess(name, `Todo list updated: ${doneCount}/${as.todos.length} done.`, {
        doneCount,
        total: as.todos.length
      });
    }
    case 'edit_file': {
      return editTextFile(name, args);
    }
    case 'apply_patch': {
      return editTextFile(name, args);
    }
    case 'read_file': {
      const path = await resolveWorkspacePath(args.path);
      const res = await api.readFile(path);
      if (res.error) return toolError(name, res.error, { path });
      if (res.isBinary) {
        return toolSuccess(name, `(binary file, ${res.size} bytes)`, { path, isBinary: true, size: res.size, mtime: res.mtime });
      }
      return toolSuccess(name, clipToolText(res.content), { path, size: res.size, mtime: res.mtime });
    }
    case 'write_file': {
      const path = await resolveWorkspacePath(args.path);
      const res = await api.writeFile(path, args.content);
      if (res.error) return toolError(name, res.error, { path });
      const verification = await verifyTextFile(path, String(args.content ?? ''));
      const output = verification.ok
        ? `Wrote ${path} (${res.size} bytes). Read-back verified.`
        : `Wrote ${path} but read-back verification failed.`;
      return toolResult(verification.ok, name, {
        output,
        error: verification.ok ? null : verification.error,
        meta: { path, size: res.size, verification }
      });
    }
    case 'list_directory': {
      const ws = await api.getWorkspace();
      const dir = args.path ? await resolveWorkspacePath(args.path) : ws;
      const entries = await api.listWorkspace(dir);
      const listing = entries.map(e =>
        `${e.isDirectory ? '[DIR]  ' : '       '}${e.name}`
      ).join('\n');
      return toolSuccess(name, listing || '(empty directory)', { path: dir, count: entries.length });
    }
    case 'execute_shell': {
      const res = await api.executeShell(args.command);
      return execToolResult(name, res, '(no output)');
    }
    case 'search_files': {
      const results = await api.searchFiles(args.query);
      const output = results.length
        ? results.map(r => `${r.path}:${r.line}: ${r.content}`).join('\n')
        : 'No matches found.';
      return toolSuccess(name, output, { query: args.query, count: results.length });
    }
    case 'git_status': {
      const res = await api.gitStatus();
      return execToolResult(name, res, '(no output)');
    }
    case 'git_diff': {
      const res = await api.gitDiff(args.staged || false);
      return execToolResult(name, res, '(no changes)');
    }
    case 'git_log': {
      const res = await api.gitLog(args.limit || 20);
      return execToolResult(name, res, '(no commits)');
    }
    case 'git_commit': {
      const res = await api.gitCommit(args.message);
      return execToolResult(name, res, 'Committed.');
    }
    case 'git_push': {
      const res = await api.gitPush(args.remote, args.branch);
      return execToolResult(name, res, 'Pushed.');
    }
    case 'git_pull': {
      const res = await api.gitPull(args.remote, args.branch);
      return execToolResult(name, res, 'Pulled.');
    }
    case 'git_clone': {
      const res = await api.gitClone(args.url);
      return execToolResult(name, res, 'Cloned.');
    }
    case 'git_branch': {
      const res = await api.gitBranch();
      return execToolResult(name, res, '(no branches)');
    }
    case 'open_builtin_browser': {
      const res = await agentOpenBuiltinBrowser(args.url);
      if (!res.ok) return toolError(name, res.error, { url: args.url });
      return toolSuccess(name, `已在内置浏览器打开：${res.url}`, { url: res.url });
    }
    default: {
      // MCP 工具路由：检查是否为 MCP 工具
      const mcpInfo = mcpToolMap.get(name);
      if (mcpInfo) {
        const res = await api.mcpCallTool(mcpInfo.serverId, mcpInfo.toolName, args);
        if (res.error) return toolError(name, res.error, { serverId: mcpInfo.serverId, toolName: mcpInfo.toolName });
        const output = clipToolText(res.result || '(无输出)');
        return toolResult(!res.isError, name, {
          output,
          error: res.isError ? 'MCP tool returned isError=true' : null,
          meta: { serverId: mcpInfo.serverId, toolName: mcpInfo.toolName, isError: !!res.isError }
        });
      }
      return toolError(name, `Unknown tool: ${name}`);
    }
  }
}

// --- Context compression ---
// 当对话历史超过 token 阈值时，压缩早期消息为摘要
// DeepSeek V4 支持 1M 上下文，阈值主要为控制成本与延迟
const CONTEXT_TOKEN_THRESHOLD = 60000; // 约 60K tokens 触发压缩
const CONTEXT_KEEP_RECENT = 12; // 保留最近 12 条消息不压缩

function estimateTokens(messages) {
  let chars = 0;
  for (const m of messages) {
    chars += (m.content || '').length;
  }
  return Math.ceil(chars * 1.8);
}

function clipTraceForStorage(trace) {
  return (trace || []).map(tm => {
    if (tm.role === 'tool') return { ...tm, content: clipToolText(tm.content, 8000) };
    if (tm.role === 'assistant' && tm.content) return { ...tm, content: clipToolText(tm.content, 4000) };
    return tm;
  });
}

async function compressContextIfNeeded(messages) {
  const estTokens = estimateTokens(messages);
  if (estTokens <= CONTEXT_TOKEN_THRESHOLD) {
    return messages;
  }

  let splitIdx = messages.length - CONTEXT_KEEP_RECENT;
  if (splitIdx <= 2) return messages;

  while (splitIdx < messages.length && messages[splitIdx]?.role === 'tool') {
    splitIdx++;
  }
  if (splitIdx >= messages.length) return messages;

  const toCompress = messages.slice(0, splitIdx);
  const toKeep = messages.slice(splitIdx);

  // 保留含 apiTrace 的 assistant 消息（工具调用链），只压缩普通文本
  const traceKeepers = [];
  const toSummarize = [];
  for (const m of toCompress) {
    if (m.role === 'assistant' && m.agentRun?.apiTrace?.length) {
      traceKeepers.push({
        role: 'assistant',
        content: m.content || '',
        agentRun: {
          status: m.agentRun.status,
          iteration: m.agentRun.iteration,
          toolCallCount: m.agentRun.toolCallCount,
          todos: m.agentRun.todos,
          todosFromTool: m.agentRun.todosFromTool,
          timeline: m.agentRun.timeline,
          apiTrace: clipTraceForStorage(m.agentRun.apiTrace)
        }
      });
    } else {
      toSummarize.push(m);
    }
  }

  if (!toSummarize.length) {
    return [...traceKeepers, ...toKeep];
  }

  const { baseUrl, apiKey, model } = state.config.api;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const compressPrompt = `请将以下对话历史压缩为简洁的上下文摘要。保留：
1. 用户的任务意图和关键需求
2. 已完成的操作和创建/修改的文件
3. 遇到的问题和解决方案
4. 任何用户偏好或约束

删除冗余的工具输出细节，只保留关键信息。输出为简洁的要点列表。`;

  const compressMessages = [
    { role: 'system', content: compressPrompt },
    { role: 'user', content: toSummarize.map(m => `[${m.role}]: ${m.content}`).join('\n\n') }
  ];

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({ model, messages: compressMessages, stream: false })
    });
    const data = await res.json();
    const summary = data.choices?.[0]?.message?.content || '';

    return [
      { role: 'system', content: `## Previous Context (已压缩的早期对话摘要)\n${summary}` },
      ...traceKeepers,
      ...toKeep
    ];
  } catch (e) {
    return [
      ...traceKeepers,
      ...toSummarize.map(m => {
        if ((m.content || '').length > 4000) {
          return { ...m, content: m.content.slice(0, 2000) + '\n...(已截断)...' };
        }
        return m;
      }),
      ...toKeep
    ];
  }
}

// --- Memory extraction ---
// 任务完成后从对话中提取关键事实存入长期记忆
async function extractMemoryFacts(messages) {
  const { baseUrl, apiKey, model } = state.config.api;
  if (!apiKey) return []; // 无 Key 时不发起额外请求
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const extractPrompt = `请从以下对话中提取值得长期记住的关键事实（用户偏好、项目约定、重要决策、技术栈选择等）。
只提取跨会话有用的事实，不要提取具体任务细节。
每条事实一行，格式为简洁陈述句。如果没有值得提取的内容，回复"无"。`;

  // 只看最近 12 条消息，避免 token 过多
  const recentMsgs = messages.slice(-12);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: 'system', content: extractPrompt },
          { role: 'user', content: recentMsgs.map(m => `[${m.role}]: ${(m.content || '').slice(0, 500)}`).join('\n\n') }
        ],
        stream: false
      })
    });
    const data = await res.json();
    const content = data.choices?.[0]?.message?.content || '';
    if (!content || content.trim() === '无') return [];

    // 按行分割为事实列表
    return content.split('\n')
      .map(line => line.replace(/^[-*•]\s*/, '').trim())
      .filter(line => line.length > 3 && line.length < 200);
  } catch (e) {
    return [];
  }
}

// --- Agent run persistence (Package C) ---
const agentState = { todos: [], todosFromTool: false, iteration: 0, toolCallCount: 0, status: 'idle' };
let activeAgentRun = null;

function getForegroundRunCtx() {
  return { background: false, ui: true, agentState, get shouldAbort() { return state.shouldAbort; } };
}

function createBackgroundRunCtx(sessionId) {
  return {
    background: true,
    sessionId,
    ui: false,
    shouldAbort: false,
    abortController: null,
    agentState: { todos: [], todosFromTool: false, iteration: 0, toolCallCount: 0, status: 'idle' },
    activeAgentRun: null
  };
}

function getActiveRun(runCtx) {
  return runCtx?.background ? runCtx.activeAgentRun : activeAgentRun;
}

function startAgentRun(runCtx) {
  const run = { timeline: [], runStartIndex: 0 };
  if (runCtx?.background) runCtx.activeAgentRun = run;
  else activeAgentRun = run;
  return run;
}

function recordTimelineEvent(entry, runCtx) {
  const run = getActiveRun(runCtx);
  if (!run) return;
  run.timeline.push({ ...entry, ts: Date.now() });
}

function clipApiTrace(trace) {
  return trace.map(m => {
    if (m.role === 'tool') {
      return { ...m, content: clipToolText(m.content, 8000) };
    }
    if (m.role === 'assistant' && m.content) {
      return { ...m, content: clipToolText(m.content, 4000) };
    }
    return m;
  });
}

function finalizeAgentRun(content, status, run, bodyEl, apiMessages, runCtx) {
  const as = runCtx?.agentState || agentState;
  const timeline = run?.timeline?.length
    ? run.timeline
    : (bodyEl ? collectTimelineFromDom(bodyEl) : []);
  let apiTrace = [];
  if (apiMessages && run?.runStartIndex != null) {
    apiTrace = clipApiTrace(apiMessages.slice(run.runStartIndex));
  }
  return {
    status,
    iteration: as.iteration,
    toolCallCount: as.toolCallCount,
    todos: as.todos.map(t => ({ text: t.text, done: t.done, inProgress: t.inProgress })),
    todosFromTool: as.todosFromTool,
    timeline,
    apiTrace
  };
}

function makeLoopResult(content, status, apiMessages, runCtx) {
  const run = getActiveRun(runCtx);
  const agentRun = finalizeAgentRun(content, status, run, null, apiMessages, runCtx);
  if (runCtx?.background) runCtx.activeAgentRun = null;
  else activeAgentRun = null;
  return { content, agentRun };
}

function parseToolOutputOk(raw) {
  try { return !!JSON.parse(raw).ok; } catch { return null; }
}

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
  const statusLabel = {
    done: '完成',
    interrupted: '已中断',
    error: '出错',
    working: '执行中'
  }[agentRun.status] || agentRun.status;
  header.innerHTML = `
    <span class="run-status ${escapeAttr(agentRun.status)}">${escapeHtml(statusLabel)}</span>
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
    agentState.todos = agentRun.todos.map(t => ({
      text: t.text,
      done: !!t.done,
      inProgress: !!t.inProgress
    }));
    agentState.todosFromTool = !!agentRun.todosFromTool;
    renderTodos();
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
  thinkEl.innerHTML = `<summary>${open ? '深度思考中…' : '深度思考'}</summary><div class="thinking-text"></div>`;
  thinkEl.querySelector('.thinking-text').textContent = content || '';
  return thinkEl;
}

function summarizeToolArgs(toolName, args) {
  if (!args || typeof args !== 'object') return '';
  if (args.path) return String(args.path);
  if (args.command) return String(args.command).slice(0, 80);
  if (args.query) return String(args.query);
  if (args.message) return String(args.message).slice(0, 60);
  const first = Object.values(args)[0];
  return first != null ? String(first).slice(0, 60) : '';
}

function buildToolStepElement(toolName, args, resultRaw = '', ok = null) {
  const step = document.createElement('details');
  step.className = 'tool-step';
  step.open = ok === false;
  step.dataset.tool = toolName;
  step.dataset.args = JSON.stringify(args || {});
  if (ok != null) step.dataset.ok = String(!!ok);

  let displayName = toolName;
  let icon = TOOL_ICONS[toolName] || '🔧';
  const mcpMatch = toolName.match(/^mcp__(.+)__(.+)$/);
  if (mcpMatch) {
    displayName = `MCP · ${mcpMatch[2]}`;
    icon = '🔌';
  }

  const parsedOk = ok != null ? ok : (resultRaw ? parseToolOutputOk(resultRaw) : null);
  const badge = parsedOk == null ? '' : (parsedOk ? '<span class="tc-badge ok">OK</span>' : '<span class="tc-badge fail">FAIL</span>');
  const preview = summarizeToolArgs(toolName, args);

  step.innerHTML = `
    <summary class="tc-header">
      ${badge}
      <span class="tc-icon">${icon}</span>
      <span class="tc-name">${escapeHtml(displayName)}</span>
      <span class="tc-preview">${escapeHtml(preview)}</span>
    </summary>
    <div class="tc-body"></div>
  `;

  const body = step.querySelector('.tc-body');
  const argLines = Object.entries(args || {}).map(([k, v]) =>
    `<div class="tc-arg-line"><span class="tc-arg-key">${escapeHtml(k)}</span><span class="tc-arg-val">${escapeHtml(String(v).slice(0, 500))}</span></div>`
  ).join('');
  if (argLines) {
    const argsEl = document.createElement('div');
    argsEl.className = 'tc-args-block';
    argsEl.innerHTML = argLines;
    body.appendChild(argsEl);
  }

  if (resultRaw) {
    const resultEl = document.createElement('div');
    resultEl.className = 'tc-result';
    const formatted = formatToolResultForUi(resultRaw);
    resultEl.innerHTML = `<pre class="tc-output">${escapeHtml(formatted)}</pre>`;
    body.appendChild(resultEl);
  }

  return step;
}

// --- Agentic loop ---
async function runAgentLoop(sessionMessages, assistantEl, runCtx = getForegroundRunCtx()) {
  const as = runCtx.agentState;
  const shouldAbort = () => runCtx.background ? runCtx.shouldAbort : state.shouldAbort;
  const ui = runCtx.ui && assistantEl;
  const cfg = state.config;
  const perm = await api.getPermissions();

  if (!perm.allowNetwork) {
    return makeLoopResult(`⚠️ **网络权限已关闭**，无法调用 AI 接口。\n\n请在「设置 → 权限」中开启「允许网络访问」。`, 'error', null, runCtx);
  }
  if (!cfg.api?.apiKey) {
    return makeLoopResult(`⚠️ **未配置 API Key**\n\n请在「设置 → API 配置」中填入你的 DeepSeek API Key。`, 'error', null, runCtx);
  }

  const systemPrompt = await buildSystemPrompt();
  await refreshMcpTools();

  let memoryContext = '';
  try {
    const mem = await api.getMemory();
    if (mem.facts && mem.facts.length > 0) {
      memoryContext = '\n\n## Long-term Memory (跨会话记忆)\n以下是关于用户和项目的长期记忆，请始终遵循：\n' +
        mem.facts.map(f => `- ${f.content}`).join('\n');
    }
  } catch {}

  const compressedMessages = await compressContextIfNeeded(sessionMessages);
  const apiMessages = [{ role: 'system', content: systemPrompt + memoryContext }];
  for (const m of compressedMessages) {
    if (m.role === 'assistant' && m.agentRun?.apiTrace?.length) {
      apiMessages.push(...m.agentRun.apiTrace);
      continue;
    }
    let content = m.content || '';
    if (m.role === 'user' && Array.isArray(m.attachments) && m.attachments.length) {
      const parts = [];
      for (const a of m.attachments) {
        try {
          const res = await api.readFile(a.path);
          if (res && res.error) parts.push(`【附件: ${a.name}】(无法读取: ${res.error})`);
          else if (res && res.isBinary) parts.push(`【附件: ${a.name}】(二进制文件，${res.size} 字节，未内联)`);
          else if (res && res.content != null) {
            const clipped = res.content.length > 8000 ? res.content.slice(0, 8000) + '\n...(内容过长已截断)...' : res.content;
            parts.push(`【附件: ${a.name}】\n\`\`\`\n${clipped}\n\`\`\``);
          }
        } catch {}
      }
      if (parts.length) content = (content ? content + '\n\n' : '') + parts.join('\n\n');
    }
    apiMessages.push({ role: m.role, content });
  }

  const run = startAgentRun(runCtx);
  run.runStartIndex = apiMessages.length;

  let iteration = 0;
  const maxIterations = 40;
  let fullContent = '';
  let finalStatus = 'done';

  as.todos = [];
  as.todosFromTool = false;
  as.iteration = 0;
  as.toolCallCount = 0;
  as.status = 'working';
  if (ui) {
    renderTodos(as);
    updateContextInfo(as);
  }

  const bodyEl = ui ? assistantEl.querySelector('.msg-body') : null;
  if (bodyEl) renderAgentRunHeader(bodyEl, { status: 'working', iteration: 0, toolCallCount: 0 });

  while (iteration < maxIterations) {
    if (shouldAbort()) {
      fullContent += (fullContent ? '\n\n' : '') + '⚠️ **任务已被用户中断**';
      finalStatus = 'interrupted';
      break;
    }
    iteration++;
    as.iteration = iteration;
    if (ui) {
      updateContextInfo(as);
      renderAgentRunHeader(bodyEl, { status: 'working', iteration, toolCallCount: as.toolCallCount });
    }

    const result = await callApiStream(apiMessages, assistantEl, runCtx);

    if (result.reasoning_content) {
      recordTimelineEvent({ type: 'thinking', content: result.reasoning_content }, runCtx);
    }
    if (result.content) {
      fullContent += (fullContent ? '\n\n' : '') + result.content;
      updateTodos(result.content, as, ui);
      recordTimelineEvent({ type: 'text', content: result.content }, runCtx);
    }

    if (shouldAbort()) {
      fullContent += (fullContent ? '\n\n' : '') + '⚠️ **任务已被用户中断**';
      finalStatus = 'interrupted';
      break;
    }

    if (!result.tool_calls || result.tool_calls.length === 0) {
      if (result.content || result.reasoning_content) {
        const finalTurn = { role: 'assistant', content: result.content || '' };
        if (result.reasoning_content) finalTurn.reasoning_content = result.reasoning_content;
        apiMessages.push(finalTurn);
      }
      as.status = 'done';
      if (!as.todosFromTool) as.todos.forEach(t => t.done = true);
      if (ui) {
        renderTodos(as);
        updateContextInfo(as);
      }
      return makeLoopResult(fullContent || result.content || '(无回复)', finalStatus, apiMessages, runCtx);
    }

    const assistantTurn = {
      role: 'assistant',
      content: result.content || '',
      tool_calls: result.tool_calls
    };
    if (result.reasoning_content) assistantTurn.reasoning_content = result.reasoning_content;
    apiMessages.push(assistantTurn);

    for (const toolCall of result.tool_calls) {
      if (shouldAbort()) break;
      const fnName = toolCall.function.name;
      let fnArgs = {};
      try { fnArgs = JSON.parse(toolCall.function.arguments || '{}'); } catch {}

      recordTimelineEvent({ type: 'tool_call', name: fnName, args: fnArgs }, runCtx);
      const toolOutput = await executeTool(fnName, fnArgs, runCtx);
      const toolOk = parseToolOutputOk(toolOutput);
      recordTimelineEvent({ type: 'tool_result', name: fnName, output: toolOutput, ok: toolOk }, runCtx);

      if (bodyEl) bodyEl.appendChild(buildToolStepElement(fnName, fnArgs, toolOutput, toolOk));

      as.toolCallCount++;
      if (ui) {
        updateContextInfo(as);
        renderAgentRunHeader(bodyEl, { status: 'working', iteration, toolCallCount: as.toolCallCount });
      }

      apiMessages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content: toolOutput
      });
    }

    if (shouldAbort()) {
      fullContent += (fullContent ? '\n\n' : '') + '⚠️ **任务已被用户中断**';
      finalStatus = 'interrupted';
      break;
    }
    if (ui) renderRightSidebarFiles();
  }

  as.status = 'done';
  if (ui) updateContextInfo(as);
  return makeLoopResult(fullContent || '⚠️ 达到最大迭代次数限制。', finalStatus, apiMessages, runCtx);
}

// --- SSE streaming API call with tool support ---
async function callApiStream(messages, assistantEl, runCtx = getForegroundRunCtx()) {
  const shouldAbort = () => runCtx.background ? runCtx.shouldAbort : state.shouldAbort;
  const { baseUrl, apiKey, model, thinking } = state.config.api;
  const url = `${baseUrl.replace(/\/$/, '')}/chat/completions`;

  const body = {
    model,
    messages,
    stream: true,
    tools: TOOLS,
    tool_choice: 'auto'
  };
  if (thinking) body.thinking = { type: 'enabled' };

  const abortController = new AbortController();
  if (runCtx.background) runCtx.abortController = abortController;
  else state.abortController = abortController;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`
    },
    body: JSON.stringify(body),
    signal: abortController.signal
  });

  if (!res.ok) {
    const t = await res.text();
    throw new Error(`HTTP ${res.status}: ${t.slice(0, 300)}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let content = '';
  let reasoning = '';
  let toolCalls = [];
  const bodyEl = assistantEl ? assistantEl.querySelector('.msg-body') : null;
  let roundEl = null;
  let thinkEl = null;
  let thinkTextEl = null;

  try {
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6).trim();
      if (data === '[DONE]') continue;

      try {
        const json = JSON.parse(data);
        const delta = json.choices?.[0]?.delta;
        if (!delta) continue;

        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          if (bodyEl) {
            if (!thinkEl) {
              thinkEl = document.createElement('details');
              thinkEl.className = 'thinking-block';
              thinkEl.open = true;
              thinkEl.innerHTML = '<summary>深度思考中…</summary><div class="thinking-text"></div>';
              bodyEl.appendChild(thinkEl);
              thinkTextEl = thinkEl.querySelector('.thinking-text');
            }
            thinkTextEl.textContent = reasoning;
            thinkTextEl.scrollTop = thinkTextEl.scrollHeight;
            scrollChatToBottom();
          }
        }

        if (delta.content) {
          content += delta.content;
          if (bodyEl) {
            if (thinkEl && thinkEl.open) {
              thinkEl.open = false;
              thinkEl.querySelector('summary').textContent = '深度思考';
            }
            if (!roundEl) {
              roundEl = document.createElement('div');
              roundEl.className = 'msg-round';
              bodyEl.appendChild(roundEl);
            }
            roundEl.innerHTML = renderMarkdown(content);
            scrollChatToBottom();
          }
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCalls[idx]) {
              toolCalls[idx] = { id: tc.id || '', type: 'function', function: { name: '', arguments: '' } };
            }
            if (tc.id) toolCalls[idx].id = tc.id;
            if (tc.function?.name) toolCalls[idx].function.name += tc.function.name;
            if (tc.function?.arguments) toolCalls[idx].function.arguments += tc.function.arguments;
          }
        }
      } catch (e) { /* skip parse errors */ }
    }
  }
  } catch (e) {
    if (!(e && e.name === 'AbortError') && !shouldAbort()) throw e;
  }

  if (thinkEl && thinkEl.open) {
    thinkEl.open = false;
    thinkEl.querySelector('summary').textContent = '深度思考';
  }

  const filteredToolCalls = toolCalls.filter(tc => tc.function.name);
  return {
    content: content || '',
    reasoning_content: reasoning || undefined,
    tool_calls: filteredToolCalls.length > 0 ? filteredToolCalls : null
  };
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

function updateContextInfo(as = agentState) {
  const m = state.config.api.model;
  const modelName = (state.config.models || []).find(x => x.id === m)?.name || m;
  const el = id => $('#' + id);
  if (el('ctxModel')) el('ctxModel').textContent = modelName;
  if (el('ctxIteration')) el('ctxIteration').textContent = as.iteration;
  if (el('ctxToolCalls')) el('ctxToolCalls').textContent = as.toolCallCount;
  if (el('ctxMsgCount')) el('ctxMsgCount').textContent = state.currentSession?.messages?.length || 0;
  if (el('ctxStatus')) el('ctxStatus').textContent = { idle: '空闲', working: '执行中', done: '完成', error: '错误' }[as.status] || as.status;
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

function updateTodos(content, as = agentState, ui = true) {
  if (as.todosFromTool) return;
  const newTodos = parseTodos(content);
  if (newTodos.length > 0) {
    as.todos = newTodos;
    if (ui) renderTodos(as);
  }
}

function renderTodos(as = agentState) {
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

async function populateSettings() {
  const cfg = await api.getConfig();
  const perm = await api.getPermissions();
  const ws = await api.getWorkspace();

  $('#cfgBaseUrl').value = cfg.api.baseUrl;
  $('#cfgApiKey').value = cfg.api.apiKey;
  $('#wsPath').value = ws;

  $('#permRead').checked = perm.allowFileRead;
  $('#permWrite').checked = perm.allowFileWrite;
  $('#permShell').checked = perm.allowShell;
  $('#permNet').checked = perm.allowNetwork;

  renderModelGrid(cfg);
  await renderWsTree(ws);
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
  const slots = MAX_BACKGROUND_RUNS - state.backgroundRuns.size;
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
  if (state.backgroundRuns.size >= MAX_BACKGROUND_RUNS) return { ok: false, error: 'busy' };

  state.automationRuns.add(auto.id);
  try {
    await api.autoUpdate(auto.id, { lastRun: Date.now(), lastStatus: 'running' });

    const s = await api.createSession();
    const title = `[自动] ${auto.name}`;
    s.title = title;
    await api.renameSession(s.id, title);
    await refreshSessions();

    const res = await submitMessageBackground(s, auto.prompt);

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
  // Base URL 固定为 DeepSeek（主进程会强制覆盖），此处只保存 API Key
  const partial = {
    api: {
      apiKey: $('#cfgApiKey').value.trim()
    }
  };
  state.config = await api.setConfig(partial);
  renderModelBadge();
  toast('API 配置已保存');
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

async function agentOpenBuiltinBrowser(urlOrPath) {
  const panel = $('#browserPanel');
  if (!panel) return { ok: false, error: '内置浏览器面板不可用' };
  const url = await resolveBrowserUrl(urlOrPath);
  if (!url) return { ok: false, error: '请提供 URL 或文件路径' };
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

/* Yan Agent — read-only agent output renderer (shared with desktop styles) */
(function (global) {
  'use strict';

  const SUBAGENT_LABELS = {
    explore: 'Explore',
    shell: 'Shell',
    review: 'Review',
    edit: 'Edit',
    ui: 'UI',
    doc: 'Doc',
  };

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
    scan_project: { label: '扫描项目', icon: 'scan' },
    trace_symbol: { label: '追踪符号', icon: 'search' },
    execute_shell: { label: '执行命令', icon: 'terminal' },
    todo_write: { label: '更新计划', icon: 'list' },
    spawn_subagent: { label: '子 Agent', icon: 'agent' },
    spawn_subagents: { label: '并行子 Agent', icon: 'agent' },
    generate_image: { label: '生成图片', icon: 'image' },
    open_builtin_browser: { label: '打开预览', icon: 'browser' },
    git_status: { label: 'Git 状态', icon: 'git' },
    git_diff: { label: 'Git 差异', icon: 'git' },
    git_log: { label: 'Git 日志', icon: 'git' },
    git_commit: { label: 'Git 提交', icon: 'git' },
    git_push: { label: 'Git 推送', icon: 'git' },
    git_pull: { label: 'Git 拉取', icon: 'git' },
    git_clone: { label: 'Git 克隆', icon: 'git' },
    git_branch: { label: 'Git 分支', icon: 'git' },
  };

  const TOOL_ICON_SVG = {
    file: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
    write: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>',
    edit: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>',
    folder: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
    search: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>',
    link: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>',
    index: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    scan: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 7V5a2 2 0 0 1 2-2h2"/><path d="M17 3h2a2 2 0 0 1 2 2v2"/><path d="M21 17v2a2 2 0 0 1-2 2h-2"/><path d="M7 21H5a2 2 0 0 1-2-2v-2"/></svg>',
    terminal: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/></svg>',
    list: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>',
    agent: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/></svg>',
    browser: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"/></svg>',
    image: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="m21 15-5-5L5 21"/></svg>',
    git: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v2a3 3 0 0 0 3 3h6a3 3 0 0 0 3-3V9"/></svg>',
    tool: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg>',
    mcp: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/></svg>',
  };

  function escapeHtml(s) {
    return String(s ?? '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  function escapeAttr(s) { return escapeHtml(s); }

  function renderMarkdownTables(t) {
    const lines = t.split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const header = lines[i];
      const sep = lines[i + 1];
      const isSep = sep != null && sep.includes('|') &&
        /-/.test(sep) && sep.replace(/[^|:\-\s]/g, '') === sep;
      if (header && header.includes('|') && isSep) {
        const parseRow = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        const headers = parseRow(header);
        const rows = [];
        let j = i + 2;
        while (j < lines.length && lines[j].includes('|') && lines[j].trim() !== '') {
          rows.push(parseRow(lines[j]));
          j++;
        }
        let html = '<table><thead><tr>' + headers.map((h) => `<th>${h}</th>`).join('') + '</tr></thead><tbody>';
        html += rows.map((r) => '<tr>' + r.map((c) => `<td>${c}</td>`).join('') + '</tr>').join('');
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
    const codeBlocks = [];
    let t = String(text).replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, code) => {
      codeBlocks.push(code.replace(/\n$/, ''));
      return `\u0000CODE${codeBlocks.length - 1}\u0000`;
    });
    t = escapeHtml(t);
    t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
    t = t.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    t = t.replace(/(?<!\w)\*([^*]+)\*(?!\w)/g, '<em>$1</em>');
    t = t.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
    t = t.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
    t = t.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
    t = renderMarkdownTables(t);
    t = t.replace(/^\s*\d+[.)]\s+(.*)$/gm, '\u0001$1\u0002');
    t = t.replace(/(\u0001[\s\S]*?\u0002(?:\s*\u0001[\s\S]*?\u0002)*)/g,
      (m) => '<ol>' + m.replace(/\u0001/g, '<li>').replace(/\u0002/g, '</li>').replace(/\s+/g, ' ') + '</ol>');
    t = t.replace(/^(?:- |\* )(.*)$/gm, '<li>$1</li>');
    t = t.replace(/(<li>[\s\S]*?<\/li>(?:\s*<li>[\s\S]*?<\/li>)*)/g, '<ul>$1</ul>');
    t = t.split(/\n{2,}/).map((block) => {
      const b = block.trim();
      if (!b) return '';
      if (/^<(h\d|ul|ol|pre|li|table|blockquote)/.test(b)) return block;
      if (/^\u0000CODE\d+\u0000$/.test(b)) return block;
      return '<p>' + block.replace(/\n/g, '<br>') + '</p>';
    }).join('\n');
    t = t.replace(/\u0000CODE(\d+)\u0000/g, (_, i) =>
      `<pre><code>${escapeHtml(codeBlocks[Number(i)])}</code></pre>`);
    return t;
  }

  function parseToolOutputOk(raw) {
    try { return !!JSON.parse(raw).ok; } catch { return null; }
  }

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

  function resolveToolUi(toolName) {
    const mcpMatch = toolName.match(/^mcp__(.+)__(.+)$/);
    if (mcpMatch) {
      return { label: 'MCP · ' + mcpMatch[2], icon: TOOL_ICON_SVG.mcp };
    }
    if (toolName === 'spawn_subagent' || toolName === 'spawn_subagents') return null;
    const ui = TOOL_UI[toolName];
    if (ui) return { label: ui.label, icon: TOOL_ICON_SVG[ui.icon] || TOOL_ICON_SVG.tool };
    return { label: toolName, icon: TOOL_ICON_SVG.tool };
  }

  function summarizeToolArgs(toolName, args) {
    if (!args || typeof args !== 'object') return '';
    if (toolName === 'spawn_subagent' && args.type) {
      const tag = SUBAGENT_LABELS[args.type] || args.type;
      const task = String(args.task || '').slice(0, 56);
      return task ? `${tag} · ${task}` : tag;
    }
    if (toolName === 'spawn_subagents' && Array.isArray(args.agents)) {
      const types = args.agents.map((a) => a.type || 'explore').join('+');
      return `并行 ×${args.agents.length} (${types})`;
    }
    if (args.path) return String(args.path);
    if (args.command) return String(args.command).slice(0, 80);
    if (args.query) return String(args.query);
    if (args.message) return String(args.message).slice(0, 60);
    const first = Object.values(args)[0];
    return first != null ? String(first).slice(0, 60) : '';
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

  function buildGeneratedImageElement(resultRaw) {
    let result;
    try { result = JSON.parse(resultRaw); } catch { return null; }
    const assetId = String(result?.meta?.generatedImageId || '');
    if (!/^[a-f0-9]{32}$/.test(assetId)) return null;
    const password = sessionStorage.getItem('yan_remote_password') || '';
    const src = `/api/generated-images/${assetId}?password=${encodeURIComponent(password)}`;
    const figure = document.createElement('figure');
    figure.className = 'remote-generated-image';
    figure.dataset.assetId = assetId;
    const link = document.createElement('a');
    link.href = src;
    link.target = '_blank';
    link.rel = 'noopener';
    link.setAttribute('aria-label', '打开生成图片原图');
    const image = document.createElement('img');
    image.src = src;
    image.alt = result?.meta?.name || 'Agent 生成的图片';
    image.loading = 'lazy';
    image.draggable = false;
    image.addEventListener('error', () => {
      figure.classList.add('is-unavailable');
      figure.textContent = '会话图片已失效';
    }, { once: true });
    link.appendChild(image);
    figure.appendChild(link);
    return figure;
  }

  function buildUserImageAttachments(attachments) {
    const images = (Array.isArray(attachments) ? attachments : []).filter(attachment => (
      /^[a-f0-9]{32}$/.test(String(attachment?.uploadId || '')) || /^blob:/i.test(String(attachment?.previewUrl || ''))
    ));
    if (!images.length) return null;
    const password = sessionStorage.getItem('yan_remote_password') || '';
    const container = document.createElement('div');
    container.className = 'remote-user-images';
    for (const attachment of images) {
      const uploadId = String(attachment.uploadId || '');
      const src = attachment.previewUrl
        || `/api/uploaded-images/${uploadId}?password=${encodeURIComponent(password)}`;
      const link = document.createElement('a');
      link.href = src;
      link.target = '_blank';
      link.rel = 'noopener';
      const image = document.createElement('img');
      image.src = src;
      image.alt = attachment.name || '用户上传的图片';
      image.loading = 'lazy';
      image.draggable = false;
      link.appendChild(image);
      container.appendChild(link);
    }
    return container;
  }

  function buildToolStepElement(toolName, args, resultRaw = '', ok = null) {
    const isSubagentSpawn = toolName === 'spawn_subagent' || toolName === 'spawn_subagents';
    const step = document.createElement('details');
    step.className = 'tool-step main-agent-step';
    if (isSubagentSpawn) {
      step.classList.add('subagent-step', 'delegation-step');
      if (toolName === 'spawn_subagents') step.classList.add('subagent-parallel');
    }
    step.open = ok === false || isSubagentSpawn;
    step.dataset.tool = toolName;
    step.dataset.args = JSON.stringify(args || {});
    if (ok != null) step.dataset.ok = String(!!ok);

    let displayName;
    let iconSvg;
    let laneBadge = '<span class="lane-badge main">主 Agent</span>';
    if (toolName === 'spawn_subagent' && args?.type) {
      displayName = `委派 · ${SUBAGENT_LABELS[args.type] || args.type}`;
      iconSvg = TOOL_ICON_SVG.agent;
      laneBadge = '<span class="lane-badge sub">子 Agent</span>';
    } else if (toolName === 'spawn_subagents') {
      const n = Array.isArray(args?.agents) ? args.agents.length : 0;
      displayName = `委派 · 并行子 Agent${n ? ` ×${n}` : ''}`;
      iconSvg = TOOL_ICON_SVG.agent;
      laneBadge = '<span class="lane-badge sub">子 Agent</span>';
    } else {
      const ui = resolveToolUi(toolName);
      displayName = ui.label;
      iconSvg = ui.icon;
    }

    const parsedOk = ok != null ? ok : (resultRaw ? parseToolOutputOk(resultRaw) : null);
    let badge = '';
    if (parsedOk != null) {
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
      <div class="tc-body"></div>`;

    const body = step.querySelector('.tc-body');
    if (args && Object.keys(args).length) {
      const argLines = Object.entries(args).map(([k, v]) =>
        `<div class="tc-arg-line"><span class="tc-arg-key">${escapeHtml(k)}</span><span class="tc-arg-val">${escapeHtml(String(v).slice(0, 500))}</span></div>`
      ).join('');
      const argsEl = document.createElement('div');
      argsEl.className = 'tc-args-block';
      argsEl.innerHTML = argLines;
      body.appendChild(argsEl);
    }
    if (resultRaw) {
      const resultEl = document.createElement('div');
      resultEl.className = 'tc-result';
      resultEl.innerHTML = `<pre class="tc-output">${escapeHtml(formatToolResultForUi(resultRaw))}</pre>`;
      body.appendChild(resultEl);
    }
    return step;
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
        ${files.map((file) => {
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

  function buildAgentErrorElement(errorMessage) {
    const errorEl = document.createElement('div');
    errorEl.className = 'msg-error';
    errorEl.innerHTML = renderMarkdown(`⚠️ **出错了**\n\n${errorMessage}`);
    return errorEl;
  }

  function ensureAgentActivity(bodyEl) {
    let activity = Array.from(bodyEl.children).find((child) => child.classList?.contains('agent-run-header'));
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
    const status = agentRun.status || 'working';
    header.className = 'agent-run-header status-' + status;
    header.dataset.status = status;
    const statusLabel = {
      done: '已完成工作',
      interrupted: '已中断',
      error: '出错',
      working: '正在工作',
    }[status] || status;
    const pulse = status === 'working' ? '<span class="run-pulse" aria-hidden="true"></span>' : '';
    const stepCount = Number(agentRun.toolCallCount) || 0;
    const changeCount = Number(agentRun.changeCount) || 0;
    const meta = [
      stepCount ? `${stepCount} 个步骤` : '',
      changeCount ? `${changeCount} 处文件改动` : '',
    ].filter(Boolean).join(' · ');
    summary.innerHTML = `
      ${pulse}
      <span class="run-status ${escapeAttr(status)}">${escapeHtml(statusLabel)}</span>
      ${meta ? `<span class="run-meta">${escapeHtml(meta)}</span>` : ''}
      <span class="run-chevron" aria-hidden="true">›</span>`;
    const hasActivity = !!activityBody?.children.length;
    header.hidden = status === 'done' && !hasActivity && stepCount === 0;
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
        else if (item.type === 'tool_call') {
          const next = timeline[i + 1];
          const output = next?.type === 'tool_result' ? next.output : '';
          const ok = next?.type === 'tool_result' ? next.ok : null;
          activityBody?.appendChild(buildToolStepElement(item.name, item.args, output, ok));
        }
      }
    } else if (fallbackContent) {
      bodyEl.appendChild(buildTextRoundElement(fallbackContent));
    }
    for (const item of timeline) {
      if (item.type !== 'tool_result' || !item.ok) continue;
      const image = buildGeneratedImageElement(item.output);
      if (image && !bodyEl.querySelector(`[data-asset-id="${image.dataset.assetId}"]`)) bodyEl.appendChild(image);
    }
    if (agentRun.error) bodyEl.appendChild(buildAgentErrorElement(agentRun.error));
    const summary = buildRunChangeSummaryElement(agentRun);
    if (summary) bodyEl.appendChild(summary);
    renderAgentRunHeader(bodyEl, agentRun);
  }

  function buildMessageNode(msg) {
    const wrap = document.createElement('div');
    wrap.className = 'msg ' + (msg.role === 'user' ? 'user' : 'assistant');
    const body = document.createElement('div');
    body.className = 'msg-body' + (msg.role === 'assistant' ? ' agent-output' : '');
    if (msg.role === 'user') {
      body.textContent = msg.content || msg.text || '';
      const attachments = buildUserImageAttachments(msg.attachments);
      if (attachments) body.appendChild(attachments);
    } else if (msg.agentRun) {
      renderAgentRunBody(body, msg.agentRun, msg.content || '');
    } else {
      body.innerHTML = renderMarkdown(msg.content || '');
    }
    wrap.appendChild(body);
    return wrap;
  }

  global.YanRemoteOutput = { buildMessageNode, renderAgentRunBody, renderMarkdown };
})(typeof window !== 'undefined' ? window : globalThis);

/* Yan Agent — read-only agent output renderer (shared with desktop styles) */
(function (global) {
  'use strict';

  const elementRenderState = new WeakMap();

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
    generate_image: { label: '生成图片', icon: 'image' },
    generate_video: { label: '生成视频', icon: 'image' },
    read_image: { label: '读取图片', icon: 'image' },
    find_skills: { label: '查找 Skill', icon: 'search' },
    install_skill: { label: '安装 Skill', icon: 'tool' },
    list_installed_skills: { label: '列出 Skill', icon: 'list' },
    read_skill: { label: '调用 Skill', icon: 'file' },
    remove_skill: { label: '删除 Skill', icon: 'edit' },
    open_builtin_browser: { label: '打开预览', icon: 'browser' },
    browser_snapshot: { label: '读取网页结构', icon: 'browser' },
    browser_read_page: { label: '读取网页', icon: 'browser' },
    browser_click: { label: '点击网页', icon: 'browser' },
    browser_type: { label: '填写网页', icon: 'browser' },
    browser_press: { label: '操作网页', icon: 'browser' },
    browser_scroll: { label: '滚动网页', icon: 'browser' },
    browser_wait: { label: '等待网页', icon: 'browser' },
    browser_screenshot: { label: '检查网页画面', icon: 'browser' },
    browser_history: { label: '网页导航', icon: 'browser' },
    browser_status: { label: '检查浏览器', icon: 'browser' },
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

  async function copyMarkdownCode(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch {}
    }
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Clipboard write failed');
  }

  const MARKDOWN_CODE_COPY_ICONS = {
    idle: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>',
    loading: '<span class="md-code-copy-spinner" aria-hidden="true"></span>',
    success: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>',
    error: '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v6"/><path d="M12 17h.01"/></svg>'
  };

  function setMarkdownCodeCopyState(button, state) {
    const labels = {
      idle: '复制整段代码',
      loading: '正在复制整段代码',
      success: '代码已复制',
      error: '代码复制失败'
    };
    button.dataset.state = state;
    button.innerHTML = MARKDOWN_CODE_COPY_ICONS[state] || MARKDOWN_CODE_COPY_ICONS.idle;
    button.setAttribute('aria-label', labels[state] || labels.idle);
    button.title = labels[state] || labels.idle;
  }

  document.addEventListener('click', async (event) => {
    const button = event.target.closest('.md-code-copy');
    if (!button || button.disabled) return;
    const code = button.closest('.md-code-block')?.querySelector('code');
    if (!code) return;
    button.disabled = true;
    setMarkdownCodeCopyState(button, 'loading');
    try {
      await copyMarkdownCode(code.textContent || '');
      setMarkdownCodeCopyState(button, 'success');
    } catch {
      setMarkdownCodeCopyState(button, 'error');
    }
    setTimeout(() => {
      if (!button.isConnected) return;
      button.disabled = false;
      setMarkdownCodeCopyState(button, 'idle');
    }, 1400);
  });

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
      `<div class="md-code-block"><button type="button" class="md-code-copy" data-state="idle" aria-label="复制整段代码" aria-live="polite" title="复制整段代码">${MARKDOWN_CODE_COPY_ICONS.idle}</button><pre><code>${escapeHtml(codeBlocks[Number(i)])}</code></pre></div>`);
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
      if ((mcpMatch[1] === 'yan_skills' || mcpMatch[1] === 'yan_media' || mcpMatch[1] === 'yan_browser') && TOOL_UI[mcpMatch[2]]) {
        const ui = TOOL_UI[mcpMatch[2]];
        return { label: ui.label, icon: TOOL_ICON_SVG[ui.icon] || TOOL_ICON_SVG.mcp };
      }
      return { label: 'MCP · ' + mcpMatch[2], icon: TOOL_ICON_SVG.mcp };
    }
    const ui = TOOL_UI[toolName];
    if (ui) return { label: ui.label, icon: TOOL_ICON_SVG[ui.icon] || TOOL_ICON_SVG.tool };
    return { label: toolName, icon: TOOL_ICON_SVG.tool };
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

  function buildTextRoundElement(content) {
    const roundEl = document.createElement('div');
    roundEl.className = 'msg-round';
    roundEl.innerHTML = renderMarkdown(content || '');
    return roundEl;
  }

  function buildWorkNarrationElement(content) {
    const narration = buildTextRoundElement(content);
    narration.classList.add('agent-work-narration');
    return narration;
  }

  function buildProgressNoteElement(content) {
    const note = document.createElement('div');
    note.className = 'agent-progress-note';
    note.textContent = String(content || '');
    return note;
  }

  function buildThinkingElement(content, open = false) {
    const thinkEl = document.createElement('details');
    thinkEl.className = 'thinking-block';
    thinkEl.open = open;
    const label = open ? '思考中…' : '思考过程';
    thinkEl.innerHTML = `<summary><span class="think-icon" aria-hidden="true"></span><span class="thinking-label">${label}</span></summary><div class="thinking-text"></div>`;
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

  function buildToolStepElement(toolName, args, resultRaw = '', ok = null, phase = 'done') {
    const step = document.createElement('details');
    step.className = 'tool-step';
    if (phase === 'running') step.classList.add('is-running');
    if (phase === 'interrupted') step.classList.add('is-interrupted');
    step.open = ok === false;
    step.dataset.tool = toolName;
    step.dataset.args = JSON.stringify(args || {});
    if (ok != null) step.dataset.ok = String(!!ok);

    let displayName;
    let iconSvg;
    const ui = resolveToolUi(toolName);
    displayName = ui.label;
    iconSvg = ui.icon;

    const parsedOk = phase === 'running' || phase === 'interrupted'
      ? null
      : (ok != null ? ok : (resultRaw ? parseToolOutputOk(resultRaw) : null));
    let badge = '';
    if (phase === 'running') {
      badge = '<span class="tc-badge running" aria-label="运行中"></span>';
    } else if (phase === 'interrupted') {
      badge = '<span class="tc-badge interrupted" aria-label="已中断">—</span>';
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
      <div class="tc-body"></div>`;

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

  function formatHandledDuration(ms) {
    const totalSeconds = Math.max(0, Math.floor((Number(ms) || 0) / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const parts = [];
    if (hours) parts.push(`${hours}小时`);
    if (minutes || hours) parts.push(`${minutes}分`);
    parts.push(`${seconds}秒`);
    return parts.join(' ');
  }

  function formatCompactTokenCount(value) {
    const count = Math.max(0, Number(value) || 0);
    if (count >= 1_000_000) return `${Math.round(count / 10_000) / 100}M`;
    if (count >= 1_000) return `${Math.round(count / 100) / 10}K`;
    return String(Math.round(count));
  }

  function getAgentRunCacheStats(agentRun) {
    const usage = agentRun?.usage;
    if (!usage || typeof usage !== 'object') return null;
    const input = Math.max(0, Number(usage.input) || 0);
    const cacheRead = Math.max(0, Number(usage.cacheRead) || 0);
    const cacheWrite = Math.max(0, Number(usage.cacheWrite) || 0);
    const promptTokens = input + cacheRead + cacheWrite;
    if (promptTokens <= 0) return null;
    return {
      cacheRead,
      promptTokens,
      rate: Math.min(1, cacheRead / promptTokens),
    };
  }

  function formatCacheHitRate(rate) {
    const percentage = Math.max(0, Math.min(100, (Number(rate) || 0) * 100));
    const rounded = Math.round(percentage * 10) / 10;
    return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
  }

  function syncWorkVisibility(header) {
    const toggle = header?.querySelector('.agent-work-toggle');
    const canToggle = !!toggle && !toggle.hidden && !toggle.disabled;
    const expanded = canToggle && header.dataset.workExpanded === 'true';
    header?.classList.toggle('agent-work-collapsed', canToggle && !expanded);
    if (!toggle) return;
    toggle.textContent = expanded ? '隐藏工作过程' : '查看工作过程';
    toggle.setAttribute('aria-expanded', String(expanded));
  }

  function bindWorkToggle(activity) {
    if (!activity || activity.dataset.workToggleBound === 'true') return;
    activity.dataset.workToggleBound = 'true';
    activity.addEventListener('click', (event) => {
      const toggle = event.target.closest('.agent-work-toggle');
      if (!toggle || !activity.contains(toggle) || toggle.disabled) return;
      activity.dataset.workToggleTouched = 'true';
      activity.dataset.workExpanded = activity.dataset.workExpanded === 'true' ? 'false' : 'true';
      syncWorkVisibility(activity);
    });
  }

  function ensureAgentActivity(bodyEl) {
    let activity = Array.from(bodyEl.children).find((child) => child.classList?.contains('agent-run-header'));
    if (activity?.tagName === 'DETAILS') {
      const replacement = document.createElement('div');
      replacement.className = activity.className;
      const existingBody = activity.querySelector('.agent-activity-body');
      replacement.innerHTML = '<div class="agent-run-summary" role="status"></div>';
      replacement.appendChild(existingBody || document.createElement('div'));
      replacement.lastElementChild.classList.add('agent-activity-body');
      activity.replaceWith(replacement);
      activity = replacement;
    }
    if (activity) {
      if (!activity.dataset.workExpanded) activity.dataset.workExpanded = 'false';
      bindWorkToggle(activity);
      return activity;
    }
    activity = document.createElement('div');
    activity.className = 'agent-run-header status-working';
    activity.dataset.workExpanded = 'false';
    activity.innerHTML = '<div class="agent-run-summary" role="status"></div><div class="agent-activity-body"></div>';
    bindWorkToggle(activity);
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
    const summaryStarted = !!agentRun.summaryStarted;
    const previousSummaryStarted = header.dataset.summaryStarted === 'true';
    header.dataset.summaryStarted = String(summaryStarted);
    if (summaryStarted && !previousSummaryStarted && header.dataset.workToggleTouched !== 'true') {
      header.dataset.workExpanded = 'false';
    }
    const hasWork = !!activityBody?.querySelector('[data-agent-stage="work"]');
    const canToggle = summaryStarted && hasWork && status !== 'error' && status !== 'interrupted';
    const terminalLabel = status === 'error' ? '运行失败' : (status === 'interrupted' ? '已暂停' : '');
    const cacheStats = status === 'working' ? null : getAgentRunCacheStats(agentRun);
    const cacheRate = cacheStats ? formatCacheHitRate(cacheStats.rate) : '';
    const cacheLevel = cacheStats?.rate >= 0.8 ? 'is-high' : (cacheStats?.rate > 0 ? 'is-active' : 'is-cold');
    const cacheTitle = cacheStats
      ? `本轮缓存读取 ${formatCompactTokenCount(cacheStats.cacheRead)} / 输入总量 ${formatCompactTokenCount(cacheStats.promptTokens)} tokens`
      : '';
    const startedAt = Number(agentRun.startedAt) || Date.parse(String(agentRun.startedAt || '')) || Date.now();
    const elapsedMs = status === 'working'
      ? Math.max(0, Date.now() - startedAt)
      : Math.max(0, Number(agentRun.durationMs) || 0);
    const elapsed = formatHandledDuration(elapsedMs);
    const signature = [status, canToggle, terminalLabel, cacheStats?.cacheRead || 0, cacheStats?.promptTokens || 0].join('|');
    if (elementRenderState.get(summary)?.signature !== signature) {
      const expanded = header.dataset.workExpanded === 'true';
      summary.innerHTML = `
        <span class="run-status">已处理 <span class="run-elapsed">${escapeHtml(elapsed)}</span></span>
        ${cacheStats ? `<span class="run-divider" aria-hidden="true">·</span><span class="run-cache-hit ${cacheLevel}" title="${escapeAttr(cacheTitle)}">缓存命中 <span class="run-cache-rate">${escapeHtml(cacheRate)}</span></span>` : ''}
        ${canToggle ? `<span class="run-divider" aria-hidden="true">·</span><button type="button" class="agent-work-toggle" aria-expanded="${expanded}">${expanded ? '隐藏工作过程' : '查看工作过程'}</button>` : ''}
        ${terminalLabel ? `<span class="run-terminal ${escapeAttr(status)}">· ${escapeHtml(terminalLabel)}</span>` : ''}`;
      elementRenderState.set(summary, { signature });
    }
    header.hidden = false;
    syncWorkVisibility(header);
  }

  function getTimelinePartKey(item, index) {
    const explicitKey = String(item?.openCodeKey || item?.id || '').trim();
    if (explicitKey) return explicitKey;
    if (item?.type === 'tool_call' && item.callId) return `tool-call:${item.callId}`;
    return `${item?.type || 'part'}:${index}`;
  }

  function findToolResult(timeline, toolCall, index, claimedResults) {
    if (toolCall.callId) {
      const result = timeline.find((item) => item.type === 'tool_result' && item.callId === toolCall.callId);
      if (result) claimedResults.add(result);
      return result;
    }
    for (let i = index + 1; i < timeline.length; i++) {
      const candidate = timeline[i];
      if (candidate.type !== 'tool_result' || claimedResults.has(candidate)) continue;
      if (!candidate.name || candidate.name === toolCall.name) {
        claimedResults.add(candidate);
        return candidate;
      }
    }
    return null;
  }

  function getPartSignature(value) {
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  function updateTimelinePartElement(element, item, result, phase) {
    const previous = elementRenderState.get(element) || {};
    if (item.type === 'text') {
      const content = String(item.content || '');
      if (previous.content !== content) element.innerHTML = renderMarkdown(content);
      const streaming = !!item.streaming;
      element.classList.toggle('streaming', streaming);
      let cursor = element.querySelector(':scope > .stream-cursor');
      if (streaming && !cursor) {
        cursor = document.createElement('span');
        cursor.className = 'stream-cursor';
        cursor.setAttribute('aria-hidden', 'true');
        element.appendChild(cursor);
      } else if (!streaming) {
        cursor?.remove();
      }
      elementRenderState.set(element, { content, streaming });
      return;
    }
    if (item.type === 'thinking') {
      const content = String(item.content || '');
      const streaming = !!item.streaming;
      const text = element.querySelector('.thinking-text');
      if (text && previous.content !== content) text.textContent = content;
      const label = element.querySelector('.thinking-label');
      if (label) label.textContent = streaming ? '思考中…' : '思考过程';
      element.classList.toggle('streaming', streaming);
      if (streaming && !previous.streaming) element.open = true;
      if (!streaming && previous.streaming) element.open = false;
      elementRenderState.set(element, { content, streaming });
      return;
    }
    if (item.type === 'progress') {
      const content = String(item.content || '');
      if (previous.content !== content) element.textContent = content;
      elementRenderState.set(element, { content });
      return;
    }
    if (item.type === 'tool_call') {
      const resultRaw = String(result?.output || '');
      const signature = getPartSignature({ name: item.name, args: item.args, resultRaw, ok: result?.ok, phase });
      if (previous.signature === signature) return;
      const wasOpen = element.open;
      const next = buildToolStepElement(item.name, item.args, resultRaw, result ? result.ok : null, phase);
      element.className = next.className;
      element.dataset.tool = next.dataset.tool || '';
      element.dataset.args = next.dataset.args || '{}';
      if (next.dataset.ok != null) element.dataset.ok = next.dataset.ok;
      else delete element.dataset.ok;
      if (item.callId) element.dataset.callId = String(item.callId);
      else delete element.dataset.callId;
      element.replaceChildren(...Array.from(next.children));
      element.open = wasOpen || next.open;
      elementRenderState.set(element, { signature });
    }
  }

  function createTimelinePartElement(item) {
    if (item.type === 'thinking') return buildThinkingElement('', false);
    if (item.type === 'text') return buildWorkNarrationElement('');
    if (item.type === 'progress') return buildProgressNoteElement('');
    if (item.type === 'tool_call') return document.createElement('details');
    return null;
  }

  function syncTimelineParts(activityBody, timeline, status, fallbackContent, summaryStarted = false) {
    const sourceParts = timeline.map((item, index) => ({ item, index }));
    const hasNarration = timeline.some((item) => item.type === 'text' && String(item.content || '').trim());
    if (fallbackContent && !hasNarration) {
      sourceParts.push({
        item: {
          type: 'text',
          stage: summaryStarted ? 'summary' : 'work',
          content: fallbackContent,
          streaming: status === 'working',
          openCodeKey: 'fallback:text',
        },
        index: timeline.length,
      });
    }
    const existing = new Map(Array.from(activityBody.children)
      .filter((element) => element.dataset?.agentPartKey)
      .map((element) => [element.dataset.agentPartKey, element]));
    const claimedResults = new Set();
    const keyCounts = new Map();
    const desired = [];
    const desiredKeys = new Set();
    for (const { item, index } of sourceParts) {
      if (!item || item.type === 'tool_result') continue;
      const baseKey = getTimelinePartKey(item, index);
      const occurrence = keyCounts.get(baseKey) || 0;
      keyCounts.set(baseKey, occurrence + 1);
      const key = occurrence ? `${baseKey}#${occurrence}` : baseKey;
      let element = existing.get(key);
      if (element && element.dataset.agentPartType !== item.type) {
        element.remove();
        element = null;
      }
      if (!element) element = createTimelinePartElement(item);
      if (!element) continue;
      element.dataset.agentPartKey = key;
      element.dataset.agentPartType = item.type;
      element.dataset.agentStage = item.stage === 'summary' ? 'summary' : 'work';
      if (item.type === 'text') {
        element.classList.toggle('agent-work-narration', element.dataset.agentStage === 'work');
        element.classList.toggle('agent-summary-output', element.dataset.agentStage === 'summary');
      }
      const result = item.type === 'tool_call'
        ? findToolResult(timeline, item, index, claimedResults)
        : null;
      const phase = item.type === 'tool_call'
        ? (result?.interrupted ? 'interrupted' : (!result && status === 'working' ? 'running' : 'done'))
        : (status === 'working' ? 'running' : 'done');
      updateTimelinePartElement(element, item, result, phase);
      desired.push(element);
      desiredKeys.add(key);
    }
    for (const element of Array.from(activityBody.children)) {
      if (element.dataset?.agentPartKey && !desiredKeys.has(element.dataset.agentPartKey)) element.remove();
    }
    let reference = activityBody.firstElementChild;
    for (const element of desired) {
      if (element !== reference) activityBody.insertBefore(element, reference);
      reference = element.nextElementSibling;
    }
  }

  function renderAgentRunBody(bodyEl, agentRun, fallbackContent = '') {
    if (!bodyEl) return;
    if (bodyEl.dataset.agentOutputInitialized !== 'true') {
      bodyEl.replaceChildren();
      bodyEl.dataset.agentOutputInitialized = 'true';
    }
    const header = ensureAgentActivity(bodyEl);
    const activityBody = getAgentActivityBody(bodyEl);
    const timeline = Array.isArray(agentRun.timeline) ? agentRun.timeline : [];
    syncTimelineParts(
      activityBody,
      timeline,
      agentRun.status || 'working',
      String(fallbackContent || agentRun.textContent || ''),
      !!agentRun.summaryStarted
    );
    bodyEl.querySelector(':scope > .agent-final-output')?.remove();
    for (const item of timeline) {
      if (item.type !== 'tool_result' || !item.ok) continue;
      const image = buildGeneratedImageElement(item.output);
      if (image && !activityBody.querySelector(`[data-asset-id="${image.dataset.assetId}"]`)) {
        image.dataset.agentStage = 'summary';
        activityBody.appendChild(image);
      }
    }

    let errorEl = activityBody.querySelector(':scope > .agent-run-error')
      || bodyEl.querySelector(':scope > .agent-run-error');
    const errorContent = String(agentRun.error || '').trim();
    if (errorContent) {
      if (!errorEl) {
        errorEl = buildAgentErrorElement(errorContent);
        errorEl.classList.add('agent-run-error');
      }
      if (elementRenderState.get(errorEl)?.content !== errorContent) {
        errorEl.innerHTML = renderMarkdown(`⚠️ **出错了**\n\n${errorContent}`);
        elementRenderState.set(errorEl, { content: errorContent });
      }
      errorEl.dataset.agentStage = 'summary';
      activityBody.appendChild(errorEl);
    } else {
      errorEl?.remove();
    }

    const files = Array.isArray(agentRun?.changeSummary?.files) ? agentRun.changeSummary.files : [];
    let summary = activityBody.querySelector(':scope > .run-change-summary')
      || bodyEl.querySelector(':scope > .run-change-summary');
    if (files.length) {
      const signature = getPartSignature({ rolledBack: !!agentRun.rolledBack, changeSummary: agentRun.changeSummary });
      if (!summary || elementRenderState.get(summary)?.signature !== signature) {
        const next = buildRunChangeSummaryElement(agentRun);
        if (summary && next) {
          next.open = summary.open;
          summary.replaceWith(next);
        }
        summary = next;
        if (summary) elementRenderState.set(summary, { signature });
      }
      if (summary) {
        summary.dataset.agentStage = 'summary';
        activityBody.appendChild(summary);
      }
    } else {
      summary?.remove();
    }
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

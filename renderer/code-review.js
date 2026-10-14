/* Project PR details share the plugin detail shell and Git notification flows. */
window.YanCodeReview = (() => {
  let workspace = '', data = null, error = '', loading = false, acting = false;
  let issues = [], issuesError = '', issuesLoading = false, issuesLoaded = false, viewMode = 'pr';
  const projects = new Map();
  let sessionQueue = Promise.resolve(), composerMode = 'standby';
  const entryFor = selected => {
    const key = workspaceGroupKey(selected);
    if (!projects.has(key)) projects.set(key, { data: null, error: '', sessionId: '', scrollTop: 0,
      issues: [], issuesError: '', issuesLoading: false, issuesLoaded: false, issuesVersion: 0 });
    return projects.get(key);
  };
  const writable = permission => ['WRITE', 'MAINTAIN', 'ADMIN'].includes(permission);
  const canMerge = pr => writable(data?.repository.permission) && !pr.isDraft && pr.mergeable === 'MERGEABLE' && ['CLEAN', 'HAS_HOOKS', 'UNSTABLE'].includes(pr.mergeStateStatus);
  const canMonitor = pr => writable(pr.headRepository?.viewerPermission);
  const refreshIcon = () => settingsOverlay.querySelector('#worktreeRefresh svg').outerHTML;
  const questionIcon = () => $('#aboutNavBtn svg').outerHTML;
  const projectsRefresh = $('#codeReviewProjectsRefresh');
  projectsRefresh.innerHTML = refreshIcon();
  projectsRefresh.addEventListener('click', async () => {
    projectsRefresh.disabled = true;
    projectsRefresh.setAttribute('aria-busy', 'true');
    try { await renderCodeReviewProjects({ force: true }); }
    finally { projectsRefresh.disabled = false; projectsRefresh.setAttribute('aria-busy', 'false'); }
  });
  function saveScroll() {
    if (workspace) entryFor(workspace).scrollTop = $('#codeReviewDetailPanel .page-body').scrollTop;
  }
  function syncComposer() {
    const app = $('#app');
    const active = currentMainPage === 'code-review' && !!workspace && entryFor(workspace).sessionId === state.currentSession?.id;
    const wasActive = app.classList.contains('panel-composer-mode');
    if (!active && wasActive) composerMode = browserFocusComposerMode;
    app.classList.toggle('panel-composer-mode', active);
    if (currentMainPage === 'code-review') $('#pageChat').classList.toggle('hidden', !active);
    if (active) {
      syncBrowserFocusComposerAvailability();
      if (!wasActive) setBrowserFocusComposerMode(composerMode);
      updateBrowserFocusComposerInset();
    }
  }
  function ensureSession(selected) {
    const entry = entryFor(selected);
    sessionQueue = sessionQueue.catch(() => {}).then(async () => {
      if (workspace !== selected || currentMainPage !== 'code-review') return;
      if (!entry.sessionId) {
        const session = await api.createSession(true, selected);
        if (!session?.id) throw new Error('未能创建项目审查聊天');
        entry.sessionId = session.id;
      }
      if (workspace !== selected || currentMainPage !== 'code-review') return;
      if (state.currentSession?.id !== entry.sessionId) await loadSession(entry.sessionId);
      syncComposer();
    });
    return sessionQueue;
  }
  function showPage() {
    if (currentMainPage !== 'code-review') { saveScroll(); syncComposer(); return; }
    syncComposer();
    if (workspace) void ensureSession(workspace).catch(failure => toast(failure.message, { error: true }));
  }
  function syncSelection() {
    $$('#codeReviewProjectList [data-code-review-workspace]').forEach(row => {
      const active = workspaceGroupKey(row.dataset.codeReviewWorkspace) === workspaceGroupKey(workspace);
      row.classList.toggle('active', active);
      row.setAttribute('aria-pressed', String(active));
    });
  }
  function render() {
    $('#codeReviewEmpty').classList.toggle('hidden', !!workspace);
    $('#codeReviewDetailPanel').classList.toggle('hidden', !workspace);
    if (!workspace) return;
    const repository = data?.repository;
    const prs = data?.prs || [];
    const issueMode = viewMode === 'issue';
    const plusIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" data-keyline-icon="plus"><path d="M12 5V19M5 12H19"/></svg>';
    // The active view owns the busy state so the refresh button, the list and
    // the card actions grey out and lock exactly the same way in PR and Issue mode.
    const viewLoading = issueMode ? issuesLoading : loading;
    const button = (action, label, disabled = false) => `<button type="button" class="ghost-btn code-review-pill" data-review-action="${action}" ${disabled || acting || loading ? 'disabled' : ''}>${label}</button>`;
    const issueButton = (action, label, disabled = false) => `<button type="button" class="ghost-btn code-review-pill" data-review-action="${action}" ${disabled || acting || issuesLoading ? 'disabled' : ''}>${label}</button>`;
    const pill = (action, label, disabled = false) => `<button type="button" class="ghost-btn code-review-pill" data-review-action="${action}" ${disabled || acting ? 'disabled' : ''}>${label}</button>`;
    const sectionTitle = issueMode ? 'Issues' : 'Pull Requests';
    const count = issueMode
      ? (issuesLoaded ? issues.length : (issuesLoading ? '…' : ''))
      : (data ? prs.length : '');
    const emptyHtml = issueMode
      ? `${issuesError ? `<div class="skill-detail-empty" role="alert">${escapeHtml(issuesError)}</div>` : ''}
        ${!issuesLoaded && issuesLoading ? '<div class="skill-detail-empty">正在检查 Issue…</div>' : ''}
        ${issuesLoaded && !issues.length ? '<div class="skill-detail-empty">暂无打开的 Issue</div>' : ''}`
      : `${error ? `<div class="skill-detail-empty" role="alert">${escapeHtml(error)}</div>` : ''}
        ${!data && loading ? '<div class="skill-detail-empty">正在检查 PR…</div>' : ''}
        ${data && !prs.length ? '<div class="skill-detail-empty">暂无打开的 Pull Request</div>' : ''}`;
    const cards = issueMode
      ? issues.map(issue => `<article class="code-review-pr-card" data-issue-number="${Number(issue.number)}">
          <div class="code-review-pr-copy"><h3>#${Number(issue.number)} ${escapeHtml(issue.title)}</h3><p>${escapeHtml(issue.author || '')}${issue.labels?.length ? ` · ${escapeHtml(issue.labels.join('、'))}` : ''}</p></div>
          <footer class="code-review-pr-footer">${issueButton('ask', `${questionIcon()}<span>发起提问</span>`)}
            <div class="code-review-pr-actions">${issueButton('open', 'GitHub 打开')}</div>
          </footer>
        </article>`).join('')
      : prs.map(pr => `<article class="code-review-pr-card" data-pr-number="${Number(pr.number)}">
          <div class="code-review-pr-copy"><h3>#${Number(pr.number)} ${escapeHtml(pr.title)}</h3><p>${escapeHtml(pr.headRefName)} → ${escapeHtml(pr.baseRefName)}${pr.author?.login ? ` · ${escapeHtml(pr.author.login)}` : ''}</p></div>
          <footer class="code-review-pr-footer">${button('ask', `${questionIcon()}<span>发起提问</span>`)}
            <div class="code-review-pr-actions">${button('open', 'GitHub 打开')}${canMonitor(pr) ? button('monitor', '监控并修复') : ''}${writable(repository?.permission) ? `<span title="${canMerge(pr) ? '合并此 PR' : '草稿、冲突、检查或分支保护要求尚未满足；请刷新或在 GitHub 查看'}">${button('merge', '合并', !canMerge(pr))}</span>` : ''}${button('diff', 'Diff')}</div>
          </footer>
        </article>`).join('');
    $('#codeReviewDetailContent').innerHTML = `${window.YanCapabilityTemplates.compactDetailHead({
      titleId: 'codeReviewTitle', name: workspaceGroupLabel(workspace), description: null, logo: '',
      afterTitle: '<button type="button" class="plugin-directory icon-btn" data-review-action="directory" title="在资源管理器中打开" aria-label="在资源管理器中打开"><img src="assets/windows-explorer.png" alt="" aria-hidden="true"></button>',
      actions: `<button type="button" class="ghost-btn code-review-pill" data-review-action="refresh" ${viewLoading || acting ? 'disabled' : ''} aria-busy="${viewLoading}">${refreshIcon()}<span>${issueMode ? '检查或刷新Issue' : '检查或刷新PR'}</span></button>`,
      actionLabel: '代码审查操作', closeAttribute: 'data-review-action', closeLabel: '关闭项目审查'
    })}
    <section class="plugin-info-section" aria-label="信息"><h2>信息</h2><dl>
      <div class="plugin-info-row"><dt>开发者</dt><dd>${escapeHtml(repository?.developer || '—')}</dd></div>
      <div class="plugin-info-row"><dt>Github页</dt><dd>${repository ? `<button type="button" class="plugin-info-link icon-btn" data-review-action="repository" title="${escapeAttr(repository.nameWithOwner)}" aria-label="打开 GitHub 仓库">${window.YanPluginDetails.externalIcon}</button>` : '—'}</dd></div>
    </dl></section>
    <section class="plugin-skills-section code-review-pr-section" aria-labelledby="codeReviewPrTitle"><header class="code-review-pr-heading"><div class="code-review-pr-heading-main"><h2 id="codeReviewPrTitle">${sectionTitle} <span>${count}</span></h2>${pill('toggle-view', issueMode ? '查看PR' : '查看issue', viewLoading)}</div>${pill('create', `${plusIcon}<span>${issueMode ? '新建issue' : '新建PR'}</span>`, viewLoading)}</header>
      <div class="code-review-pr-list" aria-busy="${viewLoading}" aria-live="polite">
        ${emptyHtml}
        ${cards}
      </div>
    </section>`;
    syncSelection();
    syncComposer();
  }
  async function refresh(notify = false) {
    if (!workspace || acting) return;
    const selected = workspace;
    const entry = entryFor(selected);
    const token = entry.requestVersion = (entry.requestVersion || 0) + 1;
    entry.loading = true;
    loading = true; error = ''; render();
    try {
      const result = await api.ghReviewProject(selected);
      if (token !== entry.requestVersion) return;
      if (result?.ok === false) throw new Error(result.error || '检查 PR 失败');
      entry.data = result; entry.error = '';
      if (workspace !== selected) return;
      data = result;
      if (notify) toast(`PR 已刷新，共 ${data.prs.length} 个`);
    } catch (failure) {
      if (token !== entry.requestVersion) return;
      entry.error = failure.message || '检查 PR 失败';
      if (workspace !== selected) return;
      error = failure.message || '检查 PR 失败';
      toast(error, { error: true });
    } finally {
      if (token === entry.requestVersion) {
        entry.loading = false;
        if (workspace === selected) { loading = false; render(); }
      }
    }
  }
  async function loadIssues(notify = false) {
    if (!workspace || acting) return;
    const selected = workspace;
    const entry = entryFor(selected);
    const token = entry.issuesVersion = (entry.issuesVersion || 0) + 1;
    entry.issuesLoading = true; entry.issuesError = '';
    issuesLoading = true; issuesError = ''; render();
    try {
      const result = await api.ghIssueList(selected, { state: 'open' });
      if (token !== entry.issuesVersion) return;
      if (result?.ok === false) throw new Error(result.error || '检查 Issue 失败');
      entry.issues = Array.isArray(result.issues) ? result.issues : [];
      entry.issuesError = ''; entry.issuesLoaded = true;
      if (workspace !== selected) return;
      issues = entry.issues; issuesError = ''; issuesLoaded = true;
      if (notify) toast(`Issue 已刷新，共 ${issues.length} 个`);
    } catch (failure) {
      if (token !== entry.issuesVersion) return;
      entry.issuesError = failure.message || '检查 Issue 失败';
      if (workspace !== selected) return;
      issuesError = entry.issuesError;
      toast(issuesError, { error: true });
    } finally {
      if (token === entry.issuesVersion) {
        entry.issuesLoading = false;
        if (workspace === selected) { issuesLoading = false; render(); }
      }
    }
  }
  function select(selected) {
    if (workspace !== selected) closeDiff();
    if (acting) return;
    if (workspace === selected) { showPage(); return; }
    saveScroll();
    const cached = projects.has(workspaceGroupKey(selected));
    workspace = selected;
    const entry = entryFor(selected);
    data = entry.data; error = entry.error; loading = !!entry.loading;
    issues = entry.issues || []; issuesError = entry.issuesError || ''; issuesLoading = !!entry.issuesLoading; issuesLoaded = !!entry.issuesLoaded;
    render();
    $('#codeReviewDetailPanel .page-body').scrollTop = entry.scrollTop;
    if (!cached) void refresh();
    if (viewMode === 'issue' && !entry.issuesLoaded && !entry.issuesLoading) void loadIssues();
    void ensureSession(selected).catch(failure => toast(failure.message, { error: true }));
  }
  async function startChat(item, monitor, selected, kind = 'PR') {
    await ensureSession(selected);
    if (workspace !== selected || currentMainPage !== 'code-review' || state.currentSession?.id !== entryFor(selected).sessionId) return;
    setBrowserFocusComposerMode('expanded', { focus: true });
    if (monitor) {
      const selection = normalizeModelSelectionSnapshot(getAgentModelSelection());
      if (selection.modelType !== 'text') throw new Error('请先切换到文本模型');
      await submitMessage(`/monitor-pr ${item.number}`, [], [], { modelSelection: selection, subagentRoles: [] });
    } else {
      const prompt = `关于 ${kind} #${item.number}「${item.title}」\n${item.url}\n\n我的问题：`;
      if (!input.value.includes(prompt)) input.value = [input.value.trim(), prompt].filter(Boolean).join('\n\n');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.focus();
      toast(`已在本页填入 ${kind} 提问，请填写问题`);
    }
  }
  async function createIssue(selected) {
    const values = await requestGitAction({
      title: '新建 Issue',
      description: `在 ${workspaceGroupLabel(selected)} 创建一个 GitHub Issue。`,
      submitLabel: '创建 Issue',
      fields: [
        { name: 'title', label: '标题', placeholder: 'Issue 标题' },
        { name: 'body', label: '描述', placeholder: 'Issue 描述（可留空）', required: false, multiline: true, rows: 5 }
      ]
    });
    if (!values || workspace !== selected) return;
    const title = String(values.title || '').trim();
    if (!title) { toast('请先填写 Issue 标题'); return; }
    acting = true; render();
    try {
      const result = await api.ghIssueCreate(selected, { title, body: String(values.body || '') });
      if (result?.ok === false) throw new Error(result.error || '创建 Issue 失败');
      toast(result.url ? `Issue 已创建：${result.url}` : 'gh 已完成创建，但未返回可识别链接；请刷新列表确认，勿重复提交。');
      await loadIssues(true);
    } catch (failure) { toast(failure.message || '创建 Issue 失败', { error: true }); }
    finally { acting = false; render(); }
  }
  $('#codeReviewDetailContent').addEventListener('click', async event => {
    const trigger = event.target.closest('[data-review-action]');
    if (!trigger || trigger.disabled || acting) return;
    const action = trigger.dataset.reviewAction;
    if (action === 'back') { closeDiff(); saveScroll(); workspace = ''; data = null; loading = false; viewMode = 'pr'; render(); syncSelection(); syncComposer(); return; }
    if (action === 'toggle-view') {
      viewMode = viewMode === 'issue' ? 'pr' : 'issue';
      if (viewMode === 'issue' && workspace) {
        const entry = entryFor(workspace);
        if (!entry.issuesLoaded && !entry.issuesLoading) void loadIssues();
      }
      render();
      return;
    }
    if (action === 'refresh') { if (viewMode === 'issue') void loadIssues(true); else void refresh(true); return; }
    if (action === 'create') {
      if (viewMode === 'issue') { void createIssue(workspace); return; }
      const selected = workspace;
      acting = true; render();
      try {
        await ensureSession(selected);
        if (workspace === selected && currentMainPage === 'code-review' && state.currentSession?.id === entryFor(selected).sessionId) openTaskGitPrDialog();
      } catch (failure) { toast(failure.message || '无法打开 PR 表单', { error: true }); }
      finally { acting = false; render(); }
      return;
    }
    if (action === 'directory') {
      try { const result = await api.openWorkspaceInExplorer(workspace); if (result?.ok === false) throw new Error(result.error || '无法打开项目目录'); }
      catch (failure) { toast(failure.message, { error: true }); }
      return;
    }
    const pr = data?.prs.find(item => item.number === Number(trigger.closest('[data-pr-number]')?.dataset.prNumber));
    const issue = issues.find(item => item.number === Number(trigger.closest('[data-issue-number]')?.dataset.issueNumber));
    if (action === 'repository' || action === 'open') {
      const target = action === 'repository' ? data.repository?.url : (pr?.url || issue?.url);
      try { const result = await api.gitOpenRemote(target); if (result?.ok === false) throw new Error(result.error); }
      catch (failure) { toast(failure.message, { error: true }); }
      return;
    }
    if (!pr && !issue) return;
    if (pr && action === 'diff') { void openDiff(pr); return; }
    const selected = workspace;
    acting = true; render();
    try {
      if (action === 'ask') await startChat(pr || issue, false, selected, pr ? 'PR' : 'Issue');
      if (action === 'monitor' && pr && canMonitor(pr)) await startChat(pr, true, selected, 'PR');
      if (action === 'merge' && pr && canMerge(pr)) {
        const confirm = await requestGitAction({ title: `合并 PR #${pr.number}`, description: `${pr.title}\n${pr.headRefName} → ${pr.baseRefName}`, submitLabel: '合并 PR' });
        if (confirm === null) return;
        const result = await api.ghPrMerge(selected, pr.number, pr.headRefOid);
        if (result?.ok === false) throw new Error(result.error || '合并失败');
        toast(`PR #${pr.number} 已合并`);
        acting = false;
        await refresh();
      }
    } catch (failure) { toast(failure.message || 'PR 操作失败', { error: true }); }
    finally { acting = false; render(); }
  });
  let diffVersion = 0, diffPr = null;
  const diffCache = new Map();
  const diffCacheKey = (selected, pr) => JSON.stringify([workspaceGroupKey(selected), pr.number, pr.headRefOid || '', pr.baseRefOid || '', pr.updatedAt || '']);
  function maxDiffWidth() {
    const left = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--sidebar-w')) || 260;
    return Math.max(1, (window.innerWidth - ($('#appRail')?.offsetWidth || 0) - left) / 2);
  }
  function closeDiff() {
    if (!$('#app').classList.contains('pr-diff-open')) return;
    diffVersion++; diffPr = null;
    globalThis.YanDshReview?.close();
    $('#app').classList.remove('pr-diff-open');
    setRightSidebarOpen(false);
    renderRightSidebarTabs();
  }
  async function openDiff(pr, { fresh = false } = {}) {
    const selected = workspace, version = ++diffVersion;
    diffPr = pr;
    if (browserFocusMode) setBrowserFocusMode(false);
    $('#app').classList.add('pr-diff-open');
    renderRightSidebarTabs();
    const width = Math.min(640, maxDiffWidth());
    document.documentElement.style.setProperty('--rs-w', width + 'px');
    setRightSidebarOpen(true);
    syncSidebarAccessibility();
    const current = () => version === diffVersion && workspace === selected && currentMainPage === 'code-review';
    globalThis.YanDshReview.showError('正在读取 PR #' + pr.number + ' 的差异…');
    try {
      const key = diffCacheKey(selected, pr);
      let request = !fresh && diffCache.get(key);
      if (!request) {
        request = api.ghPrDiff(selected, pr.number);
        diffCache.set(key, request);
        if (diffCache.size > 8) diffCache.delete(diffCache.keys().next().value);
      }
      let result;
      try { result = await request; }
      catch (error) { if (diffCache.get(key) === request) diffCache.delete(key); throw error; }
      if (result?.ok === false || String(result?.diff || '').length > 4 * 1024 * 1024) {
        if (diffCache.get(key) === request) diffCache.delete(key);
      }
      if (!current()) return;
      if (result?.ok === false) throw new Error(result.error || '无法读取 PR 差异');
      const rawDiff = String(result.diff || '');
      if (rawDiff.length > 4 * 1024 * 1024) throw new Error('PR 差异过大，请在 GitHub 查看。');
      if (!rawDiff.trim()) { globalThis.YanDshReview.showError('该 PR 暂无文件差异。'); return; }
      await globalThis.YanDshReview.open({ rawDiff, lazy: false, pr: true,
        comparison: { currentBranch: pr.headRefName, baseBranch: pr.baseRefName, mode: 'all', branches: [] },
        onClose: () => { if (current()) closeDiff(); },
        onRefresh: () => { if (current()) void openDiff(diffPr, { fresh: true }); }
      });
    } catch (failure) { if (current()) globalThis.YanDshReview.showError(failure.message || '读取 PR 差异失败'); }
  }
  return { select, syncSelection, showPage, closeDiff, openDiff, maxDiffWidth };
})();

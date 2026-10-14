/* Session-scoped Bash UI. Main process owns all execution state. */
window.YanBackgroundBash = (() => {
  const jobs = new Map(), expanded = new Set(), outputs = new Map(), rows = new Map();
  let open = false, refreshVersion = 0, lastSession = '', refreshing = false, quickOpen = false;
  const panel = document.querySelector('#bashStatusPanel');
  const list = document.querySelector('#bashStatusDetails');
  const quickList = document.querySelector('#taskBashQuick');
  const quickToggle = document.querySelector('#taskBashToggleBtn');
  const sessionId = () => String(state.currentSession?.id || '');
  function el(tag, className, text) {
    const node = document.createElement(tag); node.className = className;
    if (text != null) node.textContent = text; return node;
  }
  function clock(ms) {
    const total = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
    return h ? `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}` : `${m}:${String(s).padStart(2, '0')}`;
  }
  function chevronIcon() {
    // Same down/right paths as the sidebar project expand/collapse control.
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
    svg.append(document.createElementNS('http://www.w3.org/2000/svg', 'path'));
    return svg;
  }
  function visibleJobs() { return [...jobs.values()].filter(job => job.sessionId === sessionId()).reverse(); }
  function toggleQuick() {
    quickOpen = !quickOpen;
    renderQuick();
    if (quickOpen) void refresh();
  }
  // Compact inline panel under the Bash row: only currently running jobs, with
  // elapsed time and a stop control. Open in the capsule, never in the composer.
  function renderQuick() {
    if (!quickList) return;
    quickList.classList.toggle('hidden', !quickOpen);
    quickList.setAttribute('aria-hidden', String(!quickOpen));
    if (quickToggle) {
      quickToggle.setAttribute('aria-expanded', String(quickOpen));
      const title = quickOpen ? '收起运行中的 Bash 任务' : '展开运行中的 Bash 任务';
      quickToggle.title = title; quickToggle.setAttribute('aria-label', title);
      quickToggle.querySelector('path')?.setAttribute('d', quickOpen ? 'M9 6L15 12L9 18' : 'M6 9L12 15L18 9');
    }
    if (!quickOpen) { quickList.replaceChildren(); return; }
    const running = visibleJobs().filter(job => job.status === 'running');
    const now = Date.now();
    quickList.replaceChildren(...(running.length ? running.map(job => {
      const item = el('div', 'bash-quick-job'); item.dataset.job = job.id;
      const target = el('button', 'bash-quick-open'); target.type = 'button';
      const command = el('code', 'bash-quick-command', job.command); command.title = job.command;
      const time = el('span', 'bash-quick-time', clock(now - (job.startedAt || now)));
      time.dataset.bashQuickTime = job.id;
      target.append(command, time);
      target.addEventListener('click', () => openQuickJob(job.id));
      const stop = el('button', 'bash-quick-stop'); stop.type = 'button';
      stop.title = '停止'; stop.setAttribute('aria-label', '停止');
      stop.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="7" y="7" width="10" height="10" rx="1"/></svg>';
      stop.addEventListener('click', async () => {
        stop.disabled = true;
        try {
          const result = await api.bashControl({ id: job.id, sessionId: job.sessionId, action: 'cancel' });
          jobs.set(result.id, result); render();
        } catch (error) { toast(error.message || 'Bash 操作失败'); }
        finally { stop.disabled = false; }
      });
      item.append(target, stop);
      return item;
    }) : [el('p', 'bash-quick-empty', '没有正在运行的命令')]));
  }
  function openQuickJob(jobId) {
    const job = jobs.get(jobId);
    if (job) expanded.add(jobId);
    quickOpen = false;
    toggle(true);
    if (job) void readOutput(job).then(render).catch(() => {});
  }
  function tickQuickTimes() {
    if (!quickOpen || !quickList) return;
    const now = Date.now();
    for (const node of quickList.querySelectorAll('[data-bash-quick-time]')) {
      const job = jobs.get(node.dataset.bashQuickTime);
      if (job) node.textContent = clock(now - (job.startedAt || now));
    }
  }
  function toggle(value) {
    open = value; panel.classList.toggle('hidden', !open); panel.setAttribute('aria-hidden', String(!open));
    if (open) { closeTaskGitPanel(); void refresh(); }
  }
  function createRow(job) {
    const row = el('article', 'bash-job'); row.dataset.job = job.id;
    const heading = el('div', 'bash-job-row');
    const command = el('code', 'bash-job-command');
    const cwd = el('small', 'bash-job-cwd');
    const error = el('small', 'bash-job-wake-error');
    const outputWrap = el('div', 'bash-job-output-wrap'); outputWrap.hidden = true;
    const output = el('pre', 'bash-job-output'); output.id = 'bash-output-' + job.id;
    const actions = el('div', 'bash-job-actions');
    const view = { row, command, cwd, error, outputWrap, output, actions, scrollTop: 0, scrollLeft: 0 };
    const action = (name, label, className, handler) => {
      const control = el('button', className, label); control.type = 'button'; control.dataset.bashAction = name;
      control.addEventListener('click', async () => {
        control.disabled = true;
        try { await handler(control); render(); }
        catch (error) { toast(error.message || 'Bash 操作失败'); }
        finally { control.disabled = false; }
      });
      return control;
    };
    view.toggle = action('output', '', 'bash-job-output-toggle', async () => {
      if (expanded.has(job.id)) {
        view.scrollTop = output.scrollTop; view.scrollLeft = output.scrollLeft;
        expanded.delete(job.id);
      } else {
        await readOutput(jobs.get(job.id) || job);
        expanded.add(job.id);
      }
    });
    view.toggle.append(chevronIcon()); view.toggle.setAttribute('aria-controls', output.id);
    const controlJob = async name => {
      const result = await api.bashControl({ id: job.id, sessionId: job.sessionId, action: name });
      jobs.set(result.id, result);
    };
    view.background = action('background', '转后台', '', () => controlJob('background'));
    view.copy = action('copy', '', 'bash-job-copy', async () => {
      await navigator.clipboard.writeText(outputs.get(job.id) || jobs.get(job.id)?.error || '');
      toast('已复制');
    });
    view.copy.title = '复制输出'; view.copy.setAttribute('aria-label', '复制输出');
    view.copy.innerHTML = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M8 8V6C8 4.34315 9.34315 3 11 3H18C19.6569 3 21 4.34315 21 6V13C21 14.6569 19.6569 16 18 16H16"/><path d="M6 8H13C14.6569 8 16 9.34315 16 11V18C16 19.6569 14.6569 21 13 21H6C4.34315 21 3 19.6569 3 18V11C3 9.34315 4.34315 8 6 8Z"/></svg>';
    heading.append(command, view.toggle, cwd, actions); actions.append(view.background);
    outputWrap.append(view.copy, output); row.append(heading, error, outputWrap);
    return view;
  }
  function render() {
    const selected = visibleJobs(); const running = selected.filter(job => job.status === 'running').length;
    document.querySelector('#taskBashCount').textContent = running ? running + ' 运行中' : String(selected.length);
    document.querySelector('#bashStatusSummary').textContent = running ? running + ' 个运行中' : '无运行中的命令';
    renderQuick();
    if (!open) return;
    const scroll = list.scrollTop, ids = new Set(selected.map(job => job.id));
    for (const [id, view] of rows) if (!ids.has(id)) { view.row.remove(); rows.delete(id); }
    if (!selected.length) {
      if (!list.querySelector('.bash-status-empty')) list.append(el('p', 'bash-status-empty', '当前任务还没有 Bash 命令'));
      return;
    }
    list.querySelector('.bash-status-empty')?.remove();
    selected.forEach((job, index) => {
      let view = rows.get(job.id);
      if (!view) { view = createRow(job); rows.set(job.id, view); }
      const { row, command, cwd, toggle, actions, background, error, outputWrap, output, copy } = view;
      if (list.children[index] !== row) list.insertBefore(row, list.children[index] || null);
      row.dataset.status = job.status;
      if (command.textContent !== job.command) command.textContent = job.command;
      command.title = job.command;
      if (cwd.textContent !== job.cwd) cwd.textContent = job.cwd;
      cwd.title = job.cwd;
      const show = expanded.has(job.id), wasHidden = outputWrap.hidden;
      toggle.title = show ? '收起输出' : '查看输出'; toggle.setAttribute('aria-label', toggle.title);
      toggle.setAttribute('aria-expanded', String(show));
      toggle.querySelector('path').setAttribute('d', show ? 'M9 6L15 12L9 18' : 'M6 9L12 15L18 9');
      actions.hidden = job.status !== 'running';
      background.hidden = job.background || job.status !== 'running';
      error.hidden = !job.wakeError; error.textContent = job.wakeError ? '唤醒待重试：' + job.wakeError : '';
      outputWrap.hidden = !show;
      if (show) {
        const text = outputs.get(job.id) || job.error || '';
        const top = wasHidden ? view.scrollTop : output.scrollTop;
        const left = wasHidden ? view.scrollLeft : output.scrollLeft;
        // Keep the output element and scroll position across polls.
        if (output.textContent !== (text || '暂无输出')) output.textContent = text || '暂无输出';
        output.scrollTop = top; output.scrollLeft = left; copy.disabled = !text;
      }
    });
    list.scrollTop = scroll;
  }
  async function readOutput(job) {
    const detail = await api.bashControl({ id: job.id, sessionId: job.sessionId, action: 'output' });
    if (job.sessionId !== sessionId()) return;
    outputs.set(job.id, (detail.output || detail.error || '') + (detail.truncated ? '\n[输出超过捕获上限，已截断]' : ''));
  }
  async function refresh() {
    if (!api.bashList) return;
    const id = sessionId(), version = ++refreshVersion;
    if (lastSession !== id) { lastSession = id; expanded.clear(); outputs.clear(); render(); }
    try {
      const result = await api.bashList(id);
      if (version !== refreshVersion || id !== sessionId()) return;
      for (const [key, job] of jobs) if (job.sessionId === id) jobs.delete(key);
      for (const job of result || []) jobs.set(job.id, job);
      render();
    } catch (error) { if (open) document.querySelector('#bashStatusSummary').textContent = '读取失败：' + error.message; }
  }
  quickToggle?.addEventListener('click', toggleQuick);
  document.querySelector('#bashStatusClose').addEventListener('click', () => { toggle(false); document.querySelector('#taskGitHubBtn')?.focus(); });
  document.addEventListener('keydown', event => { if (event.key === 'Escape' && open) toggle(false); });
  api.onBashChanged?.(job => {
    jobs.set(job.id, job);
    if (jobs.size > 256) for (const [id, item] of jobs) { if (jobs.size <= 256) break; if (item.status !== 'running') jobs.delete(id); }
    render();
    if (expanded.has(job.id) && job.status !== 'running') void readOutput(job).then(render).catch(() => {});
  });
  const wakes = new Map(); let reconciling = false;
  api.onBashWake?.(detail => { wakes.set(detail.runId, detail.sessionId); });
  setInterval(async () => {
    if (wakes.size && !reconciling) {
      reconciling = true;
      try {
        await reconcileOpenCodeActiveRuns();
        for (const [runId, id] of wakes) {
          if (state.activeRuns.get(id)?.runCtx?.runId === runId
            || (state.currentSession?.id === id && state.currentSession.messages?.some(message => message.agentRun?.runId === runId))) { wakes.delete(runId); continue; }
          if (!state.activeRuns.has(id)) {
            const saved = await api.getSession(id, { messageLimit: MESSAGE_LOAD_LIMIT });
            if (!saved || saved.messages?.some(message => message.agentRun?.runId === runId)) wakes.delete(runId);
          }
        }
      } catch (error) { console.warn('[bash] resume reconciliation failed:', error); }
      finally { reconciling = false; }
    }
    tickQuickTimes();
    if (open && !refreshing) {
      refreshing = true;
      try {
        if (lastSession !== sessionId()) await refresh();
        await Promise.all(visibleJobs().filter(job => expanded.has(job.id) && job.status === 'running').map(readOutput));
        render();
      } catch {} finally { refreshing = false; }
    }
  }, 1000);
  void refresh();
  return { refresh };
})();

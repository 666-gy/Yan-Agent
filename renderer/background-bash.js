/* Background-only, session-scoped command manager. */
window.YanBackgroundBash = (() => {
  const jobs = new Map(), expanded = new Set(), outputs = new Map(), rows = new Map();
  let open = false, refreshVersion = 0, lastSession = '', refreshing = false;
  const panel = document.querySelector('#bashStatusPanel');
  document.body.append(panel);
  const list = document.querySelector('#bashStatusDetails');
  const pill = document.querySelector('#bashPill');
  const sessionId = () => String(window.yan?.nestedWindowSessionId || state.currentSession?.id || '');
  const visibleJobs = () => [...jobs.values()].filter(job => job.sessionId === sessionId() && job.background === true).reverse();
  function clock(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const h = Math.floor(seconds / 3600), m = Math.floor(seconds % 3600 / 60), s = seconds % 60;
    return (h ? h + 'h ' : '') + (m ? m + 'm ' : '') + s + 's';
  }
  function tickTimes() {
    for (const [id, view] of rows) {
      const job = jobs.get(id);
      if (job) view.time.textContent = clock((job.endedAt || Date.now()) - job.startedAt);
    }
  }
  function toggle(value) {
    if (value && visibleJobs().length) { if (!panel.open) panel.showModal(); open = true; void refresh(); }
    else { panel.close(); open = false; }
    pill.setAttribute('aria-expanded', String(open));
  }
  function render() {
    const selected = visibleJobs();
    window.syncTaskCapsuleBashRow?.(selected.length);
    document.querySelector('#bashPillHost').classList.toggle('hidden', !sessionId() || !selected.length);
    document.querySelector('#bashPillCount').textContent = selected.length;
    document.querySelector('#bashStatusSummary').textContent = selected.length;
    if (!selected.length && open) toggle(false);
    const ids = new Set(selected.map(job => job.id));
    for (const [id, view] of rows) if (!ids.has(id)) { view.row.remove(); rows.delete(id); }
    if (!open) return;
    selected.forEach((job, index) => {
      const phase = job.status === 'running' ? 'running' : ['cancelled', 'interrupted'].includes(job.status) ? 'interrupted' : 'done';
      const ok = phase === 'done' ? job.status === 'succeeded' : null;
      const output = outputs.get(job.id) || job.error || '';
      const signature = JSON.stringify([job.command, job.status, output, job.exit]);
      let view = rows.get(job.id);
      if (!view) {
        const row = buildToolStepElement('bash', { command: job.command }, '', ok, phase);
        row.open = false;
        row.dataset.job = job.id;
        const time = document.createElement('span'); time.className = 'bash-elapsed';
        const stop = document.createElement('button');
        stop.type = 'button'; stop.className = 'bash-job-stop'; stop.textContent = '停止';
        stop.title = '停止此后台命令'; stop.setAttribute('aria-label', '停止此后台命令');
        stop.addEventListener('click', async event => {
          event.preventDefault(); event.stopPropagation();
          if (stop.disabled || stop.dataset.stopping === 'true') return;
          stop.dataset.stopping = 'true'; stop.disabled = true; stop.textContent = '停止中…';
          try { await api.bashControl({ id: job.id, sessionId: job.sessionId, action: 'cancel' }); }
          catch (error) { stop.dataset.stopping = 'false'; stop.disabled = false; stop.textContent = '停止'; toast(error.message || '停止失败'); }
        });
        row.querySelector('summary')?.append(time, stop);
        view = { row, time, stop }; rows.set(job.id, view);
        row.addEventListener('toggle', () => {
          if (!row.isConnected || rows.get(job.id)?.row !== row) return;
          if (row.open) { expanded.add(job.id); void readOutput(jobs.get(job.id)).then(render).catch(error => toast(error.message)); }
          else expanded.delete(job.id);
        });
      }
      if (job.status !== 'running') {
        view.stop.hidden = true;
        if (view.stop.dataset.stopping !== 'true') { view.stop.disabled = false; view.stop.textContent = '停止'; }
      } else if (view.stop.dataset.stopping !== 'true') {
        view.stop.hidden = false;
      }
      if (view.signature !== signature) {
        view.signature = signature;
        const {row} = view;
        const toolState = phase === 'running' ? 'running' : phase === 'interrupted' ? 'interrupted' : ok ? 'completed' : 'error';
        row.className = 'tool-step is-' + toolState; row.dataset.toolState = toolState;
        const name = row.querySelector('.tc-name');
        name.textContent = job.status === 'failed' ? '运行中出错' : phase === 'running' ? '正在运行' : phase === 'interrupted' ? '已停止' : '已运行';
        name.classList.toggle('tool-state-shine', phase === 'running'); name.dataset.toolState = toolState;
        row.querySelector('.tc-command-failure')?.remove();
        const result = output + (job.exit != null ? '\nCommand exited with code ' + job.exit + '.' : '');
        setToolStepDetails(row, { toolName:'bash', args:{command:job.command}, resultRaw:result, ok, phase });
        renderToolStepDetails(row);
      }
      if (list.children[index] !== view.row) list.insertBefore(view.row, list.children[index] || null);
    });
    tickTimes();
  }
  async function readOutput(job) {
    if (!job) return;
    const version = refreshVersion;
    const detail = await api.bashControl({id:job.id, sessionId:job.sessionId, action:'output'});
    if (version !== refreshVersion || job.sessionId !== sessionId()) return;
    outputs.set(job.id, (detail.output || detail.error || '') + (detail.truncated ? '\n[输出已截断]' : ''));
  }
  async function refresh() {
    const id = sessionId(), version = ++refreshVersion;
    if (lastSession !== id) { toggle(false); lastSession = id; expanded.clear(); outputs.clear(); rows.forEach(view=>view.row.remove()); rows.clear(); }
    render();
    if (!id || !api.bashList) return;
    try {
      const result = await api.bashList(id);
      if (version !== refreshVersion || id !== sessionId()) return;
      for (const [key, job] of jobs) if (job.sessionId === id) jobs.delete(key);
      for (const job of result || []) jobs.set(job.id, job);
      render();
    } catch(error) { if(open) toast(error.message); }
  }
  pill.addEventListener('click', () => toggle(true));
  document.querySelector('#bashStatusClose').addEventListener('click', () => toggle(false));
  panel.addEventListener('close', () => {open=false; pill.setAttribute('aria-expanded','false');});
  panel.addEventListener('click', event => { if(event.target !== panel)return; const r=panel.getBoundingClientRect(); if(event.clientX<r.left || event.clientX>r.right || event.clientY<r.top || event.clientY>r.bottom)toggle(false); });
  api.onBashChanged?.(job => {
    jobs.set(job.id,job); render();
    if(open && expanded.has(job.id))void readOutput(job).then(render).catch(()=>{});
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
    tickTimes();
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
  return { refresh, open: () => toggle(true) };
})();

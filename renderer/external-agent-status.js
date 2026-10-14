/* The task bar reflects durable GUI jobs, including jobs in other Yan chats. */
(() => {
  const host = document.getElementById('externalAgentActivity');
  if (!host) return;
  const strip = host.querySelector('.external-agent-activity-pills');
  const detail = host.querySelector('.external-agent-activity-detail');
  const providers = { codex: 'Codex', claude: 'Claude' };
  const terminal = new Set(['succeeded', 'failed', 'cancelled', 'blocked', 'interrupted']);
  const nodes = new Map();
  let jobs = [], expanded = '', timer, pending = false, stopped = false;

  function display(job) {
    if (job.status === 'queued') return { state: 'queued', text: '等待派发队列' };
    const attention = job.needs_attention === true;
    const trust = attention && /信任|trust\s+(?:this\s+)?(?:workspace|folder)|确认弹窗/i.test(job.error || '');
    if (trust) return { state: 'trust', text: '正在等待你信任工作区' };
    if (attention) return { state: 'attention', text: '需要你处理桌面提示' };
    return { state: 'running', text: '正在处理Yan Agent的派发任务' };
  }
  function updateDetail() {
    const job = jobs.find(job => job.provider === expanded);
    for (const [provider, button] of nodes) button.setAttribute('aria-expanded', String(provider === expanded));
    detail.hidden = !job;
    if (!job) return;
    const title = document.createElement('strong');
    title.textContent = `${providers[job.provider]} · ${display(job).text}`;
    const task = document.createElement('p'); task.textContent = job.title || 'Yan Agent 的派发任务';
    const workspace = document.createElement('p'); workspace.className = 'external-agent-activity-workspace'; workspace.textContent = job.workspace || '';
    const hint = document.createElement('p');
    hint.textContent = display(job).state === 'trust'
      ? `请切换到 ${providers[job.provider]} 桌面端，核对目录后确认信任。Yan 会继续等待这条原任务。`
      : job.error || job.progress || '任务正在桌面端执行，完成后此提示会自动消失。';
    detail.replaceChildren(title, task, workspace, hint);
  }
  function render(records) {
    const active = records.filter(job => providers[job.provider] && !job.terminal && !terminal.has(job.status)
      && ['queued', 'starting', 'running', 'uncertain'].includes(job.status));
    // One pill per provider. A task awaiting user action takes precedence.
    jobs = Object.keys(providers).map(provider => active.find(job => job.provider === provider && job.needs_attention)
      || active.find(job => job.provider === provider && job.status !== 'queued')
      || active.find(job => job.provider === provider)).filter(Boolean);
    for (const [provider, button] of nodes) if (!jobs.some(job => job.provider === provider)) {
      button.remove(); nodes.delete(provider);
      if (expanded === provider) expanded = '';
    }
    for (const job of jobs) {
      let button = nodes.get(job.provider);
      if (!button) {
        button = document.createElement('button');
        button.type = 'button'; button.className = 'external-agent-activity-pill'; button.dataset.provider = job.provider;
        button.setAttribute('aria-haspopup', 'dialog'); button.setAttribute('aria-expanded', 'false');
        const logo = document.createElement('img');
        logo.src = `assets/provider-logos/${job.provider}.svg`; logo.alt = ''; logo.width = 18; logo.height = 18;
        button.append(logo, document.createElement('span'));
        button.addEventListener('click', () => { expanded = expanded === job.provider ? '' : job.provider; updateDetail(); });
        nodes.set(job.provider, button); strip.append(button);
      }
      const view = display(job);
      button.dataset.state = view.state;
      const label = button.querySelector('span');
      if (label.textContent !== view.text) label.textContent = view.text;
      button.setAttribute('aria-label', `${providers[job.provider]}：${view.text}`);
      button.title = `${providers[job.provider]} · ${view.text}\n${job.workspace || ''}${job.error ? `\n${job.error}` : ''}`;
    }
    host.hidden = jobs.length === 0;
    if (expanded) updateDetail(); else detail.hidden = true;
  }
  async function refresh() {
    if (pending || stopped) return;
    clearTimeout(timer); pending = true;
    try { const records = await api.externalAgentsList(); if (!stopped && Array.isArray(records)) render(records); }
    catch { /* A transient IPC failure does not mean the external task ended. */ }
    finally { pending = false; if (!stopped) timer = setTimeout(refresh, 2000); }
  }
  document.addEventListener('click', event => {
    if (expanded && !host.contains(event.target)) { expanded = ''; updateDetail(); }
  });
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && expanded) { const button = nodes.get(expanded); expanded = ''; updateDetail(); button?.focus(); }
  });
  window.addEventListener('focus', refresh);
  window.addEventListener('pagehide', () => { stopped = true; clearTimeout(timer); });
  refresh();
})();

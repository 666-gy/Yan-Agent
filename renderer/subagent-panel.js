(function () {
  'use strict';
  // Lucide is ISC licensed; Phosphor and Keyline are MIT licensed.
  // Keep the role marks inline so the desktop shell remains offline-capable.
  const ICONS = Object.freeze({
    explorer: '<svg data-agent-icon="explorer" width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M245.83,121.63a15.53,15.53,0,0,0-9.52-7.33,73.51,73.51,0,0,0-22.17-2.22c4-19.85,1-35.55-2.06-44.86a16.15,16.15,0,0,0-18.79-10.88,85.53,85.53,0,0,0-28.55,12.12,94.58,94.58,0,0,0-27.11-33.25,16.05,16.05,0,0,0-19.26,0A94.48,94.48,0,0,0,91.26,68.46,85.53,85.53,0,0,0,62.71,56.34,16.15,16.15,0,0,0,43.92,67.22c-3,9.31-6,25-2.06,44.86a73.51,73.51,0,0,0-22.17,2.22,15.53,15.53,0,0,0-9.52,7.33,16,16,0,0,0-1.6,12.27c3.39,12.57,13.8,36.48,45.33,55.32S113.13,208,128.05,208s42.67,0,74-18.78c31.53-18.84,41.94-42.75,45.33-55.32A16,16,0,0,0,245.83,121.63ZM59.14,72.14a.2.2,0,0,1,.23-.15A70.43,70.43,0,0,1,85.18,83.66,118.65,118.65,0,0,0,80,119.17c0,18.74,3.77,34,9.11,46.28A123.59,123.59,0,0,1,69.57,140C51.55,108.62,55.3,84,59.14,72.14Zm3,103.35C35.47,159.57,26.82,140.05,24,129.7a59.82,59.82,0,0,1,22.5-1.17,129.08,129.08,0,0,0,9.15,19.41,142.28,142.28,0,0,0,34,39.56A114.92,114.92,0,0,1,62.1,175.49ZM128,190.4c-9.33-6.94-32-28.23-32-71.23C96,76.7,118.38,55.24,128,48c9.62,7.26,32,28.72,32,71.19C160,162.17,137.33,183.46,128,190.4ZM170.82,83.66A70.43,70.43,0,0,1,196.63,72a.2.2,0,0,1,.23.15C200.7,84,204.45,108.62,186.43,140a123.32,123.32,0,0,1-19.54,25.48c5.34-12.26,9.11-27.54,9.11-46.28A118.65,118.65,0,0,0,170.82,83.66ZM232,129.72c-2.77,10.25-11.4,29.81-38.09,45.77a114.92,114.92,0,0,1-27.55,12,142.28,142.28,0,0,0,34-39.56,129.08,129.08,0,0,0,9.15-19.41A59.69,59.69,0,0,1,232,129.71Z"/></svg>',
    reviewer: '<svg data-agent-icon="reviewer" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 20v-9"/><path d="M14 7a4 4 0 0 1 4 4v3a6 6 0 0 1-12 0v-3a4 4 0 0 1 4-4z"/><path d="M14.12 3.88 16 2"/><path d="M21 21a4 4 0 0 0-3.81-4"/><path d="M21 5a4 4 0 0 1-3.55 3.97"/><path d="M22 13h-4"/><path d="M3 21a4 4 0 0 1 3.81-4"/><path d="M3 5a4 4 0 0 0 3.55 3.97"/><path d="M6 13H2"/><path d="m8 2 1.88 1.88"/><path d="M9 7.13V6a3 3 0 1 1 6 0v1.13"/></svg>',
    researcher: '<svg data-agent-icon="researcher" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v16"/><path d="M16 13h2"/><path d="M16 9h2"/><path d="M20.001 19A2 2 0 0 0 22 17V5a2 2 0 0 0-1.999-2L16 3.002A5 5 0 0 0 12 5a5 5 0 0 0-4-2H4a2 2 0 0 0-2 2v12a2 2 0 0 0 1.999 2H8a5 5 0 0 1 4 2 5 5 0 0 1 4-2z"/><path d="M6 13h2"/><path d="M6 9h2"/></svg>',
    tester: '<svg data-agent-icon="tester" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 19H13"/><path d="M8 5V15"/><path d="M4 13L12 7"/><path d="M4 7L12 13"/></svg>',
    builder: '<svg data-agent-icon="builder" width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M216,79v1a40,40,0,0,1-40,40H136v80h8a16,16,0,0,0,10.67-27.93,8,8,0,0,1,10.66-11.92A32,32,0,0,1,144,216h-8v16a8,8,0,0,1-16,0V216H96a8,8,0,0,1,0-16h24V120H96a16,16,0,0,0,0,32,8,8,0,0,1,0,16,32,32,0,0,1,0-64h24V24a8,8,0,0,1,16,0v80h40a24,24,0,0,0,24-24V79a23,23,0,0,0-23-23H160a8,8,0,0,1,0-16h17a39,39,0,0,1,39,39ZM56,96H32a8,8,0,0,1-8-8V80A40,40,0,0,1,64,40H96a8,8,0,0,1,0,16A40,40,0,0,1,56,96ZM80,56H64A24,24,0,0,0,40,80H56A24,24,0,0,0,80,56Z"/></svg>',
    mapper: '<svg data-agent-icon="mapper" width="20" height="20" viewBox="0 0 256 256" fill="currentColor" aria-hidden="true"><path d="M249.94,120.24l-27.05-6.76a95.86,95.86,0,0,0-80.37-80.37l-6.76-27a8,8,0,0,0-15.52,0l-6.76,27.05a95.86,95.86,0,0,0-80.37,80.37l-27,6.76a8,8,0,0,0,0,15.52l27.05,6.76a95.86,95.86,0,0,0,80.37,80.37l6.76,27.05a8,8,0,0,0,15.52,0l6.76-27.05a95.86,95.86,0,0,0,80.37-80.37l27.05-6.76a8,8,0,0,0,0-15.52Zm-95.49,22.9L139.31,128l15.14-15.14L215,128Zm-52.9,0L41,128l60.57-15.14L116.69,128ZM205.77,109.2,158.6,97.4,146.8,50.23A79.88,79.88,0,0,1,205.77,109.2Zm-62.63-7.65L128,116.69l-15.14-15.14L128,41ZM109.2,50.23,97.4,97.4,50.23,109.2A79.88,79.88,0,0,1,109.2,50.23Zm-59,96.57L97.4,158.6l11.8,47.17A79.88,79.88,0,0,1,50.23,146.8Zm62.63,7.65L128,139.31l15.14,15.14L128,215Zm33.94,51.32,11.8-47.17,47.17-11.8A79.88,79.88,0,0,1,146.8,205.77Z"/></svg>',
    tracer: '<svg data-agent-icon="tracer" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22v-9"/><path d="M15.17 2.21a1.67 1.67 0 0 1 1.63 0L21 4.57a1.93 1.93 0 0 1 0 3.36L8.82 14.79a1.655 1.655 0 0 1-1.64 0L3 12.43a1.93 1.93 0 0 1 0-3.36z"/><path d="M20 13v3.87a2.06 2.06 0 0 1-1.11 1.83l-6 3.08a1.93 1.93 0 0 1-1.78 0l-6-3.08A2.06 2.06 0 0 1 4 16.87V13"/><path d="M21 12.43a1.93 1.93 0 0 0 0-3.36L8.83 2.2a1.64 1.64 0 0 0-1.63 0L3 4.57a1.93 1.93 0 0 0 0 3.36l12.18 6.86a1.636 1.636 0 0 0 1.63 0z"/></svg>',
    reverser: '<svg data-agent-icon="reverser" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12a1 1 0 0 1-10 0 1 1 0 0 0-10 0"/><path d="M7 20.7a1 1 0 1 1 5-8.7 1 1 0 1 0 5-8.6"/><path d="M7 3.3a1 1 0 1 1 5 8.6 1 1 0 1 0 5 8.6"/><circle cx="12" cy="12" r="10"/></svg>'
  });
  const icon = '<svg data-agent-icon="bot-message-square" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6V2H8"/><path d="M15 11v2"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="M20 16a2 2 0 0 1-2 2H8.828a2 2 0 0 0-1.414.586l-2.202 2.202A.71.71 0 0 1 4 20.286V8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/><path d="M9 11v2"/></svg>';
  const ROLE_ALIASES = Object.freeze({ explore: 'explorer', review: 'reviewer', research: 'researcher', test: 'tester', build: 'builder' });
  const roleFor = role => {
    const key = String(role || '').trim().toLowerCase();
    return ROLE_ALIASES[key] || key;
  };
  const iconFor = role => ICONS[roleFor(role)] || icon;
  const planIcon = ICONS.reviewer.replace('data-agent-icon="reviewer"', 'data-agent-icon="bug"');
  const W = window.YanSubagentWorkflow;
  const nameFor = role => `${W.name(roleFor(role)) || 'Sub'} Agent`;
  function create({ getSessionId, getRuns, renderNative, renderActions, openSidebar, escapeHtml }) {
    const panel = document.querySelector('#rs-subagents');
    let selected = '';
    let sessionId = '';
    let frame = 0;
    let rowsSignature = '';
    let timer = null;
    let detailSignature = '';
    let lastRenderAt = 0;
    function visible() {
      return panel?.classList.contains('active') && !document.hidden && !document.querySelector('#app')?.classList.contains('rs-hidden');
    }
    const query = selector => panel?.querySelector(selector);
    function records() {
      return getRuns().flatMap(run => { W.migrate(run); return run.subagents || []; });
    }
    function elapsed(record) {
      const seconds = Math.max(0, Math.floor(((record.completedAt || Date.now()) - record.startedAt) / 1000));
      return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
    }
    function activity(record) {
      if (record.status === 'error') return record.error || '工作失败';
      if (record.status === 'interrupted') return '工作已中止';
      if (record.status === 'incomplete') return '工作未确认完成';
      if (record.status === 'completed') return '已完成工作';
      const last = [...record.timeline].reverse().find(item => item.type !== 'tool_result');
      if (last?.type === 'tool_call') return `正在执行 ${last.name}`;
      if (last?.type === 'thinking') return '正在思考';
      return last?.content?.replace(/\s+/g, ' ').trim().slice(0, 140) || '已开始工作';
    }
    function agentName(record) {
      return nameFor(record.role);
    }
    function taskSummary(record) {
      const source = String(record.description || record.title || record.prompt || activity(record) || '当前任务');
      const concise = source
        .replace(/^\s*调用\s+\S+\s*/u, '')
        .replace(/\s*[（(]\s*(?:任务\s*)?(?:id|ID|编号)[\s\S]*$/u, '')
        .replace(/\s+/g, ' ')
        .trim();
      if (concise.length <= 42) return concise;
      const clipped = concise.slice(0, 42).replace(/[，、：:；;\s]+[^\w\u4e00-\u9fff]*$/u, '').trim();
      return `${clipped || concise.slice(0, 42).trim()}…`;
    }
    function statusLabel(record) {
      if (record.status === 'completed') return '已完成';
      if (record.status === 'error') return '失败';
      if (record.status === 'interrupted') return '已中止';
      if (record.status === 'incomplete') return '待确认';
      return '工作中';
    }
    // Delegation plan (yan-plan marker parsed by workflow-state): show the
    // dependency graph once two or more tasks declare ids, so parallel
    // builder fan-out and its ordering stay legible.
    function planGraphHtml(all) {
      const planned = all.filter(record => record.plan?.id);
      if (planned.length < 2) return '';
      const known = new Set(planned.map(record => record.plan.id));
      return `<section class="subagent-plan-graph"><h5>${planIcon}<span>委派计划</span></h5>${planned.map(record => {
        const deps = (record.plan.dependsOn || []);
        const depsText = deps.length
          ? `依赖 ${deps.map(dep => known.has(dep) ? dep : `${dep}（未声明）`).join('、')}`
          : '无前置依赖';
        return `<div class="subagent-plan-entry is-${escapeHtml(record.status)}">
          <div class="subagent-plan-heading"><strong>${escapeHtml(record.plan.id)}</strong><span class="subagent-plan-status">${escapeHtml(statusLabel(record))}</span></div>
          <span class="subagent-plan-dependencies">${escapeHtml(depsText)}</span>
          ${record.plan.acceptance ? `<small class="subagent-plan-acceptance"><span>验收</span>${escapeHtml(record.plan.acceptance)}</small>` : ''}
        </div>`;
      }).join('')}</section>`;
    }
    function planStripHtml(plan) {
      if (!plan?.id) return '';
      const deps = (plan.dependsOn || []);
      return `<strong>${planIcon}${escapeHtml(plan.id)}</strong>${deps.length ? `<span>依赖 ${escapeHtml(deps.join('、'))}</span>` : ''}${plan.acceptance ? `<small>验收：${escapeHtml(plan.acceptance)}</small>` : ''}`;
    }
    function render() {
      clearTimeout(timer);
      timer = null;
      if (!visible()) return;
      lastRenderAt = performance.now();
      const nextSessionId = getSessionId();
      if (nextSessionId !== sessionId) { sessionId = nextSessionId; selected = ''; }
      const all = records();
      const count = query('[data-subagents-count]');
      const running = all.filter(record => record.status === 'running').length;
      const countLabel = `已开启·${all.length}`;
      count.textContent = countLabel;
      const signature = JSON.stringify(all.map(record => [record.id, record.role, record.status, taskSummary(record), elapsed(record), record.plan || null]));
      if (signature !== rowsSignature) {
        rowsSignature = signature;
        const focusId = document.activeElement?.closest('[data-subagent-ui-id]')?.dataset.subagentUiId;
        const planGraph = planGraphHtml(all);
        query('[data-subagents-list]').innerHTML = all.length ? `${planGraph}${all.map(record => {
          const planChip = record.plan?.id ? `<em class="subagent-plan-chip" title="委派计划 id">${planIcon}${escapeHtml(record.plan.id)}</em>` : '';
          return `<button type="button" class="subagent-ui-row is-${escapeHtml(record.status)}" data-subagent-ui-id="${escapeHtml(record.id)}">
          <span class="subagent-ui-icon" data-agent-role="${escapeHtml(record.role)}">${iconFor(record.role)}</span><span class="subagent-ui-main"><strong>${escapeHtml(agentName(record))}</strong><small>${escapeHtml(taskSummary(record))}</small>${planChip}</span><span class="subagent-ui-meta"><strong>${escapeHtml(elapsed(record))}</strong><small>${escapeHtml(statusLabel(record))}</small></span>
        </button>`;
        }).join('')}` : '<div class="subagents-empty">当前任务尚未调用子智能体</div>';
        if (focusId) [...query('[data-subagents-list]').children].find(row => row.dataset.subagentUiId === focusId)?.focus({ preventScroll: true });
      }
      const detail = all.find(record => record.id === selected);
      query('[data-subagents-view="root"]').classList.toggle('hidden', !!detail);
      query('[data-subagents-view="detail"]').classList.toggle('hidden', !detail);
      if (detail) {
        const title = query('[data-subagents-detail-name]');
        title.textContent = agentName(detail);
        title.title = title.textContent;
        const detailIcon = query('[data-subagents-detail-icon]');
        detailIcon.dataset.agentRole = String(detail.role || '').toLowerCase();
        if (detailIcon.dataset.iconRole !== detail.role) {
          detailIcon.innerHTML = iconFor(detail.role);
          detailIcon.dataset.iconRole = detail.role;
        }
        const planStrip = query('[data-subagents-detail-plan]');
        if (planStrip) {
          const planHtml = planStripHtml(detail.plan);
          planStrip.classList.toggle('hidden', !planHtml);
          if (planHtml) planStrip.innerHTML = planHtml;
        }
        const body = query('[data-subagents-detail-body]');
        if (body.dataset.childId !== detail.id) {
          body.replaceChildren();
          delete body.dataset.agentOutputInitialized;
          body.dataset.childId = detail.id;
          body.scrollTop = 0;
        }
        const nextDetailSignature = JSON.stringify([sessionId, detail.id, detail.outputRevision, detail.revision, detail.status, detail.result, detail.historyError, detail.plan || null]);
        if (nextDetailSignature !== detailSignature) {
        detailSignature = nextDetailSignature;
        const pinned = body.scrollHeight - body.scrollTop - body.clientHeight < 28;
        const childRun = W.nativeRun(detail);
        renderNative(body, childRun, detail.result || '');
        renderActions(body, childRun, detail.result || detail.timeline.filter(item => item.type === 'text').map(item => item.content).join('\n'));
        if (detail.status === 'running' && pinned) body.scrollTop = body.scrollHeight;
        }
      }
      // Only the visible panel needs an elapsed clock; no background poller.
      clearTimeout(timer);
      if (running && panel.classList.contains('active') && !document.querySelector('#app')?.classList.contains('rs-hidden')) {
        timer = setTimeout(render, 1000);
      }
    }
    function schedule() {
      if (frame || !visible()) return;
      frame = setTimeout(() => { frame = 0; render(); }, Math.max(0, 100 - (performance.now() - lastRenderAt)));
    }
    function open(id = '') {
      if (getSessionId() !== sessionId) { sessionId = getSessionId(); selected = ''; }
      selected = id;
      openSidebar();
      render();
    }
    panel?.addEventListener('click', event => {
      const row = event.target.closest('[data-subagent-ui-id]');
      if (row) { selected = row.dataset.subagentUiId; render(); query('[data-subagents-back]')?.focus({ preventScroll: true }); }
      if (event.target.closest('[data-subagents-back]')) {
        const previous = selected;
        selected = '';
        render();
        [...query('[data-subagents-list]').children].find(row => row.dataset.subagentUiId === previous)?.focus({ preventScroll: true });
      }
    });
    function openRoot(id = '') {
      open();
      const row = [...query('[data-subagents-list]').children].find(row => row.dataset.subagentUiId === id);
      row?.scrollIntoView({ block: 'nearest' });
      row?.focus({ preventScroll: true });
    }
    return { render, schedule, open, openRoot };
  }
  window.YanSubagentPanel = { icon, iconFor, nameFor, roleFor, create };
})();

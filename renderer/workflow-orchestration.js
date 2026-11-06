(function () {
  'use strict';
  const labels = { pending: '待开始', starting: '启动中', running: '进行中', awaiting_review: '待验收', accepted: '已通过', completed: '已完成', error: '需处理', interrupted: '已中断', paused: '已暂停', blocked: '等待处理' };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  // Lucide code-xml, ISC licensed.
  const icon = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m18 16 4-4-4-4"/><path d="m6 8-4 4 4 4"/><path d="m14.5 4-5 16"/></svg>';
  const chevron = '<span class="workflow-chevron" aria-hidden="true">›</span>';
  function stagesOf(data) {
    if (!data?.tasks) return data?.stages || [];
    return data.stages.map(stage => {
      const tasks = data.tasks.filter(task => task.stageId === stage.id);
      const status = tasks.length && tasks.every(t => t.status === 'accepted') ? 'completed'
        : ['error', 'interrupted', 'running', 'starting', 'awaiting_review'].find(s => tasks.some(t => t.status === s)) || 'pending';
      return { ...stage, status, agents: tasks.map(task => {
        const member = data.members.find(m => m.id === task.memberId);
        return { id: task.id, agentID: member?.agentID, name: member?.name || task.memberId, task: task.title, status: task.status,
          detail: task.attempts.at(-1)?.error || task.attempts.at(-1)?.review?.evidence || task.acceptance };
      }) };
    });
  }
  function create(data, { onAgentClick } = {}) {
    const element = document.createElement('details');
    element.className = 'workflow-orchestration';
    element.innerHTML = `<summary class="workflow-root-row">${icon}<span>构建工作流编排</span><span class="workflow-count"></span>${chevron}</summary><ol class="workflow-stages" aria-label="工作流规划"></ol>`;
    const list = element.querySelector('ol');
    let agents = [];
    element.addEventListener('click', event => {
      const button = event.target.closest('[data-workflow-agent]');
      if (button && element.contains(button)) onAgentClick?.(agents[Number(button.dataset.workflowAgent)]);
    });
    function update(next) {
      const expanded = new Set([...list.querySelectorAll('details[open]')].map(node => node.dataset.stageId));
      const stages = stagesOf(next); agents = [];
      const count = stages.reduce((n, stage) => n + (stage.agents?.length || 0), 0);
      element.querySelector('.workflow-count').textContent = next?.tasks ? `${labels[next.status] || '待开始'} · ${next.tasks.filter(t => t.status === 'accepted').length}/${count} 项任务` : `${stages.length} 项规划 · ${count} 个子代理`;
      list.innerHTML = stages.map(stage => `<li class="workflow-stage" data-status="${escape(stage.status)}"><details data-stage-id="${escape(stage.id)}" ${expanded.has(stage.id) ? 'open' : ''}><summary class="workflow-stage-row"><span class="workflow-node" aria-hidden="true"></span><span class="workflow-stage-title">${escape(stage.title)}</span><span class="workflow-stage-status">${labels[stage.status] || '待开始'}</span>${chevron}</summary><ul class="workflow-agents">${(stage.agents || []).map(agent => {
        const index = agents.push(agent) - 1;
        const clickable = onAgentClick && agent.agentID;
        const tag = clickable ? 'button' : 'div';
        return `<li><${tag} class="workflow-agent" ${clickable ? `type="button" data-workflow-agent="${index}"` : ''} title="${escape(agent.detail || '')}">${window.YanSubagentPanel?.avatarFor(agent) || ''}<span class="workflow-agent-copy"><span class="workflow-agent-name">${escape(agent.name)}</span><span class="workflow-separator">·</span>${escape(agent.task)}</span><span class="workflow-agent-status">${labels[agent.status] || '待开始'}</span></${tag}></li>`;
      }).join('') || '<li class="workflow-empty">尚未分配子代理</li>'}</ul></details></li>`).join('') || '<li class="workflow-empty">等待规划工作流</li>';
    }
    update(data);
    return { element, update };
  }
  window.YanWorkflowOrchestration = { create, stagesOf };
})();

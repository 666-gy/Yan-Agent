const bridge = window.yanPet || null;

const elements = {
  stateLabel: document.getElementById('stateLabel'),
  taskTitle: document.getElementById('taskTitle'),
  taskMessage: document.getElementById('taskMessage'),
  assessmentText: document.getElementById('assessmentText'),
  iterationStat: document.getElementById('iterationStat'),
  toolStat: document.getElementById('toolStat'),
  changeStat: document.getElementById('changeStat'),
  memoryStat: document.getElementById('memoryStat'),
  cpuStat: document.getElementById('cpuStat'),
  compactStatus: document.getElementById('compactStatus'),
  openTaskBtn: document.getElementById('openTaskBtn'),
  stopTaskBtn: document.getElementById('stopTaskBtn'),
  petToggle: document.getElementById('petToggle'),
  statusStrip: document.getElementById('statusStrip'),
  collapseBtn: document.getElementById('collapseBtn'),
  hideBtn: document.getElementById('hideBtn')
};
elements.panel = document.querySelector('.pet-panel');

const statusLabels = {
  idle: '待命',
  observing: '观察中',
  warning: '需要注意',
  paused: '已暂停',
  completed: '已完成',
  error: '运行异常'
};

const defaultState = {
  status: 'idle',
  sessionId: null,
  running: false,
  title: 'Yan Agent',
  message: '随时待命',
  assessment: '本地监督已就绪',
  stats: { iteration: 0, toolCalls: 0, changes: 0 }
};

let currentState = defaultState;
let expanded = false;
let metricsTimer = null;

function applyState(next = {}) {
  currentState = {
    ...defaultState,
    ...next,
    stats: { ...defaultState.stats, ...(next.stats || {}) }
  };
  const status = statusLabels[currentState.status] ? currentState.status : 'observing';
  document.body.dataset.state = status;
  elements.stateLabel.textContent = statusLabels[status];
  elements.taskTitle.textContent = currentState.title;
  elements.taskTitle.title = currentState.title;
  elements.taskMessage.textContent = currentState.message;
  elements.taskMessage.title = currentState.message;
  elements.assessmentText.textContent = currentState.assessment;
  elements.assessmentText.title = currentState.assessment;
  elements.iterationStat.textContent = String(currentState.stats.iteration || 0);
  elements.toolStat.textContent = String(currentState.stats.toolCalls || 0);
  elements.changeStat.textContent = String(currentState.stats.changes || 0);
  elements.compactStatus.textContent = currentState.message || statusLabels[status];
  elements.openTaskBtn.disabled = !currentState.sessionId;
  elements.stopTaskBtn.disabled = !currentState.sessionId || !currentState.running;
}

async function setExpanded(value) {
  expanded = !!value;
  if (bridge) await bridge.setExpanded(expanded);
  elements.panel.hidden = !expanded;
  document.body.classList.toggle('expanded', expanded);
  elements.panel.toggleAttribute('inert', !expanded);
  elements.panel.setAttribute('aria-hidden', expanded ? 'false' : 'true');
  elements.petToggle.setAttribute('aria-label', expanded ? '收起监督面板' : '展开监督面板');
  elements.statusStrip.setAttribute('aria-label', expanded ? '收起监督面板' : '展开监督面板');
  if (expanded) {
    refreshMetrics();
    clearInterval(metricsTimer);
    metricsTimer = setInterval(refreshMetrics, 5000);
  } else {
    clearInterval(metricsTimer);
    metricsTimer = null;
  }
}

async function refreshMetrics() {
  if (!bridge || !expanded) return;
  const metrics = await bridge.getMetrics().catch(() => null);
  elements.memoryStat.textContent = Number.isFinite(metrics?.memoryMb) ? String(metrics.memoryMb) : '--';
  elements.cpuStat.textContent = Number.isFinite(metrics?.cpuPercent) ? `${metrics.cpuPercent}%` : '--';
}

function bindMovableToggle(element) {
  let drag = null;

  element.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      lastX: event.screenX,
      lastY: event.screenY,
      moved: false
    };
    element.setPointerCapture?.(event.pointerId);
    event.preventDefault();
  });

  element.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    if (!drag.moved && Math.hypot(event.screenX - drag.startX, event.screenY - drag.startY) >= 4) {
      drag.moved = true;
    }
    if (!drag.moved) return;
    const dx = event.screenX - drag.lastX;
    const dy = event.screenY - drag.lastY;
    drag.lastX = event.screenX;
    drag.lastY = event.screenY;
    if (dx || dy) bridge?.moveBy(dx, dy);
  });

  const finishPointer = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const shouldToggle = !drag.moved;
    element.releasePointerCapture?.(event.pointerId);
    drag = null;
    if (shouldToggle) setExpanded(!expanded);
  };
  element.addEventListener('pointerup', finishPointer);
  element.addEventListener('pointercancel', () => { drag = null; });
  element.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    setExpanded(!expanded);
  });
}

bindMovableToggle(elements.petToggle);
bindMovableToggle(elements.statusStrip);
elements.collapseBtn.addEventListener('click', () => setExpanded(false));
elements.hideBtn.addEventListener('click', () => bridge?.close());
elements.openTaskBtn.addEventListener('click', () => bridge?.openTask(currentState.sessionId));
elements.stopTaskBtn.addEventListener('click', () => {
  if (!currentState.sessionId || !currentState.running) return;
  bridge?.stopTask(currentState.sessionId);
  applyState({
    ...currentState,
    status: 'paused',
    running: false,
    message: '正在停止任务',
    assessment: '已向 Agent 发送中止请求'
  });
});

document.addEventListener('contextmenu', event => event.preventDefault());
applyState(defaultState);

if (bridge) {
  bridge.onState(applyState);
  bridge.ready();
} else {
  const params = new URLSearchParams(location.search);
  const demoStatus = params.get('demo') || 'observing';
  applyState({
    status: demoStatus,
    sessionId: 'demo-session',
    running: ['observing', 'warning'].includes(demoStatus),
    title: '制作 HTML 小游戏',
    message: demoStatus === 'warning' ? '连续两次修改未通过验证' : '正在编辑 renderer/game.js',
    assessment: demoStatus === 'warning' ? '建议检查实现方向' : '未发现异常',
    stats: { iteration: 4, toolCalls: 7, changes: 3 }
  });
  elements.memoryStat.textContent = '42.6';
  elements.cpuStat.textContent = '0.2%';
  if (params.get('expanded') === '1') setExpanded(true);
}

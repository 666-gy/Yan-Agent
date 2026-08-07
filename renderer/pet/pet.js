const bridge = window.yanPet || null;

const elements = {
  stateLabel: document.getElementById('stateLabel'),
  taskTitle: document.getElementById('taskTitle'),
  statusText: document.getElementById('statusText'),
  compactStatus: document.getElementById('compactStatus'),
  openTaskBtn: document.getElementById('openTaskBtn'),
  stopTaskBtn: document.getElementById('stopTaskBtn'),
  petToggle: document.getElementById('petToggle'),
  statusStrip: document.getElementById('statusStrip')
};
elements.panel = document.querySelector('.pet-panel');

const statusLabels = {
  idle: '待命',
  observing: '工作中',
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
  message: '随时待命'
};

let currentState = defaultState;
let expanded = false;

function applyState(next = {}) {
  currentState = {
    ...defaultState,
    ...next
  };
  const status = statusLabels[currentState.status] ? currentState.status : 'observing';
  document.body.dataset.state = status;
  elements.stateLabel.textContent = statusLabels[status];
  elements.taskTitle.textContent = currentState.title;
  elements.taskTitle.title = currentState.title;
  elements.statusText.textContent = currentState.message || statusLabels[status];
  elements.statusText.title = currentState.message || statusLabels[status];
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
elements.openTaskBtn.addEventListener('click', () => bridge?.openTask(currentState.sessionId));
elements.stopTaskBtn.addEventListener('click', () => {
  if (!currentState.sessionId || !currentState.running) return;
  bridge?.stopTask(currentState.sessionId);
  applyState({
    ...currentState,
    status: 'paused',
    running: false,
    message: '正在结束任务'
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
  const demoMessages = {
    idle: '随时待命',
    observing: '正在修改文件 · renderer/game.js',
    warning: '修改文件执行失败',
    paused: '任务已停止',
    completed: '任务已完成',
    error: '任务出现异常'
  };
  applyState({
    status: demoStatus,
    sessionId: 'demo-session',
    running: ['observing', 'warning'].includes(demoStatus),
    title: '制作 HTML 小游戏',
    message: demoMessages[demoStatus] || '正在理解任务'
  });
  if (params.get('expanded') === '1') setExpanded(true);
}

const bridge = window.yanPet || null;
let orb = null;
let activePetId = 'orb';
let entertainmentAnimation = 'idle';
let entertainmentDragging = false;
let entertainmentDragDirection = '';
let passiveAnimationTimer = null;
let animationReturnTimer = null;

const petText = value => window.YanI18n?.translate(value) || String(value || '');

const PET_SPRITE_ANIMATIONS = Object.freeze({
  idle: { row: 0, frames: 6, duration: 1100 },
  runRight: { row: 1, frames: 8, duration: 1060 },
  runLeft: { row: 2, frames: 8, duration: 1060 },
  waving: { row: 3, frames: 4, duration: 700 },
  jumping: { row: 4, frames: 5, duration: 840 },
  failed: { row: 5, frames: 8, duration: 1220 },
  waiting: { row: 6, frames: 6, duration: 1010 },
  running: { row: 7, frames: 6, duration: 820 },
  review: { row: 8, frames: 6, duration: 1030 }
});

function ensureOrb() {
  if (orb || !window.yanParticlesOrb?.ParticlesOrb) return orb;
  orb = new window.yanParticlesOrb.ParticlesOrb(document.getElementById('orbCanvas'), {
    size: 212,
    speed: 2,
    colorFrom: '#f0abfc',
    colorTo: '#818cf8'
  });
  return orb;
}

const elements = {
  compactStatus: document.getElementById('compactStatus'),
  petToggle: document.getElementById('petToggle'),
  entertainmentPet: document.getElementById('entertainmentPet'),
  petSprite: document.querySelector('.pet-sprite'),
  statusStrip: document.getElementById('statusStrip')
};

const defaultState = {
  status: 'idle',
  sessionId: null,
  running: false,
  title: 'Yan Agent',
  message: '随时待命'
};

const allowedStatuses = new Set(['idle', 'observing', 'warning', 'paused', 'completed', 'error']);
let currentState = { ...defaultState };

function clearPassiveAnimation() {
  if (passiveAnimationTimer) clearTimeout(passiveAnimationTimer);
  passiveAnimationTimer = null;
}

function clearAnimationReturn() {
  if (animationReturnTimer) clearTimeout(animationReturnTimer);
  animationReturnTimer = null;
}

function setEntertainmentAnimation(name, iterations = 'infinite') {
  clearAnimationReturn();
  const animation = PET_SPRITE_ANIMATIONS[name] || PET_SPRITE_ANIMATIONS.idle;
  entertainmentAnimation = PET_SPRITE_ANIMATIONS[name] ? name : 'idle';
  elements.petSprite.style.setProperty('--sprite-row', String(animation.row));
  elements.petSprite.style.setProperty('--sprite-frames', String(animation.frames));
  elements.petSprite.style.setProperty('--sprite-duration', `${animation.duration}ms`);
  elements.petSprite.style.setProperty('--sprite-iterations', String(iterations));
  elements.petSprite.dataset.animation = entertainmentAnimation;
  elements.petSprite.classList.remove('is-animating');
  void elements.petSprite.offsetWidth;
  elements.petSprite.classList.add('is-animating');
  const iterationCount = Number(iterations);
  if (Number.isFinite(iterationCount) && iterationCount > 0) {
    const expectedAnimation = entertainmentAnimation;
    animationReturnTimer = setTimeout(() => {
      if (entertainmentAnimation === expectedAnimation && !entertainmentDragging) returnEntertainmentPetToIdle();
    }, animation.duration * iterationCount + 80);
  }
}

function schedulePassiveAnimation() {
  clearPassiveAnimation();
  if (activePetId === 'orb' || entertainmentDragging) return;
  passiveAnimationTimer = setTimeout(() => {
    const passive = [
      { name: 'waiting', iterations: 2 },
      { name: 'waving', iterations: 2 },
      { name: 'jumping', iterations: 3 },
      { name: 'review', iterations: 3 }
    ];
    const next = passive[Math.floor(Math.random() * passive.length)];
    setEntertainmentAnimation(next.name, next.iterations);
  }, 3800 + Math.round(Math.random() * 4200));
}

function returnEntertainmentPetToIdle() {
  if (activePetId === 'orb' || entertainmentDragging) return;
  setEntertainmentAnimation('idle');
  schedulePassiveAnimation();
}

function playEntertainmentReaction(name, iterations = 1) {
  if (activePetId === 'orb' || entertainmentDragging) return;
  clearPassiveAnimation();
  setEntertainmentAnimation(name, iterations);
}

function orbStateForPet(state) {
  const status = String(state.status || 'idle');
  const message = String(state.message || '');
  if (status === 'observing') {
    if (/等待|回答|询问|选择|确认|问题/.test(message)) return 'listening';
    if (/正在理解|正在启动|正在连接|准备任务/.test(message)) return 'connecting';
    if (/组织回答|总结|输出回答/.test(message)) return 'speaking';
  }
  return {
    idle: 'idle',
    observing: 'thinking',
    warning: 'error',
    paused: 'disabled',
    completed: 'idle',
    error: 'error'
  }[status] || 'idle';
}

function applyState(next = {}) {
  currentState = {
    ...defaultState,
    ...next,
    status: allowedStatuses.has(next.status) ? next.status : 'observing'
  };
  if (activePetId !== 'orb') return;
  const orbState = orbStateForPet(currentState);
  document.body.dataset.state = currentState.status;
  document.body.dataset.orbState = orbState;
  const title = petText(currentState.title);
  const message = petText(currentState.message || '随时待命');
  elements.compactStatus.textContent = message || title;
  elements.compactStatus.title = message || title;
  elements.statusStrip.setAttribute('aria-label', `${title}: ${message}`);
  elements.petToggle.setAttribute('aria-label', `${title}: ${message}`);
  ensureOrb()?.setState(orbState);
  ensureOrb()?.setLevel(null);
}

function applyPetConfig(config = {}) {
  window.YanI18n?.apply(config.language || new URLSearchParams(window.location.search).get('lang') || 'zh-CN', document);
  const selected = ['orb', 'yuexinmiao', 'deepseek', 'claude'].includes(String(config.selected || ''))
    ? String(config.selected)
    : 'orb';
  activePetId = selected;
  const isOrb = selected === 'orb';
  document.body.dataset.pet = selected;
  elements.petToggle.hidden = !isOrb;
  elements.statusStrip.hidden = !isOrb;
  elements.entertainmentPet.hidden = isOrb;
  const label = petText(config.label || '娱乐桌宠');
  elements.entertainmentPet.setAttribute('aria-label', `${label}, click to wave, double-click to jump, drag to move`);
  elements.entertainmentPet.title = `${label}: click to wave, double-click to jump, drag to move`;
  if (isOrb) {
    clearPassiveAnimation();
    clearAnimationReturn();
    elements.petSprite.classList.remove('is-animating');
    ensureOrb();
    applyState(currentState);
  } else {
    if (orb) {
      orb.destroy();
      orb = null;
    }
    returnEntertainmentPetToIdle();
  }
}

function bindMovableToggle(element, onClick, interaction = {}) {
  let drag = null;

  element.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    drag = {
      pointerId: event.pointerId,
      startX: event.screenX,
      startY: event.screenY,
      moved: false
    };
    try { element.setPointerCapture?.(event.pointerId); } catch {}
    interaction.onPointerDown?.();
    bridge?.startDrag();
    event.preventDefault();
  });

  element.addEventListener('pointermove', event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const deltaX = event.screenX - drag.startX;
    const deltaY = event.screenY - drag.startY;
    if (!drag.moved && Math.hypot(deltaX, deltaY) >= 4) {
      drag.moved = true;
      interaction.onDragStart?.({ deltaX, deltaY });
    }
    if (drag.moved) interaction.onDragMove?.({ deltaX, deltaY });
  });

  const finishPointer = event => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    const shouldOpen = !drag.moved;
    try {
      if (element.hasPointerCapture?.(event.pointerId)) element.releasePointerCapture(event.pointerId);
    } catch {}
    drag = null;
    bridge?.stopDrag();
    if (shouldOpen) onClick?.();
    else interaction.onDragEnd?.();
  };
  element.addEventListener('pointerup', finishPointer);
  window.addEventListener('pointerup', finishPointer);
  const cancelPointer = () => {
    const wasDragging = !!drag?.moved;
    drag = null;
    bridge?.stopDrag();
    if (wasDragging) interaction.onDragEnd?.();
  };
  element.addEventListener('pointercancel', cancelPointer);
  window.addEventListener('pointercancel', cancelPointer);
  window.addEventListener('blur', cancelPointer);
  element.addEventListener('keydown', event => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    onClick?.();
  });
}

const openCurrentTask = () => {
  if (currentState.sessionId) bridge?.openTask(currentState.sessionId);
};

bindMovableToggle(elements.petToggle, openCurrentTask);
bindMovableToggle(elements.statusStrip, openCurrentTask);
bindMovableToggle(elements.entertainmentPet, () => playEntertainmentReaction('waving'), {
  onPointerDown: clearPassiveAnimation,
  onDragStart: ({ deltaX }) => {
    entertainmentDragging = true;
    entertainmentDragDirection = deltaX < 0 ? 'left' : 'right';
    elements.entertainmentPet.classList.add('is-dragging');
    setEntertainmentAnimation(entertainmentDragDirection === 'left' ? 'runLeft' : 'runRight');
  },
  onDragMove: ({ deltaX }) => {
    const direction = deltaX < 0 ? 'left' : 'right';
    if (direction === entertainmentDragDirection) return;
    entertainmentDragDirection = direction;
    setEntertainmentAnimation(direction === 'left' ? 'runLeft' : 'runRight');
  },
  onDragEnd: () => {
    entertainmentDragging = false;
    entertainmentDragDirection = '';
    elements.entertainmentPet.classList.remove('is-dragging');
    returnEntertainmentPetToIdle();
  }
});
elements.entertainmentPet.addEventListener('dblclick', event => {
  event.preventDefault();
  playEntertainmentReaction('jumping');
});
elements.petSprite.addEventListener('animationend', () => {
  if (entertainmentAnimation !== 'idle' && !entertainmentDragging) returnEntertainmentPetToIdle();
});
window.addEventListener('blur', () => {
  bridge?.stopDrag();
  if (!entertainmentDragging) return;
  entertainmentDragging = false;
  entertainmentDragDirection = '';
  elements.entertainmentPet.classList.remove('is-dragging');
  returnEntertainmentPetToIdle();
});
document.addEventListener('contextmenu', event => event.preventDefault());
applyState(defaultState);

if (bridge) {
  bridge.onState(applyState);
  bridge.onConfig(applyPetConfig);
  bridge.ready();
} else {
  const params = new URLSearchParams(location.search);
  const demoPet = params.get('pet') || 'orb';
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
  applyPetConfig({ selected: demoPet, label: demoPet });
}

// Handwriting paths adapted from Ricardo Fuentes' apple-hello-effect (MIT).
// See assets/hello-LICENSE.txt. Playback and startup integration are local.
(() => {
  'use strict';
  const preview = new URLSearchParams(location.search).has('helloPreview');
  if (!preview && (!window.yan?.onStartupShown || window.yan.nestedWindowSessionId)) return;
  try {
    if (!preview && sessionStorage.getItem('yan-hello-played')) return;
    if (!preview) sessionStorage.setItem('yan-hello-played', '1');
  } catch { /* Storage can be unavailable in a restricted renderer. */ }
  const layer = document.createElement('div');
  layer.id = 'yanStartupHello';
  layer.setAttribute('role', 'dialog');
  layer.setAttribute('aria-label', '欢迎使用 Yan Agent');
  layer.setAttribute('aria-modal', 'true');
  layer.innerHTML = window.YanHelloMarkup;
  const controls = document.createElement('div');
  controls.className = 'hello-window-controls';
  controls.setAttribute('role', 'group');
  controls.setAttribute('aria-label', '窗口控制');
  controls.innerHTML = '<button type="button" data-window="minimize" aria-label="最小化" title="最小化"><span class="hello-min-icon" aria-hidden="true"></span></button><button type="button" data-window="maximize" aria-label="最大化" title="最大化"><span class="hello-max-icon" aria-hidden="true"></span></button><button type="button" data-window="close" aria-label="关闭" title="关闭"><span class="hello-close-icon" aria-hidden="true"></span></button>';
  layer.append(controls);
  const windowApi = window.yan?.window;
  const maxButton = controls.querySelector('[data-window="maximize"]');
  function syncMaximized(maximized) {
    maxButton.classList.toggle('is-maximized', !!maximized);
    maxButton.title = maximized ? '窗口化' : '最大化';
    maxButton.setAttribute('aria-label', maxButton.title);
  }
  controls.querySelector('[data-window="minimize"]').addEventListener('click', () => windowApi?.minimize());
  maxButton.addEventListener('click', () => windowApi?.toggleMaximize());
  controls.querySelector('[data-window="close"]').addEventListener('click', () => windowApi?.close());
  const unsubscribeMaximized = windowApi?.onMaximizeChange(syncMaximized);
  windowApi?.isMaximized().then(syncMaximized).catch(() => {});
  if (!windowApi) {
    for (const control of controls.querySelectorAll('button')) {
      control.disabled = true;
      control.title += '（桌面客户端可用）';
    }
  }
  layer.style.visibility = 'hidden';
  const preference = preview ? Promise.resolve(true) : window.yan.getConfig().then(config => config.general?.startupAnimation !== false).catch(() => true);
  document.body.append(layer);
  let app, wasInert;
  function lockApp() {
    if (closed || app || layer.style.visibility === 'hidden') return;
    app = document.getElementById('app');
    wasInert = app?.inert;
    if (app) app.inert = true;
  }
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const paths = [...layer.querySelectorAll('path')];
  paths.forEach(p => { const length = p.getTotalLength(); p.style.strokeDasharray = length; p.style.strokeDashoffset = length; });
  let started = false, closed = false, unsubscribe, deadline, typingTimer;
  preference.then(enabled => { if (!enabled) finish(); else if (!closed) { layer.style.visibility = ''; lockApp(); } });
  document.addEventListener('DOMContentLoaded', lockApp, { once: true });
  const animations = [];
  const button = layer.querySelector('.hello-enter');
  const type = layer.querySelector('.hello-type');
  const phrases = ['让想法妙笔生花', '现在开始，慧启新生', '一起构建吧'];
  let phrase = 0, count = 0, deleting = false;
  function writeText(text) {
    type.textContent = text;
    button.style.width = `${Math.max(76, Math.ceil(type.getBoundingClientRect().width) + 56)}px`;
  }
  function typeNext() {
    if (closed) return;
    const chars = Array.from(phrases[phrase]);
    count += deleting ? -1 : 1;
    writeText(chars.slice(0, count).join(''));
    let delay = deleting ? 65 : (chars[count - 1] === '，' ? 320 : 150);
    if (!deleting && count === chars.length) { deleting = true; delay = 1900; }
    else if (deleting && count === 0) { deleting = false; phrase = (phrase + 1) % phrases.length; delay = 420; }
    typingTimer = setTimeout(typeNext, delay);
  }
  function revealButton() {
    if (closed) return;
    button.disabled = false;
    layer.querySelector('.hello-action').classList.add('ready');
    button.focus({ preventScroll: true });
    if (reduced) writeText(phrases[0]);
    else typingTimer = setTimeout(typeNext, 420);
  }
  // Programmatic bypass for startup preference and automation.
  window.YanStartupHello = Object.freeze({ skip: finish });
  const previousFocus = document.activeElement;
  function finish() {
    if (closed) return;
    closed = true;
    clearTimeout(deadline); clearTimeout(typingTimer);
    unsubscribe?.();
    unsubscribeMaximized?.();
    document.removeEventListener('DOMContentLoaded', lockApp);
    document.removeEventListener('keydown', onKey);
    layer.classList.add('leaving');
    setTimeout(() => {
      animations.forEach(a => a.cancel());
      layer.remove();
      if (app) app.inert = wasInert;
      if (previousFocus?.isConnected && previousFocus !== document.body) previousFocus.focus();
    }, reduced ? 0 : 540);
  }
  function onKey(event) {
    if (event.key === 'Tab') {
      event.preventDefault();
      const focusable = [...layer.querySelectorAll('button:not(:disabled)')];
      const current = focusable.indexOf(document.activeElement);
      const next = (current + (event.shiftKey ? -1 : 1) + focusable.length) % focusable.length;
      focusable[next]?.focus({ preventScroll: true });
    }
  }
  async function start() {
    if (!await preference) { finish(); return; }
    if (started || closed) return;
    started = true;
    clearTimeout(deadline);
    lockApp();
    if (reduced) {
      paths.forEach(p => { p.style.strokeDashoffset = '0'; });
      revealButton();
      return;
    }
    // A short lead-in, then one flowing gesture with a slight overlap at h.
    paths.forEach((p, i) => animations.push(p.animate(
      [{ strokeDashoffset: p.style.strokeDashoffset }, { strokeDashoffset: '0' }],
      { duration: i ? 2350 : 850, delay: i ? 950 : 220, easing: i ? 'cubic-bezier(.32,0,.25,1)' : 'cubic-bezier(.4,0,.3,1)', fill: 'forwards' }
    )));
    Promise.all(animations.map(animation => animation.finished)).then(revealButton).catch(() => {});
  }
  button.addEventListener('click', finish);
  document.addEventListener('keydown', onKey);
  // Never cover the existing boot failure UI indefinitely.
  deadline = setTimeout(finish, 14500);
  if (preview) requestAnimationFrame(start);
  else unsubscribe = window.yan.onStartupShown(start);
})();

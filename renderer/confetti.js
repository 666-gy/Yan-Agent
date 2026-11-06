/* js-confetti 0.13.1 (MIT), vendored with its license in renderer/vendor. */
(() => {
  'use strict';
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let canvas, cannon, timer;
  let lastFire = 0;
  function stop() {
    clearTimeout(timer);
    cannon?.clearCanvas();
    canvas?.remove();
    cannon = canvas = null;
  }
  function fire({ emojis = ['🎉', '✨', '🚀', '🦄'] } = {}) {
    if (state.config?.general?.confettiEnabled === false) return { ok: true, fired: false, reason: 'disabled' };
    if (motion.matches) return { ok: true, fired: false, reason: 'reduced_motion' };
    if (document.hidden) return { ok: true, fired: false, reason: 'window_hidden' };
    if (!window.JSConfetti) return { ok: false, fired: false, reason: 'renderer_unavailable' };
    if (Date.now() - lastFire < 1000) return { ok: true, fired: false, reason: 'cooldown' };
    stop();
    canvas = document.createElement('canvas');
    canvas.id = 'yan-confetti';
    canvas.setAttribute('aria-hidden', 'true');
    canvas.inert = true;
    Object.assign(canvas.style, { position: 'fixed', inset: '0', width: '100%', height: '100%', pointerEvents: 'none', zIndex: '2147483647' });
    document.body.appendChild(canvas);
    try {
      if (!canvas.getContext('2d')) throw new Error('Canvas unavailable');
      cannon = new window.JSConfetti({ canvas });
      void cannon.addConfetti({ confettiNumber: 200, confettiRadius: 6,
        confettiColors: ['#FF1E56', '#FF8230', '#FFCF32', '#37D672', '#28BCD9', '#4885F7', '#A95DEC', '#F65AAA'] });
      if (emojis.length) void cannon.addConfetti({ confettiNumber: 50, emojis, emojiSize: 72 * window.devicePixelRatio });
      lastFire = Date.now();
      timer = setTimeout(stop, 3500);
      return { ok: true, fired: true };
    } catch {
      stop();
      return { ok: false, fired: false, reason: 'render_failed' };
    }
  }
  motion.addEventListener('change', event => { if (event.matches) stop(); });
  window.addEventListener('pagehide', stop);
  window.YanConfetti = { fire, stop };
})();

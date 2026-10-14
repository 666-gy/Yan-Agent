'use strict';

// Yan Agent — 黑屏错误屏
//
// A blank window is the worst failure mode: the app looks alive but every
// surface is gone and the user has no idea what happened. This module is loaded
// before every other renderer script so it is already listening when a boot
// error happens, and it builds its own overlay with inline styles so it does not
// depend on styles.css, the app DOM, or any other script having loaded.
//
// It reports the concrete error, not just a generic banner:
//   - uncaught exceptions and unhandled rejections (the usual cause of a
//     half-painted or blank page);
//   - a boot watchdog: the app never set window.__YAN_APP_READY__, so the first
//     paint failed or stopped halfway;
//   - a liveness probe: the app finished booting but its root container is now
//     empty.
// Everything is append-only and dismissible, so a benign stray error cannot
// trap the user behind a permanent overlay.
(function () {
  const READY_FLAG = '__YAN_APP_READY__';
  const BOOT_DEADLINE_MS = 15000;
  const LIVENESS_INTERVAL_MS = 5000;
  const TITLE = 'Yan Agent发生了错误';
  const startedAt = Date.now();
  const entries = [];
  let overlay = null;
  let detailNode = null;
  let shownAt = 0;

  function textOf(value) {
    if (value == null) return '';
    if (typeof value === 'string') return value;
    if (value instanceof Error) return `${value.name || 'Error'}: ${value.message || ''}`;
    try { return JSON.stringify(value); } catch { return String(value); }
  }

  function describe(detail, meta) {
    const lines = [String(detail == null ? '' : detail).trim() || '未提供错误信息。'];
    const at = [meta?.source, meta?.at].filter(Boolean).join(' @ ');
    if (at) lines.push(`位置：${at}`);
    if (meta?.stack) lines.push('', String(meta.stack));
    const origin = String(meta?.url || (typeof location !== 'undefined' ? location.href : ''));
    if (origin) lines.push('', `页面：${origin}`);
    lines.push(`时间：${new Date().toLocaleString()}`);
    return lines.join('\n');
  }

  function ensureOverlay() {
    if (overlay && overlay.isConnected) return overlay;
    overlay = document.createElement('div');
    overlay.id = 'yanFatalError';
    overlay.setAttribute('role', 'alertdialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', TITLE);
    overlay.innerHTML = [
      '<style>',
      '#yanFatalError{position:fixed;inset:0;z-index:2147483600;display:flex;align-items:center;justify-content:center;',
      'padding:32px;box-sizing:border-box;background:rgba(12,13,16,.94);color:#f4f5f7;',
      'font-family:system-ui,-apple-system,"Segoe UI","Microsoft YaHei",sans-serif;}',
      '#yanFatalError .yan-fatal-card{width:min(760px,100%);max-height:100%;display:flex;flex-direction:column;gap:14px;',
      'background:#1b1d22;border:1px solid rgba(255,255,255,.14);border-radius:14px;padding:24px 26px;box-shadow:0 24px 60px rgba(0,0,0,.5);}',
      '#yanFatalError h1{margin:0;font-size:19px;font-weight:600;letter-spacing:.01em;color:#ff8f8f;}',
      '#yanFatalError p{margin:0;font-size:13px;line-height:1.6;color:rgba(244,245,247,.72);}',
      '#yanFatalError pre{margin:0;padding:14px;max-height:46vh;overflow:auto;white-space:pre-wrap;word-break:break-word;',
      'font-family:Consolas,"Cascadia Mono",monospace;font-size:12.5px;line-height:1.6;color:#e8e9ec;',
      'background:#111216;border:1px solid rgba(255,255,255,.1);border-radius:10px;}',
      '#yanFatalError .yan-fatal-actions{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap;}',
      '#yanFatalError button{cursor:pointer;font:inherit;font-size:13px;padding:8px 16px;border-radius:999px;',
      'border:1px solid rgba(255,255,255,.18);background:transparent;color:#f4f5f7;}',
      '#yanFatalError button[data-primary="true"]{background:#f4f5f7;color:#16181d;border-color:transparent;font-weight:600;}',
      '</style>',
      '<div class="yan-fatal-card">',
      `<h1>${TITLE}</h1>`,
      '<p>界面遇到未处理的错误，可能表现为黑屏或空白。下面是具体报错，可以复制后反馈给开发者。</p>',
      '<pre id="yanFatalErrorDetail"></pre>',
      '<div class="yan-fatal-actions">',
      '<button type="button" data-action="copy">复制错误信息</button>',
      '<button type="button" data-action="reload" data-primary="true"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.7883 13.9407C20.929 13.3034 21 12.6527 21 12C21 7.0294 16.9706 3 12 3C9.5169 3 7.1441 4.0259 5.4432 5.8349M4.2857 3L4.7293 6.105C4.7683 6.3784 5.0216 6.5683 5.295 6.5293L8.4 6.0857M3.2117 10.0593C3.071 10.6966 3 11.3473 3 12C3 16.9706 7.0294 21 12 21C14.4831 21 16.8559 19.9741 18.5568 18.1651M19.7143 21L19.2707 17.895C19.2317 17.6216 18.9784 17.4317 18.705 17.4707L15.6 17.9143"/></svg> 重新加载界面</button>',
      '<button type="button" data-action="close">关闭提示</button>',
      '</div>',
      '</div>'
    ].join('');
    const host = document.body || document.documentElement;
    host.appendChild(overlay);
    detailNode = overlay.querySelector('#yanFatalErrorDetail');
    overlay.addEventListener('click', event => {
      const action = event.target?.closest?.('button')?.dataset?.action;
      if (action === 'reload') location.reload();
      else if (action === 'close') hide();
      else if (action === 'copy') void copyDetail(event.target);
    });
    return overlay;
  }

  function paint() {
    if (detailNode) detailNode.textContent = entries.map(entry => entry.text).join('\n\n────────\n\n');
  }

  function show(detail, meta = {}) {
    const text = describe(detail, meta);
    if (entries.some(entry => entry.text === text)) return;
    entries.push({ text, at: Date.now() });
    // Bound the history so a burst of repeated errors cannot grow without limit.
    if (entries.length > 12) entries.splice(0, entries.length - 12);
    shownAt = Date.now();
    ensureOverlay();
    paint();
    console.error('[yan-fatal-error]', text);
  }

  function hide() {
    overlay?.remove();
    overlay = null;
    detailNode = null;
  }

  async function copyDetail(button) {
    const text = entries.map(entry => entry.text).join('\n\n────────\n\n');
    try {
      await navigator.clipboard.writeText(text);
      if (button) button.textContent = '已复制';
    } catch {
      const range = document.createRange();
      range.selectNodeContents(detailNode);
      const selection = window.getSelection();
      selection.removeAllRanges();
      selection.addRange(range);
      if (button) button.textContent = '已选中，请复制';
    }
  }

  function fromErrorEvent(event) {
    // Resource failures (img/script) carry no message and are never a black screen.
    if (!event.message) return null;
    // A ResizeObserver loop warning is a benign browser notice, not a black screen.
    if (/ResizeObserver loop/i.test(String(event.message))) return null;
    const error = event.error;
    return {
      detail: `${event.message}${error?.name && !String(event.message).includes(error.name) ? ` (${error.name})` : ''}`,
      meta: {
        source: 'script',
        at: [event.filename, event.lineno, event.colno].filter(value => value !== undefined && value !== '').join(':'),
        stack: error?.stack || ''
      }
    };
  }

  window.addEventListener('error', event => {
    const failure = fromErrorEvent(event);
    if (failure) show(failure.detail, failure.meta);
  });

  window.addEventListener('unhandledrejection', event => {
    const reason = event.reason;
    show(textOf(reason) || 'Promise 未处理的拒绝。', {
      source: 'unhandledrejection',
      stack: reason?.stack || ''
    });
  });

  // Boot watchdog: the first paint never completed.
  const bootWatchdog = setInterval(() => {
    if (window[READY_FLAG] === true) {
      clearInterval(bootWatchdog);
      return;
    }
    if (Date.now() - startedAt < BOOT_DEADLINE_MS) return;
    clearInterval(bootWatchdog);
    show('界面在预期时间内没有完成启动，页面可能一片空白或黑屏。', { source: 'boot-watchdog' });
  }, 1000);

  // Liveness probe: the app booted but its root container lost its content.
  const livenessProbe = setInterval(() => {
    if (document.hidden) return;
    if (window[READY_FLAG] !== true) return;
    if (Date.now() - shownAt < LIVENESS_INTERVAL_MS) return;
    const root = document.getElementById('app');
    if (!root || root.childElementCount === 0) {
      show('界面根节点已为空，页面可能已经黑屏。', { source: 'liveness' });
    }
  }, LIVENESS_INTERVAL_MS);
  window.addEventListener('unload', () => clearInterval(livenessProbe));

  window.YanFatalError = { show, hide, entries };
})();

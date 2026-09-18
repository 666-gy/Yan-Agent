(function () {
  'use strict';

  let api = null;
  let hooks = {};
  let workspace = '';
  let open = false;
  let openSeq = 0;

  const $ = id => document.getElementById(id);
  const layer = () => $('understandAnythingLayer');
  const frame = () => $('understandAnythingFrame');
  const statusEl = () => $('understandAnythingStatus');

  function setWorkspace(next) {
    workspace = String(next || '').trim();
  }

  function showLayer(visible) {
    const target = layer();
    if (!target) return;
    target.classList.toggle('hidden', !visible);
    if (visible) target.removeAttribute('aria-hidden');
    else target.setAttribute('aria-hidden', 'true');
    open = !!visible;
  }

  function setStatus(message, isError = false) {
    const target = statusEl();
    if (!target) return;
    const show = !!message;
    target.hidden = !show;
    if (show) target.removeAttribute('hidden');
    else target.setAttribute('hidden', '');
    target.classList.toggle('is-error', !!isError);
    target.textContent = message || '';
  }

  function clearFrame() {
    const target = frame();
    if (!target) return;
    try { target.src = 'about:blank'; } catch {}
  }

  async function openViewer(nextWorkspace) {
    const seq = ++openSeq;
    const next = String(nextWorkspace || hooks.getWorkspace?.() || '').trim();
    showLayer(true);
    if (!next) {
      setWorkspace('');
      clearFrame();
      setStatus('请先选择工作区', true);
      return { ok: false, error: '请先选择工作区' };
    }
    setWorkspace(next);
    clearFrame();
    setStatus('正在生成并打开知识图谱…');
    let result;
    try {
      result = await api?.understandAnythingOpen?.(next);
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    if (seq !== openSeq) return { ok: false, cancelled: true };
    if (!open) {
      clearFrame();
      setStatus('');
      return { ok: false, cancelled: true };
    }
    if (!result?.ok || !result.url) {
      const error = result?.error || '无法启动 Understand Anything';
      setStatus(error, true);
      hooks.toast?.(error);
      return result || { ok: false, error };
    }
    setStatus('');
    const target = frame();
    if (target) target.src = result.url;
    return result;
  }

  async function refresh() {
    if (!workspace) return openViewer(hooks.getWorkspace?.());
    const seq = ++openSeq;
    if (!open) showLayer(true);
    setStatus('正在刷新知识图谱…');
    let result;
    try {
      result = await api?.understandAnythingRefresh?.(workspace);
    } catch (error) {
      result = { ok: false, error: error?.message || String(error) };
    }
    if (seq !== openSeq) return { ok: false, cancelled: true };
    if (!open) {
      clearFrame();
      setStatus('');
      return { ok: false, cancelled: true };
    }
    if (!result?.ok || !result.url) {
      const error = result?.error || '刷新图谱失败';
      setStatus(error, true);
      hooks.toast?.(error);
      return result || { ok: false, error };
    }
    setStatus('');
    const target = frame();
    if (target) target.src = result.url;
    return result;
  }

  function close(options = {}) {
    const silent = !!(options && options.silent);
    openSeq += 1;
    showLayer(false);
    setStatus('');
    clearFrame();
    if (!silent) hooks.onClose?.();
  }

  function isOpen() { return open; }

  function handleWorkspaceChanged(detail = {}) {
    if (!open) return;
    const next = detail.workspace || '';
    if (next && next !== workspace) openViewer(next).catch(() => {});
  }

  function init(options = {}) {
    api = options.api || api;
    hooks = options.hooks || hooks;
    setWorkspace(hooks.getWorkspace?.() || '');
  }

  window.YanUnderstandAnything = { init, open: openViewer, refresh, close, isOpen, handleWorkspaceChanged, bindWorkspace: setWorkspace };
})();

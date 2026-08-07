(function () {
  'use strict';

  let api = null;
  let hooks = {};
  let workspace = '';
  let open = false;

  const $ = id => document.getElementById(id);
  const layer = () => $('understandAnythingLayer');
  const frame = () => $('understandAnythingFrame');

  function setWorkspace(next) {
    workspace = String(next || '').trim();
  }

  function showLayer(visible) {
    const target = layer();
    if (!target) return;
    target.classList.toggle('hidden', !visible);
    open = !!visible;
  }

  async function openViewer(nextWorkspace) {
    const next = String(nextWorkspace || hooks.getWorkspace?.() || '').trim();
    if (!next) {
      setWorkspace('');
      showLayer(true);
      return { ok: false, error: '请先选择工作区' };
    }
    setWorkspace(next);
    showLayer(true);
    const result = await api?.understandAnythingOpen?.(next);
    if (!result?.ok || !result.url) {
      return result || { ok: false, error: '无法启动 Understand Anything' };
    }
    const target = frame();
    if (target && target.src !== result.url) {
      target.src = result.url;
    }
    return result;
  }

  async function refresh() {
    if (!workspace) return openViewer(hooks.getWorkspace?.());
    const result = await api?.understandAnythingRefresh?.(workspace);
    if (!result?.ok || !result.url) {
      return result || { ok: false, error: '刷新图谱失败' };
    }
    const target = frame();
    if (target) {
      target.src = '';
      requestAnimationFrame(() => { target.src = result.url; });
    }
    return result;
  }

  function close() {
    showLayer(false);
    hooks.onClose?.();
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

'use strict';
// Remote control (WebUI) settings refresh the LAN address on demand. The address is
// discovered in the main process (see lib/main/remote-control.js).
(() => {
  const page = $('#remotePage');
  if (!page) return;
  const tab = $('#tab-remote');
  const content = page.querySelector('.remote-page-scroll');
  content.querySelector('.remote-hero')?.remove();
  tab.append(...content.children);
  page.remove();
  const nav = document.createElement('button');
  nav.id = 'settings-tab-remote';
  nav.type = 'button';
  nav.className = 'sheet-nav-btn';
  nav.dataset.tab = 'remote';
  nav.title = '远程操控';
  nav.setAttribute('role', 'tab');
  nav.setAttribute('aria-controls', 'tab-remote');
  nav.setAttribute('aria-selected', 'false');
  nav.tabIndex = -1;
  nav.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14V4C4 2.8954 4.8954 2 6 2H18C19.1046 2 20 2.8954 20 4M9 18H4C2.8954 18 2 17.1046 2 16V14.5C2 14.2239 2.2239 14 2.5 14H9M22 19V13C22 11.3431 20.6569 10 19 10H16C14.3431 10 13 11.3431 13 13V19C13 20.6569 14.3431 22 16 22H19C20.6569 22 22 20.6569 22 19ZM17 14H18"/></svg><span class="sheet-nav-text">远程操控</span>';
  $('#settings-tab-browser').after(nav);
  nav.addEventListener('click', () => switchTab('remote'));
  // Reuse the shared icon set (renderer.js `ICONS`) and clipboard helper.
  const iconSet = (typeof ICONS === 'object' && ICONS) || {};
  const COPY_ICON = iconSet.copy
    || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>';
  const CHECK_ICON = iconSet.check
    || '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>';
  let loading = false;
  let copyResetTimer = null;
  let currentAddress = '';

  // Reuse the shared toast component (renderer.js `toast`); feedback is
  // best-effort so a missing notification surface never blocks the refresh.
  const pushNotice = (message, options) => {
    try { window.toast?.(message, options); } catch { /* ignore */ }
  };

  const writeClipboard = async text => {
    if (typeof copyMarkdownCode === 'function') return copyMarkdownCode(text);
    if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
    throw new Error('Clipboard unavailable');
  };

  function generateQr() {
    const result = $('#remoteQrResult');
    const canvas = $('#remoteQrCanvas');
    if (!result || !canvas) return;
    if (!currentAddress) {
      pushNotice('请先获取有效的 webUI 地址', { error: true });
      return;
    }
    if (typeof qrcode !== 'function') {
      pushNotice('二维码组件不可用', { error: true });
      return;
    }
    try {
      const qr = qrcode(0, 'M');
      qr.addData(currentAddress);
      qr.make();
      canvas.innerHTML = qr.createSvgTag({ cellSize: 6, margin: 12, alt: 'webUI 地址二维码' });
      result.hidden = false;
    } catch (error) {
      pushNotice('生成二维码失败：' + (error?.message || String(error)), { error: true });
    }
  }

  function render(info) {
    const value = $('#remoteAddressValue');
    if (!value) return;
    setCopyState('idle');
    if (!info || info.ok === false) {
      currentAddress = '';
      value.dataset.state = 'error';
      value.textContent = '获取失败，请重试';
      value.title = info?.error || '';
      const result = $('#remoteQrResult');
      if (result) result.hidden = true;
      return;
    }
    currentAddress = info.address;
    value.dataset.state = 'ready';
    value.textContent = info.address;
    value.title = info.lan ? '同一局域网内的设备可访问' : '未检测到局域网地址，当前仅本机可访问';
    if (!$('#remoteQrResult')?.hidden) generateQr();
  }

  function setCopyState(state) {
    const button = $('#remoteAddressCopy');
    if (!button) return;
    button.dataset.state = state;
    button.innerHTML = state === 'success' ? CHECK_ICON : COPY_ICON;
    const label = state === 'success' ? '已复制地址' : '复制地址';
    button.setAttribute('aria-label', label);
    button.title = label;
  }

  async function copyAddress() {
    const button = $('#remoteAddressCopy');
    const value = $('#remoteAddressValue');
    if (!button || button.disabled || !value) return;
    const address = value.textContent.trim();
    if (!address || value.dataset.state === 'error') return;
    button.disabled = true;
    try {
      await writeClipboard(address);
      setCopyState('success');
    } catch {
      setCopyState('idle');
    }
    clearTimeout(copyResetTimer);
    copyResetTimer = setTimeout(() => {
      button.disabled = false;
      if (button.dataset.state === 'success') setCopyState('idle');
    }, 1400);
  }

  function notifyResult(info) {
    if (!info || info.ok === false) {
      pushNotice('获取 webUI 地址失败：' + (info?.error || '未知错误'), { error: true });
      return;
    }
    pushNotice(info.changed ? '原端口被占用，已切换到 ' + info.address : '已更新 webUI 地址：' + info.address);
  }

  async function refresh({ notify: withNotice = false } = {}) {
    if (loading) return;
    loading = true;
    const button = $('#remoteAddressRefresh');
    button?.classList.add('is-loading');
    if (button) button.disabled = true;
    let info;
    try {
      info = await api.remoteControlInfo();
    } catch (error) {
      info = { ok: false, error: error?.message || String(error) };
    } finally {
      loading = false;
      button?.classList.remove('is-loading');
      if (button) button.disabled = false;
    }
    render(info);
    if (withNotice) notifyResult(info);
  }

  function open() {
    openSettings('remote');
  }

  function close() {
    // Settings owns visibility; retained for existing navigation callers.
  }

  $('#remoteAddressRefresh')?.addEventListener('click', () => refresh({ notify: true }));
  $('#remoteAddressCopy')?.addEventListener('click', copyAddress);
  $('#remoteQrGenerate')?.addEventListener('click', generateQr);
  window.YanRemoteControl = { open, close, refresh };
})();

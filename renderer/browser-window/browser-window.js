(function () {
  'use strict';

  const api = window.yanBrowserWindow;
  const $ = selector => document.querySelector(selector);
  const tabsHost = $('#bwTabs');
  const viewport = $('#bwViewport');
  const startPage = $('#bwStart');
  const errorBox = $('#bwError');
  const errorText = $('#bwErrorText');
  const urlInput = $('#bwUrl');
  const backBtn = $('#bwBack');
  const forwardBtn = $('#bwForward');
  const reloadBtn = $('#bwReload');
  const zoomValue = $('#bwZoomValue');
  const zoomPill = $('.bw-zoom-pill');

  const GLOBE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a15 15 0 0 1 0 18M12 3a15 15 0 0 0 0 18"/></svg>';
  const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2];
  const chromiumUserAgent = String(navigator.userAgent || '')
    .replace(/\s*Electron\/[^\s]+/gi, '')
    .replace(/\s*yan-agent\/[^\s]+/gi, '')
    .trim();

  const state = {
    tabId: '',
    tabs: [],
    activeId: '',
    pinned: false,
    metaTimer: 0,
    lastMeta: '',
    addressEditing: false,
    addressDraft: ''
  };

  const activeTab = () => state.tabs.find(tab => tab.id === state.activeId) || null;
  const nextTabId = () => `bw-tab-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  function displayUrl(url) {
    const value = String(url || '').trim();
    if (!value || value === 'about:blank') return '';
    try {
      const parsed = new URL(value);
      if (parsed.protocol === 'http:' || parsed.protocol === 'https:') return parsed.host.replace(/^www\./i, '');
      if (parsed.protocol === 'file:') return decodeURIComponent(parsed.pathname.split('/').filter(Boolean).at(-1) || value);
    } catch {}
    return value;
  }

  function fullUrl(url) {
    const value = String(url || '').trim();
    return !value || value === 'about:blank' ? '' : value;
  }

  function tabTitle(tab) {
    const title = String(tab?.title || '').replace(/\s+/g, ' ').trim();
    if (title && title !== 'about:blank') return title.slice(0, 120);
    return displayUrl(tab?.currentUrl) || '新标签页';
  }

  function normalizeAddress(input) {
    const value = String(input || '').trim();
    if (!value) return '';
    if (/^(?:https?|file):\/\//i.test(value) || /^about:/i.test(value)) return value;
    if (/^[\w.-]+\.[a-z]{2,}/i.test(value)) return `https://${value}`;
    return `https://www.bing.com/search?q=${encodeURIComponent(value)}`;
  }

  function safeFavicon(value) {
    const source = String(value || '').trim();
    if (!source) return '';
    if (/^data:image\//i.test(source)) return source;
    try {
      const parsed = new URL(source);
      return ['http:', 'https:', 'file:'].includes(parsed.protocol) ? parsed.href : '';
    } catch {
      return '';
    }
  }

  function syncAddress(tab = activeTab()) {
    if (!urlInput) return;
    const url = fullUrl(tab?.currentUrl);
    urlInput.value = state.addressEditing ? state.addressDraft : displayUrl(url);
    urlInput.title = url;
  }

  function syncZoom() {
    const tab = activeTab();
    const percent = Math.round((tab?.zoom ?? 1) * 100);
    zoomValue.textContent = `${percent}%`;
    zoomPill?.setAttribute('aria-label', `页面缩放 ${percent}%`);
  }

  function syncNav(tab = activeTab()) {
    const ready = !!tab?.webview && tab.domReady;
    let canBack = false;
    let canForward = false;
    try {
      canBack = ready && tab.webview.canGoBack();
      canForward = ready && tab.webview.canGoForward();
    } catch {}
    backBtn.disabled = !canBack;
    forwardBtn.disabled = !canForward;
    reloadBtn.disabled = !tab;
  }

  function syncStartPage() {
    const tab = activeTab();
    const empty = !tab || !fullUrl(tab.currentUrl);
    startPage.classList.toggle('hidden', !empty);
    errorBox.classList.toggle('hidden', !tab?.error);
    errorText.textContent = tab?.error || '';
  }

  function syncMeta(tab = activeTab()) {
    // Only the tab that came from the main window owns the sidebar handoff.
    // Tabs created inside this window must not rewrite the Agent-side tab.
    if (!tab || !tab.origin) return;
    const favicon = safeFavicon(tab.favicon);
    const payload = { title: tabTitle(tab), url: fullUrl(tab.currentUrl), favicon: favicon.length > 100000 ? '' : favicon };
    const key = `${payload.title}\n${payload.url}\n${payload.favicon}`;
    if (key === state.lastMeta) return;
    state.lastMeta = key;
    clearTimeout(state.metaTimer);
    state.metaTimer = setTimeout(() => api.updateMeta(payload), 180);
  }

  function renderTabs() {
    tabsHost.replaceChildren();
    for (const tab of state.tabs) {
      const wrapper = document.createElement('div');
      wrapper.className = `bw-tab${tab.id === state.activeId ? ' active' : ''}`;
      wrapper.dataset.bwTab = tab.id;

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'bw-tab-button';
      button.setAttribute('role', 'tab');
      button.setAttribute('aria-selected', String(tab.id === state.activeId));
      button.title = tabTitle(tab);

      const icon = document.createElement('span');
      icon.className = 'bw-tab-icon';
      const favicon = safeFavicon(tab.favicon);
      if (favicon) {
        const image = document.createElement('img');
        image.alt = '';
        image.src = favicon;
        image.addEventListener('error', () => { icon.innerHTML = GLOBE_ICON; }, { once: true });
        icon.append(image);
      } else {
        icon.innerHTML = GLOBE_ICON;
      }

      const label = document.createElement('span');
      label.className = 'bw-tab-label';
      label.textContent = tabTitle(tab);

      button.append(icon, label);
      button.addEventListener('click', () => activateTab(tab.id));

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'bw-tab-close';
      close.title = `关闭${tabTitle(tab)}`;
      close.setAttribute('aria-label', close.title);
      close.innerHTML = '<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
      close.addEventListener('click', event => {
        event.stopPropagation();
        closeTab(tab.id);
      });

      wrapper.append(button, close);
      tabsHost.append(wrapper);
    }
    const active = activeTab();
    tabsHost.querySelector(`[data-bw-tab="${CSS.escape(active?.id || '')}"]`)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function applyTabVisibility() {
    for (const tab of state.tabs) {
      tab.webview?.classList.toggle('hidden', tab.id !== state.activeId);
    }
    startPage.classList.toggle('hidden', !!fullUrl(activeTab()?.currentUrl));
    errorBox.classList.toggle('hidden', !activeTab()?.error);
  }

  function activateTab(tabId) {
    if (!state.tabs.some(tab => tab.id === tabId)) return;
    state.activeId = tabId;
    state.addressEditing = false;
    renderTabs();
    applyTabVisibility();
    syncAddress();
    syncZoom();
    syncNav();
    syncStartPage();
    syncMeta();
  }

  function createWebview(tab, initialUrl = '') {
    const webview = document.createElement('webview');
    webview.className = 'bw-webview hidden';
    webview.setAttribute('partition', 'persist:yan-browser');
    webview.setAttribute('allowpopups', '');
    if (chromiumUserAgent) webview.setAttribute('useragent', chromiumUserAgent);
    webview.setAttribute('src', initialUrl || 'about:blank');
    tab.webview = webview;
    viewport.insertBefore(webview, startPage);

    const update = () => {
      tab.currentUrl = fullUrl(webview.getURL?.() || tab.currentUrl);
      tab.title = webview.getTitle?.() || tab.title;
      syncAddress(tab);
      syncNav(tab);
      syncStartPage();
      syncMeta(tab);
      renderTabs();
    };

    webview.addEventListener('dom-ready', () => {
      tab.domReady = true;
      try { webview.setZoomFactor(tab.zoom || 1); } catch {}
      update();
    });
    webview.addEventListener('did-start-loading', () => {
      tab.error = '';
      syncStartPage();
    });
    webview.addEventListener('did-stop-loading', () => {
      tab.currentUrl = fullUrl(webview.getURL?.() || tab.currentUrl);
      syncAddress(tab);
      syncNav(tab);
      syncMeta(tab);
    });
    webview.addEventListener('did-navigate', event => {
      tab.currentUrl = fullUrl(event.url || webview.getURL?.());
      tab.error = '';
      update();
    });
    webview.addEventListener('did-navigate-in-page', event => {
      if (!event.isMainFrame) return;
      tab.currentUrl = fullUrl(event.url || webview.getURL?.());
      update();
    });
    webview.addEventListener('did-finish-load', update);
    webview.addEventListener('page-title-updated', event => {
      tab.title = String(event.title || '');
      renderTabs();
      syncMeta(tab);
    });
    webview.addEventListener('page-favicon-updated', event => {
      const favicon = (Array.isArray(event.favicons) ? event.favicons : []).map(safeFavicon).find(Boolean) || '';
      if (favicon === tab.favicon) return;
      tab.favicon = favicon;
      renderTabs();
      syncMeta(tab);
    });
    webview.addEventListener('did-fail-load', event => {
      if (event.isMainFrame === false || event.errorCode === -3) return;
      if (!event.validatedURL || event.validatedURL === 'about:blank') return;
      tab.error = `${event.errorDescription || `错误码 ${event.errorCode}`}（${event.validatedURL}）`;
      tab.currentUrl = fullUrl(event.validatedURL) || tab.currentUrl;
      syncStartPage();
    });
    webview.addEventListener('render-process-gone', event => {
      tab.error = `页面已崩溃（${event.reason || 'crashed'}）`;
      syncStartPage();
    });
    return webview;
  }

  function addTab({ url = '', title = '', favicon = '', activate = true, origin = false } = {}) {
    const tab = {
      id: nextTabId(),
      currentUrl: fullUrl(url),
      title: String(title || ''),
      favicon: safeFavicon(favicon),
      zoom: 1,
      domReady: false,
      error: '',
      origin
    };
    state.tabs.push(tab);
    createWebview(tab, tab.currentUrl);
    if (activate) {
      state.activeId = tab.id;
      applyTabVisibility();
      renderTabs();
      syncAddress(tab);
      syncZoom();
      syncNav(tab);
      syncStartPage();
    }
    return tab;
  }

  function navigate(input, tab = activeTab()) {
    if (!tab?.webview) return;
    const url = normalizeAddress(input);
    if (!url) return;
    tab.error = '';
    tab.currentUrl = url;
    state.addressEditing = false;
    syncStartPage();
    syncAddress(tab);
    if (tab.webview.getURL?.() === url) tab.webview.reload();
    else tab.webview.src = url;
    tab.webview.focus?.();
  }

  function closeTab(tabId) {
    const index = state.tabs.findIndex(tab => tab.id === tabId);
    if (index < 0) return;
    const [tab] = state.tabs.splice(index, 1);
    try { tab.webview?.remove(); } catch {}
    if (!state.tabs.length) {
      void api.closeWindow();
      return;
    }
    if (state.activeId === tabId) {
      const next = state.tabs[Math.min(index, state.tabs.length - 1)];
      state.activeId = next.id;
    }
    applyTabVisibility();
    renderTabs();
    syncAddress();
    syncZoom();
    syncNav();
    syncStartPage();
    syncMeta();
  }

  function setZoom(mode) {
    const tab = activeTab();
    if (!tab?.webview) return;
    if (mode === 'reset') tab.zoom = 1;
    else {
      const current = tab.zoom || 1;
      const direction = mode === 'in' ? 1 : -1;
      const candidates = direction > 0
        ? ZOOM_STEPS.filter(step => step > current + 0.001)
        : [...ZOOM_STEPS].reverse().filter(step => step < current - 0.001);
      tab.zoom = candidates[0] ?? current;
    }
    try { tab.webview.setZoomFactor(tab.zoom); } catch {}
    syncZoom();
  }

  function snapshotTabs() {
    const withUrl = state.tabs.filter(tab => fullUrl(tab.currentUrl));
    const origin = withUrl.find(tab => tab.origin);
    const ordered = origin ? [origin, ...withUrl.filter(tab => tab !== origin)] : withUrl;
    return ordered.map(tab => ({ id: tab.id, url: fullUrl(tab.currentUrl), title: tabTitle(tab), favicon: safeFavicon(tab.favicon) }));
  }

  function wireEvents() {
    $('#bwMin').addEventListener('click', () => api.minimize());
    $('#bwMax').addEventListener('click', () => api.toggleMaximize());
    $('#bwClose').addEventListener('click', () => api.closeWindow());
    $('#bwRestore').addEventListener('click', () => api.restore(snapshotTabs()));
    $('#bwPin').addEventListener('click', async () => {
      const next = !state.pinned;
      const result = await api.setPinned(next).catch(() => null);
      state.pinned = result?.pinned ?? next;
      syncPin();
    });
    $('#bwNewTab').addEventListener('click', () => {
      const tab = addTab();
      requestAnimationFrame(() => urlInput.focus());
      return tab;
    });
    startPage.addEventListener('click', () => urlInput.focus());
    backBtn.addEventListener('click', () => {
      const tab = activeTab();
      try { if (tab?.webview?.canGoBack()) tab.webview.goBack(); } catch {}
    });
    forwardBtn.addEventListener('click', () => {
      const tab = activeTab();
      try { if (tab?.webview?.canGoForward()) tab.webview.goForward(); } catch {}
    });
    reloadBtn.addEventListener('click', () => {
      const tab = activeTab();
      if (!tab?.webview) return;
      if (tab.error && tab.currentUrl) {
        tab.error = '';
        syncStartPage();
        tab.webview.src = tab.currentUrl;
        return;
      }
      try { tab.webview.reload(); } catch {}
    });

    urlInput.addEventListener('focus', () => {
      state.addressEditing = true;
      state.addressDraft = fullUrl(activeTab()?.currentUrl);
      urlInput.value = state.addressDraft;
      requestAnimationFrame(() => urlInput.select());
    });
    urlInput.addEventListener('input', () => {
      if (state.addressEditing) state.addressDraft = urlInput.value;
    });
    urlInput.addEventListener('blur', () => {
      state.addressEditing = false;
      syncAddress();
    });
    urlInput.addEventListener('keydown', event => {
      if (event.key === 'Enter') {
        event.preventDefault();
        navigate(state.addressDraft || urlInput.value);
        urlInput.blur();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        urlInput.blur();
      }
    });
    $('#bwGo').addEventListener('click', () => navigate(state.addressDraft || urlInput.value));

    $('#bwRetry').addEventListener('click', () => {
      const tab = activeTab();
      if (!tab?.currentUrl) return;
      tab.error = '';
      syncStartPage();
      if (tab.webview) tab.webview.src = tab.currentUrl;
    });

    document.querySelectorAll('[data-bw-zoom]').forEach(button => {
      button.addEventListener('click', () => setZoom(button.dataset.bwZoom));
    });

    api.onMaximizeChanged(maximized => document.body.classList.toggle('bw-maximized', maximized));
    api.onRestoreRequest(() => api.restore(snapshotTabs()));
    api.onNewTab(detail => {
      const url = String(detail?.url || '');
      if (!url) return;
      addTab({ url });
    });

    document.addEventListener('keydown', event => {
      const mod = event.ctrlKey || event.metaKey;
      if (!mod) return;
      const key = String(event.key || '').toLowerCase();
      if (key === 'l') { event.preventDefault(); urlInput.focus(); }
      else if (key === 't') { event.preventDefault(); addTab(); requestAnimationFrame(() => urlInput.focus()); }
      else if (key === 'w') { event.preventDefault(); closeTab(state.activeId); }
      else if (key === 'r') { event.preventDefault(); reloadBtn.click(); }
      else if (key === '=' || key === '+') { event.preventDefault(); setZoom('in'); }
      else if (key === '-') { event.preventDefault(); setZoom('out'); }
      else if (key === '0') { event.preventDefault(); setZoom('reset'); }
    });

    window.addEventListener('beforeunload', () => { clearTimeout(state.metaTimer); });
  }

  function syncPin() {
    const button = $('#bwPin');
    button.setAttribute('aria-pressed', String(state.pinned));
    button.title = state.pinned ? '取消置顶' : '置顶窗口';
    button.setAttribute('aria-label', button.title);
  }

  async function boot() {
    const init = await api.init().catch(() => null);
    if (!init) {
      document.body.innerHTML = '<div style="padding:32px;font:14px system-ui;color:#aaa">独立窗口未能初始化。</div>';
      return;
    }
    state.tabId = init.tabId;
    state.pinned = init.pinned === true;
    document.documentElement.setAttribute('data-theme', init.theme === 'light' ? 'light' : 'dark');
    syncPin();
    wireEvents();

    const initialTabs = Array.isArray(init.tabs) && init.tabs.length
      ? init.tabs
      : [{ url: init.url || '', title: init.title || '' }];
    initialTabs.forEach((tab, index) => addTab({
      url: tab.url,
      title: tab.title,
      favicon: tab.favicon,
      activate: index === initialTabs.length - 1,
      origin: index === 0
    }));
    syncZoom();
    syncNav();
    syncStartPage();
    syncMeta();
    const active = activeTab();
    if (active && !fullUrl(active.currentUrl)) requestAnimationFrame(() => urlInput.focus());
    else active?.webview?.focus?.();
    api.isMaximized().then(maximized => document.body.classList.toggle('bw-maximized', maximized === true)).catch(() => {});
  }

  boot();
})();

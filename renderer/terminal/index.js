/* Yan built-in terminal — one system shell PTY per ordinary sidebar tab. */
(function (namespace) {
  'use strict';

  let controller = null;
  let runtimePromise = null;

  function loadStyleOnce(href) {
    const existing = document.querySelector(`link[data-terminal-runtime="${href}"]`);
    if (existing?.dataset.loaded === 'true' || existing?.sheet) return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${href}`)), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const link = document.createElement('link');
      link.rel = 'stylesheet';
      link.href = href;
      link.dataset.terminalRuntime = href;
      link.addEventListener('load', () => {
        link.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      link.addEventListener('error', () => reject(new Error(`Failed to load ${href}`)), { once: true });
      document.head.appendChild(link);
    });
  }

  function loadScriptOnce(src) {
    const existing = document.querySelector(`script[data-terminal-runtime="${src}"]`);
    if (existing?.dataset.loaded === 'true') return Promise.resolve();
    if (existing) {
      return new Promise((resolve, reject) => {
        existing.addEventListener('load', resolve, { once: true });
        existing.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      });
    }
    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = src;
      script.dataset.terminalRuntime = src;
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => reject(new Error(`Failed to load ${src}`)), { once: true });
      document.body.appendChild(script);
    });
  }

  function loadTerminalRuntime() {
    if (TerminalCtor() && FitAddonCtor()) return Promise.resolve();
    if (!runtimePromise) {
      runtimePromise = (async () => {
        await loadStyleOnce('vendor/xterm/xterm.css');
        await loadScriptOnce('vendor/xterm/xterm.js');
        await loadScriptOnce('vendor/xterm/addon-fit.js');
        if (!TerminalCtor() || !FitAddonCtor()) throw new Error('Xterm runtime is unavailable');
      })().catch(error => {
        runtimePromise = null;
        throw error;
      });
    }
    return runtimePromise;
  }

  function TerminalCtor() {
    return window.Terminal || window.XTerm?.Terminal || null;
  }

  function FitAddonCtor() {
    if (window.FitAddon?.FitAddon) return window.FitAddon.FitAddon;
    if (window.FitAddon) return window.FitAddon;
    return null;
  }

  class TerminalController {
    constructor(options = {}) {
      this.api = options.api;
      this.content = document.querySelector('.rs-content');
      this.template = document.getElementById('terminalPanelTemplate');
      this.sessions = new Map();
      this.sessionByPtyId = new Map();
      this.pendingEvents = new Map();
      this.activeTabId = '';
      this.opened = false;
      this.creating = new Set();
      this.resizeObserver = null;
      this.unsubscribe = this.api?.onTerminalEvent?.(event => this.handleTerminalEvent(event));
      this.elementsReady = !!(this.content && this.template);
      if (!this.elementsReady) console.warn('[terminal] terminal template is unavailable');
      window.addEventListener('beforeunload', () => this.dispose());
    }

    ensureRuntime() {
      if (!this.elementsReady) return false;
      if (this.resizeObserver) return true;
      this.resizeObserver = new ResizeObserver(() => this.fit());
      this.resizeObserver.observe(this.content);
      window.addEventListener('resize', () => this.fit());
      this.themeObserver = new MutationObserver(() => this.applyTheme());
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return true;
    }

    panelFor(tabId) { return document.getElementById(`rs-${tabId}`); }

    async prepareTab(tabId, options = {}) {
      if (!this.elementsReady || !tabId) return false;
      try {
        await loadTerminalRuntime();
      } catch (error) {
        console.error('[terminal] runtime load failed:', error);
        return false;
      }
      if (!this.ensureRuntime()) return false;
      if (this.sessions.has(tabId) || this.creating.has(tabId)) return true;
      const fragment = this.template.content.cloneNode(true);
      const panel = fragment.querySelector('.terminal-panel');
      const screen = fragment.querySelector('.terminal-screen');
      const mount = fragment.querySelector('.terminal-mount');
      if (!panel || !screen || !mount) return false;
      panel.id = `rs-${tabId}`;
      panel.dataset.terminalTabId = tabId;
      screen.id = `terminal-screen-${tabId}`;
      mount.id = `terminal-mount-${tabId}`;
      this.content.appendChild(fragment);
      const active = this.opened && this.activeTabId === tabId;
      panel.classList.toggle('active', active);
      panel.setAttribute('aria-hidden', String(!active));
      this.creating.add(tabId);
      void this.createSession(tabId, options);
      return true;
    }

    async createSession(tabId, options = {}) {
      const workspace = String(options.workspace || '').trim();
      const size = this.measureSize(tabId);
      let result;
      try {
        result = await this.api?.terminalCreate?.({ ...size, ...(workspace ? { cwd: workspace } : {}) });
      } catch (error) {
        result = { error: error?.message || '终端启动失败。' };
      }
      this.creating.delete(tabId);
      if (!result || result.error || !result.id) {
        this.showError(tabId, result?.error || '终端启动失败。');
        return false;
      }
      const session = {
        tabId,
        id: String(result.id),
        cwd: String(result.cwd || workspace || ''),
        shell: String(result.shell || '终端'),
        term: null,
        fitAddon: null,
        disposables: [],
        writeQueue: Promise.resolve(),
        ready: false
      };
      this.sessions.set(tabId, session);
      this.sessionByPtyId.set(session.id, session);
      this.createTerm(session);
      const pending = this.pendingEvents.get(session.id) || [];
      this.pendingEvents.delete(session.id);
      pending.forEach(event => this.handleTerminalEvent(event));
      if (this.opened && this.activeTabId === tabId) this.activateTab(tabId, { focus: true });
      return true;
    }

    createTerm(session) {
      const Term = TerminalCtor();
      const Fit = FitAddonCtor();
      const mount = document.getElementById(`terminal-mount-${session.tabId}`);
      if (!mount) return;
      const term = new Term({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: '"Cascadia Mono", "Cascadia Code", "Microsoft YaHei UI", Consolas, monospace',
        lineHeight: 1.2,
        allowProposedApi: true,
        scrollback: 5000,
        convertEol: false,
        theme: this.terminalTheme()
      });
      const fitAddon = new Fit();
      term.loadAddon(fitAddon);
      term.open(mount);
      session.term = term;
      session.fitAddon = fitAddon;
      session.disposables = [
        term.onData(data => this.api?.terminalWrite?.(session.id, data)),
        term.onBinary(data => this.api?.terminalWrite?.(session.id, data)),
        term.onResize(({ cols, rows }) => this.api?.terminalResize?.(session.id, cols, rows))
      ];
      term.attachCustomKeyEventHandler(event => this.handleKeyEvent(session, event));
    }

    handleKeyEvent(session, event) {
      if (event.type !== 'keydown') return true;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        const selection = session.term?.getSelection?.();
        if (selection) navigator.clipboard?.writeText(selection);
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        navigator.clipboard?.readText?.().then(text => {
          if (text && this.sessions.has(session.tabId)) this.api?.terminalWrite?.(session.id, text);
        });
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'l') {
        session.term?.clear();
        return false;
      }
      return true;
    }

    activateTab(tabId, options = {}) {
      const session = this.sessions.get(tabId);
      this.activeTabId = tabId;
      this.opened = true;
      if (session) requestAnimationFrame(() => { this.fit(); if (options.focus !== false) session.term?.focus(); });
    }

    onTabHidden() { this.opened = false; }

    closeTab(tabId) {
      const session = this.sessions.get(tabId);
      this.creating.delete(tabId);
      if (session) {
        this.api?.terminalDestroy?.(session.id);
        this.disposeSession(session);
        this.sessions.delete(tabId);
        this.sessionByPtyId.delete(session.id);
      }
      this.panelFor(tabId)?.remove();
      if (this.activeTabId === tabId) this.activeTabId = '';
    }

    syncWorkspace() { return true; }

    showError(tabId, message) {
      const mount = this.panelFor(tabId)?.querySelector('.terminal-mount');
      if (mount) mount.textContent = message;
      this.panelFor(tabId)?.setAttribute('data-state', 'error');
    }

    handleTerminalEvent(event) {
      if (!event?.sessionId) return;
      const key = String(event.sessionId);
      const session = this.sessionByPtyId.get(key);
      if (!session) {
        const pending = this.pendingEvents.get(key) || [];
        pending.push(event);
        this.pendingEvents.set(key, pending);
        return;
      }
      if (event.type === 'output') this.writeOutput(session, event.data);
      if (event.type === 'ready') {
        session.ready = true;
        session.cwd = String(event.cwd || session.cwd);
        this.fit();
      }
      if (event.type === 'exit') {
        session.ready = false;
        session.term?.writeln('\r\n\x1b[90m[终端已退出]\x1b[0m\r\n');
      }
      if (event.type === 'error') {
        session.ready = false;
        session.term?.writeln(`\x1b[31m${event.message || '终端发生错误。'}\x1b[0m`);
      }
    }

    writeOutput(session, data) {
      if (!session.term || data == null) return;
      session.writeQueue = session.writeQueue.then(() => new Promise(resolve => session.term.write(String(data), resolve)));
    }

    measureSize(tabId) {
      const mount = this.panelFor(tabId)?.querySelector('.terminal-mount');
      const width = mount?.clientWidth || 900;
      const height = mount?.clientHeight || 600;
      return { cols: Math.max(20, Math.min(400, Math.floor(width / 8))), rows: Math.max(5, Math.min(200, Math.floor(height / 18))) };
    }

    fit() {
      const session = this.sessions.get(this.activeTabId);
      if (!session?.term || !session.fitAddon || !this.opened) return;
      try { session.fitAddon.fit(); } catch { /* hidden during sidebar transition */ }
    }

    terminalTheme() {
      return { background: '#151515', foreground: '#deded8', cursor: '#79b69b', selectionBackground: 'rgba(121, 182, 155, 0.28)', black: '#151515', red: '#e4857f', green: '#79b69b', yellow: '#d0b46a', blue: '#7aa2d4', magenta: '#c49ad4', cyan: '#7ec8c0', white: '#c8c8c0', brightBlack: '#85857e', brightRed: '#f0a09a', brightGreen: '#96d0b4', brightYellow: '#e0c880', brightBlue: '#96b8e0', brightMagenta: '#d8b4e4', brightCyan: '#96dcd4', brightWhite: '#f0f0e8' };
    }

    applyTheme() {
      const theme = this.terminalTheme();
      for (const session of this.sessions.values()) if (session.term) session.term.options.theme = theme;
    }

    disposeSession(session) {
      for (const disposable of session.disposables || []) { try { disposable.dispose?.(); } catch { /* ignore */ } }
      try { session.term?.dispose(); } catch { /* ignore */ }
    }

    dispose() {
      for (const session of this.sessions.values()) { this.api?.terminalDestroy?.(session.id); this.disposeSession(session); }
      this.sessions.clear();
      this.sessionByPtyId.clear();
      this.unsubscribe?.();
      this.resizeObserver?.disconnect();
      this.themeObserver?.disconnect();
    }
  }

  namespace.init = options => { if (!controller) controller = new TerminalController(options || {}); return controller; };
  namespace.prepareTab = (tabId, options) => controller?.prepareTab(tabId, options);
  namespace.activateTab = (tabId, options) => controller?.activateTab(tabId, options);
  namespace.closeTab = tabId => controller?.closeTab(tabId);
  namespace.onTabHidden = () => controller?.onTabHidden();
  namespace.close = () => controller?.onTabHidden();
  namespace.open = () => controller?.activateTab(controller?.activeTabId);
  namespace.ensureShown = tabId => controller?.activateTab(tabId || controller?.activeTabId);
  namespace.syncWorkspace = () => controller?.syncWorkspace();
  namespace.fit = () => controller?.fit();
})(window.YanTerminal = window.YanTerminal || {});

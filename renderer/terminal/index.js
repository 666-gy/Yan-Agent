/* Yan built-in terminal — real PTY + xterm.js (ConPTY on Windows). */
(function (namespace) {
  'use strict';

  let controller = null;
  const MAX_TERMINAL_SESSIONS = 4;

  function TerminalCtor() {
    return window.Terminal || window.XTerm?.Terminal || null;
  }

  function FitAddonCtor() {
    if (window.FitAddon?.FitAddon) return window.FitAddon.FitAddon;
    if (window.FitAddon) return window.FitAddon;
    return null;
  }

  class TerminalController {
    constructor(options) {
      this.api = options.api;
      this.hooks = options.hooks || {};
      this.panel = document.getElementById('terminalPanel');
      this.button = document.getElementById('taskBarTerminal');
      this.screen = document.getElementById('terminalScreen');
      this.mount = document.getElementById('terminalMount');
      this.tabs = document.getElementById('terminalTabs');
      this.newButton = document.getElementById('terminalNew');
      this.cwdEl = document.getElementById('terminalCwd');
      this.sessions = new Map();
      this.activeSessionId = '';
      this.nextTabNumber = 1;
      this.opened = false;
      this.creatingSession = false;
      this.pendingSessionEvents = [];
      this.resizeObserver = null;
      this.unsubscribe = null;
      this.elementsReady = !!(this.panel && this.button && this.screen && this.mount && this.tabs && this.newButton);
      if (!this.elementsReady) return;
      this.bindEvents();
      this.updateNewButton();
    }

    bindEvents() {
      this.button.addEventListener('click', () => this.toggle());
      document.getElementById('terminalClose')?.addEventListener('click', () => this.close());
      document.getElementById('terminalClear')?.addEventListener('click', () => this.clear());
      this.newButton.addEventListener('click', () => this.createSession());
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.opened) this.close();
      });
      this.unsubscribe = this.api.onTerminalEvent?.(event => this.handleTerminalEvent(event));
      window.addEventListener('beforeunload', () => {
        for (const session of this.sessions.values()) this.api.terminalDestroy?.(session.id);
        this.unsubscribe?.();
        this.disposeAllSessions();
      });
    }

    async toggle() {
      if (this.opened) this.close();
      else await this.open();
    }

    async open() {
      if (!this.elementsReady) return;
      this.hooks.closeBrowser?.();
      this.hooks.closeCodeMap?.();
      this.panel.classList.remove('hidden');
      this.button.classList.add('active');
      this.opened = true;
      if (!this.ensureRuntime()) return;
      const workspace = this.currentWorkspace();
      const matchingSession = this.findWorkspaceSession(workspace);
      if (matchingSession) this.setActiveSession(matchingSession.id, { focus: false });
      else await this.createSession({ workspace });
      this.fit();
      requestAnimationFrame(() => {
        this.fit();
        this.activeSession()?.term?.focus();
      });
    }

    close() {
      if (!this.elementsReady) return;
      this.panel.classList.add('hidden');
      this.button.classList.remove('active');
      this.opened = false;
    }

    async syncWorkspace() {
      if (!this.opened || !this.elementsReady) return false;
      const workspace = this.currentWorkspace();
      const matchingSession = this.findWorkspaceSession(workspace);
      if (matchingSession) {
        this.setActiveSession(matchingSession.id, { focus: false });
        return true;
      }
      return this.createSession({ workspace });
    }

    ensureRuntime() {
      if (this.resizeObserver) return true;
      if (!TerminalCtor() || !FitAddonCtor()) {
        this.mount.textContent = 'xterm 组件未加载。请检查 renderer/vendor/xterm。';
        return false;
      }
      this.resizeObserver = new ResizeObserver(() => {
        if (this.opened) this.fit();
      });
      this.resizeObserver.observe(this.screen);
      this.onWindowResize = () => {
        if (this.opened) this.fit();
      };
      window.addEventListener('resize', this.onWindowResize);
      this.themeObserver = new MutationObserver(() => this.applyTheme());
      this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
      return true;
    }

    createTerm(session) {
      const Term = TerminalCtor();
      const Fit = FitAddonCtor();
      const view = document.createElement('div');
      view.className = 'terminal-session-view';
      view.dataset.sessionId = session.id;
      view.id = `terminal-session-${session.id}`;
      view.setAttribute('role', 'tabpanel');
      view.setAttribute('aria-label', session.label);
      const mount = document.createElement('div');
      mount.className = 'terminal-xterm-mount';
      view.appendChild(mount);
      this.mount.appendChild(view);

      const term = new Term({
        cursorBlink: true,
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: '"Cascadia Mono", "Cascadia Code", "Microsoft YaHei UI", Consolas, "Courier New", monospace',
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
      session.view = view;
      session.mount = mount;
      session.disposables = [
        term.onData(data => this.api.terminalWrite?.(session.id, data)),
        term.onBinary(data => this.api.terminalWrite?.(session.id, data)),
        term.onResize(({ cols, rows }) => this.api.terminalResize?.(session.id, cols, rows))
      ];
      term.attachCustomKeyEventHandler(event => this.handleKeyEvent(session, event));
    }

    handleKeyEvent(session, event) {
      if (event.type !== 'keydown') return true;
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'c') {
        const selection = session.term.getSelection();
        if (selection) {
          navigator.clipboard?.writeText(selection);
          return false;
        }
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
        navigator.clipboard?.readText?.().then(text => {
          if (text && this.sessions.has(session.id)) this.api.terminalWrite?.(session.id, text);
        });
        return false;
      }
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'l') {
        session.term.clear();
        return false;
      }
      return true;
    }

    currentWorkspace() {
      return String(this.hooks.getWorkspace?.() || '').trim();
    }

    workspaceKey(workspace) {
      return String(workspace || '')
        .trim()
        .replace(/[\\/]+$/, '')
        .toLocaleLowerCase();
    }

    findWorkspaceSession(workspace) {
      const key = this.workspaceKey(workspace);
      return [...this.sessions.values()].find(session => session.workspaceKey === key) || null;
    }

    async createSession(options = {}) {
      if (this.creatingSession || !this.ensureRuntime()) return false;
      this.creatingSession = true;
      this.pendingSessionEvents = [];
      this.updateNewButton();
      const size = this.measureSize();
      const workspace = Object.prototype.hasOwnProperty.call(options, 'workspace')
        ? String(options.workspace || '').trim()
        : this.currentWorkspace();
      let result;
      try {
        result = await this.api.terminalCreate?.({
          ...size,
          ...(workspace ? { cwd: workspace } : {})
        });
      } catch (error) {
        result = { error: error?.message || '终端启动失败。' };
      }
      this.creatingSession = false;
      if (!result || result.error) {
        this.pendingSessionEvents = [];
        this.updateNewButton();
        this.showCreateError(result?.error || '终端启动接口不可用。');
        return false;
      }

      const session = {
        id: result.id,
        label: `终端 ${this.nextTabNumber++}`,
        cwd: result.cwd || '',
        workspaceKey: this.workspaceKey(workspace),
        shell: result.shell || 'PowerShell 7',
        locale: '',
        ready: false,
        term: null,
        fitAddon: null,
        view: null,
        mount: null,
        disposables: [],
        writeQueue: Promise.resolve()
      };
      this.sessions.set(session.id, session);
      this.updateNewButton();
      this.createTerm(session);
      const pendingEvents = this.pendingSessionEvents.filter(event => event.sessionId === session.id);
      this.pendingSessionEvents = [];
      pendingEvents.forEach(event => this.handleTerminalEvent(event));
      this.setActiveSession(session.id, { focus: true });
      return true;
    }

    updateNewButton() {
      const atCapacity = this.sessions.size >= MAX_TERMINAL_SESSIONS;
      this.newButton.disabled = this.creatingSession || atCapacity;
      this.newButton.dataset.busy = String(this.creatingSession);
      const label = atCapacity ? `最多打开 ${MAX_TERMINAL_SESSIONS} 个 PowerShell 终端` : '新建 PowerShell 终端';
      this.newButton.title = label;
      this.newButton.setAttribute('aria-label', label);
    }

    showCreateError(message) {
      if (this.sessions.size) return;
      this.mount.textContent = message;
    }

    setActiveSession(sessionId, options = {}) {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      this.activeSessionId = sessionId;
      for (const candidate of this.sessions.values()) {
        const active = candidate.id === sessionId;
        candidate.view?.classList.toggle('active', active);
      }
      this.renderTabs();
      this.updateMeta();
      requestAnimationFrame(() => {
        this.fit();
        if (options.focus !== false && this.opened) session.term?.focus();
      });
    }

    renderTabs() {
      this.tabs.replaceChildren();
      for (const session of this.sessions.values()) {
        const tab = document.createElement('div');
        tab.className = 'terminal-tab';
        if (session.id === this.activeSessionId) tab.classList.add('active');
        const select = document.createElement('button');
        select.type = 'button';
        select.className = 'terminal-tab-select';
        select.setAttribute('role', 'tab');
        select.setAttribute('aria-selected', String(session.id === this.activeSessionId));
        select.setAttribute('aria-controls', `terminal-session-${session.id}`);
        select.title = `${session.shell} · ${session.cwd || '用户目录'}`;
        select.textContent = session.label;
        select.addEventListener('click', () => this.setActiveSession(session.id));
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'terminal-tab-close';
        close.title = `关闭${session.label}`;
        close.setAttribute('aria-label', `关闭${session.label}`);
        close.innerHTML = '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true"><path d="m6 6 12 12M18 6 6 18"/></svg>';
        close.addEventListener('click', event => {
          event.stopPropagation();
          this.destroySession(session.id);
        });
        tab.append(select, close);
        this.tabs.appendChild(tab);
      }
    }

    destroySession(sessionId) {
      const session = this.sessions.get(sessionId);
      if (!session) return;
      const sessionIds = [...this.sessions.keys()];
      const sessionIndex = sessionIds.indexOf(sessionId);
      this.api.terminalDestroy?.(session.id);
      this.disposeSession(session);
      this.sessions.delete(sessionId);
      this.updateNewButton();
      if (!this.sessions.size) {
        this.activeSessionId = '';
        this.renderTabs();
        this.updateMeta();
        this.close();
        return;
      }
      const nextSessionId = sessionIds[sessionIndex + 1] || sessionIds[sessionIndex - 1];
      this.setActiveSession(nextSessionId, { focus: this.opened });
    }

    disposeSession(session) {
      for (const disposable of session.disposables || []) {
        try { disposable.dispose?.(); } catch { /* ignore */ }
      }
      try { session.term?.dispose(); } catch { /* ignore */ }
      session.view?.remove();
    }

    disposeAllSessions() {
      this.resizeObserver?.disconnect();
      this.themeObserver?.disconnect();
      if (this.onWindowResize) window.removeEventListener('resize', this.onWindowResize);
      for (const session of this.sessions.values()) this.disposeSession(session);
      this.sessions.clear();
      this.activeSessionId = '';
      this.resizeObserver = null;
      this.updateNewButton();
    }

    terminalTheme() {
      const isLight = document.documentElement.getAttribute('data-theme') === 'light';
      return isLight
        ? {
            background: '#fbfbf8', foreground: '#272725', cursor: '#39765c', selectionBackground: 'rgba(57, 118, 92, 0.28)',
            black: '#272725', red: '#b33d38', green: '#39765c', yellow: '#9a6b12', blue: '#2f5f9a', magenta: '#7a4f8a', cyan: '#2f6f6a', white: '#5c5c56',
            brightBlack: '#77776f', brightRed: '#d0504a', brightGreen: '#4a9070', brightYellow: '#b8861a', brightBlue: '#3f78c0', brightMagenta: '#9862ab', brightCyan: '#3f9088', brightWhite: '#1c1c1a'
          }
        : {
            background: '#151515', foreground: '#deded8', cursor: '#79b69b', selectionBackground: 'rgba(121, 182, 155, 0.28)',
            black: '#151515', red: '#e4857f', green: '#79b69b', yellow: '#d0b46a', blue: '#7aa2d4', magenta: '#c49ad4', cyan: '#7ec8c0', white: '#c8c8c0',
            brightBlack: '#85857e', brightRed: '#f0a09a', brightGreen: '#96d0b4', brightYellow: '#e0c880', brightBlue: '#96b8e0', brightMagenta: '#d8b4e4', brightCyan: '#96dcd4', brightWhite: '#f0f0e8'
          };
    }

    applyTheme() {
      const theme = this.terminalTheme();
      for (const session of this.sessions.values()) {
        if (session.term) session.term.options.theme = theme;
      }
    }

    fit() {
      const session = this.activeSession();
      if (!session?.term || !session.fitAddon || !this.opened) return;
      try {
        session.fitAddon.fit();
      } catch {
        /* xterm may not be measurable while hidden. */
      }
    }

    measureSize() {
      const session = this.activeSession();
      if (session?.term?.cols > 0 && session.term.rows > 0) {
        return { cols: session.term.cols, rows: session.term.rows };
      }
      return { cols: 120, rows: 30 };
    }

    activeSession() {
      return this.sessions.get(this.activeSessionId) || null;
    }

    clear() {
      const session = this.activeSession();
      session?.term?.clear();
      session?.term?.focus();
    }

    handleTerminalEvent(event) {
      if (!event) return;
      const session = this.sessions.get(event.sessionId);
      if (!session) {
        if (this.creatingSession && event.sessionId) this.pendingSessionEvents.push(event);
        return;
      }
      switch (event.type) {
        case 'output':
          this.writeOutput(session, event.data);
          break;
        case 'ready':
          session.ready = true;
          session.cwd = event.cwd || session.cwd;
          session.shell = event.shell || session.shell;
          session.locale = event.locale || session.locale;
          if (session.id === this.activeSessionId) this.updateMeta();
          this.fit();
          break;
        case 'exit':
          session.ready = false;
          session.term?.writeln('\r\n\x1b[90m[终端已退出，关闭该标签后可新建终端]\x1b[0m\r\n');
          break;
        case 'error':
          session.ready = false;
          session.term?.writeln(`\x1b[31m${event.message || '终端发生错误。'}\x1b[0m`);
          break;
        default:
          break;
      }
    }

    writeOutput(session, data) {
      if (!session.term || data == null) return;
      session.writeQueue = session.writeQueue.then(
        () => new Promise(resolve => session.term.write(String(data), resolve))
      );
    }

    updateMeta() {
      if (!this.cwdEl) return;
      const session = this.activeSession();
      const cwd = session?.cwd || '用户目录';
      this.cwdEl.textContent = cwd;
      this.cwdEl.title = `${session?.shell || 'PowerShell 7'}${session?.locale ? ` · ${session.locale}` : ''} · ${cwd}`;
    }
  }

  namespace.init = options => {
    if (!controller) controller = new TerminalController(options || {});
    return controller;
  };
  namespace.open = () => controller?.open();
  namespace.close = () => controller?.close();
  namespace.toggle = () => controller?.toggle();
  namespace.syncWorkspace = () => controller?.syncWorkspace();
  namespace.fit = () => controller?.fit();
})(window.YanTerminal = window.YanTerminal || {});

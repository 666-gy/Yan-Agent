/* Yan built-in terminal - persistent PowerShell session controller. */
(function (namespace) {
  'use strict';

  const MAX_OUTPUT_CHARS = 1_000_000;
  const MAX_OUTPUT_NODES = 1200;
  let controller = null;

  class TerminalController {
    constructor(options) {
      this.api = options.api;
      this.hooks = options.hooks || {};
      this.panel = document.getElementById('terminalPanel');
      this.button = document.getElementById('taskBarTerminal');
      this.screen = document.getElementById('terminalScreen');
      this.output = document.getElementById('terminalOutput');
      this.form = document.getElementById('terminalForm');
      this.input = document.getElementById('terminalInput');
      this.prompt = document.getElementById('terminalPrompt');
      this.cwdEl = document.getElementById('terminalCwd');
      this.status = document.getElementById('terminalStatus');
      this.statusText = document.getElementById('terminalStatusText');
      this.interruptButton = document.getElementById('terminalInterrupt');
      this.runButton = document.getElementById('terminalRun');
      this.sessionId = '';
      this.cwd = '';
      this.shell = 'PowerShell';
      this.version = '';
      this.locale = '';
      this.codePage = 0;
      this.encodingLabel = '本地编码';
      this.busy = false;
      this.opened = false;
      this.outputChars = 0;
      this.history = [];
      this.historyIndex = 0;
      this.unsubscribe = null;
      this.ready = false;
      this.elementsReady = !!(this.panel && this.button && this.output && this.input);
      if (!this.elementsReady) return;
      this.bindEvents();
    }

    bindEvents() {
      this.button.addEventListener('click', () => this.toggle());
      document.getElementById('terminalClose')?.addEventListener('click', () => this.close());
      document.getElementById('terminalClear')?.addEventListener('click', () => this.clear());
      document.getElementById('terminalRestart')?.addEventListener('click', () => this.restart());
      this.interruptButton?.addEventListener('click', () => this.interrupt());
      this.form?.addEventListener('submit', event => {
        event.preventDefault();
        this.submit();
      });
      this.input.addEventListener('input', () => this.resizeInput());
      this.input.addEventListener('keydown', event => this.handleInputKeydown(event));
      this.screen?.addEventListener('click', event => {
        if (!window.getSelection()?.toString() && event.target === this.screen) this.input.focus();
      });
      document.addEventListener('keydown', event => {
        if (event.key === 'Escape' && this.opened) this.close();
      });
      this.unsubscribe = this.api.onTerminalEvent?.(event => this.handleTerminalEvent(event));
      window.addEventListener('beforeunload', () => {
        if (this.sessionId) this.api.terminalDestroy?.(this.sessionId);
        this.unsubscribe?.();
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
      this.scrollToBottom(true);
      await this.ensureSession();
      requestAnimationFrame(() => this.input.focus());
    }

    close() {
      if (!this.elementsReady) return;
      this.panel.classList.add('hidden');
      this.button.classList.remove('active');
      this.opened = false;
    }

    async ensureSession() {
      if (this.sessionId) return true;
      this.setStatus('starting', '正在启动');
      const result = await this.api.terminalCreate?.();
      if (!result || result.error) {
        const message = result?.error || '终端启动接口不可用。';
        this.setStatus('error', '启动失败');
        this.append(message + '\n', 'system');
        return false;
      }
      this.sessionId = result.id;
      this.cwd = result.cwd || '';
      this.shell = result.shell || 'PowerShell';
      this.updatePrompt();
      return true;
    }

    async submit() {
      const source = this.input.value;
      if (!source.trim()) return;
      if (!(await this.ensureSession())) return;
      this.input.value = '';
      this.resizeInput();

      if (this.busy) {
        this.append(source + '\n', 'command');
        const result = await this.api.terminalWrite(this.sessionId, source + '\r\n');
        if (result?.error) this.append(result.error + '\n', 'error');
        return;
      }

      if (/^(cls|clear|clear-host)$/i.test(source.trim())) {
        this.clear();
        return;
      }

      this.history.push(source);
      if (this.history.length > 200) this.history.shift();
      this.historyIndex = this.history.length;
      this.append(`${this.formatPrompt()} ${source}\n`, 'command');
      this.setBusy(true);
      const result = await this.api.terminalExecute(this.sessionId, source);
      if (result?.error) {
        this.setBusy(false);
        this.setStatus('error', '命令未发送');
        this.append(result.error + '\n', 'error');
      }
    }

    async interrupt() {
      if (!this.sessionId || !this.busy) return;
      this.append('^C\n', 'system');
      this.setBusy(false);
      this.setStatus('restarting', '正在中断');
      const result = await this.api.terminalInterrupt(this.sessionId);
      if (result?.error) {
        this.setStatus('error', '中断失败');
        this.append(result.error + '\n', 'error');
      }
    }

    async restart() {
      if (!(await this.ensureSession())) return;
      this.setBusy(false);
      this.setStatus('restarting', '正在重启');
      const result = await this.api.terminalRestart(this.sessionId);
      if (result?.error) {
        this.setStatus('error', '重启失败');
        this.append(result.error + '\n', 'error');
      }
      this.input.focus();
    }

    handleTerminalEvent(event) {
      if (!event || event.sessionId !== this.sessionId) return;
      switch (event.type) {
        case 'output':
          this.append(event.data, event.stream === 'stderr' ? 'error' : 'output');
          break;
        case 'ready':
          this.ready = true;
          this.cwd = event.cwd || this.cwd;
          this.shell = event.shell || this.shell;
          this.version = event.version || '';
          this.locale = event.locale || this.locale;
          this.codePage = Number(event.codePage) || this.codePage;
          this.encodingLabel = /^zh(?:-|$)/i.test(this.locale) ? '中文' : `CP${this.codePage || '本地'}`;
          this.setBusy(false);
          this.setStatus('ready', `就绪 · ${this.encodingLabel}`);
          if (this.status) this.status.title = `语言：${this.locale || '系统默认'} · 输出代码页：${this.codePage || '自动'}`;
          this.updatePrompt();
          break;
        case 'state':
          if (event.status === 'running') {
            this.setBusy(true);
            this.setStatus('running', '运行中');
          } else if (event.status === 'restarting') {
            this.setBusy(false);
            this.setStatus('restarting', '正在重启');
          }
          break;
        case 'complete':
          this.cwd = event.cwd || this.cwd;
          this.setBusy(false);
          this.setStatus('ready', `就绪 · ${this.encodingLabel}`);
          this.updatePrompt();
          if (event.exitCode) this.append(`[退出码 ${event.exitCode}]\n`, 'system');
          break;
        case 'interrupted':
          this.setBusy(false);
          this.setStatus('restarting', '正在恢复');
          break;
        case 'exit':
          this.ready = false;
          this.setBusy(false);
          this.setStatus('exited', `已退出 · ${event.code ?? 0}`);
          this.append(`[PowerShell 已退出，输入下一条命令时会自动重启]\n`, 'system');
          break;
        case 'error':
          this.ready = false;
          this.setBusy(false);
          this.setStatus('error', '终端错误');
          this.append((event.message || '终端发生错误。') + '\n', 'error');
          break;
        default:
          break;
      }
    }

    handleInputKeydown(event) {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        this.form?.requestSubmit();
        return;
      }
      if (event.key === 'ArrowUp' && !event.shiftKey && !this.busy) {
        event.preventDefault();
        this.recallHistory(-1);
        return;
      }
      if (event.key === 'ArrowDown' && !event.shiftKey && !this.busy) {
        event.preventDefault();
        this.recallHistory(1);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'l') {
        event.preventDefault();
        this.clear();
        return;
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'c') {
        const hasSelection = this.input.selectionStart !== this.input.selectionEnd || !!window.getSelection()?.toString();
        if (!hasSelection && this.busy) {
          event.preventDefault();
          this.interrupt();
        }
      }
    }

    recallHistory(direction) {
      if (!this.history.length) return;
      this.historyIndex = Math.max(0, Math.min(this.history.length, this.historyIndex + direction));
      this.input.value = this.historyIndex === this.history.length ? '' : this.history[this.historyIndex];
      this.resizeInput();
      requestAnimationFrame(() => this.input.setSelectionRange(this.input.value.length, this.input.value.length));
    }

    clear() {
      if (!this.output) return;
      this.output.replaceChildren();
      this.outputChars = 0;
      this.scrollToBottom(true);
      this.input?.focus();
    }

    append(data, kind = 'output') {
      const text = this.sanitizeOutput(data);
      if (!text || !this.output) return;
      const shouldFollow = this.isNearBottom();
      const chunk = document.createElement('span');
      chunk.className = 'terminal-output-chunk';
      if (kind === 'error') chunk.classList.add('is-error');
      if (kind === 'system') chunk.classList.add('is-system');
      if (kind === 'command') chunk.classList.add('is-command');
      chunk.textContent = text;
      this.output.appendChild(chunk);
      this.outputChars += text.length;
      this.trimOutput();
      if (shouldFollow || kind === 'command') this.scrollToBottom();
    }

    sanitizeOutput(value) {
      let text = String(value ?? '');
      text = text
        .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
        .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '')
        .replace(/\x1b[()][A-Z0-9]/g, '')
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .replace(/\r/g, '\n');
      while (/[^\n]\u0008/.test(text)) text = text.replace(/[^\n]\u0008/g, '');
      return text.replace(/\u0008/g, '');
    }

    trimOutput() {
      while (this.output.childNodes.length > MAX_OUTPUT_NODES || this.outputChars > MAX_OUTPUT_CHARS) {
        const first = this.output.firstChild;
        if (!first) break;
        this.outputChars -= first.textContent?.length || 0;
        first.remove();
      }
    }

    setBusy(busy) {
      this.busy = !!busy;
      if (this.interruptButton) this.interruptButton.disabled = !this.busy;
      if (this.runButton) this.runButton.title = this.busy ? '发送输入' : '运行命令';
      if (this.input) this.input.placeholder = this.busy ? '向当前进程发送输入' : '输入 PowerShell 命令';
    }

    setStatus(status, text) {
      if (this.status) this.status.dataset.status = status;
      if (this.statusText) this.statusText.textContent = text;
    }

    updatePrompt() {
      const full = this.cwd || '用户目录';
      if (this.cwdEl) {
        const shellVersion = this.version ? `${this.shell} ${this.version}` : this.shell;
        this.cwdEl.textContent = full;
        this.cwdEl.title = `${shellVersion} · ${full}`;
      }
      if (this.prompt) {
        this.prompt.textContent = this.formatPrompt();
        this.prompt.title = full;
      }
    }

    formatPrompt() {
      let display = this.cwd || '~';
      if (display.length > 42) {
        const parts = display.split(/[\\/]/).filter(Boolean);
        const root = /^[a-zA-Z]:/.test(display) ? display.slice(0, 2) : '';
        display = `${root}\\…\\${parts.slice(-2).join('\\')}`;
      }
      return `PS ${display}>`;
    }

    resizeInput() {
      if (!this.input) return;
      this.input.style.height = 'auto';
      this.input.style.height = `${Math.min(100, Math.max(26, this.input.scrollHeight))}px`;
    }

    isNearBottom() {
      if (!this.screen) return true;
      return this.screen.scrollHeight - this.screen.scrollTop - this.screen.clientHeight < 80;
    }

    scrollToBottom(immediate = false) {
      if (!this.screen) return;
      requestAnimationFrame(() => {
        this.screen.scrollTo({ top: this.screen.scrollHeight, behavior: immediate ? 'auto' : 'smooth' });
      });
    }
  }

  namespace.init = options => {
    if (!controller) controller = new TerminalController(options || {});
    return controller;
  };
  namespace.open = () => controller?.open();
  namespace.close = () => controller?.close();
  namespace.toggle = () => controller?.toggle();
})(window.YanTerminal = window.YanTerminal || {});

/* Yan Browser Agent Bridge — controls the visible built-in webview. */
(function (namespace) {
  'use strict';

  const MAX_SNAPSHOT_ITEMS = 80;
  const MAX_TEXT_LENGTH = 12000;
  const SNAPSHOT_SCRIPT = String.raw`(() => {
    const interactiveSelector = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'textarea', 'select',
      '[contenteditable="true"]', '[role="button"]', '[role="link"]',
      '[role="textbox"]', '[role="checkbox"]', '[role="radio"]', '[role="tab"]',
      '[role="menuitem"]', '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const refs = new Map();
    const visible = element => {
      if (!element || !element.isConnected) return false;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0
        && rect.width > 0 && rect.height > 0;
    };
    const text = value => String(value || '').replace(/\s+/g, ' ').trim();
    const labelFor = element => {
      const labelledBy = text(element.getAttribute('aria-label'));
      if (labelledBy) return labelledBy;
      const ids = text(element.getAttribute('aria-labelledby'));
      if (ids) {
        const value = ids.split(/\s+/).map(id => document.getElementById(id)?.innerText || '').join(' ');
        if (text(value)) return text(value);
      }
      if (element.id) {
        const label = document.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        if (label && text(label.innerText)) return text(label.innerText);
      }
      const parentLabel = element.closest('label');
      if (parentLabel && text(parentLabel.innerText)) return text(parentLabel.innerText);
      return text(element.getAttribute('placeholder')) || text(element.getAttribute('title'))
        || text(element.getAttribute('alt')) || text(element.innerText)
        || text(element.value) || text(element.getAttribute('name'));
    };
    const roleFor = element => {
      const explicit = text(element.getAttribute('role'));
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        const type = (element.type || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        return 'textbox';
      }
      if (element.isContentEditable) return 'textbox';
      return 'generic';
    };
    const stateFor = element => {
      const state = {};
      if (element.disabled || element.getAttribute('aria-disabled') === 'true') state.disabled = true;
      if (element.checked || element.getAttribute('aria-checked') === 'true') state.checked = true;
      if (element.selected || element.getAttribute('aria-selected') === 'true') state.selected = true;
      if ('value' in element && element.value) state.value = String(element.value).slice(0, 160);
      return state;
    };
    const elements = [...document.querySelectorAll(interactiveSelector)]
      .filter(visible)
      .filter((element, index, list) => list.indexOf(element) === index)
      .slice(0, ${MAX_SNAPSHOT_ITEMS});
    const items = elements.map((element, index) => {
      const ref = 'e' + (index + 1);
      const rect = element.getBoundingClientRect();
      refs.set(ref, element);
      return {
        ref,
        role: roleFor(element),
        name: labelFor(element).slice(0, 180),
        state: stateFor(element),
        rect: { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
      };
    });
    window.__yanBrowserRefs = refs;
    const bodyText = text(document.body?.innerText).slice(0, 1800);
    return {
      url: location.href,
      title: document.title || '',
      viewport: { width: window.innerWidth, height: window.innerHeight },
      items,
      bodyText
    };
  })()`;

  const actionScript = (ref, action) => {
    const encoded = JSON.stringify(String(ref || ''));
    return `(() => {
      const ref = ${encoded};
      const element = window.__yanBrowserRefs?.get(ref);
      if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
      const initialRect = element.getBoundingClientRect();
      if (!initialRect.width || !initialRect.height) return { ok: false, error: '目标元素当前不可见。', code: 'HIDDEN_ELEMENT' };
      element.scrollIntoView({ block: 'center', inline: 'center' });
      const rect = element.getBoundingClientRect();
      return { ok: true, x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2), tag: element.tagName.toLowerCase(), name: String(element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 160) };
    })()`;
  };

  class BrowserAgentController {
    constructor(options = {}) {
      this.webview = options.webview;
      this.panel = options.panel;
      this.status = options.status;
      this.busyTimer = null;
      this.bindEvents();
    }

    bindEvents() {
      this.webview?.addEventListener('did-start-loading', () => this.invalidateRefs());
      this.webview?.addEventListener('did-navigate', () => this.invalidateRefs());
      this.webview?.addEventListener('did-navigate-in-page', () => this.invalidateRefs());
    }

    invalidateRefs() {
      this.lastSnapshot = null;
      this.setBusy(false);
    }

    setBusy(busy) {
      this.panel?.classList.toggle('browser-agent-active', !!busy);
      if (!this.status) return;
      this.status.classList.toggle('hidden', !busy);
      this.status.setAttribute('aria-hidden', String(!busy));
      if (busy) this.status.textContent = 'Agent 操作中';
      else if (this.busyTimer) clearTimeout(this.busyTimer);
    }

    async withAction(callback) {
      this.setBusy(true);
      try {
        return await callback();
      } catch (error) {
        return { ok: false, error: `浏览器操作失败：${error?.message || error}`, code: 'BROWSER_BRIDGE_ERROR' };
      } finally {
        if (this.busyTimer) clearTimeout(this.busyTimer);
        this.busyTimer = setTimeout(() => this.setBusy(false), 260);
      }
    }

    async executePage(expression) {
      if (!this.webview?.getURL || !this.webview.getURL() || this.webview.getURL() === 'about:blank') {
        return { ok: false, error: '内置浏览器尚未打开页面。请先调用 open_builtin_browser。', code: 'BROWSER_NOT_OPEN' };
      }
      return this.webview.executeJavaScript(expression, true);
    }

    async snapshot() {
      return this.withAction(async () => {
        const result = await this.executePage(SNAPSHOT_SCRIPT);
        if (!result?.items) return result;
        this.lastSnapshot = result;
        const lines = [
          `URL: ${result.url}`,
          `标题: ${result.title || '(无标题)'}`,
          `视口: ${result.viewport.width}x${result.viewport.height}`,
          '可交互元素:'
        ];
        for (const item of result.items) {
          const state = Object.entries(item.state || {}).map(([key, value]) => `${key}=${value}`).join(', ');
          lines.push(`[${item.ref}] ${item.role}${item.name ? ` "${item.name}"` : ''}${state ? ` (${state})` : ''}`);
        }
        if (result.bodyText) lines.push(`页面文本:\n${result.bodyText}`);
        return { ok: true, output: lines.join('\n'), url: result.url, title: result.title, count: result.items.length };
      });
    }

    async readPage() {
      return this.withAction(async () => {
        const result = await this.executePage(`(() => ({ url: location.href, title: document.title || '', text: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_TEXT_LENGTH}) }))()`);
        if (!result?.url) return result;
        return { ok: true, output: `URL: ${result.url}\n标题: ${result.title || '(无标题)'}\n${result.text}`, url: result.url, title: result.title };
      });
    }

    async click(ref) {
      return this.withAction(async () => {
        const target = await this.executePage(actionScript(ref, 'click'));
        if (!target?.ok) return target;
        try {
          this.webview.sendInputEvent?.({ type: 'mouseDown', x: target.x, y: target.y, button: 'left', clickCount: 1 });
          this.webview.sendInputEvent?.({ type: 'mouseUp', x: target.x, y: target.y, button: 'left', clickCount: 1 });
        } catch {
          await this.executePage(`(() => { const el = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref))}); el?.click(); return true; })()`);
        }
        await this.waitForSettle(500);
        return { ok: true, output: `已点击 ${ref}${target.name ? `：${target.name}` : ''}`, url: this.webview.getURL?.() || '' };
      });
    }

    async type(ref, text) {
      const value = String(text ?? '');
      if (!value || value.length > MAX_TEXT_LENGTH) return { ok: false, error: `输入内容必须为 1-${MAX_TEXT_LENGTH} 个字符。`, code: 'INVALID_INPUT' };
      return this.withAction(async () => {
        const result = await this.executePage(`(() => {
          const ref = ${JSON.stringify(String(ref || ''))};
          const element = window.__yanBrowserRefs?.get(ref);
          if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
          element.scrollIntoView({ block: 'center', inline: 'center' });
          element.focus();
          const value = ${JSON.stringify(value)};
          if (element.isContentEditable) {
            element.textContent = value;
          } else if ('value' in element) {
            const prototype = Object.getPrototypeOf(element);
            const descriptor = Object.getOwnPropertyDescriptor(prototype, 'value');
            if (descriptor?.set) descriptor.set.call(element, value);
            else element.value = value;
          } else {
            return { ok: false, error: '目标不是可输入元素。', code: 'NOT_INPUT' };
          }
          element.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: value }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true };
        })()`);
        if (!result?.ok) return result;
        return { ok: true, output: `已在 ${ref} 输入 ${value.length} 个字符。`, url: this.webview.getURL?.() || '' };
      });
    }

    async press(key) {
      const raw = String(key || '').trim();
      if (!raw || raw.length > 32) return { ok: false, error: '按键名称无效。', code: 'INVALID_KEY' };
      return this.withAction(async () => {
        const parts = raw.split('+').map(item => item.trim()).filter(Boolean);
        const keyName = parts.pop() || raw;
        const modifiers = parts.map(item => ({
          ctrl: 'control', control: 'control', cmd: 'meta', meta: 'meta', shift: 'shift', alt: 'alt', option: 'alt'
        }[item.toLowerCase()])).filter(Boolean);
        const keyCode = keyName.length === 1 ? keyName.toUpperCase() : keyName;
        try {
          this.webview.sendInputEvent?.({ type: 'keyDown', keyCode, modifiers });
          if (keyName.length === 1 && !modifiers.length) this.webview.sendInputEvent?.({ type: 'char', keyCode: keyName });
          this.webview.sendInputEvent?.({ type: 'keyUp', keyCode, modifiers });
        } catch {
          await this.executePage(`(() => {
            const eventInit = { key: ${JSON.stringify(keyName)}, code: ${JSON.stringify(keyCode)}, bubbles: true, cancelable: true };
            document.activeElement?.dispatchEvent(new KeyboardEvent('keydown', eventInit));
            document.activeElement?.dispatchEvent(new KeyboardEvent('keyup', eventInit));
            return true;
          })()`);
        }
        await this.waitForSettle(250);
        return { ok: true, output: `已按下 ${raw}。`, url: this.webview.getURL?.() || '' };
      });
    }

    async scroll(direction, amount = 640) {
      const distance = Math.max(80, Math.min(2400, Number(amount) || 640));
      const delta = { up: [0, -distance], down: [0, distance], left: [-distance, 0], right: [distance, 0] }[direction];
      if (!delta) return { ok: false, error: 'direction 必须是 up、down、left 或 right。', code: 'INVALID_DIRECTION' };
      return this.withAction(async () => {
        const result = await this.executePage(`(() => { window.scrollBy({ left: ${delta[0]}, top: ${delta[1]}, behavior: 'instant' }); return { ok: true, x: window.scrollX, y: window.scrollY }; })()`);
        if (!result?.ok) return result;
        return { ok: true, output: `已向 ${direction} 滚动 ${distance}px（当前位置 ${Math.round(result.x)}, ${Math.round(result.y)}）。`, url: this.webview.getURL?.() || '' };
      });
    }

    async wait(ms = 500, text = '') {
      const timeout = Math.max(100, Math.min(10000, Number(ms) || 500));
      return this.withAction(async () => {
        const started = Date.now();
        const wanted = String(text || '').trim();
        while (Date.now() - started < timeout) {
          if (!wanted) {
            await new Promise(resolve => setTimeout(resolve, timeout));
            break;
          }
          const result = await this.executePage(`(() => String(document.body?.innerText || '').includes(${JSON.stringify(wanted)}))()`);
          if (result === true) return { ok: true, output: `页面已出现文本：${wanted}` };
          await new Promise(resolve => setTimeout(resolve, 120));
        }
        if (wanted) return { ok: false, error: `等待 ${timeout}ms 后仍未找到文本：${wanted}`, code: 'WAIT_TIMEOUT' };
        return { ok: true, output: `已等待 ${timeout}ms。`, url: this.webview.getURL?.() || '' };
      });
    }

    async screenshot() {
      return this.withAction(async () => {
        if (!this.webview?.capturePage) return { ok: false, error: '当前 Electron 版本不支持内置浏览器截图。', code: 'SCREENSHOT_UNAVAILABLE' };
        const image = await this.webview.capturePage();
        const dataUrl = image?.toDataURL?.() || '';
        const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!match) return { ok: false, error: '内置浏览器没有返回有效截图。', code: 'SCREENSHOT_EMPTY' };
        return { ok: true, output: `已截取当前页面：${this.webview.getURL?.() || ''}`, url: this.webview.getURL?.() || '', image: { mimeType: match[1], data: match[2] } };
      });
    }

    async waitForSettle(timeout = 500) {
      if (!this.webview?.isLoading?.()) {
        await new Promise(resolve => setTimeout(resolve, 100));
        return;
      }
      await new Promise(resolve => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          clearTimeout(timer);
          this.webview.removeEventListener('did-finish-load', finish);
          this.webview.removeEventListener('did-fail-load', finish);
          resolve();
        };
        const timer = setTimeout(finish, timeout);
        this.webview.addEventListener('did-finish-load', finish);
        this.webview.addEventListener('did-fail-load', finish);
      });
    }
  }

  namespace.init = options => new BrowserAgentController(options || {});
})(window.YanBrowserAgent = window.YanBrowserAgent || {});

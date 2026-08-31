/* Yan Browser Agent Bridge - controls one visible, Agent-owned webview. */
(function (namespace) {
  'use strict';

  const MAX_SNAPSHOT_ITEMS = 180;
  const MAX_TEXT_LENGTH = 16000;
  const SNAPSHOT_SCRIPT = ({ startRef = 1, snapshotId = '' } = {}) => String.raw`(() => {
    const interactiveSelector = [
      'a[href]', 'button', 'input:not([type="hidden"])', 'textarea', 'select', 'summary',
      '[contenteditable="true"]', '[role="button"]', '[role="link"]', '[role="textbox"]',
      '[role="checkbox"]', '[role="radio"]', '[role="switch"]', '[role="tab"]',
      '[role="menuitem"]', '[role="option"]', '[role="combobox"]', '[role="slider"]',
      '[tabindex]:not([tabindex="-1"])'
    ].join(',');
    const refs = new Map();
    const seen = new Set();
    const candidates = [];
    const text = value => String(value || '').replace(/\s+/g, ' ').trim();
    const visible = element => {
      if (!element || !element.isConnected) return false;
      const rect = element.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return false;
      let current = element;
      while (current) {
        const style = current.ownerDocument.defaultView.getComputedStyle(current);
        if (style.display === 'none' || style.visibility === 'hidden' || Number(style.opacity) === 0) return false;
        const root = current.getRootNode?.();
        current = current.parentElement || root?.host || null;
      }
      return true;
    };
    const labelFor = element => {
      const direct = text(element.getAttribute('aria-label'));
      if (direct) return direct;
      const ids = text(element.getAttribute('aria-labelledby'));
      if (ids) {
        const value = ids.split(/\s+/).map(id => element.ownerDocument.getElementById(id)?.innerText || '').join(' ');
        if (text(value)) return text(value);
      }
      if (element.id) {
        const label = element.ownerDocument.querySelector('label[for="' + CSS.escape(element.id) + '"]');
        if (label && text(label.innerText)) return text(label.innerText);
      }
      const parentLabel = element.closest('label');
      if (parentLabel && text(parentLabel.innerText)) return text(parentLabel.innerText);
      const safeValue = element.matches?.('input[type="password"]') ? '' : text(element.value);
      return text(element.getAttribute('placeholder')) || text(element.getAttribute('title'))
        || text(element.getAttribute('alt')) || text(element.innerText)
        || safeValue || text(element.getAttribute('name'));
    };
    const roleFor = element => {
      const explicit = text(element.getAttribute('role'));
      if (explicit) return explicit;
      const tag = element.tagName.toLowerCase();
      if (tag === 'a') return 'link';
      if (tag === 'button' || tag === 'summary') return 'button';
      if (tag === 'textarea') return 'textbox';
      if (tag === 'select') return 'combobox';
      if (tag === 'input') {
        const type = (element.type || 'text').toLowerCase();
        if (type === 'checkbox') return 'checkbox';
        if (type === 'radio') return 'radio';
        if (type === 'range') return 'slider';
        if (['button', 'submit', 'reset'].includes(type)) return 'button';
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
      if (element.required || element.getAttribute('aria-required') === 'true') state.required = true;
      if (element.readOnly || element.getAttribute('aria-readonly') === 'true') state.readonly = true;
      const expanded = element.getAttribute('aria-expanded');
      if (expanded === 'true' || expanded === 'false') state.expanded = expanded === 'true';
      const pressed = element.getAttribute('aria-pressed');
      if (pressed === 'true' || pressed === 'false') state.pressed = pressed === 'true';
      if ('value' in element && element.value !== '') {
        if (element.matches?.('input[type="password"]')) state.hasValue = true;
        else state.value = String(element.value).slice(0, 240);
      }
      return state;
    };
    const topRect = element => {
      const rect = element.getBoundingClientRect();
      let x = rect.left;
      let y = rect.top;
      let view = element.ownerDocument.defaultView;
      while (view && view !== view.top) {
        const frame = view.frameElement;
        if (!frame) break;
        const frameRect = frame.getBoundingClientRect();
        x += frameRect.left;
        y += frameRect.top;
        view = frame.ownerDocument.defaultView;
      }
      return { x, y, width: rect.width, height: rect.height };
    };
    const visitRoot = (root, depth = 0) => {
      if (!root || depth > 5 || candidates.length >= ${MAX_SNAPSHOT_ITEMS * 3}) return;
      let elements = [];
      try { elements = [...root.querySelectorAll('*')]; } catch { return; }
      for (const element of elements) {
        if (candidates.length >= ${MAX_SNAPSHOT_ITEMS * 3}) break;
        if (!seen.has(element) && element.matches?.(interactiveSelector) && visible(element)) {
          seen.add(element);
          candidates.push(element);
        }
        if (element.shadowRoot) visitRoot(element.shadowRoot, depth + 1);
        if (element.tagName === 'IFRAME') {
          try { visitRoot(element.contentDocument, depth + 1); } catch {}
        }
      }
    };
    visitRoot(document);
    const elements = candidates.slice(0, ${MAX_SNAPSHOT_ITEMS});
    const items = elements.map((element, index) => {
      const ref = 'e' + (${Math.max(1, Number(startRef) || 1)} + index);
      const rect = topRect(element);
      refs.set(ref, element);
      return {
        ref,
        role: roleFor(element),
        tag: element.tagName.toLowerCase(),
        type: String(element.getAttribute('type') || '').toLowerCase(),
        name: labelFor(element).slice(0, 220),
        state: stateFor(element),
        rect: {
          x: Math.round(rect.x + rect.width / 2),
          y: Math.round(rect.y + rect.height / 2),
          width: Math.round(rect.width),
          height: Math.round(rect.height)
        },
        inViewport: rect.x + rect.width > 0 && rect.y + rect.height > 0
          && rect.x < window.innerWidth && rect.y < window.innerHeight
      };
    });
    window.__yanBrowserRefs = refs;
    window.__yanBrowserSnapshotId = ${JSON.stringify(String(snapshotId || ''))};
    const bodyText = text(document.body?.innerText).slice(0, 3200);
    return {
      url: location.href,
      title: document.title || '',
      readyState: document.readyState,
      snapshotId: window.__yanBrowserSnapshotId,
      viewport: { width: window.innerWidth, height: window.innerHeight, scrollX: window.scrollX, scrollY: window.scrollY },
      items,
      bodyText,
      truncated: candidates.length > elements.length
    };
  })()`;

  const targetScript = ref => `(() => {
    const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref || ''))});
    if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
    element.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
    let view = element.ownerDocument.defaultView;
    while (view && view !== view.top) {
      const frame = view.frameElement;
      if (!frame) break;
      frame.scrollIntoView({ block: 'center', inline: 'center', behavior: 'instant' });
      view = frame.ownerDocument.defaultView;
    }
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return { ok: false, error: '目标元素当前不可见。', code: 'HIDDEN_ELEMENT' };
    const localX = rect.left + rect.width / 2;
    const localY = rect.top + rect.height / 2;
    const root = element.getRootNode?.();
    const hit = typeof root?.elementFromPoint === 'function'
      ? root.elementFromPoint(localX, localY)
      : element.ownerDocument.elementFromPoint(localX, localY);
    const hitTarget = hit === element
      || element.contains(hit)
      || !!hit?.shadowRoot?.contains?.(element);
    let x = rect.left;
    let y = rect.top;
    view = element.ownerDocument.defaultView;
    while (view && view !== view.top) {
      const frame = view.frameElement;
      if (!frame) break;
      const frameRect = frame.getBoundingClientRect();
      x += frameRect.left;
      y += frameRect.top;
      view = frame.ownerDocument.defaultView;
    }
    return {
      ok: true,
      x: Math.round(x + rect.width / 2),
      y: Math.round(y + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height),
      hitTarget,
      hitTag: hit?.tagName?.toLowerCase?.() || '',
      tag: element.tagName.toLowerCase(),
      name: String(element.innerText || element.getAttribute('aria-label') || element.getAttribute('placeholder') || '').trim().slice(0, 160)
    };
  })()`;

  class BrowserAgentController {
    constructor(options = {}) {
      this.webview = options.webview;
      this.panel = options.panel;
      this.status = options.status;
      this.onPointer = typeof options.onPointer === 'function' ? options.onPointer : () => {};
      this.getDiagnostics = typeof options.getDiagnostics === 'function' ? options.getDiagnostics : () => ({});
      this.busyTimer = null;
      this.lastSnapshot = null;
      this.heldKeys = new Map();
      this.refCounter = 0;
      this.snapshotCounter = 0;
      this.activeRefs = new Set();
      this.actionTail = Promise.resolve();
      this.actionSequence = 0;
      this.actionGeneration = 0;
      this.actionEntries = new Map();
      this.activeAction = null;
      this.bindEvents();
    }

    bindEvents() {
      this.webview?.addEventListener('did-start-loading', () => this.invalidateRefs());
      this.webview?.addEventListener('did-navigate', () => this.invalidateRefs());
      this.webview?.addEventListener('did-navigate-in-page', () => this.invalidateRefs());
    }

    invalidateRefs() {
      this.lastSnapshot = null;
      this.activeRefs.clear();
      this.setBusy(false);
    }

    setBusy(busy) {
      if (busy && this.busyTimer) {
        clearTimeout(this.busyTimer);
        this.busyTimer = null;
      }
      this.panel?.classList.toggle('browser-agent-active', !!busy);
      if (!this.status) return;
      this.status.classList.toggle('hidden', !busy);
      this.status.setAttribute('aria-hidden', String(!busy));
      if (busy) this.status.textContent = 'Yan Agent正在操控Browser';
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

    enqueueAction(operationId, callback) {
      const id = String(operationId || `browser-op-${++this.actionSequence}`);
      const entry = {
        id,
        generation: this.actionGeneration,
        cancelled: false,
        controller: new AbortController()
      };
      this.actionEntries.set(id, entry);
      const execute = async () => {
        try {
          if (entry.cancelled || entry.generation !== this.actionGeneration) return this.cancelledResult();
          this.activeAction = entry;
          const result = await callback(entry.controller.signal);
          if (entry.cancelled || entry.controller.signal.aborted) return this.cancelledResult();
          return result;
        } catch (error) {
          if (entry.cancelled || entry.controller.signal.aborted || error?.name === 'AbortError') return this.cancelledResult();
          throw error;
        } finally {
          if (this.activeAction === entry) this.activeAction = null;
          this.actionEntries.delete(id);
        }
      };
      const result = this.actionTail.then(execute, execute);
      this.actionTail = result.then(() => undefined, () => undefined);
      return result;
    }

    cancelledResult() {
      return { ok: false, error: '内置浏览器操作已取消。', code: 'BROWSER_ACTION_CANCELLED' };
    }

    cancelOperation(operationId) {
      const entry = this.actionEntries.get(String(operationId || ''));
      if (!entry) return false;
      entry.cancelled = true;
      entry.controller.abort();
      return true;
    }

    async releaseActions() {
      this.actionGeneration++;
      for (const entry of this.actionEntries.values()) {
        entry.cancelled = true;
        entry.controller.abort();
      }
      this.invalidateRefs();
      const releasedKeys = await this.releaseHeldKeys();
      await this.clearGuestAgentState();
      this.setBusy(false);
      return { ok: true, cancelled: true, releasedKeys };
    }

    async clearGuestAgentState() {
      try {
        return await this.executePage(`(() => {
          for (const record of window.__yanBrowserInteractionReceipts?.values?.() || []) {
            record.element?.removeEventListener?.(record.eventType, record.listener, true);
          }
          for (const record of window.__yanBrowserKeyboardReceipts?.values?.() || []) {
            document.removeEventListener('keydown', record.onDown, true);
            document.removeEventListener('keyup', record.onUp, true);
          }
          window.__yanBrowserInteractionReceipts = new Map();
          window.__yanBrowserKeyboardReceipts = new Map();
          window.__yanBrowserRefs = new Map();
          window.__yanBrowserSnapshotId = '';
          return { ok: true };
        })()`);
      } catch {
        return { ok: false };
      }
    }

    async sleep(ms) {
      const duration = Math.max(0, Number(ms) || 0);
      const signal = this.activeAction?.controller?.signal;
      if (signal?.aborted) throw new DOMException('Browser action cancelled', 'AbortError');
      await new Promise((resolve, reject) => {
        const timer = setTimeout(finish, duration);
        function finish() {
          signal?.removeEventListener('abort', abort);
          resolve();
        }
        function abort() {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          reject(new DOMException('Browser action cancelled', 'AbortError'));
        }
        signal?.addEventListener('abort', abort, { once: true });
      });
    }

    validateRef(ref) {
      const value = String(ref || '');
      if (value && this.activeRefs.has(value)) return null;
      return { ok: false, error: '页面或快照已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
    }

    async executePage(expression) {
      if (!this.webview?.getURL || !this.webview.getURL() || this.webview.getURL() === 'about:blank') {
        return { ok: false, error: '内置浏览器尚未打开页面。请先调用 open_builtin_browser。', code: 'BROWSER_NOT_OPEN' };
      }
      return this.webview.executeJavaScript(expression, true);
    }

    async target(ref) {
      const invalid = this.validateRef(ref);
      if (invalid) return invalid;
      return this.executePage(targetScript(ref));
    }

    async pageState(ref = '', { changed = false, beforeUrl = '' } = {}) {
      const result = await this.executePage(`(() => {
        const ref = ${JSON.stringify(String(ref || ''))};
        const element = ref ? window.__yanBrowserRefs?.get(ref) : null;
        const summarize = target => {
          if (!target) return null;
          const type = String(target.getAttribute?.('type') || '').toLowerCase();
          const rect = target.getBoundingClientRect?.();
          const value = 'value' in target
            ? (type === 'password' ? (target.value ? '[redacted]' : '') : String(target.value || '').slice(0, 240))
            : '';
          return {
            ref: target === element ? ref : '',
            tag: target.tagName?.toLowerCase?.() || '',
            role: String(target.getAttribute?.('role') || ''),
            name: String(target.getAttribute?.('aria-label') || target.getAttribute?.('placeholder') || target.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, 160),
            value,
            connected: !!target.isConnected,
            visible: !!rect && rect.width > 0 && rect.height > 0,
            disabled: !!target.disabled || target.getAttribute?.('aria-disabled') === 'true',
            checked: typeof target.checked === 'boolean' ? target.checked : target.getAttribute?.('aria-checked') === 'true'
          };
        };
        return {
          url: location.href,
          title: document.title || '',
          readyState: document.readyState,
          snapshotId: String(window.__yanBrowserSnapshotId || ''),
          viewport: { scrollX: Math.round(window.scrollX), scrollY: Math.round(window.scrollY) },
          active: summarize(document.activeElement),
          target: summarize(element)
        };
      })()`);
      if (!result?.url) return null;
      const urlChanged = !!beforeUrl && result.url !== beforeUrl;
      return {
        ...result,
        changed: !!changed || urlChanged,
        urlChanged,
        snapshotRequired: urlChanged || (!!changed && !result.target)
      };
    }

    async withPageState(result, ref = '', options = {}) {
      if (!result?.ok) return result;
      const pageState = await this.pageState(ref, options);
      return pageState ? { ...result, pageState } : result;
    }

    async prepareInteractionReceipt(ref, receiptId, eventType) {
      return this.executePage(`(() => {
        const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref || ''))});
        if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
        window.__yanBrowserInteractionReceipts ||= new Map();
        const id = ${JSON.stringify(receiptId)};
        const record = {
          element,
          eventType: ${JSON.stringify(eventType)},
          received: false,
          trusted: false,
          beforeText: String(document.body?.innerText || '').slice(0, 12000)
        };
        record.listener = event => {
          record.received = true;
          record.trusted = !!event.isTrusted;
        };
        element.addEventListener(record.eventType, record.listener, { capture: true, once: true });
        window.__yanBrowserInteractionReceipts.set(id, record);
        return { ok: true, url: location.href };
      })()`);
    }

    async readInteractionReceipt(receiptId, { finalize = false } = {}) {
      return this.executePage(`(() => {
        const store = window.__yanBrowserInteractionReceipts;
        const id = ${JSON.stringify(receiptId)};
        const record = store?.get(id);
        if (!record) return { received: false, trusted: false, receiptMissing: true, url: location.href };
        const element = record.element;
        const connected = !!element?.isConnected;
        let visible = false;
        if (connected) {
          const rect = element.getBoundingClientRect();
          visible = rect.width > 0 && rect.height > 0;
          let current = element;
          while (visible && current) {
            const style = current.ownerDocument.defaultView.getComputedStyle(current);
            visible = style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
            const root = current.getRootNode?.();
            current = current.parentElement || root?.host || null;
          }
        }
        const result = {
          received: !!record.received,
          trusted: !!record.trusted,
          connected,
          visible,
          pageChanged: record.beforeText !== String(document.body?.innerText || '').slice(0, 12000),
          url: location.href
        };
        if (${finalize ? 'true' : 'false'}) {
          element?.removeEventListener?.(record.eventType, record.listener, true);
          store.delete(id);
        }
        return result;
      })()`);
    }

    async fallbackInteraction(ref, { button = 'left', clickCount = 1 } = {}) {
      return this.executePage(`(() => {
        const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref || ''))});
        if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请重新快照。', code: 'STALE_REF' };
        if (${JSON.stringify(button)} === 'right') {
          element.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, view: element.ownerDocument.defaultView, button: 2 }));
        } else {
          element.click();
          if (${Number(clickCount) === 2}) {
            element.click();
            element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true, view: element.ownerDocument.defaultView, detail: 2 }));
          }
        }
        return { ok: true };
      })()`);
    }

    describeKey(rawKey) {
      const raw = String(rawKey || '').trim();
      const parts = raw.split('+').map(item => item.trim()).filter(Boolean);
      const requestedKey = parts.pop() || raw;
      const modifierNames = [];
      const modifierAliases = {
        ctrl: 'control',
        control: 'control',
        cmd: 'meta',
        command: 'meta',
        meta: 'meta',
        shift: 'shift',
        alt: 'alt',
        option: 'alt'
      };
      for (const part of parts) {
        const modifier = modifierAliases[part.toLowerCase()];
        if (modifier && !modifierNames.includes(modifier)) modifierNames.push(modifier);
      }
      const aliases = {
        space: { key: ' ', code: 'Space', keyCode: 'Space' },
        esc: { key: 'Escape', code: 'Escape', keyCode: 'Escape' },
        escape: { key: 'Escape', code: 'Escape', keyCode: 'Escape' },
        return: { key: 'Enter', code: 'Enter', keyCode: 'Enter' },
        enter: { key: 'Enter', code: 'Enter', keyCode: 'Enter' },
        arrowup: { key: 'ArrowUp', code: 'ArrowUp', keyCode: 'Up' },
        arrowdown: { key: 'ArrowDown', code: 'ArrowDown', keyCode: 'Down' },
        arrowleft: { key: 'ArrowLeft', code: 'ArrowLeft', keyCode: 'Left' },
        arrowright: { key: 'ArrowRight', code: 'ArrowRight', keyCode: 'Right' },
        tab: { key: 'Tab', code: 'Tab', keyCode: 'Tab' },
        backspace: { key: 'Backspace', code: 'Backspace', keyCode: 'Backspace' },
        delete: { key: 'Delete', code: 'Delete', keyCode: 'Delete' },
        home: { key: 'Home', code: 'Home', keyCode: 'Home' },
        end: { key: 'End', code: 'End', keyCode: 'End' },
        pageup: { key: 'PageUp', code: 'PageUp', keyCode: 'PageUp' },
        pagedown: { key: 'PageDown', code: 'PageDown', keyCode: 'PageDown' }
      };
      let key = requestedKey;
      let code = requestedKey;
      let keyCode = requestedKey;
      const alias = aliases[requestedKey.toLowerCase()];
      if (alias) {
        key = alias.key;
        code = alias.code;
        keyCode = alias.keyCode;
      } else if (requestedKey.length === 1) {
        const point = requestedKey.codePointAt(0);
        const lowerPoint = requestedKey.toLowerCase().codePointAt(0);
        const isLetter = lowerPoint >= 97 && lowerPoint <= 122;
        const isDigit = point >= 48 && point <= 57;
        key = requestedKey;
        keyCode = requestedKey.toUpperCase();
        code = isLetter ? `Key${requestedKey.toUpperCase()}` : (isDigit ? `Digit${requestedKey}` : requestedKey);
      }
      const modifierState = {
        ctrlKey: modifierNames.includes('control'),
        metaKey: modifierNames.includes('meta'),
        shiftKey: modifierNames.includes('shift'),
        altKey: modifierNames.includes('alt')
      };
      return {
        raw,
        key,
        code,
        keyCode,
        modifiers: modifierNames,
        modifierState,
        printable: requestedKey.length === 1 && modifierNames.length === 0,
        identity: `${modifierNames.join('+')}|${code}`
      };
    }

    async prepareKeyboardReceipt(receiptId, descriptor) {
      return this.executePage(`(() => {
        window.__yanBrowserKeyboardReceipts ||= new Map();
        const id = ${JSON.stringify(String(receiptId || ''))};
        const expectedKey = ${JSON.stringify(String(descriptor?.key || ''))};
        const expectedCode = ${JSON.stringify(String(descriptor?.code || ''))};
        const matches = event => String(event.key || '') === expectedKey || String(event.code || '') === expectedCode;
        const summarize = event => ({
          key: String(event.key || ''),
          code: String(event.code || ''),
          repeat: !!event.repeat,
          trusted: !!event.isTrusted,
          timeStamp: Number(event.timeStamp) || 0
        });
        const active = document.activeElement;
        const record = {
          down: null,
          up: null,
          beforeText: String(document.body?.innerText || '').slice(0, 12000),
          beforeUrl: location.href,
          activeBefore: active ? {
            tag: active.tagName?.toLowerCase?.() || '',
            id: String(active.id || ''),
            value: 'value' in active ? String(active.value || '').slice(0, 500) : ''
          } : null
        };
        record.onDown = event => { if (!record.down && matches(event)) record.down = summarize(event); };
        record.onUp = event => { if (!record.up && matches(event)) record.up = summarize(event); };
        document.addEventListener('keydown', record.onDown, true);
        document.addEventListener('keyup', record.onUp, true);
        window.__yanBrowserKeyboardReceipts.set(id, record);
        return { ok: true, url: location.href };
      })()`);
    }

    async readKeyboardReceipt(receiptId, { finalize = false } = {}) {
      return this.executePage(`(() => {
        const store = window.__yanBrowserKeyboardReceipts;
        const id = ${JSON.stringify(String(receiptId || ''))};
        const record = store?.get(id);
        if (!record) return { downReceived: false, upReceived: false, receiptMissing: true, url: location.href };
        const active = document.activeElement;
        const result = {
          downReceived: !!record.down,
          upReceived: !!record.up,
          down: record.down,
          up: record.up,
          pageTextChanged: record.beforeText !== String(document.body?.innerText || '').slice(0, 12000),
          urlChanged: record.beforeUrl !== location.href,
          url: location.href,
          activeBefore: record.activeBefore,
          activeAfter: active ? {
            tag: active.tagName?.toLowerCase?.() || '',
            id: String(active.id || ''),
            value: 'value' in active ? String(active.value || '').slice(0, 500) : ''
          } : null
        };
        if (${finalize ? 'true' : 'false'}) {
          document.removeEventListener('keydown', record.onDown, true);
          document.removeEventListener('keyup', record.onUp, true);
          store.delete(id);
        }
        return result;
      })()`);
    }

    async fallbackKeyboardEvent(descriptor, type) {
      const eventInit = {
        key: descriptor.key,
        code: descriptor.code,
        ctrlKey: descriptor.modifierState.ctrlKey,
        metaKey: descriptor.modifierState.metaKey,
        shiftKey: descriptor.modifierState.shiftKey,
        altKey: descriptor.modifierState.altKey
      };
      return this.executePage(`(() => {
        const target = document.activeElement || document.body || document.documentElement;
        if (!target) return { ok: false, error: '页面没有可接收键盘事件的目标。', code: 'KEYBOARD_TARGET_MISSING' };
        const event = new KeyboardEvent(${JSON.stringify(type)}, {
          ...${JSON.stringify(eventInit)},
          bubbles: true,
          cancelable: true,
          composed: true,
          repeat: false,
          view: window
        });
        target.dispatchEvent(event);
        return { ok: true };
      })()`);
    }

    sendKey(type, descriptor) {
      this.webview.sendInputEvent?.({
        type,
        keyCode: descriptor.keyCode,
        modifiers: descriptor.modifiers
      });
    }

    async releaseHeldKeys() {
      const held = [...this.heldKeys.values()];
      this.heldKeys.clear();
      for (const entry of held) {
        try {
          if (entry.delivery === 'verified-dom-fallback') await this.fallbackKeyboardEvent(entry.descriptor, 'keyup');
          else this.sendKey('keyUp', entry.descriptor);
        } catch {}
      }
      return held.length;
    }

    pointer(target, state = 'move') {
      if (!target?.ok) return;
      this.onPointer({ x: target.x, y: target.y, state });
    }

    sendMouse(type, target, options = {}) {
      this.webview.sendInputEvent?.({
        type,
        x: Math.round(target.x),
        y: Math.round(target.y),
        button: options.button || 'left',
        clickCount: Math.max(1, Number(options.clickCount) || 1)
      });
    }

    async snapshot() {
      return this.withAction(async () => {
        const startRef = this.refCounter + 1;
        const snapshotId = `s${++this.snapshotCounter}`;
        const result = await this.executePage(SNAPSHOT_SCRIPT({ startRef, snapshotId }));
        if (!result?.items) return result;
        this.refCounter += result.items.length;
        this.activeRefs = new Set(result.items.map(item => item.ref));
        this.lastSnapshot = result;
        const lines = [
          `URL: ${result.url}`,
          `标题: ${result.title || '(无标题)'}`,
          `状态: ${result.readyState || 'unknown'}`,
          `快照: ${result.snapshotId}（引用仅对本快照有效）`,
          `视口: ${result.viewport.width}x${result.viewport.height}，滚动位置 ${Math.round(result.viewport.scrollX)}, ${Math.round(result.viewport.scrollY)}`,
          '可交互元素:'
        ];
        for (const item of result.items) {
          const state = Object.entries(item.state || {}).map(([key, value]) => `${key}=${value}`).join(', ');
          lines.push(`[${item.ref}] ${item.role}${item.name ? ` "${item.name}"` : ''}${state ? ` (${state})` : ''}${item.inViewport ? '' : ' [视口外]'}`);
        }
        if (result.truncated) lines.push(`元素较多，仅返回前 ${result.items.length} 个。可滚动页面后重新快照。`);
        if (result.bodyText) lines.push(`页面文本:\n${result.bodyText}`);
        return {
          ok: true,
          output: lines.join('\n'),
          url: result.url,
          title: result.title,
          readyState: result.readyState,
          snapshotId: result.snapshotId,
          viewport: result.viewport,
          items: result.items,
          count: result.items.length,
          itemCount: result.items.length,
          truncated: !!result.truncated
        };
      });
    }

    async readPage() {
      return this.withAction(async () => {
        const result = await this.executePage(`(() => ({
          url: location.href,
          title: document.title || '',
          readyState: document.readyState,
          text: String(document.body?.innerText || '').replace(/\\s+/g, ' ').trim().slice(0, ${MAX_TEXT_LENGTH})
        }))()`);
        if (!result?.url) return result;
        return { ok: true, output: `URL: ${result.url}\n标题: ${result.title || '(无标题)'}\n状态: ${result.readyState}\n${result.text}`, ...result };
      });
    }

    async click(ref, { button = 'left', clickCount = 1 } = {}) {
      return this.withAction(async () => {
        const target = await this.target(ref);
        if (!target?.ok) return target;
        const receiptId = `click-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const eventType = button === 'right' ? 'contextmenu' : 'click';
        const prepared = await this.prepareInteractionReceipt(ref, receiptId, eventType);
        if (!prepared?.ok) return prepared;
        this.pointer(target, 'move');
        if (!target.hitTarget) {
          await this.readInteractionReceipt(receiptId, { finalize: true });
          return {
            ok: false,
            error: `${ref} 的中心被 ${target.hitTag || '其他元素'} 遮挡，请重新快照或滚动后再试。`,
            code: 'CLICK_TARGET_OCCLUDED',
            target
          };
        }
        this.sendMouse('mouseMove', target, { button });
        this.pointer(target, 'down');
        this.sendMouse('mouseDown', target, { button, clickCount });
        this.sendMouse('mouseUp', target, { button, clickCount });
        this.pointer(target, 'up');
        await this.sleep(80);
        let receipt = await this.readInteractionReceipt(receiptId);
        let delivery = 'native-pointer';
        const navigated = !!prepared.url && this.webview.getURL?.() !== prepared.url;
        if (!receipt?.received && !navigated) {
          const fallback = await this.fallbackInteraction(ref, { button, clickCount });
          if (!fallback?.ok) {
            await this.readInteractionReceipt(receiptId, { finalize: true });
            return fallback;
          }
          delivery = 'verified-dom-fallback';
          await this.sleep(40);
          receipt = await this.readInteractionReceipt(receiptId);
        }
        await this.waitForSettle(900);
        const finalReceipt = await this.readInteractionReceipt(receiptId, { finalize: true });
        const currentUrl = this.webview.getURL?.() || '';
        const verified = !!(receipt?.received || finalReceipt?.received || navigated);
        if (!verified) {
          return { ok: false, error: `未能确认 ${ref} 收到点击事件。`, code: 'CLICK_NOT_DELIVERED', url: currentUrl };
        }
        const targetAfter = finalReceipt?.receiptMissing ? receipt : finalReceipt;
        return this.withPageState({
          ok: true,
          output: `已${clickCount === 2 ? '双击' : '点击'} ${ref}${target.name ? `：${target.name}` : ''}，并确认目标收到事件。`,
          url: currentUrl,
          delivery,
          eventReceived: !!(receipt?.received || finalReceipt?.received),
          trustedEvent: !!(receipt?.trusted || finalReceipt?.trusted),
          pageChanged: !!(navigated || targetAfter?.pageChanged),
          targetAfter: {
            connected: typeof targetAfter?.connected === 'boolean' ? targetAfter.connected : null,
            visible: typeof targetAfter?.visible === 'boolean' ? targetAfter.visible : null
          }
        }, ref, { changed: !!(navigated || targetAfter?.pageChanged), beforeUrl: prepared.url });
      });
    }

    async type(ref, text, { submit = false } = {}) {
      const value = String(text ?? '');
      if (value.length > MAX_TEXT_LENGTH) return { ok: false, error: `输入内容不能超过 ${MAX_TEXT_LENGTH} 个字符。`, code: 'INVALID_INPUT' };
      return this.withAction(async () => {
        const beforeUrl = this.webview.getURL?.() || '';
        const target = await this.target(ref);
        if (!target?.ok) return target;
        this.pointer(target, 'move');
        const result = await this.executePage(`(() => {
          const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref || ''))});
          if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
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
        if (submit) {
          const submitted = await this.press('Enter');
          if (!submitted?.ok) return submitted;
        }
        return this.withPageState({ ok: true, output: `已在 ${ref} 输入 ${value.length} 个字符${submit ? '并提交' : ''}。`, url: this.webview.getURL?.() || '' }, ref, { changed: true, beforeUrl });
      });
    }

    async select(ref, value) {
      return this.withAction(async () => {
        const beforeUrl = this.webview.getURL?.() || '';
        const target = await this.target(ref);
        if (!target?.ok) return target;
        this.pointer(target, 'move');
        const result = await this.executePage(`(() => {
          const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref || ''))});
          if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
          if (element.tagName !== 'SELECT') return { ok: false, error: '目标不是下拉选择框。', code: 'NOT_SELECT' };
          const wanted = ${JSON.stringify(String(value ?? ''))};
          const option = [...element.options].find(item => item.value === wanted)
            || [...element.options].find(item => String(item.textContent || '').trim() === wanted);
          if (!option) return { ok: false, error: '没有找到指定选项。', code: 'OPTION_NOT_FOUND', options: [...element.options].map(item => ({ value: item.value, label: String(item.textContent || '').trim() })).slice(0, 80) };
          element.value = option.value;
          option.selected = true;
          element.dispatchEvent(new Event('input', { bubbles: true }));
          element.dispatchEvent(new Event('change', { bubbles: true }));
          return { ok: true, value: option.value, label: String(option.textContent || '').trim() };
        })()`);
        return this.withPageState(result, ref, { changed: !!result?.ok, beforeUrl });
      });
    }

    async check(ref, checked = true) {
      return this.withAction(async () => {
        const beforeUrl = this.webview.getURL?.() || '';
        const target = await this.target(ref);
        if (!target?.ok) return target;
        this.pointer(target, 'move');
        const result = await this.executePage(`(() => {
          const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref || ''))});
          if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_snapshot。', code: 'STALE_REF' };
          const wanted = ${checked !== false};
          const role = element.getAttribute('role');
          if (element.matches('input[type="checkbox"], input[type="radio"]')) {
            if (element.type === 'radio' && !wanted) return { ok: false, error: '单选按钮不能直接取消，请选择另一个选项。', code: 'RADIO_UNCHECK_UNSUPPORTED' };
            if (element.checked !== wanted) element.click();
            return { ok: true, checked: !!element.checked };
          }
          if (role === 'checkbox' || role === 'radio' || role === 'switch') {
            const current = element.getAttribute('aria-checked') === 'true';
            if (current !== wanted) element.click();
            return { ok: true, checked: element.getAttribute('aria-checked') === 'true' };
          }
          return { ok: false, error: '目标不是复选框、单选按钮或开关。', code: 'NOT_CHECKABLE' };
        })()`);
        return this.withPageState(result, ref, { changed: !!result?.ok, beforeUrl });
      });
    }

    async focus(ref) {
      return this.withAction(async () => {
        const target = await this.target(ref);
        if (!target?.ok) return target;
        this.pointer(target, 'move');
        const result = await this.executePage(`(() => {
          const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref || ''))});
          if (!element || !element.isConnected) return { ok: false, code: 'STALE_REF', error: '页面已变化，请重新快照。' };
          element.focus();
          return { ok: document.activeElement === element || element.ownerDocument.activeElement === element };
        })()`);
        return result?.ok ? { ok: true, output: `已聚焦 ${ref}。` } : result;
      });
    }

    async hover(ref) {
      return this.withAction(async () => {
        const target = await this.target(ref);
        if (!target?.ok) return target;
        this.pointer(target, 'move');
        this.sendMouse('mouseMove', target);
        await this.waitForSettle(500);
        return { ok: true, output: `已悬停 ${ref}${target.name ? `：${target.name}` : ''}` };
      });
    }

    async drag(fromRef, toRef) {
      return this.withAction(async () => {
        const from = await this.target(fromRef);
        if (!from?.ok) return from;
        const to = await this.target(toRef);
        if (!to?.ok) return to;
        this.pointer(from, 'move');
        this.sendMouse('mouseMove', from);
        this.pointer(from, 'down');
        this.sendMouse('mouseDown', from);
        const steps = 8;
        for (let step = 1; step <= steps; step++) {
          const point = { ok: true, x: from.x + (to.x - from.x) * step / steps, y: from.y + (to.y - from.y) * step / steps };
          this.pointer(point, 'drag');
          this.sendMouse('mouseMove', point);
          await this.sleep(24);
        }
        this.sendMouse('mouseUp', to);
        this.pointer(to, 'up');
        await this.waitForSettle(900);
        return { ok: true, output: `已从 ${fromRef} 拖动到 ${toRef}。` };
      });
    }

    async press(key, { durationMs = 80 } = {}) {
      const raw = String(key || '').trim();
      if (!raw || raw.length > 64) return { ok: false, error: '按键名称无效。', code: 'INVALID_KEY' };
      const holdDuration = Math.max(30, Math.min(5000, Number(durationMs) || 80));
      return this.withAction(async () => {
        const descriptor = this.describeKey(raw);
        if (this.heldKeys.has(descriptor.identity)) {
          return { ok: false, error: `${raw} 已处于按下状态。`, code: 'KEY_ALREADY_HELD' };
        }
        const receiptId = `key-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const prepared = await this.prepareKeyboardReceipt(receiptId, descriptor);
        if (!prepared?.ok) return prepared;
        let delivery = 'native-key';
        let released = false;
        let finalized = false;
        let downStartedAt = Date.now();
        try {
          this.sendKey('keyDown', descriptor);
          if (descriptor.printable) this.sendKey('char', descriptor);
          this.heldKeys.set(descriptor.identity, { descriptor, delivery });
          await this.sleep(45);
          let receipt = await this.readKeyboardReceipt(receiptId);
          if (!receipt?.downReceived) {
            this.sendKey('keyUp', descriptor);
            const fallback = await this.fallbackKeyboardEvent(descriptor, 'keydown');
            if (!fallback?.ok) return fallback;
            delivery = 'verified-dom-fallback';
            downStartedAt = Date.now();
            this.heldKeys.set(descriptor.identity, { descriptor, delivery });
            await this.sleep(30);
            receipt = await this.readKeyboardReceipt(receiptId);
          }
          if (!receipt?.downReceived) {
            return { ok: false, error: `未能确认页面收到 ${raw} 的 keydown 事件。`, code: 'KEYDOWN_NOT_DELIVERED' };
          }

          const elapsed = Date.now() - downStartedAt;
          if (elapsed < holdDuration) {
            await this.sleep(holdDuration - elapsed);
          }
          if (delivery === 'verified-dom-fallback') await this.fallbackKeyboardEvent(descriptor, 'keyup');
          else this.sendKey('keyUp', descriptor);
          const releasedAt = Date.now();
          released = true;
          this.heldKeys.delete(descriptor.identity);
          await this.sleep(45);
          let finalReceipt = await this.readKeyboardReceipt(receiptId);
          if (!finalReceipt?.upReceived) {
            await this.fallbackKeyboardEvent(descriptor, 'keyup');
            if (delivery === 'native-key') delivery = 'native-key-with-dom-release';
            await this.sleep(30);
            finalReceipt = await this.readKeyboardReceipt(receiptId);
          }
          const completed = await this.readKeyboardReceipt(receiptId, { finalize: true });
          finalized = true;
          const evidence = completed?.receiptMissing ? finalReceipt : completed;
          if (!evidence?.upReceived) {
            return { ok: false, error: `页面收到 ${raw} 的 keydown，但未能确认 keyup。`, code: 'KEYUP_NOT_DELIVERED' };
          }
          const actualDuration = Math.max(0, releasedAt - downStartedAt);
          return {
            ok: true,
            output: `已按住 ${raw} ${actualDuration}ms，并确认页面收到 keydown 与 keyup。`,
            url: this.webview.getURL?.() || '',
            delivery,
            durationMs: actualDuration,
            keydownReceived: true,
            keyupReceived: true,
            trustedEvents: !!(evidence.down?.trusted && evidence.up?.trusted),
            receivedKey: evidence.down?.key || '',
            receivedCode: evidence.down?.code || '',
            pageTextChanged: !!evidence.pageTextChanged,
            urlChanged: !!evidence.urlChanged,
            activeBefore: evidence.activeBefore || null,
            activeAfter: evidence.activeAfter || null,
            evidenceScope: 'Keyboard delivery is verified. Business or visual outcome still requires post-action page evidence.'
          };
        } finally {
          if (!released && this.heldKeys.has(descriptor.identity)) {
            const held = this.heldKeys.get(descriptor.identity);
            this.heldKeys.delete(descriptor.identity);
            try {
              if (held.delivery === 'verified-dom-fallback') await this.fallbackKeyboardEvent(descriptor, 'keyup');
              else this.sendKey('keyUp', descriptor);
            } catch {}
          }
          if (!finalized) {
            try { await this.readKeyboardReceipt(receiptId, { finalize: true }); } catch {}
          }
        }
      });
    }

    async scroll(direction, amount = 640, ref = '') {
      const distance = Math.max(80, Math.min(2400, Number(amount) || 640));
      const delta = { up: [0, -distance], down: [0, distance], left: [-distance, 0], right: [distance, 0] }[direction];
      if (!delta) return { ok: false, error: 'direction 必须是 up、down、left 或 right。', code: 'INVALID_DIRECTION' };
      if (ref) {
        const invalid = this.validateRef(ref);
        if (invalid) return invalid;
      }
      return this.withAction(async () => {
        const beforeUrl = this.webview.getURL?.() || '';
        const result = await this.executePage(`(() => {
          const ref = ${JSON.stringify(String(ref || ''))};
          const element = ref ? window.__yanBrowserRefs?.get(ref) : null;
          if (ref && (!element || !element.isConnected)) return { ok: false, error: '页面已变化，请重新快照。', code: 'STALE_REF' };
          const target = element || window;
          target.scrollBy({ left: ${delta[0]}, top: ${delta[1]}, behavior: 'instant' });
          return { ok: true, x: element ? element.scrollLeft : window.scrollX, y: element ? element.scrollTop : window.scrollY };
        })()`);
        if (!result?.ok) return result;
        await this.waitForSettle(350);
        return this.withPageState({ ok: true, output: `已${ref ? `在 ${ref} 内` : ''}向 ${direction} 滚动 ${distance}px（当前位置 ${Math.round(result.x)}, ${Math.round(result.y)}）。`, url: this.webview.getURL?.() || '' }, ref, { changed: true, beforeUrl });
      });
    }

    async wait(ms = 1500, text = '', ref = '', state = 'visible') {
      const timeout = Math.max(500, Math.min(15000, Number(ms) || 1500));
      if (ref) {
        const invalid = this.validateRef(ref);
        if (invalid) return invalid;
      }
      return this.withAction(async () => {
        const started = Date.now();
        const wanted = String(text || '').trim();
        const targetRef = String(ref || '').trim();
        while (Date.now() - started < timeout) {
          if (!wanted && !targetRef) {
            await this.sleep(timeout);
            return { ok: true, output: `已等待 ${timeout}ms。`, url: this.webview.getURL?.() || '' };
          }
          const result = await this.executePage(`(() => {
            const wanted = ${JSON.stringify(wanted)};
            const ref = ${JSON.stringify(targetRef)};
            if (wanted && String(document.body?.innerText || '').includes(wanted)) return { matched: true, reason: 'text' };
            if (!ref) return { matched: false };
            const element = window.__yanBrowserRefs?.get(ref);
            const visible = !!element && element.isConnected && (() => { const r = element.getBoundingClientRect(); const s = getComputedStyle(element); return r.width > 0 && r.height > 0 && s.display !== 'none' && s.visibility !== 'hidden'; })();
            const disabled = !!element && (element.disabled || element.getAttribute('aria-disabled') === 'true');
            const matched = ${JSON.stringify(state)} === 'hidden' ? !visible : (${JSON.stringify(state)} === 'enabled' ? visible && !disabled : visible);
            return { matched, reason: 'element' };
          })()`);
          if (result?.matched) return { ok: true, output: result.reason === 'text' ? `页面已出现文本：${wanted}` : `${targetRef} 已达到 ${state} 状态。` };
          await this.sleep(120);
        }
        const subject = wanted ? `文本：${wanted}` : `${targetRef} 的 ${state} 状态`;
        return { ok: false, error: `等待 ${timeout}ms 后仍未找到${subject}`, code: 'WAIT_TIMEOUT' };
      });
    }

    async inspectPage() {
      return this.withAction(async () => {
        const page = await this.executePage(`(() => {
          const images = [...document.images];
          const canvases = [...document.querySelectorAll('canvas')];
          const forms = [...document.forms];
          const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 40).map(item => String(item.innerText || '').trim()).filter(Boolean);
          const inspectCanvas = canvas => {
            const report = { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
            if (!canvas.width || !canvas.height) return { ...report, warnings: ['Canvas has zero bitmap dimensions.'] };
            try {
              const sample = document.createElement('canvas');
              sample.width = 64;
              sample.height = 64;
              const context = sample.getContext('2d', { willReadFrequently: true });
              context.drawImage(canvas, 0, 0, sample.width, sample.height);
              const pixels = context.getImageData(0, 0, sample.width, sample.height).data;
              let visible = 0;
              let luminanceMin = 255;
              let luminanceMax = 0;
              let luminanceSum = 0;
              let luminanceSquareSum = 0;
              const colors = new Set();
              const occupiedRows = new Set();
              for (let index = 0; index < pixels.length; index += 4) {
                const red = pixels[index];
                const green = pixels[index + 1];
                const blue = pixels[index + 2];
                const alpha = pixels[index + 3];
                if (alpha < 16) continue;
                visible++;
                occupiedRows.add(Math.floor(index / 4 / sample.width));
                const luminance = Math.round(red * 0.2126 + green * 0.7152 + blue * 0.0722);
                luminanceMin = Math.min(luminanceMin, luminance);
                luminanceMax = Math.max(luminanceMax, luminance);
                luminanceSum += luminance;
                luminanceSquareSum += luminance * luminance;
                colors.add([red >> 5, green >> 5, blue >> 5, alpha >> 6].join(':'));
              }
              const total = sample.width * sample.height;
              const mean = visible ? luminanceSum / visible : 0;
              const variance = visible ? Math.max(0, luminanceSquareSum / visible - mean * mean) : 0;
              const pixelCoverage = Number((visible / total).toFixed(3));
              const occupiedRowRatio = Number((occupiedRows.size / sample.height).toFixed(3));
              const warnings = [];
              if (pixelCoverage < 0.55) warnings.push('Most sampled Canvas pixels are transparent or unpainted.');
              if (visible && (colors.size <= 2 || luminanceMax - luminanceMin < 5 || Math.sqrt(variance) < 2)) {
                warnings.push('Canvas sample appears visually flat or nearly single-color.');
              }
              return {
                ...report,
                sample: {
                  pixelCoverage,
                  occupiedRowRatio,
                  quantizedColorCount: colors.size,
                  luminanceRange: visible ? [luminanceMin, luminanceMax] : [0, 0],
                  luminanceDeviation: Number(Math.sqrt(variance).toFixed(2))
                },
                warnings
              };
            } catch (error) {
              return { ...report, sampleUnavailable: String(error?.message || error).slice(0, 240), warnings: [] };
            }
          };
          return {
            url: location.href,
            title: document.title || '',
            readyState: document.readyState,
            viewport: { width: innerWidth, height: innerHeight, scrollX, scrollY, scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
            counts: { links: document.links.length, forms: forms.length, inputs: document.querySelectorAll('input,textarea,select').length, images: images.length, canvases: canvases.length, iframes: document.querySelectorAll('iframe').length },
            brokenImages: images.filter(image => image.complete && image.naturalWidth === 0).slice(0, 40).map(image => image.currentSrc || image.src || image.alt || '(unknown)'),
            invalidFields: [...document.querySelectorAll('input,textarea,select')].filter(item => !item.checkValidity()).slice(0, 40).map(item => item.name || item.id || item.type || item.tagName.toLowerCase()),
            headings,
            canvases: canvases.slice(0, 20).map(inspectCanvas)
          };
        })()`);
        if (!page?.url) return page;
        const diagnostics = this.getDiagnostics() || {};
        const result = { ok: true, ...page, diagnostics };
        result.output = JSON.stringify({
          url: page.url,
          title: page.title,
          readyState: page.readyState,
          viewport: page.viewport,
          counts: page.counts,
          brokenImages: page.brokenImages,
          invalidFields: page.invalidFields,
          headings: page.headings,
          canvases: page.canvases,
          console: diagnostics.console || [],
          loadErrors: diagnostics.loadErrors || []
        });
        return result;
      });
    }

    async pointerAction({ action = 'click', x, y, toX, toY, button = 'left' } = {}) {
      const start = { ok: true, x: Math.round(Number(x)), y: Math.round(Number(y)) };
      if (!Number.isFinite(start.x) || !Number.isFinite(start.y)) return { ok: false, error: '需要有效的视口坐标 x、y。', code: 'INVALID_POINTER_COORDINATES' };
      return this.withAction(async () => {
        this.pointer(start, 'move');
        this.sendMouse('mouseMove', start, { button });
        if (action === 'hover') return { ok: true, output: `已将 Agent 指针移动到 ${start.x}, ${start.y}。` };
        if (action === 'click') {
          this.pointer(start, 'down');
          this.sendMouse('mouseDown', start, { button });
          this.sendMouse('mouseUp', start, { button });
          this.pointer(start, 'up');
        } else if (action === 'drag') {
          const end = { ok: true, x: Math.round(Number(toX)), y: Math.round(Number(toY)) };
          if (!Number.isFinite(end.x) || !Number.isFinite(end.y)) return { ok: false, error: '拖动需要有效的 to_x、to_y。', code: 'INVALID_POINTER_COORDINATES' };
          this.pointer(start, 'down');
          this.sendMouse('mouseDown', start, { button });
          for (let step = 1; step <= 10; step++) {
            const point = { ok: true, x: start.x + (end.x - start.x) * step / 10, y: start.y + (end.y - start.y) * step / 10 };
            this.pointer(point, 'drag');
            this.sendMouse('mouseMove', point, { button });
            await this.sleep(20);
          }
          this.sendMouse('mouseUp', end, { button });
          this.pointer(end, 'up');
        } else {
          return { ok: false, error: `不支持的指针操作：${action}`, code: 'INVALID_POINTER_ACTION' };
        }
        await this.waitForSettle(700);
        return { ok: true, output: `Agent 指针已完成 ${action}。`, url: this.webview.getURL?.() || '' };
      });
    }

    async screenshot() {
      return this.withAction(async () => {
        if (!this.webview?.capturePage) return { ok: false, error: '当前 Electron 版本不支持内置浏览器截图。', code: 'SCREENSHOT_UNAVAILABLE' };
        const captureState = await this.executePage(`(() => ({
          title: document.title || '',
          text: String(document.body?.innerText || '').trim().slice(0, 4000),
          url: location.href
        }))()`);
        const image = await this.webview.capturePage();
        const dataUrl = image?.toDataURL?.() || '';
        const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!match) return { ok: false, error: '内置浏览器没有返回有效截图。', code: 'SCREENSHOT_EMPTY' };
        return {
          ok: true,
          output: `已截取当前页面：${this.webview.getURL?.() || ''}`,
          url: this.webview.getURL?.() || '',
          capturedAt: new Date().toISOString(),
          captureState: captureState?.url ? captureState : null,
          image: { mimeType: match[1], data: match[2] }
        };
      });
    }

    async waitForSettle(timeout = 900) {
      const capped = Math.max(100, Math.min(5000, Number(timeout) || 900));
      const startedAt = Date.now();
      if (this.webview?.isLoading?.()) {
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
          const timer = setTimeout(finish, capped);
          this.webview.addEventListener('did-finish-load', finish);
          this.webview.addEventListener('did-fail-load', finish);
        });
      }
      const remaining = Math.max(0, capped - (Date.now() - startedAt));
      if (remaining < 1) return;
      await this.executePage(`(async () => {
        const deadline = performance.now() + ${remaining};
        const nextFrame = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
        await nextFrame();
        await nextFrame();
        while (performance.now() < deadline) {
          const active = document.getAnimations().filter(animation => {
            if (animation.playState !== 'running' && animation.playState !== 'pending') return false;
            const timing = animation.effect?.getTiming?.();
            return Number.isFinite(Number(timing?.iterations));
          });
          if (!active.length) return;
          await Promise.race([
            Promise.allSettled(active.map(animation => animation.finished)),
            new Promise(resolve => setTimeout(resolve, Math.min(100, Math.max(0, deadline - performance.now()))))
          ]);
        }
      })()`);
    }

    async waitForNavigation(timeout = 5_000) {
      const capped = Math.max(500, Math.min(15_000, Number(timeout) || 5_000));
      const signal = this.activeAction?.controller?.signal;
      if (signal?.aborted) throw new DOMException('Browser navigation cancelled', 'AbortError');
      return new Promise((resolve, reject) => {
        let settled = false;
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', onAbort);
          this.webview?.removeEventListener('did-finish-load', onFinished);
          this.webview?.removeEventListener('did-fail-load', onFinished);
          this.webview?.removeEventListener('did-navigate-in-page', onFinished);
        };
        const finish = completed => {
          if (settled) return;
          settled = true;
          cleanup();
          resolve(completed);
        };
        const onFinished = () => finish(true);
        const onAbort = () => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(new DOMException('Browser navigation cancelled', 'AbortError'));
        };
        const timer = setTimeout(() => finish(false), capped);
        this.webview?.addEventListener('did-finish-load', onFinished);
        this.webview?.addEventListener('did-fail-load', onFinished);
        this.webview?.addEventListener('did-navigate-in-page', onFinished);
        signal?.addEventListener('abort', onAbort, { once: true });
      });
    }
  }

  namespace.init = options => new BrowserAgentController(options || {});
})(window.YanBrowserAgent = window.YanBrowserAgent || {});

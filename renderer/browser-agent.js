/* Yan Browser Agent Bridge - controls one Agent-owned webview. */
(function (namespace) {
  'use strict';

  const MAX_SNAPSHOT_ITEMS = 180;
  const MAX_TEXT_LENGTH = 16000;
  // Guest calls must give up well before the 40 s bridge budget so the serial
  // queue can advance and the model gets a specific error code.
  const GUEST_CALL_TIMEOUT_MS = 15_000;
  const ACTION_TIMEOUT_MS = 35_000;
  const renderLeases = new WeakMap();

  function retainRender(element) {
    if (!element) return () => {};
    renderLeases.set(element, (renderLeases.get(element) || 0) + 1);
    element.classList.add('browser-background-render');
    return () => {
      const count = (renderLeases.get(element) || 1) - 1;
      if (count) renderLeases.set(element, count);
      else { renderLeases.delete(element); element.classList.remove('browser-background-render'); }
    };
  }

  // 给可能永不落地的原生 Promise(截图走 GPU 合成器)加上界。超时只是放弃等待,
  // 底层调用无法取消,所以调用方不应该立刻重试。
  function withTimeout(promise, ms, code) {
    let timer = null;
    return Promise.race([
      Promise.resolve(promise).finally(() => clearTimeout(timer)),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
          const error = new Error(`${code} (${ms}ms)`);
          error.code = code;
          reject(error);
        }, ms);
      })
    ]);
  }
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
    if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_observe 的 interactive 模式。', code: 'STALE_REF' };
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
      const sidebar = this.webview?.closest('.right-sidebar');
      const panel = this.webview?.closest('.rs-panel');
      const needsFrame = (sidebar?.closest('.rs-hidden') || !panel?.classList.contains('active'))
        && !renderLeases.has(panel);
      const releaseSidebar = retainRender(sidebar);
      const releasePanel = retainRender(panel);
      try {
        // Give the hidden guest a viewport and compositor frame without opening the UI.
        if (needsFrame) await new Promise(resolve => setTimeout(resolve, 100));
        return await callback();
      } catch (error) {
        // Keep the specific code (BROWSER_GUEST_TIMEOUT, SCREENSHOT_TIMEOUT, ...)
        // so the caller and the screenshot breaker can react to it.
        return { ok: false, error: `浏览器操作失败：${error?.message || error}`, code: error?.code || 'BROWSER_BRIDGE_ERROR' };
      } finally {
        releasePanel();
        releaseSidebar();
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
        let timer = null;
        try {
          if (entry.cancelled || entry.generation !== this.actionGeneration) return this.cancelledResult();
          this.activeAction = entry;
          // A guest call that never settles must not wedge the serial queue.
          // Race the callback against cancellation and a hard cap so the tail
          // always advances and the next action can run.
          const result = await Promise.race([
            callback(entry.controller.signal),
            new Promise((_resolve, reject) => {
              entry.controller.signal.addEventListener('abort', () => {
                reject(Object.assign(new Error('内置浏览器操作已取消。'), { code: 'BROWSER_ACTION_CANCELLED' }));
              }, { once: true });
            }),
            new Promise((_resolve, reject) => {
              timer = setTimeout(() => {
                reject(Object.assign(new Error(`内置浏览器操作超过 ${Math.round(ACTION_TIMEOUT_MS / 1000)} 秒未完成。`), { code: 'BROWSER_ACTION_TIMEOUT' }));
              }, ACTION_TIMEOUT_MS);
            })
          ]);
          if (entry.cancelled || entry.controller.signal.aborted) return this.cancelledResult();
          return result;
        } catch (error) {
          if (entry.cancelled || entry.controller.signal.aborted || error?.name === 'AbortError') return this.cancelledResult();
          if (error?.code === 'BROWSER_ACTION_TIMEOUT') return { ok: false, error: error.message, code: 'BROWSER_ACTION_TIMEOUT' };
          throw error;
        } finally {
          if (timer) clearTimeout(timer);
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
      // Let aborted actions finish before clearing guest state or handing off.
      await this.actionTail;
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
      return { ok: false, error: '页面或快照已变化，请先重新调用 browser_observe 的 interactive 模式。', code: 'STALE_REF' };
    }

    async executePage(expression) {
      if (!this.webview?.getURL || !this.webview.getURL() || this.webview.getURL() === 'about:blank') {
        return { ok: false, error: '内置浏览器尚未打开页面。请先调用 open_builtin_browser。', code: 'BROWSER_NOT_OPEN' };
      }
      // A blocked guest main thread makes executeJavaScript never settle. Cap
      // every guest call so one stuck page cannot stall the whole tool surface.
      return withTimeout(this.webview.executeJavaScript(expression, true), GUEST_CALL_TIMEOUT_MS, 'BROWSER_GUEST_TIMEOUT');
    }

    // Arbitrary page-context evaluation for acceptance checks that need state
    // the structured tools cannot express (storage persistence, custom metrics,
    // WebGL context state). Kept as a plain expression so the last statement
    // value is returned the way DevTools console does.
    async evaluate(expression, { storage = false } = {}) {
      return this.withAction(async () => {
        if (storage) {
          const snapshot = await this.executePage(`(() => {
            const dump = store => {
              const out = {};
              try { for (let i = 0; i < store.length; i += 1) { const key = store.key(i); out[key] = String(store.getItem(key)).slice(0, 2000); } } catch {}
              return out;
            };
            return { url: location.href, localStorage: dump(localStorage), sessionStorage: dump(sessionStorage) };
          })()`);
          if (snapshot?.ok === false) return snapshot;
          return { ok: true, output: JSON.stringify(snapshot), ...snapshot };
        }
        const source = String(expression || '').trim();
        if (!source) return { ok: false, error: '需要提供 expression，或设置 storage: true 读取本地存储。', code: 'BROWSER_EVAL_EMPTY' };
        if (source.length > 8000) return { ok: false, error: 'expression 过长（上限 8000 字符）。', code: 'BROWSER_EVAL_TOO_LONG' };
        let value;
        try {
          value = await this.executePage(source);
        } catch (error) {
          return { ok: false, error: `执行表达式失败：${error?.message || error}`, code: error?.code || 'BROWSER_EVAL_FAILED' };
        }
        if (value && typeof value === 'object' && value.ok === false && value.code) return value;
        let text;
        try { text = typeof value === 'string' ? value : JSON.stringify(value); }
        catch { text = String(value); }
        text = String(text ?? '').slice(0, 8000);
        return { ok: true, output: text, value: text, url: this.webview.getURL?.() || '' };
      });
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
        if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_observe 的 interactive 模式。', code: 'STALE_REF' };
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
      // DOM targets use CSS pixels; Electron guest input uses viewport DIPs.
      const zoom = this.webview.getZoomFactor?.() || 1;
      this.webview.sendInputEvent?.({
        type,
        x: Math.round(target.x * zoom),
        y: Math.round(target.y * zoom),
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
          if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_observe 的 interactive 模式。', code: 'STALE_REF' };
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
          if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_observe 的 interactive 模式。', code: 'STALE_REF' };
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
          if (!element || !element.isConnected) return { ok: false, error: '页面已变化，请先重新调用 browser_observe 的 interactive 模式。', code: 'STALE_REF' };
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

    async press(key, { durationMs = 80, ref = '' } = {}) {
      const raw = String(key || '').trim();
      if (!raw || raw.length > 64) return { ok: false, error: '按键名称无效。', code: 'INVALID_KEY' };
      const holdDuration = Math.max(30, Math.min(5000, Number(durationMs) || 80));
      return this.withAction(async () => {
        if (ref) {
          const target = await this.target(ref);
          if (!target?.ok) return target;
          const focused = await this.executePage(`(() => {
            const element = window.__yanBrowserRefs?.get(${JSON.stringify(String(ref))});
            if (!element?.isConnected) return { ok: false, code: 'STALE_REF' };
            element.focus();
            return { ok: element.ownerDocument.activeElement === element };
          })()`);
          if (!focused?.ok) return focused;
        }
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

    async inspectPage(options = {}) {
      return this.withAction(async () => {
        const page = await this.executePage(`(async () => {
          const images = [...document.images];
          const canvases = [...document.querySelectorAll('canvas')];
          const forms = [...document.forms];
          const headings = [...document.querySelectorAll('h1,h2,h3')].slice(0, 40).map(item => String(item.innerText || '').trim()).filter(Boolean);
          const inspectCanvas = canvas => {
            const report = { width: canvas.width, height: canvas.height, clientWidth: canvas.clientWidth, clientHeight: canvas.clientHeight };
            if (!canvas.width || !canvas.height) return { ...report, warnings: ['Canvas has zero bitmap dimensions.'] };
            // A WebGL canvas must not be sampled with drawImage/getImageData:
            // that forces a GPU framebuffer readback on the guest main thread
            // and reports pixelCoverage 0 whenever preserveDrawingBuffer is
            // false, even though the frame is on screen. Report context state.
            const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
            if (gl) {
              const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
              const contextLost = gl.isContextLost();
              return {
                ...report,
                kind: 'webgl',
                webgl: {
                  contextLost,
                  version: String(gl.getParameter(gl.VERSION) || ''),
                  renderer: debugInfo ? String(gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '') : ''
                },
                warnings: contextLost ? ['WebGL context is lost; the page must restore it before it can draw again.'] : []
              };
            }
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
            canvases: canvases.slice(0, 8).map(inspectCanvas),
            resources: (() => {
              const entries = performance.getEntriesByType('resource');
              const failed = entries.filter(entry => Number(entry.responseStatus) >= 400);
              return {
                count: entries.length,
                failed: failed.slice(0, 20).map(entry => String(entry.responseStatus) + ' ' + entry.name).map(text => text.slice(0, 200)),
                slowest: entries.slice().sort((a, b) => b.duration - a.duration).slice(0, 5)
                  .map(entry => ({ name: entry.name.slice(0, 160), ms: Math.round(entry.duration), status: Number(entry.responseStatus) || 0 }))
              };
            })(),
            performance: (() => {
              const nav = performance.getEntriesByType('navigation')[0];
              return {
                domContentLoadedMs: nav ? Math.round(nav.domContentLoadedEventEnd) : null,
                loadMs: nav ? Math.round(nav.loadEventEnd) : null,
                usedJSHeapSize: performance.memory?.usedJSHeapSize ?? null
              };
            })(),
            frameSample: ${JSON.stringify(options.includePerformance === true)} ? await (() => {
              const stamps = [];
              return new Promise(resolve => {
                const started = performance.now();
                const tick = now => {
                  stamps.push(now);
                  if (now - started < 600) requestAnimationFrame(tick);
                  else {
                    const span = stamps.length > 1 ? stamps[stamps.length - 1] - stamps[0] : 0;
                    let maxFrame = 0;
                    for (let index = 1; index < stamps.length; index += 1) maxFrame = Math.max(maxFrame, stamps[index] - stamps[index - 1]);
                    resolve({
                      frames: stamps.length,
                      fps: span > 0 ? Math.round(((stamps.length - 1) / span) * 1000) : 0,
                      maxFrameMs: Math.round(maxFrame)
                    });
                  }
                };
                requestAnimationFrame(tick);
              });
            })() : null
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
          resources: page.resources,
          performance: page.performance,
          frameSample: page.frameSample,
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

    async screenshot({ fullSize = false, force = false } = {}) {
      return this.withAction(async () => {
        if (!this.webview?.getWebContentsId || !window.yan?.browserCapturePage) return { ok: false, error: '当前 Electron 版本不支持内置浏览器截图。', code: 'SCREENSHOT_UNAVAILABLE' };
        // capturePage 经由 GPU/Viz 合成器。合成器卡住时这个 Promise 可能永远不落地
        // 并连带冻结主进程,所以必须自己设上界,失败后交给主进程侧的熔断器处理。
        // Capture first: the guest's JS main thread may be busy while the
        // compositor is still able to produce a frame.
        const capture = await withTimeout(
          window.yan.browserCapturePage(this.webview.getWebContentsId(), { fullSize, force }),
          12_000,
          'SCREENSHOT_TIMEOUT'
        );
        const url = this.webview.getURL?.() || '';
        if (capture?.unchanged) {
          return {
            ok: true,
            unchanged: true,
            output: `画面与上一张截图相同（${capture.width}×${capture.height}），未重复传输图像。需要重新取帧时传 force: true。`,
            url,
            hash: capture.hash,
            viewport: { width: capture.width, height: capture.height }
          };
        }
        const dataUrl = typeof capture === 'string' ? capture : String(capture?.dataUrl || '');
        const match = dataUrl.match(/^data:(image\/[^;]+);base64,(.+)$/);
        if (!match) return { ok: false, error: '内置浏览器没有返回有效截图。', code: 'SCREENSHOT_EMPTY' };
        let captureState = null;
        try {
          captureState = await withTimeout(this.executePage(`(() => ({
            title: document.title || '',
            text: String(document.body?.innerText || '').trim().slice(0, 4000),
            url: location.href
          }))()`), 3000, 'SCREENSHOT_STATE_TIMEOUT');
        } catch { captureState = null; }
        return {
          ok: true,
          output: `已截取当前页面：${url}`,
          url,
          capturedAt: new Date().toISOString(),
          captureState: captureState?.url ? captureState : null,
          viewport: capture?.width ? { width: capture.width, height: capture.height } : null,
          hash: capture?.hash || '',
          image: { mimeType: match[1], data: match[2] }
        };
      });
    }

    // High-risk pages must not be signed off by a quick pass. Returns which
    // signals were found so the renderer can require an explicit upgrade.
    async acceptanceRisk() {
      const probe = await this.executePage(`(() => {
        // Install a one-time write monitor: any non-GET request, form submit or
        // beacon marks the tab. This is behaviour-based, so it also covers flows
        // nobody enumerated (new SDKs, redirects, background saves).
        if (!window.__yanAcceptanceMonitor) {
          window.__yanAcceptanceMonitor = true;
          window.__yanAcceptanceDirty = null;
          const mark = (kind, detail) => {
            if (!window.__yanAcceptanceDirty) window.__yanAcceptanceDirty = { kind, detail: String(detail || '').slice(0, 200), at: Date.now() };
          };
          try {
            const nativeFetch = window.fetch;
            if (nativeFetch) {
              window.fetch = function (input, init) {
                const method = String(init?.method || (typeof input === 'object' && input ? input.method : '') || 'GET').toUpperCase();
                if (method !== 'GET' && method !== 'HEAD') mark('fetch', method + ' ' + String(typeof input === 'string' ? input : input?.url || ''));
                return nativeFetch.apply(this, arguments);
              };
            }
            const nativeOpen = XMLHttpRequest.prototype.open;
            XMLHttpRequest.prototype.open = function (method, url) {
              if (String(method || 'GET').toUpperCase() !== 'GET') mark('xhr', String(method) + ' ' + String(url || ''));
              return nativeOpen.apply(this, arguments);
            };
            document.addEventListener('submit', event => {
              const form = event.target;
              if (String(form?.method || '').toLowerCase() !== 'get') mark('form-submit', String(form?.action || ''));
            }, true);
            if (navigator.sendBeacon) {
              const nativeBeacon = navigator.sendBeacon.bind(navigator);
              navigator.sendBeacon = function (url, data) { mark('beacon', url); return nativeBeacon(url, data); };
            }
            if (window.WebSocket) {
              const nativeSend = WebSocket.prototype.send;
              WebSocket.prototype.send = function (data) {
                mark('websocket', typeof data === 'string' ? data.slice(0, 120) : '[binary]');
                return nativeSend.apply(this, arguments);
              };
            }
            window.addEventListener('beforeunload', () => mark('beforeunload', location.href));
          } catch {}
        }
        const text = element => String(element?.innerText || element?.getAttribute?.('aria-label') || element?.value || '').trim();
        const interactive = [...document.querySelectorAll('button,a,[role="button"],input[type="submit"],[role="menuitem"]')];
        const destructivePattern = /删除|移除|清空|重置|注销|退出登录|发布|提交|支付|付款|下单|购买|转账|发送|delete|remove|destroy|reset|publish|submit|pay|purchase|checkout|transfer|send|sign\\s?out/i;
        const canvases = [...document.querySelectorAll('canvas')];
        let webgl = false;
        try {
          webgl = canvases.some(canvas => {
            try { return !!(canvas.getContext('webgl2') || canvas.getContext('webgl')); } catch { return false; }
          });
        } catch {}
        const sensitiveInput = [...document.querySelectorAll('input,textarea')].some(input => {
          const type = String(input.type || '').toLowerCase();
          if (['password', 'email', 'tel', 'date'].includes(type)) return true;
          if (/cc-number|cc-csc|one-time-code|current-password|new-password/i.test(String(input.autocomplete || ''))) return true;
          return /pass(word)?|pwd|secret|token|otp|code|card|cvv|phone|mobile|email|身份证|密码|验证码|手机|邮箱/i.test(String(input.name || '') + ' ' + String(input.id || ''));
        });
        const writeForm = [...document.forms].some(form => {
          const method = String(form.method || 'get').toLowerCase();
          const encoding = String(form.enctype || '').toLowerCase();
          return method !== 'get' || encoding.includes('multipart');
        });
        const fileUpload = !!document.querySelector('input[type="file"]');
        const destructiveLabel = interactive
          .map(text)
          .filter(Boolean)
          .some(label => destructivePattern.test(label));
        return {
          webgl,
          sensitiveInput,
          writeForm,
          fileUpload,
          destructiveLabel,
          dirty: window.__yanAcceptanceDirty || null,
          title: document.title,
          url: location.href
        };
      })()`);
      if (!probe || probe.ok === false) return null;
      return probe;
    }

    // One call for one acceptance pass: settle, run every declarative check in a
    // single guest script, capture one frame, and return per-check results.
    async acceptanceSweep(options = {}) {
      return this.withAction(async () => {
        const checks = Array.isArray(options.checks) ? options.checks.slice(0, 20) : [];
        const settleMs = Math.max(0, Math.min(15000, Number(options.settleMs ?? options.settle_ms) || 4000));
        const includePerformance = options.includePerformance === true;
        const settledAt = Date.now();
        const settle = await this.waitForStable(settleMs).catch(() => null);
        const probe = await this.executePage(`(async () => {
          const checks = ${JSON.stringify(checks)};
          const readStorage = (key, session) => {
            try { return (session ? sessionStorage : localStorage).getItem(String(key)); } catch { return null; }
          };
          const visible = element => {
            if (!element || !element.isConnected) return false;
            const rect = element.getBoundingClientRect();
            const style = getComputedStyle(element);
            return rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0';
          };
          const webglContext = () => {
            for (const canvas of document.querySelectorAll('canvas')) {
              try {
                const context = canvas.getContext('webgl2') || canvas.getContext('webgl');
                if (context) return context;
              } catch {}
            }
            return null;
          };
          const run = check => {
            const type = String(check?.type || '');
            try {
              switch (type) {
                case 'title_contains': return { pass: String(document.title).includes(String(check.value ?? '')), detail: document.title };
                case 'url_contains': return { pass: String(location.href).includes(String(check.value ?? '')), detail: location.href };
                case 'text_visible': {
                  const text = String(document.body?.innerText || '');
                  return { pass: text.includes(String(check.value ?? '')), detail: text.replace(/\\s+/g, ' ').slice(0, 160) };
                }
                case 'element_exists': return { pass: !!document.querySelector(String(check.selector || '')), detail: String(check.selector || '') };
                case 'element_visible': return { pass: visible(document.querySelector(String(check.selector || ''))), detail: String(check.selector || '') };
                case 'no_horizontal_overflow': {
                  const root = document.scrollingElement || document.documentElement;
                  const overflow = Math.max(0, (root?.scrollWidth || 0) - (root?.clientWidth || 0));
                  return { pass: overflow <= 2, detail: overflow + 'px overflow' };
                }
                case 'storage_equals': {
                  const actual = readStorage(check.key, check.session === true);
                  return { pass: actual === String(check.value ?? ''), detail: String(actual).slice(0, 160) };
                }
                case 'canvas_present': {
                  const count = document.querySelectorAll('canvas').length;
                  return { pass: count > 0, detail: count + ' canvas' };
                }
                case 'webgl_context_ok': {
                  const context = webglContext();
                  return { pass: !!context && !context.isContextLost(), detail: context ? String(context.getParameter(context.VERSION)) : 'no webgl context' };
                }
                default: return { pass: false, detail: 'unsupported check type: ' + type };
              }
            } catch (error) {
              return { pass: false, detail: String(error?.message || error).slice(0, 160) };
            }
          };
          const results = checks.map(check => ({ type: String(check?.type || ''), ...run(check) }));
          const root = document.scrollingElement || document.documentElement;
          const gl = webglContext();
          const frames = [];
          let frameSample = null;
          if (${JSON.stringify(includePerformance)}) {
            await new Promise(resolve => {
              const started = performance.now();
              const tick = now => {
                frames.push(now);
                if (now - started < 600) requestAnimationFrame(tick);
                else {
                  const span = frames.length > 1 ? frames[frames.length - 1] - frames[0] : 0;
                  let maxFrame = 0;
                  for (let index = 1; index < frames.length; index += 1) maxFrame = Math.max(maxFrame, frames[index] - frames[index - 1]);
                  frameSample = { frames: frames.length, fps: span > 0 ? Math.round(((frames.length - 1) / span) * 1000) : 0, maxFrameMs: Math.round(maxFrame) };
                  resolve();
                }
              };
              requestAnimationFrame(tick);
            });
          }
          const entries = performance.getEntriesByType('resource');
          return {
            url: location.href,
            title: document.title,
            readyState: document.readyState,
            checks: results,
            viewport: { width: innerWidth, height: innerHeight, scrollWidth: root?.scrollWidth || 0, scrollHeight: root?.scrollHeight || 0 },
            webgl: gl ? { contextLost: gl.isContextLost(), version: String(gl.getParameter(gl.VERSION)) } : null,
            resources: {
              count: entries.length,
              failed: entries.filter(entry => Number(entry.responseStatus) >= 400).length
            },
            frameSample
          };
        })()`);
        if (!probe || probe.ok === false) return probe;
        const consoleErrors = (this.consoleEntries || [])
          .filter(entry => Number(entry.level) >= 3)
          .slice(-10)
          .map(entry => String(entry.message || '').slice(0, 300));
        const results = (probe.checks || []).map(check => ({ ...check }));
        if (checks.some(check => check?.type === 'no_console_errors')) {
          const existing = results.find(check => check.type === 'no_console_errors');
          const entry = { type: 'no_console_errors', pass: consoleErrors.length === 0, detail: consoleErrors.length ? consoleErrors[0] : '' };
          if (existing) Object.assign(existing, entry); else results.push(entry);
        }
        let shot = null;
        try {
          shot = await withTimeout(window.yan.browserCapturePage(this.webview.getWebContentsId(), { fullSize: options.fullSize === true }), 12_000, 'SCREENSHOT_TIMEOUT');
        } catch (error) { shot = { error: String(error?.message || error) }; }
        const failed = results.filter(check => !check.pass).map(check => check.type);
        const lines = [
          `URL: ${probe.url}`,
          `标题: ${probe.title || '(无标题)'}`,
          `状态: ${probe.readyState}`,
          `视口: ${probe.viewport.width}×${probe.viewport.height}`,
          `检查: ${results.length - failed.length}/${results.length} 通过`,
          ...results.map(check => `${check.pass ? '✓' : '✗'} ${check.type}${check.pass ? '' : ' — ' + check.detail}`)
        ];
        if (consoleErrors.length) lines.push(`控制台错误: ${consoleErrors.slice(0, 3).join(' | ')}`);
        if (probe.frameSample) lines.push(`帧率: ${probe.frameSample.fps} fps，最大帧 ${probe.frameSample.maxFrameMs}ms`);
        const image = typeof shot?.dataUrl === 'string' && shot.dataUrl.includes('base64,')
          ? { mimeType: shot.dataUrl.slice(5, shot.dataUrl.indexOf(';')) || 'image/png', data: shot.dataUrl.slice(shot.dataUrl.indexOf('base64,') + 7) }
          : null;
        return {
          ok: failed.length === 0,
          output: lines.join('\n'),
          url: probe.url,
          title: probe.title,
          readyState: probe.readyState,
          settleMs: Date.now() - settledAt,
          settle,
          checks: results,
          failed,
          consoleErrors,
          metrics: {
            resources: probe.resources,
            frameSample: probe.frameSample,
            webgl: probe.webgl
          },
          // `image` is the field the MCP layer lifts into an image content block;
          // `screenshot` stays metadata-only so base64 never lands in the text.
          image: image ? { mimeType: image.mimeType, data: image.data } : null,
          screenshot: {
            hash: shot?.hash || '',
            viewport: shot?.width ? { width: shot.width, height: shot.height } : null,
            unchanged: shot?.unchanged === true
          }
        };
      });
    }

    // Wait for the page to actually stop moving: commit + two frames + fonts +
    // pending images, capped. This replaces most explicit browser_wait calls.
    async waitForStable(timeoutMs = 4000) {
      const capped = Math.max(200, Math.min(15000, Number(timeoutMs) || 4000));
      const started = Date.now();
      if (this.webview?.isLoading?.()) {
        await new Promise(resolve => {
          let done = false;
          const finish = () => { if (done) return; done = true; clearTimeout(timer); this.webview.removeEventListener('did-finish-load', finish); this.webview.removeEventListener('did-fail-load', finish); resolve(); };
          const timer = setTimeout(finish, Math.min(3000, capped));
          this.webview.addEventListener('did-finish-load', finish);
          this.webview.addEventListener('did-fail-load', finish);
        });
      }
      const remaining = Math.max(200, capped - (Date.now() - started));
      try {
        await this.executePage(`(async () => {
          const deadline = performance.now() + ${remaining};
          const raf = () => new Promise(resolve => requestAnimationFrame(() => resolve()));
          await raf(); await raf();
          try { await Promise.race([document.fonts.ready, new Promise(resolve => setTimeout(resolve, 300))]); } catch {}
          const pending = () => [...document.images].filter(image => !image.complete).length;
          while (pending() > 0 && performance.now() < deadline) await new Promise(resolve => setTimeout(resolve, 50));
          return { readyState: document.readyState, pendingImages: pending(), fonts: document.fonts?.status || '' };
        })()`);
      } catch { /* a busy guest is reported by the caller's own timeout */ }
      return Date.now() - started;
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
        // requestAnimationFrame can be paused (hidden or occluded guest). Fall
        // back to a timer so a paused frame loop cannot eat the whole guest
        // budget and surface as a generic timeout.
        const nextFrame = () => new Promise(resolve => {
          let settled = false;
          const done = () => { if (settled) return; settled = true; clearTimeout(timer); resolve(); };
          const timer = setTimeout(done, 600);
          requestAnimationFrame(done);
        });
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

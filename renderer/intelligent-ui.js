/* Inline Creator output. Only the sandbox host receives generated HTML. */
(() => {
  const states = new WeakMap();
  const panels = new WeakMap();
  const STATE_STORAGE = 'yan.intelligent-ui.state.v1';
  const MAX_STATE_BYTES = 16 * 1024;
  const MAX_SAVED_PANELS = 32;
  let mapRuntime;
  let openUiRuntime;
  function loadOpenUiRuntime() {
    if (!openUiRuntime) openUiRuntime = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = new URL('vendor/openui/intelligent-ui-runtime.js', document.baseURI).href;
      script.onload = () => resolve(window.YanIntelligentUiOpenUiSource);
      script.onerror = () => { script.remove(); openUiRuntime = null; reject(new Error('OpenUI 加载失败')); };
      document.head.append(script);
    });
    return openUiRuntime;
  }
  function loadMapRuntime() {
    if (!mapRuntime) mapRuntime = (async () => {
      for (const source of ['vendor/maplibre/intelligent-ui-maplibre.js', 'intelligent-ui-map.js']) {
        await new Promise((resolve, reject) => {
          const script = document.createElement('script');
          script.src = new URL(source, document.baseURI).href;
          script.onload = resolve;
          script.onerror = () => { script.remove(); reject(new Error('地图组件加载失败')); };
          document.head.append(script);
        });
      }
      return { script: window.YanIntelligentUiMapLibre.script + '\n' + window.YanIntelligentUiMapSource, css: window.YanIntelligentUiMapLibre.css };
    })().catch(error => { mapRuntime = null; throw error; });
    return mapRuntime;
  }
  function validState(json) {
    if (typeof json !== 'string' || json.length > MAX_STATE_BYTES
      || new TextEncoder().encode(json).length > MAX_STATE_BYTES) return false;
    try { JSON.parse(json); return true; } catch { return false; }
  }
  function savedPanels() {
    try {
      const records = JSON.parse(localStorage.getItem(STATE_STORAGE) || '[]');
      return Array.isArray(records) ? records.filter(record => record && typeof record.key === 'string'
        && /^[a-f0-9]{64}$/.test(record.key) && validState(record.json)).slice(-MAX_SAVED_PANELS) : [];
    } catch { return []; }
  }
  async function panelKey(item) {
    if (!item.id) return null;
    // Include code and revision: an updated program may have a different state schema.
    const identityParts = [item.id, item.revision || 0, item.html];
    if (item.format === 'openui') identityParts.push('openui', item.code);
    if (item.resources?.map || item.resources?.images?.length) identityParts.push(item.resources);
    const identity = JSON.stringify(identityParts);
    const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('');
  }
  function savePanel(key, json) {
    if (!key || !validState(json)) return false;
    try {
      const records = savedPanels().filter(record => record.key !== key);
      records.push({ key, json });
      localStorage.setItem(STATE_STORAGE, JSON.stringify(records.slice(-MAX_SAVED_PANELS)));
      return true;
    } catch { return false; }
  }
  const isTool = name => /^(?:yan_session_)?intelligent_ui_creator$/.test(String(name || ''));
  function decode(value, depth = 0) {
    if (depth > 5 || value == null) return null;
    if (typeof value === 'string') {
      try { return decode(JSON.parse(value), depth + 1); } catch { return null; }
    }
    if (value.intelligent_ui?.version === 1) return value;
    if (Array.isArray(value)) {
      for (const part of value) { const found = decode(part, depth + 1); if (found) return found; }
    }
    for (const key of ['structuredContent', 'content', 'text', 'output']) {
      if (value[key]) { const found = decode(value[key], depth + 1); if (found) return found; }
    }
    return null;
  }
  function fromCall(call, result, runStatus) {
    const payload = result?.ok !== false ? decode(result?.output) : null;
    const raw = payload?.ok === true ? payload.intelligent_ui : null;
    const args = call.args || {};
    const format = raw?.format || 'html';
    const id = String(raw?.id || args.task_id || call.callId || '');
    const accepted = raw?.status === 'ready' && raw.id === args.task_id && args.action === 'render' && format === (args.format || 'html');
    const code = accepted && format === 'openui' && typeof args.code === 'string' && args.code.length <= 65536 && !Object.hasOwn(args, 'html') ? args.code.trim() : '';
    const html = accepted && format === 'html' && !Object.hasOwn(args, 'code')
      && typeof args.html === 'string' && args.html.length <= 163840 ? args.html.trim() : '';
    return {
      type: 'intelligent_ui', openCodeKey: `intelligent-ui:${id}`, stage: 'summary',
      id, revision: Number.isSafeInteger(raw?.revision) ? raw.revision : 0,
      resources: html || code ? raw.resources || null : null, format, code,
      handoff: !!code && raw.handoff === true && args.handoff === true,
      title: String(raw?.title || args.title || 'Intelligent UI').slice(0, 100),
      purpose: String(raw?.purpose || args.purpose || '').slice(0, 500), html,
      status: html || code ? 'ready' : result?.ok === false ? 'error' : runStatus === 'working' ? 'creating' : 'incomplete'
    };
  }
  function create() {
    const element = document.createElement('section');
    element.className = 'intelligent-ui-output';
    element.innerHTML = '<header class="intelligent-ui-heading"><div><span class="intelligent-ui-label">Intelligent UI Creator</span><h3></h3></div><span class="intelligent-ui-status" role="status"></span></header><p class="intelligent-ui-purpose"></p><div class="intelligent-ui-surface"></div>';
    return element;
  }
  function update(element, item) {
    const previous = states.get(element);
    element.querySelector('h3').textContent = item.title;
    element.querySelector('.intelligent-ui-purpose').textContent = item.purpose;
    const status = element.querySelector('.intelligent-ui-status');
    const labels = { creating: '正在创建', ready: '可交互', error: '创建失败', incomplete: '未完成' };
    if (previous?.html === item.html && previous?.code === item.code && previous?.format === item.format && previous?.handoff === item.handoff && previous?.status === item.status
      && previous?.id === item.id && previous?.revision === item.revision
      && previous?.resources === JSON.stringify(item.resources || null)) return;
    status.textContent = labels[item.status] || '未完成';
    element.dataset.state = item.status;
    const surface = element.querySelector('.intelligent-ui-surface');
    if (!item.html && !item.code) {
      surface.replaceChildren();
      states.set(element, { html: '', status: item.status });
      return;
    }
    const frame = document.createElement('iframe');
    frame.className = 'intelligent-ui-frame';
    frame.title = item.title;
    frame.style.colorScheme = document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    frame.setAttribute('sandbox', 'allow-scripts');
    frame.setAttribute('referrerpolicy', 'no-referrer');
    frame.src = new URL('intelligent-ui-host.html', document.baseURI).href;
    const handoff = document.createElement('button');
    handoff.className = 'intelligent-ui-handoff';
    handoff.textContent = '带回对话'; handoff.disabled = true;
    handoff.style.cssText = 'border:1px solid var(--border-color,#8885);border-radius:999px;padding:6px 14px;background:transparent;color:inherit;margin-top:8px;cursor:pointer';
    handoff.addEventListener('click', () => {
      const summary = panels.get(frame)?.summary;
      if (!summary || !frame.isConnected) return;
      const text = item.title + '\n' + summary;
      if (typeof getComposerText === 'function' && typeof setComposerText === 'function') {
        const draft = getComposerText();
        setComposerText((draft ? draft + '\n\n' : '') + text);
        const input = document.getElementById('composerInput');
        input?.dispatchEvent(new Event('input', { bubbles: true })); input?.focus();
      } else {
        let output = surface.querySelector('textarea');
        if (!output) { output = document.createElement('textarea'); output.readOnly = true; output.style.cssText = 'display:block;width:100%;margin-top:8px'; surface.append(output); }
        output.value = text; output.focus(); output.select();
      }
      handoff.textContent = '已准备结果';
    });
    frame.onload = async () => {
      let key = null;
      try { key = await panelKey(item); } catch { /* Rendering still works without persistence. */ }
      const online = typeof state === 'undefined' || state.config?.permissions?.allowNetwork !== false;
      const resources = online ? item.resources : null;
      let runtime = null;
      let openui = null;
      if (item.format === 'openui') {
        try { openui = await loadOpenUiRuntime(); }
        catch { status.textContent = 'OpenUI 组件加载失败'; return; }
      }
      if (resources?.map) {
        try { runtime = await loadMapRuntime(); }
        catch { status.textContent = '地图组件加载失败'; }
      }
      if (!frame.isConnected) return;
      panels.set(frame, { key, handoff, format: item.format });
      const saved = key ? savedPanels().find(record => record.key === key) : null;
      frame.contentWindow?.postMessage({
        type: 'yan-ui-render', html: item.html, state: saved ? JSON.parse(saved.json) : null,
        resources, runtime, format: item.format, code: item.code, openui,
        dark: document.documentElement.dataset.theme === 'dark'
      }, '*');
    };
    surface.replaceChildren(frame);
    if (item.format === 'openui' && item.handoff === true) surface.append(handoff);
    states.set(element, { id: item.id, revision: item.revision, html: item.html, code: item.code, format: item.format, handoff: item.handoff, status: item.status, resources: JSON.stringify(item.resources || null) });
  }
  window.addEventListener('message', event => {
    if (!['yan-ui-size', 'yan-ui-error', 'yan-ui-state', 'yan-ui-summary'].includes(event.data?.type)) return;
    const frame = [...document.querySelectorAll('.intelligent-ui-frame')].find(node => node.contentWindow === event.source);
    if (!frame) return;
    if (event.data.type === 'yan-ui-summary') {
      const panel = panels.get(frame);
      if (panel?.format !== 'openui' || typeof event.data.text !== 'string' || event.data.text.length > 8000) return;
      panel.summary = event.data.text; panel.handoff.disabled = !panel.summary;
      panel.handoff.textContent = '带回对话';
    } else if (event.data.type === 'yan-ui-size' && Number.isFinite(event.data.height)) {
      frame.style.height = `${Math.max(160, Math.min(20000, Math.ceil(event.data.height)))}px`;
    } else if (event.data.type === 'yan-ui-error') {
      frame.closest('.intelligent-ui-output').querySelector('.intelligent-ui-status').textContent = '界面运行出错';
    } else if (event.data.type === 'yan-ui-state' && Number.isSafeInteger(event.data.requestId)) {
      const ok = savePanel(panels.get(frame)?.key, event.data.json);
      frame.contentWindow?.postMessage({ type: 'yan-ui-state-result', requestId: event.data.requestId, ok }, '*');
    }
  });
  window.YanIntelligentUi = { isTool, fromCall, create, update };
})();

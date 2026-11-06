'use strict';
let child;
// Encode JSON literals without changing their values after the inner script parses them.
const scriptLiteral = value => JSON.stringify(value).replace(/[<\u2028\u2029]/g, char => String.fromCharCode(92) + 'u' + char.charCodeAt(0).toString(16).padStart(4, '0'));
function installPanelBridge(initialState, capabilities) {
  const MAX_BYTES = 16 * 1024;
  let current = initialState, nextId = 0;
  const pending = new Map();
  const clone = value => JSON.parse(JSON.stringify(value));
  const api = Object.freeze({
    capabilities: Object.freeze(capabilities),
    createMap: (element, options) => {
      if (!capabilities.map || !window.YanMapRuntime) throw new Error('Map capability unavailable for this panel.');
      return window.YanMapRuntime.createMap(element, options);
    },
    getState: () => clone(current),
    setState: async value => {
      const json = JSON.stringify(value, (_key, field) => {
        if (['undefined', 'function', 'symbol', 'bigint'].includes(typeof field)
          || (typeof field === 'number' && !Number.isFinite(field))) throw new TypeError('State must contain JSON values only.');
        return field;
      });
      if (typeof json !== 'string') throw new TypeError('State must contain JSON values only.');
      if (new TextEncoder().encode(json).length > MAX_BYTES) throw new RangeError('State exceeds 16 KiB.');
      current = JSON.parse(json);
      const requestId = ++nextId;
      return new Promise(resolve => {
        const timer = setTimeout(() => { pending.delete(requestId); resolve(false); }, 3000);
        pending.set(requestId, { resolve, timer });
        parent.postMessage({ type: 'state', requestId, json }, '*');
      });
    }
  });
  Object.defineProperty(window, 'yanUi', { value: api, writable: false, configurable: false });
  addEventListener('message', event => {
    if (event.source !== parent || event.data?.type !== 'state-result') return;
    const request = pending.get(event.data.requestId);
    if (!request) return;
    clearTimeout(request.timer);
    pending.delete(event.data.requestId);
    request.resolve(event.data.ok === true);
  });
}
window.addEventListener('message', event => {
  if (event.source === parent && event.data?.type === 'yan-ui-render') {
    let html = event.data.html;
    const openui = event.data.format === 'openui';
    const lang = event.data.lang === 'en' ? 'en' : 'zh';
    document.documentElement.lang = lang === 'en' ? 'en' : 'zh-CN';
    if (openui) {
      if (typeof event.data.code !== 'string' || event.data.code.length > 65536 || typeof event.data.openui !== 'string') return;
      const program = scriptLiteral(event.data.code);
      const source = event.data.openui.replace(/<\/script/gi, '<\\/script');
      const panelTitle = scriptLiteral(typeof event.data.title === 'string' ? event.data.title.slice(0, 100) : '');
      html = '<body><scr' + 'ipt>' + source + '\nwindow.YanOpenUi.mount(' + program + ', ' + JSON.stringify(lang) + ', ' + panelTitle + ');</scr' + 'ipt>';
    } else if (typeof html !== 'string' || html.length > 163840) return;
    child?.remove();
    child = document.createElement('iframe');
    child.title = lang === 'en' ? 'Interactive content' : '交互内容';
    child.setAttribute('sandbox', 'allow-scripts');
    const dark = event.data.dark === true;
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
    child.style.colorScheme = dark ? 'dark' : 'light';
    const css = ':root{color-scheme:' + (dark ? 'dark' : 'light') + ';--ui-bg:' + (dark ? '#202020' : '#ffffff') + ';--ui-text:' + (dark ? '#ededed' : '#202020') + ';--ui-muted:' + (dark ? '#aaa' : '#666') + ';--ui-border:' + (dark ? '#444' : '#ddd') + ';--ui-accent:' + (dark ? '#79adf4' : '#2465b5') + '}';
    // Serialize data as a JS literal without allowing a saved value to end the script tag.
    const snapshot = scriptLiteral(event.data.state ?? null);
    const allowedHosts = new Set(['upload.wikimedia.org', 'images.unsplash.com', 'images.pexels.com']);
    const sources = [];
    for (const value of (Array.isArray(event.data.resources?.images) ? event.data.resources.images.slice(0, 12) : [])) {
      try {
        const url = new URL(value);
        if (url.protocol === 'https:' && allowedHosts.has(url.hostname) && !url.username && !url.password && !url.port) {
          // CSP matches paths, not query strings; providers are also bounded by the outer policy.
          sources.push((url.origin + url.pathname).replace(/[;'"<>\s]/g, char => encodeURIComponent(char).replace(/'/g, '%27')));
        }
      } catch {}
    }
    const map = event.data.resources?.map === true && typeof event.data.runtime?.script === 'string';
    if (map) sources.push('blob:', 'https://tiles.openfreemap.org/');
    const policy = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data: " + sources.join(' ') + "; font-src data:; connect-src " + (map ? 'https://tiles.openfreemap.org' : "'none'") + "; worker-src " + (map ? 'blob:' : "'none'") + "; frame-src 'none'; form-action 'none'; base-uri 'none';";
    const meta = '<meta http-equiv="Content-Security-Policy" content="' + policy.replace(/&/g, '&amp;').replace(/"/g, '&quot;') + '">';
    const bridge = '(' + installPanelBridge.toString() + ')(' + snapshot + ',' + JSON.stringify({ map }) + ');' + "addEventListener('error',()=>parent.postMessage({type:'error'},'*'));addEventListener('unhandledrejection',()=>parent.postMessage({type:'error'},'*'));addEventListener('DOMContentLoaded',()=>{let pending=false;const report=()=>{if(pending)return;pending=true;requestAnimationFrame(()=>{pending=false;parent.postMessage({type:'size',height:Math.max(document.body.scrollHeight,document.body.offsetHeight)},'*')})};new ResizeObserver(report).observe(document.body);report()});";
    const runtimeScript = map ? event.data.runtime.script.replace(/<\/script/gi, '<\\/script') : '';
    const runtimeCss = (map ? event.data.runtime.css : '') + (openui && typeof event.data.openuiCss === 'string' ? event.data.openuiCss.replace(/<\/style/gi, '<\\/style') : '');
    child.srcdoc = '<!doctype html><meta charset="utf-8">' + meta + '<style>' + runtimeCss + css + document.getElementById('ui-defaults').content.textContent + '</style><scr' + 'ipt>' + runtimeScript + '\n' + bridge + '</scr' + 'ipt>' + html;
    document.body.append(child);
  } else if (event.source === parent && event.data?.type === 'yan-ui-state-result') {
    child?.contentWindow?.postMessage({ type: 'state-result', requestId: event.data.requestId, ok: event.data.ok === true }, '*');
  } else if (child && event.source === child.contentWindow) {
    if (event.data?.type === 'size' && Number.isFinite(event.data.height)) {
      const height = Math.max(1, Math.min(20000, Math.ceil(event.data.height) + 2));
      child.style.height = height + 'px';
      parent.postMessage({type:'yan-ui-size',height}, '*');
    } else if (event.data?.type === 'error') parent.postMessage({type:'yan-ui-error'}, '*');
    else if (event.data?.type === 'summary' && typeof event.data.text === 'string' && event.data.text.length <= 8000) {
      parent.postMessage({type:'yan-ui-summary',text:event.data.text}, '*');
    }
    else if (event.data?.type === 'state' && Number.isSafeInteger(event.data.requestId)
      && typeof event.data.json === 'string' && event.data.json.length <= 16384) {
      parent.postMessage({ type: 'yan-ui-state', requestId: event.data.requestId, json: event.data.json }, '*');
    }
  }
});

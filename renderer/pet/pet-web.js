// Custom frontends run in an opaque-origin frame; only this small bridge reaches the host.
(() => {
  const frame = document.getElementById('petFrontend');
  let identity = '';
  let snapshots = {};
  const send = (type, payload) => frame.contentWindow?.postMessage({ channel: 'yan-pet', type, payload }, '*');
  function bootstrap() {
    const listeners = new Map();
    const latest = new Map();
    const command = type => parent.postMessage({ channel: 'yan-pet', type }, '*');
    const subscribe = type => cb => {
      if (typeof cb !== 'function') return () => {};
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(cb);
      if (latest.has(type)) queueMicrotask(() => { if (listeners.get(type).has(cb)) cb(latest.get(type)); });
      return () => listeners.get(type)?.delete(cb);
    };
    window.yanPet = Object.freeze({
      onData: subscribe('data'), onConfig: subscribe('config'), onState: subscribe('state'),
      refreshData: () => command('refreshData'), startDrag: () => command('startDrag'),
      stopDrag: () => command('stopDrag'), openTask: () => command('openTask'), close: () => command('close')
    });
    addEventListener('message', event => {
      if (event.source !== parent || event.data?.channel !== 'yan-pet') return;
      const { type, payload } = event.data;
      if (!['data', 'config', 'state'].includes(type)) return;
      latest.set(type, payload);
      for (const cb of listeners.get(type) || []) { try { cb(payload); } catch (error) { console.error(error); } }
    });
    addEventListener('blur', () => command('stopDrag'));
    addEventListener('pointerup', () => command('stopDrag'));
    addEventListener('pointercancel', () => command('stopDrag'));
    addEventListener('DOMContentLoaded', () => command('ready'));
  }
  addEventListener('message', event => {
    if (frame.hidden || event.source !== frame.contentWindow || event.data?.channel !== 'yan-pet') return;
    const type = event.data.type;
    if (type === 'ready') {
      for (const [key, payload] of Object.entries(snapshots)) send(key, payload);
    } else if (['refreshData', 'startDrag', 'stopDrag', 'openTask', 'close'].includes(type)) {
      window.yanPet?.[type]?.();
    }
  });
  window.yanPetFrontend = {
    configure(config) {
      const frontend = config.layout === 'web' ? config.frontend : null;
      frame.hidden = !frontend;
      if (!frontend) {
        if (identity) { frame.removeAttribute('srcdoc'); identity = ''; snapshots = {}; }
        return;
      }
      const next = JSON.stringify([config.selected, frontend]);
      if (identity !== next) {
        identity = next;
        snapshots = {};
        const doc = new DOMParser().parseFromString(frontend.html, 'text/html');
        const policy = doc.createElement('meta');
        policy.httpEquiv = 'Content-Security-Policy';
        policy.content = "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; frame-src 'none'; base-uri 'none'; form-action 'none'";
        const script = doc.createElement('script');
        script.textContent = `(${bootstrap.toString()})();`;
        doc.head.prepend(policy, script);
        const style = doc.createElement('style');
        style.textContent = `html,body{margin:0;background:transparent;}\n${frontend.css}`.replace(/<\/style/gi, '<\\/style');
        doc.head.append(style);
        const code = doc.createElement('script');
        code.textContent = frontend.js.replace(/<\/script/gi, '<\\/script');
        doc.body.append(code);
        frame.srcdoc = '<!doctype html>' + doc.documentElement.outerHTML;
      }
      snapshots.config = { selected: config.selected, label: config.label, scale: config.scale,
        width: frontend.width, height: frontend.height, hasDataSource: config.hasDataSource };
      send('config', snapshots.config);
    },
    publish(type, payload) {
      if (frame.hidden) return;
      snapshots[type] = payload;
      send(type, payload);
    }
  };
})();

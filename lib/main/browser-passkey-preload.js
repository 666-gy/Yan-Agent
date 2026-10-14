'use strict';
const { contextBridge, ipcRenderer } = require('electron');
if (process.isMainFrame) {
  // A deliberately narrow bridge: no vault access, challenges, responses or keys.
  contextBridge.exposeInMainWorld('__yanPasskeyUpgrade', value => ipcRenderer.invoke('browser:passkey-upgrade', value));
  contextBridge.executeInMainWorld({ func: () => {
    if (!window.isSecureContext || !navigator.credentials || !window.PublicKeyCredential) return;
    const authorize = window.__yanPasskeyUpgrade;
    const nativeCreate = navigator.credentials.create.bind(navigator.credentials);
    navigator.credentials.create = async function(options) {
      if (!options?.publicKey || options.mediation !== 'conditional') return nativeCreate(options);
      const signal = options.signal;
      if (signal?.aborted) throw signal.reason;
      if (document.visibilityState !== 'visible') throw new DOMException('The page is not visible.', 'NotAllowedError');
      // Snapshot the site's request before asynchronous consent: changing user/rp
      // or ArrayBuffers during the dialog must not change what was approved.
      const { signal: ignoredSignal, ...data } = options;
      const request = structuredClone(data);
      delete request.mediation;
      if (signal) request.signal = signal;
      const requestId = crypto.randomUUID();
      const cancel = () => { authorize({ action: 'cancel', requestId }).catch(() => {}); };
      signal?.addEventListener('abort', cancel, { once: true });
      try {
        const allowed = await authorize({ action: 'authorize', requestId,
          rpId: request.publicKey.rp?.id || location.hostname, username: request.publicKey.user?.name });
        if (signal?.aborted) throw signal.reason;
        if (!allowed) throw new DOMException('Passkey upgrade was not approved.', 'NotAllowedError');
        // Electron has no password-manager-backed silent upgrade provider. After
        // explicit consent use its normal platform-authenticator ceremony instead.
        return await nativeCreate(request);
      } finally { signal?.removeEventListener('abort', cancel); }
    };
  } });
}

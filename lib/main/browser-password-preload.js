'use strict';
// Isolated world only: never expose credential IPC or the vault to page scripts.
const { ipcRenderer } = require('electron');
if (process.isMainFrame) {
  let filling = false, supplied = false, timer;
  const visible = input => !input.disabled && !input.readOnly && input.getClientRects().length > 0;
  function fields() {
    const passwords = [...document.querySelectorAll('input[type="password"]')].filter(visible);
    if (passwords.length !== 1 || passwords[0].autocomplete === 'new-password') return null;
    const password = passwords[0], form = password.form;
    if (!form || new URL(form.action || location.href, location.href).origin !== location.origin) return null;
    const username = [...form.querySelectorAll('input')].filter(visible).find(input => input.autocomplete === 'username') || [...form.querySelectorAll('input[type="email"], input[type="text"], input:not([type])')].filter(visible).find(input => !!(input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING));
    return username ? { form, username, password } : null;
  }
  const setValue = (input, value) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true })); input.dispatchEvent(new Event('change', { bubbles: true }));
  };
  async function fill() {
    if (filling || supplied) return;
    const target = fields();
    if (!target || target.password.value || target.username.value) return;
    filling = true;
    try {
      const credentials = await ipcRenderer.invoke('browser:credential-fill');
      if (!credentials || credentials.origin !== location.origin || !target.form.isConnected || target.password.value || target.username.value || fields()?.form !== target.form) return;
      supplied = true;
      setValue(target.username, credentials.username); setValue(target.password, credentials.password);
      if (credentials.autoLogin && fields()?.form === target.form && target.form.checkValidity()) {
        // Avoid registration/payment forms and let the page perform normal submit validation.
        const submit = target.form.querySelector('button[type="submit"], input[type="submit"], button:not([type])');
        const label = `${submit?.textContent || ''} ${submit?.value || ''}`;
        if (submit && /log\s*in|sign\s*in|登录|登入/i.test(label) && !/sign\s*up|register|注册|支付|pay|purchase/i.test(label)) target.form.requestSubmit(submit);
      }
    } catch { /* Missing/locked OS vault must not break a webpage. */ }
    finally { filling = false; }
  }
  document.addEventListener('submit', event => {
    const target = fields();
    if (!event.isTrusted || !target || event.target !== target.form || !target.password.value) return;
    ipcRenderer.invoke('browser:credential-save', { username: target.username.value, password: target.password.value }).catch(() => {});
  }, true);
  addEventListener('DOMContentLoaded', () => {
    fill();
    new MutationObserver(() => { clearTimeout(timer); timer = setTimeout(fill, 250); }).observe(document.documentElement, { childList: true, subtree: true });
  });
}

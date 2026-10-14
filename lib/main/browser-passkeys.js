'use strict';

// Private keys and WebAuthn responses stay with Chromium/the system authenticator.
// This module only authorizes a site's upgrade request and selects account IDs.
function registerBrowserPasskeys({ app, ipcMain, session, dialog, webContents }, {
  getMainWindow, configStore, BROWSER_PARTITION, guest, stillHere, readPasswords
}) {
  const recentLogins = new WeakMap();
  const pending = new WeakMap();
  const enabled = () => configStore.loadConfig().browserPasswords?.offerPasskeyUpgrade !== false;
  function notePasswordUsed(event, value) {
    const context = guest(event);
    const item = readPasswords().find(item => new URL(item.url).origin === context.url.origin
      && item.username === String(value?.username || '').trim() && item.password === value?.password);
    if (item) recentLogins.set(context.contents, { origin: context.url.origin, username: item.username,
      id: item.id, updatedAt: item.updatedAt, time: Date.now() });
  }
  async function prompt(context, options, requestId) {
    if (pending.has(context.contents)) return 0;
    const controller = new AbortController();
    const cancel = () => controller.abort();
    const navigate = (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) cancel(); };
    pending.set(context.contents, { controller, requestId });
    context.contents.on('did-start-navigation', navigate);
    context.contents.once('destroyed', cancel);
    const timer = setTimeout(cancel, 60000);
    try {
      const result = await dialog.showMessageBox(getMainWindow(), { type: 'question', defaultId: 0,
        cancelId: 0, noLink: true, ...options, signal: controller.signal });
      return !controller.signal.aborted && stillHere(context) ? result.response : 0;
    } finally {
      clearTimeout(timer);
      context.contents.removeListener('did-start-navigation', navigate);
      context.contents.removeListener('destroyed', cancel);
      pending.delete(context.contents);
    }
  }
  ipcMain.handle('browser:passkey-upgrade', async (event, value) => {
    const context = guest(event);
    if (value?.action === 'cancel') {
      const active = pending.get(context.contents);
      if (active?.requestId === value.requestId) active.controller.abort();
      return false;
    }
    if (value?.action !== 'authorize' || typeof value.requestId !== 'string' || value.requestId.length > 80 || !enabled()) return false;
    const login = recentLogins.get(context.contents);
    const rp = value.rpId;
    if (typeof rp !== 'string' || !rp || !(context.url.hostname === rp || context.url.hostname.endsWith(`.${rp}`))) return false;
    if (!login || login.origin !== context.url.origin || login.username !== value.username || Date.now() - login.time > 300000) return false;
    const exists = () => readPasswords().some(item => item.id === login.id && item.updatedAt === login.updatedAt);
    if (!exists()) return false;
    // One offer per matching password submission, including a declined offer.
    recentLogins.delete(context.contents);
    const response = await prompt(context, { title: '创建通行密钥？', message: `${context.url.origin} 请求创建通行密钥`,
      detail: `账号：${login.username}\n你刚刚使用了此账号的已保存密码。继续后由系统确认并保存通行密钥，原密码仍然保留。`,
      buttons: ['暂不创建', '继续创建'] }, value.requestId);
    return response === 1 && enabled() && exists();
  });
  app.whenReady().then(() => {
    const partition = session.fromPartition(BROWSER_PARTITION);
    partition.registerPreloadScript({ type: 'frame', filePath: require('path').join(__dirname, 'browser-passkey-preload.js'), id: 'yan-browser-passkeys' });
    partition.on('select-webauthn-account', async (_event, details, callback) => {
      let selected;
      try {
        const contents = details.frame && webContents.fromFrame(details.frame);
        const context = guest({ sender: contents, senderFrame: details.frame });
        const accounts = details.accounts;
        if (!accounts?.length) return;
        const response = await prompt(context, { title: '选择通行密钥', message: `登录 ${context.url.origin}`,
          detail: `选择用于 ${details.relyingPartyId} 的账号`,
          buttons: ['取消', ...accounts.map(account => String(account.name || account.displayName || '未命名账号').slice(0, 200))] });
        selected = accounts[response - 1]?.credentialId;
      } catch { /* Closed/navigated/untrusted frames cancel the request. */ }
      finally { callback(selected); }
    });
  });
  return { notePasswordUsed };
}

module.exports = { registerBrowserPasskeys };

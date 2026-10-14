'use strict';
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const { writeAtomic } = require('../yan-core/store');
function registerBrowserPasswords({ app, ipcMain, safeStorage, session, dialog, webContents }, { getMainWindow, configStore, BROWSER_PARTITION }) {
  const file = path.join(app.getPath('userData'), 'browser-passwords.json');
  let vaultRevision = 0;
  function available() {
    if (!safeStorage.isEncryptionAvailable() || safeStorage.getSelectedStorageBackend?.() === 'basic_text') throw new Error('系统加密存储不可用，无法保存或读取密码');
  }
  function read() {
    if (!fs.existsSync(file)) return [];
    available();
    const stored = JSON.parse(fs.readFileSync(file, 'utf8'));
    return JSON.parse(safeStorage.decryptString(Buffer.from(stored.encrypted, 'base64')));
  }
  function save(items) {
    available();
    writeAtomic(file, { version: 1, encrypted: safeStorage.encryptString(JSON.stringify(items)).toString('base64') });
    vaultRevision++;
  }
  function bind(name, callback) {
    ipcMain.handle(`browser:password-${name}`, (event, value) => {
      const main = getMainWindow();
      if (!main || main.isDestroyed() || event.sender !== main.webContents || event.senderFrame !== main.webContents.mainFrame) throw new Error('无权访问密码管理器');
      return callback(value);
    });
  }
  bind('list', () => read().map(({ password, ...metadata }) => metadata));
  bind('get', id => {
    const item = read().find(item => item.id === id);
    if (!item) throw new Error('密码记录不存在');
    return item;
  });
  bind('save', value => {
    const url = new URL(String(value?.url || '').trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw new Error('请输入有效的 HTTP 或 HTTPS 网址');
    const username = String(value.username || '').trim(), password = String(value.password || '');
    if (!password || password.length > 10000 || username.length > 1000 || url.href.length > 4000) throw new Error('请填写密码，并检查字段长度');
    const items = read(), index = items.findIndex(item => item.id === value.id);
    if (value.id && index < 0) throw new Error('密码记录不存在');
    const entry = { id: value.id || randomUUID(), url: url.href, username, password, updatedAt: Date.now() };
    if (index >= 0) items[index] = entry; else items.unshift(entry);
    save(items); return { ok: true };
  });
  bind('remove', id => { save(read().filter(item => item.id !== id)); return { ok: true }; });
  bind('clear', () => { if (fs.existsSync(file)) fs.unlinkSync(file); vaultRevision++; return { ok: true }; });
  const preferences = () => ({ offerSave: configStore.loadConfig().browserPasswords?.offerSave !== false, autoLogin: configStore.loadConfig().browserPasswords?.autoLogin !== false });
  const guestState = new WeakMap();
  function guest(event) {
    const contents = event.sender, main = getMainWindow();
    if (!main || main.isDestroyed() || contents.isDestroyed() || contents.getType() !== 'webview' || contents.hostWebContents !== main.webContents || contents.session !== session.fromPartition(BROWSER_PARTITION) || event.senderFrame !== contents.mainFrame) throw new Error('无权访问密码');
    const url = new URL(event.senderFrame.url);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) throw new Error('密码填充仅支持 HTTPS 或本地开发页面');
    let state = guestState.get(contents);
    if (!state) {
      state = { url: '', filled: false, prompted: false, busy: false, revision: 0 };
      guestState.set(contents, state);
      contents.on('did-start-navigation', (_event, _url, inPlace, isMainFrame) => { if (isMainFrame && !inPlace) { state.revision++; state.url = ''; state.filled = false; state.prompted = false; } });
    }
    if (state.url !== url.href) { state.url = url.href; state.filled = false; state.prompted = false; }
    return { contents, state, url, frame: event.senderFrame, revision: state.revision };
  }
  const stillHere = context => !context.contents.isDestroyed() && context.state.revision === context.revision && context.contents.mainFrame === context.frame && context.frame.url === context.url.href;
  const passkeys = require('./browser-passkeys').registerBrowserPasskeys({ app, ipcMain, session, dialog, webContents },
    { getMainWindow, configStore, BROWSER_PARTITION, guest, stillHere, readPasswords: read });
  ipcMain.handle('browser:credential-fill', async event => {
    const context = guest(event), { state, url } = context;
    if (state.filled || state.busy) return null;
    state.busy = true;
    try {
      const items = read().filter(item => new URL(item.url).origin === url.origin);
      if (!items.length) return null;
      let selected = items[0];
      const auto = preferences().autoLogin;
      if (!auto || items.length > 1) {
        const result = await dialog.showMessageBox(getMainWindow(), { type: 'question', title: '使用已保存的密码', message: `向 ${url.origin} 填充登录信息？`, detail: '仅填充当前网站。选择账号后由你确认登录。', buttons: ['取消', ...items.map(item => item.username || '未设置用户名')], defaultId: 0, cancelId: 0, noLink: true });
        selected = items[result.response - 1];
      }
      if (!stillHere(context)) return null;
      state.filled = true;
      if (!selected) return null;
      const current = read().find(item => item.id === selected.id && new URL(item.url).origin === url.origin);
      if (!current) return null;
      return { username: current.username, password: current.password, autoLogin: auto && preferences().autoLogin && items.length === 1, origin: url.origin };
    } finally { state.busy = false; }
  });
  ipcMain.handle('browser:credential-save', async (event, value) => {
    const context = guest(event), { state, url } = context;
    passkeys.notePasswordUsed(event, value);
    if (!preferences().offerSave || state.prompted || state.busy) return;
    const username = String(value?.username || '').trim(), password = String(value?.password || '');
    if (!password || password.length > 10000 || username.length > 1000) return;
    const existing = read().find(item => new URL(item.url).origin === url.origin && item.username === username);
    if (existing?.password === password) return;
    state.prompted = true; state.busy = true;
    const revision = vaultRevision;
    try {
      const result = await dialog.showMessageBox(getMainWindow(), { type: 'question', title: existing ? '更新密码？' : '保存密码？', message: `${existing ? '更新' : '保存'} ${url.origin} 的密码？`, detail: `用户名：${username || '未设置用户名'}\n已检测到登录表单提交，尚未确认网站是否接受登录。密码将使用系统加密保存。`, buttons: ['不保存', existing ? '更新密码' : '保存密码'], defaultId: 0, cancelId: 0, noLink: true });
      if (result.response !== 1 || !preferences().offerSave || revision !== vaultRevision) return;
      // A login commonly navigates while this trusted application dialog is open;
      // retain the original origin captured from the authenticated sender frame.
      const items = read(), index = items.findIndex(item => new URL(item.url).origin === url.origin && item.username === username);
      const entry = { id: index >= 0 ? items[index].id : randomUUID(), url: url.origin, username, password, updatedAt: Date.now() };
      if (index >= 0) items[index] = entry; else items.unshift(entry);
      save(items);
    } finally { state.busy = false; }
  });
  app.whenReady().then(() => {
    const partition = session.fromPartition(BROWSER_PARTITION);
    const preload = path.join(__dirname, 'browser-password-preload.js');
    partition.registerPreloadScript({ type: 'frame', filePath: preload, id: 'yan-browser-passwords' });
  });
}
module.exports = { registerBrowserPasswords };

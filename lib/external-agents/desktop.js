'use strict';

const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { environment } = require('./adapters');

const helper = path.join(__dirname, '../native/yan-desktop-bridge.exe').replace(/([\\/])app\.asar([\\/])/, '$1app.asar.unpacked$2');
function ready() { return process.platform === 'win32' && fs.existsSync(helper); }
function link(provider, workspace, prompt) {
  return provider === 'claude'
    ? `claude://code/new?${new URLSearchParams({ q: prompt, folder: workspace })}`
    : `codex://threads/new?${new URLSearchParams({ path: workspace, prompt })}`;
}
function sessionLink(provider, sessionId) {
  if (provider === 'claude' && /^local_[A-Za-z0-9-]{1,64}$/.test(sessionId)) {
    return `claude://code/continue?${new URLSearchParams({ session: sessionId })}`;
  }
  if (provider === 'codex' && /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(sessionId)) {
    return `codex://threads/${encodeURIComponent(sessionId)}`;
  }
  throw new Error('保存的桌面任务编号无效；不会新建会话');
}
function invoke(request, dir) {
  if (!ready()) return Promise.reject(new Error('桌面桥未安装；请运行 npm run build:desktop-bridge 后重启 Yan'));
  const file = path.join(dir, 'gui-command.json');
  fs.writeFileSync(file, JSON.stringify(request), { mode: 0o600 });
  return new Promise((resolve, reject) => execFile(helper, [file], {
    windowsHide: true, timeout: 45000, maxBuffer: 128 * 1024, env: environment()
  }, (error, stdout) => {
    let result;
    try {
      const line = String(stdout).replace(/^\uFEFF/, '').split(/\r?\n/).findLast(line => line.startsWith('YAN_DESKTOP_BRIDGE_RESULT='));
      if (line) result = JSON.parse(line.slice('YAN_DESKTOP_BRIDGE_RESULT='.length));
    } catch {}
    if (result?.ok) resolve(result);
    else {
      const failure = new Error(result?.error || error?.message || '桌面桥没有返回有效结果');
      failure.beforeSend = result?.beforeSend === true;
      reject(failure);
    }
  }));
}
module.exports = { helper, ready, link, sessionLink, invoke };

'use strict';
const { execFile } = require('node:child_process');
// Keep explicit proxy choices. Import Windows' manual proxy for subprocesses
// which do not consult WinINET (Git, curl, npm and Node's HTTP clients).
function shellEnvironment(inherited = process.env, readProxy = windowsProxy) {
  const env = { ...inherited };
  if (!env.HTTPS_PROXY && !env.https_proxy && !env.HTTP_PROXY && !env.http_proxy && !env.ALL_PROXY && !env.all_proxy) {
    const proxy = readProxy();
    if (proxy) { env.HTTPS_PROXY = proxy; env.HTTP_PROXY = proxy; env.https_proxy = proxy; env.http_proxy = proxy; }
  }
  if (env.HTTPS_PROXY || env.https_proxy || env.HTTP_PROXY || env.http_proxy) {
    env.NO_PROXY = [...new Set((env.NO_PROXY || env.no_proxy || '').split(',').concat(['localhost', '127.0.0.1', '::1']))].filter(Boolean).join(',');
    env.no_proxy = env.NO_PROXY;
    env.NODE_USE_ENV_PROXY = '1';
  }
  return env;
}
let cached = '', checked = 0, pending;
function windowsProxy() { return cached; }
function refreshProxy() {
  if (process.platform !== 'win32' || Date.now() - checked < 60000) return Promise.resolve();
  if (pending) return pending;
  pending = new Promise(resolve => execFile('reg.exe', ['query', 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings'],
    { encoding: 'utf8', windowsHide: true, timeout: 2000 }, (error, text = '') => {
      cached = ''; checked = Date.now();
      if (!error && /ProxyEnable\s+REG_DWORD\s+0x1\b/i.test(text)) {
        const value = /ProxyServer\s+REG_SZ\s+([^\r\n]+)/i.exec(text)?.[1]?.trim();
        const selected = value?.includes('=') ? /(?:^|;)https=([^;]+)/i.exec(value)?.[1] || /(?:^|;)http=([^;]+)/i.exec(value)?.[1] : value;
        if (selected) cached = /^https?:\/\//i.test(selected) ? selected : `http://${selected}`;
      }
      resolve();
    })).finally(() => { pending = null; });
  return pending;
}
module.exports = { shellEnvironment, refreshProxy };

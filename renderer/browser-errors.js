'use strict';
// Browser load-error copy. The headline is always a plain-language explanation
// (never only the raw Chromium error); the exact code/description stays in the
// details row. Codes are Chromium net errors surfaced by <webview> did-fail-load.
(function () {
  const NET_ERROR_MESSAGES = {
    '-7': { title: '连接超时', hint: '等待服务器响应超时，请重试。' },
    '-21': { title: '网络已切换', hint: '网络环境发生变化，请重试。' },
    '-101': { title: '连接被重置', hint: '连接被对方中断，请稍后重试。' },
    '-102': { title: '连接被拒绝', hint: '目标服务没有启动，或该端口没有在监听。' },
    '-104': { title: '无法建立连接', hint: '网络请求失败，请检查目标地址与网络后重试。' },
    '-105': { title: '找不到该域名', hint: '域名无法解析：可能是网址拼写错误、DNS 异常，或当前环境无法访问外网。' },
    '-106': { title: '本机没有网络连接', hint: '当前设备未联网；若只在局域网内，请访问内网地址。' },
    '-109': { title: '目标地址不可达', hint: '目标不在当前可达的网络中（可能不在同一局域网）。' },
    '-118': { title: '连接超时', hint: '等待服务器响应超时，请确认服务是否正常后重试。' },
    '-130': { title: '代理连接失败', hint: '系统代理或 VPN 不可用，请检查代理设置。' },
    '-131': { title: '代理隧道建立失败', hint: '请检查代理设置后重试。' },
    '-137': { title: '域名解析失败', hint: 'DNS 解析失败，请检查网络，或改用 IP 地址访问。' },
    '-300': { title: '网址格式无效', hint: '请输入正确的网址，例如 https://example.com。' },
    '-310': { title: '重定向次数过多', hint: '页面跳转进入了循环，常见于登录状态异常。' },
    '-324': { title: '服务器没有返回内容', hint: '服务器响应为空，请稍后重试。' },
    '-328': { title: '该端口被安全策略拦截', hint: '浏览器默认禁止访问此端口，请更换端口。' },
    '-350': { title: '不是有效的网页响应', hint: '该地址可能不是网页服务（端口被其它程序占用），请确认地址。' },
    '-501': { title: '响应不安全', hint: '响应未通过安全检查。' }
  };

  function describe(code, extra = {}) {
    if (extra && extra.crash) {
      return { kind: 'crash', title: '页面已崩溃', hint: '页面渲染进程意外退出，请重新加载。' };
    }
    const value = Number(code);
    if (Number.isFinite(value) && value <= -200 && value >= -299) {
      return { kind: 'cert', title: '证书不受信任', hint: '该站点的 HTTPS 证书无效或已过期，无法安全打开。' };
    }
    const known = NET_ERROR_MESSAGES[String(value)];
    if (known) return { kind: 'net', ...known };
    return { kind: 'net', title: '无法打开该页面', hint: '加载失败，请重试或检查地址是否正确。' };
  }

  window.YanBrowserErrors = {
    describe,
    isAborted: code => Number(code) === -3
  };
})();

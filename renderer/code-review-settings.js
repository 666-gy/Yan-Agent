window.YanCodeReviewSettings = (() => {
  const button = settingsOverlay.querySelector('#reviewGithubRefresh');
  const status = settingsOverlay.querySelector('#reviewGithubStatus');
  const notice = settingsOverlay.querySelector('#reviewGithubNotice');
  const icon = settingsOverlay.querySelector('#worktreeRefresh svg')?.outerHTML || '';
  button.innerHTML = icon + '<span>刷新</span>';
  let pending = null;
  function refresh() {
    if (pending) return pending;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    status.textContent = '正在检查连接…';
    notice.textContent = '';
    pending = (async () => {
      try {
        const result = await api.ghConnectionStatus();
        if (result?.ok === false) throw new Error(result.error || '检查失败');
        const accounts = (result.accounts || []).filter(account => account.active && account.connected);
        status.textContent = !result.installed ? '未安装 GitHub CLI' : result.connected
          ? '已连接 · ' + accounts.map(account => `${account.login}（${account.host}）`).join('、') : '未连接 GitHub';
        notice.textContent = !result.installed ? '请安装 GitHub CLI，然后运行 gh auth login 登录，再点击刷新。'
          : result.checkFailed ? result.error
          : result.connected ? '使用本机 GitHub CLI 登录。仓库访问权限取决于当前账号；切换账号或权限后请刷新。'
          : '请在终端运行 gh auth login 登录，然后点击刷新。';
      } catch {
        status.textContent = '连接检查失败';
        notice.textContent = '暂时无法检查 GitHub 连接，请检查网络和本机 gh auth status 后重试。';
      } finally {
        button.disabled = false;
        button.setAttribute('aria-busy', 'false');
        pending = null;
      }
    })();
    return pending;
  }
  button.addEventListener('click', refresh);
  return { refresh };
})();

(() => {
  'use strict';
  let active;
  window.YanUpdateDialog = {
    reopen() {
      if (!active?.isConnected) return false;
      if (!active.open) active.showModal();
      return true;
    },
    show(info, { download, install, onError } = {}) {
      if (active) { if (!active.open) active.showModal(); return; }
      const dialog = document.createElement('dialog');
      dialog.id = 'yan-update-dialog';
      dialog.setAttribute('aria-labelledby', 'yan-update-title');
      dialog.setAttribute('aria-describedby', 'yan-update-message');
      dialog.innerHTML = `<header class="titlebar"><h2 id="yan-update-title">发现新版本</h2><button class="close" aria-label="关闭" autofocus>×</button></header>
        <div class="body"><div class="fluid"><div class="fluid-brand"><img src="assets/logo.png" alt="Yan Agent Logo"><span></span></div></div>
        <p id="yan-update-message">我们迎来了新版本，它更加优秀和强大，并且我们希望你安装它。</p></div>
        <footer class="footer"><div class="progress" hidden><div class="progress-label"><span class="stage">正在下载</span><span class="percent">0%</span></div>
        <div class="progress-track" role="progressbar" aria-label="更新进度" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><div class="progress-fill"></div></div></div>
        <button class="install">现在安装并更新</button></footer>`;
      const upToDate = info.hasUpdate === false;
      dialog.querySelector('.fluid-brand span').textContent = 'Yan Agent v' + String(upToDate ? info.currentVersion : info.latestVersion)
        .replace(/-beta\.(\d+)-rc\.(\d+)/i, ' Beta$1-RC$2');
      if (upToDate) {
        dialog.querySelector('#yan-update-title').textContent = '已是最新版本';
        dialog.querySelector('#yan-update-message').textContent = '你正在使用我们的最新版本。';
        dialog.querySelector('.install').textContent = '这太酷啦！';
      }
      document.body.append(dialog); active = dialog;
      const button = dialog.querySelector('.install'), progress = dialog.querySelector('.progress');
      let state = 'idle';
      dialog.querySelector('.close').onclick = () => dialog.close();
      dialog.addEventListener('close', () => { if (state === 'idle') { dialog.remove(); active = null; } });
      button.onclick = async () => {
        if (upToDate) { dialog.close(); return; }
        if (state === 'busy') return;
        if (state === 'ready') {
          button.disabled = true;
          try { await install(); } catch (error) { button.disabled = false; onError(error); }
          return;
        }
        state = 'busy'; button.disabled = true; button.textContent = '正在下载更新'; progress.hidden = false;
        try {
          await download(data => {
            const value = Math.max(0, Math.min(100, Number(data.percent) || 0));
            dialog.querySelector('.stage').textContent = data.stage === 'fallback' ? '改用完整下载' : data.reusedBytes ? '差分下载' : '正在下载';
            dialog.querySelector('.percent').textContent = `${value}%`;
            dialog.querySelector('.progress-fill').style.width = `${value}%`;
            dialog.querySelector('.progress-track').setAttribute('aria-valuenow', value);
          });
          state = 'ready'; progress.hidden = true; button.disabled = false;
          button.textContent = '下载完成，安装并重启';
        } catch (error) {
          state = 'idle'; progress.hidden = true; button.disabled = false; button.textContent = '重试下载';
          onError(error);
          if (!dialog.open) { dialog.remove(); active = null; }
        }
      };
      dialog.showModal();
    }
  };
})();

(() => {
  'use strict';
  const panel = document.getElementById('tab-storage');
  if (!panel) return;
  const categories = [
    ['chats', '聊天', '#f4bf00'], ['subagents', '子智能体', '#a985ee'],
    ['archivedChats', '已归档聊天', '#e89859'], ['unclassifiedChats', '未分类聊天', '#e76d76'],
    ['worktrees', '工作树', '#62b687'], ['other', '其他', '#72727a']
  ];
  const formatBytes = bytes => {
    if (!bytes) return '0 B';
    const unit = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), 4);
    return `${new Intl.NumberFormat('zh-CN', { maximumFractionDigits: unit ? 1 : 0 }).format(bytes / 1024 ** unit)} ${['B', 'KB', 'MB', 'GB', 'TB'][unit]}`;
  };
  panel.innerHTML = `
    <div class="storage-device-heading"><h2>此设备</h2><p>管理存储在此电脑上的聊天和工作树。</p></div>
    <div class="storage-summary"><strong id="storageTotal">正在检测存储空间…</strong><button id="storageRefresh" class="storage-button" type="button">刷新</button></div>
    <div id="storageBar" class="storage-bar" role="img" aria-label="正在检测存储空间"></div>
    <div class="storage-legend">${categories.map(([key, label, color]) => `<div><span class="storage-category"><i style="background:${color}" aria-hidden="true"></i>${label}</span><span id="storageSize-${key}" class="storage-size">—</span></div>`).join('')}</div>
    <div class="storage-location" title="按文件大小统计，包含已登记的工作树。内核数据库及缓存计入其他。"><span id="storagePath"></span></div>
    <div class="storage-actions">
      <div class="storage-card"><div class="storage-action-row"><div><h3>清理旧聊天</h3><p>永久删除前，检查聊天及其子智能体。</p></div><button id="storageCleanup" class="storage-button" type="button">查看</button></div></div>
      <div class="storage-card">
        <div class="storage-action-row"><div><h3>管理工作树</h3><p>检查工作副本，并设置保留的旧工作树数量。</p></div><button id="storageWorktrees" class="storage-button" type="button">管理</button></div>
        <div class="storage-action-row"><div><h3>已归档的聊天</h3><p>恢复或删除单个已归档的聊天。</p></div><button id="storageArchives" class="storage-button" type="button">管理</button></div>
      </div>
    </div>`;
  const refreshButton = panel.querySelector('#storageRefresh');
  let pending, lastResult;
  async function refresh({ announce = false } = {}) {
    if (pending) return pending;
    refreshButton.disabled = true;
    refreshButton.textContent = '刷新中…';
    panel.setAttribute('aria-busy', 'true');
    pending = (async () => {
      try {
        const result = await api.storageStats();
        if (!result?.ok) throw new Error(result?.error || '无法读取存储数据');
        lastResult = result;
        panel.dataset.totalBytes = String(result.totalBytes);
        const total = `Yan Agent 已使用 ${formatBytes(result.totalBytes)}`;
        panel.querySelector('#storageTotal').textContent = total;
        const bar = panel.querySelector('#storageBar');
        bar.replaceChildren();
        bar.setAttribute('aria-label', `${total}；${categories.map(([key, label]) => `${label} ${formatBytes(result.categories[key])}`).join('，')}`);
        for (const [key, label, color] of categories) {
          const bytes = result.categories[key];
          const size = panel.querySelector(`#storageSize-${key}`);
          size.textContent = formatBytes(bytes);
          size.title = `${bytes.toLocaleString('zh-CN')} 字节`;
          if (bytes > 0 && result.totalBytes > 0) {
            const segment = document.createElement('span');
            segment.style.width = `${bytes / result.totalBytes * 100}%`;
            segment.style.background = color;
            segment.title = `${label}：${formatBytes(bytes)}`;
            bar.append(segment);
          }
        }
        panel.querySelector('#storagePath').textContent = result.dataDir;
        panel.querySelector('#storagePath').title = [result.dataDir, ...result.worktreeRoots].join('\n');
        if (result.partial) toast(`部分文件未能读取或分类（${result.warningCount} 项），统计可能不完整。可刷新重试。`, { error: true });
        else if (announce) toast('存储空间已刷新');
      } catch (error) {
        if (!lastResult) panel.querySelector('#storageTotal').textContent = '暂时无法统计存储空间';
        toast(`${error.message}。${lastResult ? '保留上次统计结果，' : ''}请点击刷新重试。`, { error: true });
      } finally {
        panel.setAttribute('aria-busy', 'false');
        refreshButton.disabled = false;
        refreshButton.textContent = '刷新';
      }
    })();
    try { await pending; } finally { pending = null; }
  }
  refreshButton.addEventListener('click', () => void refresh({ announce: true }));
  panel.querySelector('#storageCleanup').addEventListener('click', () => window.YanStorageCleanup?.open());
  panel.querySelector('#storageWorktrees').addEventListener('click', () => switchTab('worktrees'));
  panel.querySelector('#storageArchives').addEventListener('click', () => switchTab('archived'));
  window.YanStorageSettings = { refresh };
})();

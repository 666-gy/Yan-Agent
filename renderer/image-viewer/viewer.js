const bridge = window.yanImageViewer;
const params = new URLSearchParams(window.location.search);
const assetId = params.get('assetId') || '';
const image = document.getElementById('generatedImage');
const viewerStatus = document.getElementById('viewerStatus');
const imageMeta = document.getElementById('imageMeta');
const downloadBtn = document.getElementById('downloadBtn');
const downloadStatus = document.getElementById('downloadStatus');

function formatFileSize(bytes) {
  const size = Number(bytes) || 0;
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${Math.round(size / 1024)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

async function loadImage() {
  if (!bridge || !assetId) {
    viewerStatus.textContent = '无法读取会话图片';
    return;
  }
  const result = await bridge.read(assetId);
  if (result?.error || !result?.dataUrl) {
    viewerStatus.textContent = result?.error || '会话图片已失效';
    return;
  }
  document.title = `${result.name || '生成图片'} - 图片预览`;
  imageMeta.textContent = `${result.name || '生成图片'} · ${formatFileSize(result.size)}`;
  image.src = result.dataUrl;
  image.hidden = false;
  viewerStatus.hidden = true;
  downloadBtn.disabled = false;
}

downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  downloadStatus.classList.remove('is-error');
  downloadStatus.textContent = '正在选择保存位置…';
  try {
    const result = await bridge.download(assetId);
    if (result?.error) {
      downloadStatus.classList.add('is-error');
      downloadStatus.textContent = result.error;
    } else if (result?.ok) {
      downloadStatus.textContent = `已下载到 ${result.path}`;
    } else {
      downloadStatus.textContent = '';
    }
  } catch (error) {
    downloadStatus.classList.add('is-error');
    downloadStatus.textContent = `下载失败：${error.message}`;
  } finally {
    downloadBtn.disabled = false;
  }
});

loadImage().catch(error => {
  viewerStatus.textContent = `图片加载失败：${error.message}`;
});

const bridge = window.yanImageViewer;
const params = new URLSearchParams(window.location.search);
const assetId = params.get('assetId') || '';
const image = document.getElementById('generatedImage');
const stage = document.querySelector('.image-stage');
const imageCanvas = document.getElementById('imageCanvas');
const viewerStatus = document.getElementById('viewerStatus');
const downloadBtn = document.getElementById('downloadBtn');
const downloadStatus = document.getElementById('downloadStatus');
const VIEW_PADDING = 48;
const MIN_SCALE = 0.05;
const MAX_SCALE = 8;

let naturalWidth = 0;
let naturalHeight = 0;
let scale = 1;
let fitScale = 1;
let userAdjustedZoom = false;
let downloadStatusTimer = null;

document.title = '图片预览';

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function calculateFitScale() {
  if (!naturalWidth || !naturalHeight) return 1;
  const availableWidth = Math.max(1, stage.clientWidth - VIEW_PADDING);
  const availableHeight = Math.max(1, stage.clientHeight - VIEW_PADDING);
  return clamp(Math.min(1, availableWidth / naturalWidth, availableHeight / naturalHeight), MIN_SCALE, MAX_SCALE);
}

function updateCanvasSize() {
  const width = Math.max(1, Math.round(naturalWidth * scale));
  const height = Math.max(1, Math.round(naturalHeight * scale));
  image.style.width = `${width}px`;
  image.style.height = `${height}px`;
  imageCanvas.style.width = `${Math.max(stage.clientWidth, width + VIEW_PADDING)}px`;
  imageCanvas.style.height = `${Math.max(stage.clientHeight, height + VIEW_PADDING)}px`;
}

function setScale(nextScale, clientX = stage.clientWidth / 2, clientY = stage.clientHeight / 2) {
  if (!naturalWidth || !naturalHeight) return;
  const oldRect = image.getBoundingClientRect();
  const focalX = oldRect.width ? clamp((clientX - oldRect.left) / oldRect.width, 0, 1) : 0.5;
  const focalY = oldRect.height ? clamp((clientY - oldRect.top) / oldRect.height, 0, 1) : 0.5;
  scale = clamp(nextScale, MIN_SCALE, MAX_SCALE);
  updateCanvasSize();

  const newRect = image.getBoundingClientRect();
  stage.scrollLeft += newRect.left + focalX * newRect.width - clientX;
  stage.scrollTop += newRect.top + focalY * newRect.height - clientY;
}

function fitImage() {
  fitScale = calculateFitScale();
  scale = fitScale;
  updateCanvasSize();
  stage.scrollLeft = Math.max(0, (imageCanvas.scrollWidth - stage.clientWidth) / 2);
  stage.scrollTop = Math.max(0, (imageCanvas.scrollHeight - stage.clientHeight) / 2);
}

function showDownloadStatus(message, isError = false) {
  if (downloadStatusTimer) clearTimeout(downloadStatusTimer);
  downloadStatus.textContent = message || '';
  downloadStatus.classList.toggle('is-error', isError);
  downloadStatus.classList.toggle('is-visible', !!message);
  if (message) {
    downloadStatusTimer = setTimeout(() => {
      downloadStatus.classList.remove('is-visible');
      downloadStatusTimer = null;
    }, 4200);
  }
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
  await new Promise((resolve, reject) => {
    image.addEventListener('load', resolve, { once: true });
    image.addEventListener('error', () => reject(new Error('图片数据无法解码')), { once: true });
    image.src = result.dataUrl;
  });
  naturalWidth = image.naturalWidth;
  naturalHeight = image.naturalHeight;
  image.hidden = false;
  viewerStatus.hidden = true;
  fitImage();
  downloadBtn.disabled = false;
}

stage.addEventListener('wheel', event => {
  if (!naturalWidth || !naturalHeight || !event.deltaY) return;
  event.preventDefault();
  const unit = event.deltaMode === WheelEvent.DOM_DELTA_LINE
    ? 16
    : event.deltaMode === WheelEvent.DOM_DELTA_PAGE
      ? stage.clientHeight
      : 1;
  const delta = clamp(event.deltaY * unit, -240, 240);
  const factor = Math.exp(-delta * 0.0022);
  userAdjustedZoom = true;
  setScale(scale * factor, event.clientX, event.clientY);
}, { passive: false });

window.addEventListener('resize', () => {
  if (!naturalWidth || !naturalHeight) return;
  if (!userAdjustedZoom) {
    fitImage();
    return;
  }
  updateCanvasSize();
});

downloadBtn.addEventListener('click', async () => {
  downloadBtn.disabled = true;
  downloadBtn.setAttribute('aria-busy', 'true');
  showDownloadStatus('正在选择保存位置…');
  try {
    const result = await bridge.download(assetId);
    if (result?.error) {
      showDownloadStatus(result.error, true);
    } else if (result?.ok) {
      showDownloadStatus(`已下载到 ${result.path}`);
    } else {
      showDownloadStatus('');
    }
  } catch (error) {
    showDownloadStatus(`下载失败：${error.message}`, true);
  } finally {
    downloadBtn.disabled = false;
    downloadBtn.removeAttribute('aria-busy');
  }
});

loadImage().catch(error => {
  viewerStatus.textContent = `图片加载失败：${error.message}`;
});

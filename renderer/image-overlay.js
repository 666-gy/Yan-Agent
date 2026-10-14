(() => {
  'use strict';
  const bridge = window.yan;
  const dialog = document.createElement('dialog');
  dialog.className = 'image-overlay';
  dialog.setAttribute('aria-label', '图片预览');
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  dialog.innerHTML = `
    <div class="image-overlay-actions">
      <button type="button" data-action="text" aria-pressed="false" hidden>查看文本</button>
      <button type="button" data-action="edit" aria-label="编辑图片" title="编辑图片" disabled>${icon('<path d="m15 5 4 4M4 20l4-1L20 7a2.8 2.8 0 0 0-4-4L4 15Z"/>')}</button>
      <button type="button" data-action="download" aria-label="下载图片" title="下载图片" disabled>${icon('<path d="M12 3v12m-4-4 4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>')}</button>
      <button type="button" data-action="close" aria-label="关闭图片预览" title="关闭（Esc）" autofocus>${icon('<path d="m6 6 12 12M18 6 6 18"/>')}</button>
    </div>
    <div class="image-overlay-stage" tabindex="0" aria-label="图片滚动区域"><div class="image-overlay-canvas"><img class="image-overlay-image" alt="图片预览" draggable="false" hidden></div></div>
    <section class="image-overlay-text" hidden><header>纯文本</header><pre tabindex="0"></pre></section>
    <div class="image-overlay-status" role="status"></div>
    <div class="image-overlay-zoom" aria-label="图片缩放">
      <button type="button" data-action="out" aria-label="缩小" title="缩小" disabled>${icon('<path d="M5 12h14"/>')}</button>
      <output aria-live="polite">100%</output>
      <button type="button" data-action="in" aria-label="放大" title="放大" disabled>${icon('<path d="M5 12h14M12 5v14"/>')}</button>
    </div>`;
  document.body.append(dialog);
  const stage = dialog.querySelector('.image-overlay-stage');
  const canvas = dialog.querySelector('.image-overlay-canvas');
  const image = dialog.querySelector('img');
  const status = dialog.querySelector('.image-overlay-status');
  const output = dialog.querySelector('output');
  const button = action => dialog.querySelector(`[data-action="${action}"]`);
  const textPanel = dialog.querySelector('.image-overlay-text');
  function showText(show) {
    textPanel.hidden = !show;
    stage.hidden = show;
    dialog.querySelector('.image-overlay-zoom').hidden = show;
    button('text').textContent = show ? '查看图片' : '查看文本';
    button('text').setAttribute('aria-pressed', String(show));
    if (show) textPanel.querySelector('pre').focus({ preventScroll: true });
  }
  button('text').onclick = () => showText(textPanel.hidden);
  let source, scale = 1, adjusted = false, generation = 0, loaded = false;
  let previousFocus;
  const minScale = () => Math.min(.05, fitScale());
  const fitScale = () => Math.min(1, Math.max(1, stage.clientWidth - 64) / image.naturalWidth, Math.max(1, stage.clientHeight - 16) / image.naturalHeight);
  function layout() {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    canvas.style.width = `${Math.max(stage.clientWidth, width + 64)}px`;
    canvas.style.height = `${Math.max(stage.clientHeight, height + 16)}px`;
    output.value = `${Math.round(scale * 100)}%`;
    button('out').disabled = scale <= minScale();
    button('in').disabled = scale >= 8;
  }
  function zoom(next) {
    if (!loaded) return;
    const rect = image.getBoundingClientRect();
    const bounds = stage.getBoundingClientRect();
    const x = bounds.left + stage.clientWidth / 2;
    const y = bounds.top + stage.clientHeight / 2;
    const fx = (x - rect.left) / rect.width;
    const fy = (y - rect.top) / rect.height;
    scale = Math.max(minScale(), Math.min(8, next));
    adjusted = true;
    layout();
    const after = image.getBoundingClientRect();
    stage.scrollLeft += after.left + fx * after.width - x;
    stage.scrollTop += after.top + fy * after.height - y;
  }
  function close() {
    ++generation;
    loaded = false;
    dialog.close();
    image.removeAttribute('src');
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  button('close').onclick = close;
  button('edit').onclick = () => {
    if (!loaded) return;
    const next = { ...source };
    close();
    window.YanImageEditor.open(next);
  };
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  // Keep background chat shortcuts and scrolling out of the modal.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
    stage.scrollTop += event.deltaY * unit;
    stage.scrollLeft += event.deltaX * unit;
  }, { passive: false });
  button('out').onclick = () => zoom(scale / 1.25);
  button('in').onclick = () => zoom(scale * 1.25);
  button('download').onclick = async () => {
    const token = generation;
    button('download').disabled = true;
    try {
      const result = source.filePath ? await bridge.downloadImageFile(source.filePath) : await bridge.downloadGeneratedImage(source.assetId);
      if (token !== generation) return;
      if (result?.error) window.toast?.(result.error, { error: true });
      else if (result?.ok) window.toast?.('图片已保存');
    } catch (error) {
      if (token === generation) window.toast?.(`下载失败：${error.message}`, { error: true });
    } finally {
      if (token === generation) button('download').disabled = false;
    }
  };
  new ResizeObserver(() => {
    if (!loaded || !dialog.open) return;
    if (!adjusted) scale = fitScale();
    layout();
  }).observe(stage);
  async function open(nextSource) {
    const token = ++generation;
    source = nextSource;
    showText(false);
    button('text').hidden = !source.snapshot;
    textPanel.querySelector('pre').textContent = source.snapshot?.text || source.snapshot?.textError || '此快照未包含可读取的窗口文本。';
    loaded = false;
    adjusted = false;
    image.hidden = true;
    image.removeAttribute('src');
    canvas.style.width = canvas.style.height = '';
    output.value = '—';
    status.hidden = false;
    status.textContent = '正在加载图片…';
    ['edit', 'download', 'out', 'in'].forEach(action => { button(action).disabled = true; });
    if (!dialog.open) {
      previousFocus = document.activeElement;
      dialog.showModal();
    }
    try {
      const result = source.filePath ? await bridge.readImageFile(source.filePath) : await bridge.readGeneratedImage(source.assetId);
      if (token !== generation) return;
      if (result?.error || !result?.dataUrl) throw new Error(result?.error || '图片已失效');
      image.src = result.dataUrl;
      await image.decode();
      if (token !== generation) return;
      image.alt = result.name || source.name || '图片预览';
      image.hidden = false;
      status.hidden = true;
      loaded = true;
      scale = fitScale();
      layout();
      stage.scrollLeft = stage.scrollTop = 0;
      button('download').disabled = false;
      button('edit').disabled = false;
    } catch (error) {
      if (token === generation) status.textContent = `无法打开图片：${error.message}`;
    }
  }
  window.yanImageOverlay = { open, close };
})();

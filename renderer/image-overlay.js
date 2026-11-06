(() => {
  'use strict';
  const bridge = window.yan;
  const dialog = document.createElement('dialog');
  dialog.className = 'image-overlay';
  dialog.setAttribute('aria-label', '图片预览');
  const icon = path => `<svg viewBox="0 0 24 24" aria-hidden="true">${path}</svg>`;
  const imageIcon = icon('<path d="M6 3L18 3C19.6569 3 21 4.3431 21 6L21 18C21 19.6569 19.6569 21 18 21L6 21C4.3431 21 3 19.6569 3 18L3 6C3 4.3431 4.3431 3 6 3ZM3 18L7.9393 13.0607C8.5251 12.4749 9.4749 12.4749 10.0607 13.0607L12.0801 15.0801C12.6079 15.6079 13.4436 15.6673 14.0408 15.2194L15.9592 13.7806C16.5564 13.3327 17.3921 13.3921 17.9199 13.9199L21 17"/><path d="M9.5 7.5C9.5 8.3284 8.8284 9 8 9C7.1716 9 6.5 8.3284 6.5 7.5C6.5 6.6716 7.1716 6 8 6C8.8284 6 9.5 6.6716 9.5 7.5Z" fill="currentColor" stroke="none"/>');
  const fullscreenIcon = icon('<path d="M14 3H20.5C20.77614 3 21 3.22386 21 3.5V10M14 10L20.4 3.6M10 21H3.5C3.22386 21 3 20.77614 3 20.5V14M10 14L3.6 20.4"/>');
  const chevronIcon = icon('<path d="m7 10 5 5 5-5"/>').replace('<svg ', '<svg class="image-overlay-chevron" ');
  const downloadIcon = icon('<path d="M12 3v12m-4-4 4 4 4-4M4 15v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/>');
  const closeIcon = icon('<path d="m6 6 12 12M18 6 6 18"/>');
  const annotateIcon = icon('<path d="M3 18 15 4l3 3L6 21H3v-3Zm12-14 2-2 3 3-2 2M10 18c4-7 7-6 4-1s4 4 6-2"/>');
  const commentIcon = icon('<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM12 7v8m-4-4h8"/>');
  const backgroundIcon = window.YanImageEditorIcons?.['refresh-ccw-sparkles'] || '';
  const eraseIcon = icon('<path d="m4 13 9-10 8 8-9 10H9l-5-5v-3Zm5-5 8 8"/>');
  const resizeIcon = window.YanImageEditorIcons?.images || '';
  const windowIcons = {
    minimize: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="5.5" width="9" height="1" fill="currentColor"/></svg>',
    maximize: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="1.5" y="1.5" width="9" height="9" rx="1.2" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    restore: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><rect x="2.5" y="1" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1"/><rect x="1" y="3.5" width="7" height="8" rx="1" fill="none" stroke="currentColor" stroke-width="1"/></svg>',
    close: '<svg width="11" height="11" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 2 L10 10 M10 2 L2 10" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>'
  };
  dialog.innerHTML = `
    <header class="image-overlay-bar">
      <div class="image-overlay-bar-left">
        <span class="image-overlay-title-pill" aria-label="当前预览类型">${imageIcon}<span class="image-overlay-title-text">图像</span></span>
        <button type="button" class="image-overlay-pill image-overlay-text-toggle" data-action="text" aria-pressed="false" hidden>查看文本</button>
        <div class="image-overlay-tools" role="toolbar" aria-label="图片标注工具">
          <button type="button" data-action="annotate" title="标注" disabled>${annotateIcon}标注</button>
          <button type="button" data-action="comment" title="添加评论" disabled>${commentIcon}添加评论</button>
          <button type="button" data-action="background" title="移除背景" disabled>${backgroundIcon}移除背景</button>
          <button type="button" data-action="erase" title="擦除选定区域" disabled>${eraseIcon}擦除</button>
          <button type="button" data-action="resize" title="调整大小" disabled>${resizeIcon}调整大小</button>
        </div>
      </div>
      <div class="image-overlay-bar-right">
        <button type="button" class="image-overlay-pill image-overlay-zoom" data-action="zoom" aria-label="缩放比例" title="缩放比例" aria-haspopup="menu" aria-expanded="false" disabled><span class="image-overlay-zoom-label">100%</span>${chevronIcon}</button>
        <div class="image-overlay-open" role="group" aria-label="用其他应用打开">
          <button type="button" data-action="reveal" title="在资源管理器中打开" aria-label="在资源管理器中打开" disabled><img src="assets/windows-explorer.png" alt=""></button>
          <button type="button" data-action="default" title="用 Windows 图片管理器打开" aria-label="用 Windows 图片管理器打开" disabled><img src="assets/windows-photos.png" alt=""></button>
        </div>
        <button type="button" class="image-overlay-round" data-action="download" aria-label="下载图片" title="下载图片" disabled>${downloadIcon}</button>
        <button type="button" class="image-overlay-pill image-overlay-panel" data-action="panel" aria-label="在侧边面板打开" title="在侧边面板打开" disabled>${fullscreenIcon}<span>在侧边面板打开</span></button>
        <button type="button" class="image-overlay-round image-overlay-close" data-action="close" aria-label="关闭图片预览" title="关闭（Esc）">${closeIcon}</button>
        <div class="image-overlay-window-controls" role="group" aria-label="窗口控制">
          <button type="button" data-window="minimize" title="最小化" aria-label="最小化">${windowIcons.minimize}</button>
          <button type="button" data-window="maximize" title="最大化" aria-label="最大化">${windowIcons.maximize}</button>
          <button type="button" data-window="close" title="关闭" aria-label="关闭">${windowIcons.close}</button>
        </div>
      </div>
    </header>
    <div class="image-overlay-menu" role="menu" hidden></div>
    <div class="image-overlay-stage" tabindex="0" aria-label="图片滚动区域"><div class="image-overlay-canvas"><img class="image-overlay-image" alt="图片预览" draggable="false" hidden></div></div>
    <div class="image-overlay-nav" hidden>
      <button type="button" data-action="prev" aria-label="上一张" title="上一张（←）">${icon('<path d="m15 18-6-6 6-6"/>')}</button>
      <button type="button" data-action="next" aria-label="下一张" title="下一张（→）">${icon('<path d="m9 18 6-6-6-6"/>')}</button>
    </div>
    <section class="image-overlay-text" hidden><header>纯文本</header><pre tabindex="0"></pre></section>
    <div class="image-overlay-status" role="status"></div>`;
  // The preview shares a stacking layer with the composer: it is mounted inside
  // the app layout (not the top layer) so the input can stay above it and keep
  // receiving keystrokes while an image is open.
  const mount = document.querySelector('#app > .layout') || document.body;
  mount.append(dialog);
  const composerWrap = document.querySelector('#composerStage .composer-wrap') || document.querySelector('.composer-wrap');
  const stage = dialog.querySelector('.image-overlay-stage');
  const canvas = dialog.querySelector('.image-overlay-canvas');
  const image = dialog.querySelector('.image-overlay-image');
  const video=document.createElement('video');video.className='image-overlay-video';video.controls=true;video.playsInline=true;video.hidden=true;canvas.append(video);
  const localMediaUrl=filePath=>{const normalized=String(filePath).replaceAll('\\','/');const encoded=normalized.split('/').map((part,index)=>index===0 && /^[a-z]:$/i.test(part)?part:encodeURIComponent(part)).join('/');return `file://${encoded.startsWith('/')?'':'/'}${encoded}`;};
  const status = dialog.querySelector('.image-overlay-status');
  const zoomPill = dialog.querySelector('.image-overlay-zoom');
  const zoomLabel = dialog.querySelector('.image-overlay-zoom-label');
  const tools = dialog.querySelector('.image-overlay-tools');
  const menu = dialog.querySelector('.image-overlay-menu');
  const titleText = dialog.querySelector('.image-overlay-title-text');
  const button = action => dialog.querySelector(`[data-action="${action}"]`);
  const textPanel = dialog.querySelector('.image-overlay-text');
  const nav = dialog.querySelector('.image-overlay-nav');
  const win = bridge?.window;
  const maxWindowButton = dialog.querySelector('[data-window="maximize"]');
  function setMaximizedIcon(isMax) {
    if (maxWindowButton) maxWindowButton.innerHTML = isMax ? windowIcons.restore : windowIcons.maximize;
  }
  dialog.querySelector('[data-window="minimize"]').onclick = () => win?.minimize?.();
  if (maxWindowButton) maxWindowButton.onclick = () => win?.toggleMaximize?.();
  dialog.querySelector('[data-window="close"]').onclick = () => win?.close?.();
  win?.onMaximizeChange?.(setMaximizedIcon);
  const maxState = win?.isMaximized?.();
  if (maxState?.then) maxState.then(setMaximizedIcon).catch(() => {});
  let gallery = [], galleryIndex = 0;
  function updateGalleryNav() {
    const multiple = gallery.length > 1;
    nav.hidden = !multiple || !textPanel.hidden;
    if (!multiple) return;
    button('prev').disabled = galleryIndex <= 0;
    button('next').disabled = galleryIndex >= gallery.length - 1;
  }
  function stepGallery(delta) {
    if (gallery.length < 2) return;
    const next = galleryIndex + delta;
    if (next < 0 || next >= gallery.length) return;
    galleryIndex = next;
    updateGalleryNav();
    void loadSource(gallery[galleryIndex]);
  }
  button('prev').onclick = () => stepGallery(-1);
  button('next').onclick = () => stepGallery(1);
  function showText(show) {
    textPanel.hidden = !show;
    stage.hidden = show;
    zoomPill.hidden = show;
    tools.hidden = show;
    button('text').textContent = show ? '查看图片' : '查看文本';
    button('text').setAttribute('aria-pressed', String(show));
    closeMenu();
    updateGalleryNav();
    if (show) textPanel.querySelector('pre').focus({ preventScroll: true });
  }
  button('text').onclick = () => showText(textPanel.hidden);
  let source, scale = 1, adjusted = false, generation = 0, loaded = false;
  let previousFocus;
  let composerParking = null;
  const minScale = () => Math.min(.05, fitScale());
  const fitScale = () => Math.min(1, Math.max(1, stage.clientWidth - 64) / image.naturalWidth, Math.max(1, stage.clientHeight - 16) / image.naturalHeight);
  function layout() {
    const width = Math.max(1, Math.round(image.naturalWidth * scale));
    const height = Math.max(1, Math.round(image.naturalHeight * scale));
    image.style.width = `${width}px`;
    image.style.height = `${height}px`;
    canvas.style.width = `${Math.max(stage.clientWidth, width + 64)}px`;
    canvas.style.height = `${Math.max(stage.clientHeight, height + 16)}px`;
    zoomLabel.textContent = `${Math.round(scale * 100)}%`;
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
  // Reserve the composer's real height at the bottom of the preview so the
  // image, zoom bar and gallery controls sit above the input instead of behind
  // it. The value is measured from the live composer block, including
  // attachments and the environment strip.
  function updateComposerInset() {
    if (!dialog.open) return;
    let inset = 0;
    const rect = composerWrap?.getBoundingClientRect();
    const visible = !!rect && rect.height > 0 && rect.width > 0
      && (typeof composerWrap.checkVisibility !== 'function'
        || composerWrap.checkVisibility({ visibilityProperty: true }));
    if (visible) inset = Math.max(0, Math.min(window.innerHeight, Math.round(window.innerHeight - rect.top)));
    dialog.style.setProperty('--preview-composer-inset', `${inset}px`);
    dialog.classList.toggle('has-composer', inset > 0);
  }
  if (composerWrap && typeof ResizeObserver === 'function') {
    new ResizeObserver(updateComposerInset).observe(composerWrap);
  }
  window.addEventListener('resize', updateComposerInset);
  const isTypingTarget = target => {
    const element = target instanceof Element ? target : null;
    return !!element && (element.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(element.tagName));
  };
  function close() {
    ++generation;
    loaded = false;
    video.pause();video.removeAttribute('src');video.load();
    closeMenu();
    const active = document.activeElement;
    const restoreFocus = previousFocus?.isConnected
      && (!active || active === document.body || dialog.contains(active));
    dialog.close();
    if (composerParking) {
      composerParking.replaceWith(document.querySelector('#composerStage'));
      composerParking = null;
    }
    document.body.classList.remove('image-preview-open');
    dialog.style.removeProperty('--preview-composer-inset');
    image.removeAttribute('src');
    gallery = [];
    galleryIndex = 0;
    updateGalleryNav();
    if (restoreFocus) previousFocus.focus({ preventScroll: true });
  }
  function closeMenu() {
    if (menu.hidden) return;
    menu.hidden = true;
    button('zoom').setAttribute('aria-expanded', 'false');
  }
  function openZoomMenu() {
    if (!loaded || source?.video) return;
    if (!menu.hidden) { closeMenu(); return; }
    const check = value => (adjusted && Math.abs(scale - value) < 0.001 ? '✓' : '');
    const items = [[.25, '25%'], [.5, '50%'], [1, '100%'], [1.5, '150%'], [2, '200%']]
      .map(([value, label]) => `<button type="button" role="menuitem" data-zoom="${value}">${label}<span>${check(value)}</span></button>`)
      .join('');
    menu.innerHTML = `${items}<hr><button type="button" role="menuitem" data-zoom="fit">缩放至适合窗口<span>${adjusted ? '' : '✓'}</span></button>`;
    menu.hidden = false;
    button('zoom').setAttribute('aria-expanded', 'true');
    const anchor = button('zoom').getBoundingClientRect();
    const bounds = dialog.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(anchor.right - bounds.left - menu.offsetWidth, window.innerWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${anchor.bottom - bounds.top + 8}px`;
    menu.querySelector('button')?.focus();
  }
  button('zoom').onclick = openZoomMenu;
  menu.addEventListener('click', event => {
    const item = event.target.closest('[data-zoom]');
    if (!item) return;
    const value = item.dataset.zoom;
    if (value === 'fit') { adjusted = false; scale = fitScale(); layout(); }
    else zoom(Number(value));
    closeMenu();
    button('zoom').focus();
  });
  document.addEventListener('pointerdown', event => {
    if (menu.hidden) return;
    if (menu.contains(event.target) || button('zoom').contains(event.target)) return;
    closeMenu();
  });
  async function openExternally(useDefault) {
    if (!source?.filePath) return;
    try {
      const result = useDefault ? await bridge.openImageDefault(source.filePath) : await bridge.revealFile(source.filePath);
      if (result?.error) window.toast?.(result.error, { error: true });
    } catch (error) {
      window.toast?.(`无法打开：${error.message}`, { error: true });
    }
  }
  button('reveal').onclick = () => openExternally(false);
  button('default').onclick = () => openExternally(true);
  function openEditor(action) {
    if (!loaded || !source) return;
    const next = { ...source };
    close();
    window.YanImageEditor?.open(next, action ? { action } : undefined);
  }
  button('panel').onclick = () => openEditor();
  ['annotate', 'comment', 'background', 'erase', 'resize'].forEach(action => {
    button(action).onclick = () => openEditor(action);
  });
  button('close').onclick = close;
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  dialog.addEventListener('close', () => {
    document.body.classList.remove('image-preview-open');
    dialog.style.removeProperty('--preview-composer-inset');
  });
  dialog.addEventListener('click', event => { if (event.target === dialog) close(); });
  // Keep background chat shortcuts and scrolling out of the preview itself.
  dialog.addEventListener('keydown', event => event.stopPropagation());
  // Escape closes the preview from anywhere, including while the composer has
  // focus. A non-modal dialog does not receive the native cancel event.
  document.addEventListener('keydown', event => {
    if (!dialog.open) return;
    if (event.isComposing || event.keyCode === 229) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (!menu.hidden) { closeMenu(); button('zoom').focus(); return; }
      close();
      return;
    }
    // Capture arrow keys at the document while the preview is open. A disabled
    // next/previous button can drop focus to the body, so relying only on the
    // dialog's keydown listener made ArrowLeft/ArrowRight stop working at the
    // ends of the gallery. Typing targets keep their caret navigation.
    if (!menu.hidden || !textPanel.hidden) return;
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    if (isTypingTarget(event.target)) return;
    event.preventDefault();
    event.stopPropagation();
    stepGallery(event.key === 'ArrowLeft' ? -1 : 1);
  }, true);
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
    stage.scrollTop += event.deltaY * unit;
    stage.scrollLeft += event.deltaX * unit;
  }, { passive: false });
  button('download').onclick = async () => {
    const token = generation;
    button('download').disabled = true;
    try {
      const result = source.filePath ? await bridge.downloadImageFile(source.filePath,!!source.video) : await bridge.downloadGeneratedImage(source.assetId);
      if (token !== generation) return;
      if (result?.error) window.toast?.(result.error, { error: true });
      else if (result?.ok) window.toast?.(source.video?'视频已保存':'图片已保存');
    } catch (error) {
      if (token === generation) window.toast?.(`下载失败：${error.message}`, { error: true });
    } finally {
      if (token === generation) button('download').disabled = false;
    }
  };
  new ResizeObserver(() => {
    if (!loaded || !dialog.open || source?.video) return;
    if (!adjusted) scale = fitScale();
    layout();
  }).observe(stage);
  function enableSourceActions() {
    button('download').disabled = false;
    if (source?.filePath) {
      button('reveal').disabled = false;
      button('default').disabled = false;
    }
    if (source?.video) return;
    ['annotate', 'comment', 'background', 'erase', 'resize', 'zoom', 'panel'].forEach(action => { button(action).disabled = false; });
  }
  async function loadSource(nextSource) {
    const token = ++generation;
    source = nextSource;
    video.pause();video.removeAttribute('src');video.load();video.hidden=true;
    closeMenu();
    dialog.classList.toggle('is-video',!!source.video);
    dialog.setAttribute('aria-label',source.video?'视频预览':'图片预览');
    titleText.textContent = source.video ? '视频' : '图像';
    button('close').setAttribute('aria-label',source.video?'关闭视频预览':'关闭图片预览');
    button('download').setAttribute('aria-label',source.video?'下载视频':'下载图片');
    button('download').title=source.video?'下载视频':'下载图片';
    showText(false);
    tools.hidden = !!source.video;
    zoomPill.hidden = !!source.video;
    button('panel').hidden = !!source.video;
    button('text').hidden = !source.snapshot;
    textPanel.querySelector('pre').textContent = source.snapshot?.text || source.snapshot?.textError || '此快照未包含可读取的窗口文本。';
    loaded = false;
    adjusted = false;
    image.hidden = true;
    image.removeAttribute('src');
    canvas.style.width = canvas.style.height = '';
    zoomLabel.textContent = '—';
    status.hidden = false;
    status.textContent = '正在加载图片…';
    ['download', 'reveal', 'default', 'panel', 'annotate', 'comment', 'background', 'erase', 'resize', 'zoom'].forEach(action => { button(action).disabled = true; });
    updateGalleryNav();
    if(source.video){
      status.textContent='正在加载视频…';video.hidden=false;
      video.onloadeddata=()=>{if(token!==generation)return;status.hidden=true;enableSourceActions();void video.play().catch(()=>{});};
      video.onerror=()=>{if(token===generation){status.hidden=false;status.textContent='无法播放此视频，文件可能已移动或编码不受支持。';}};
      video.src=localMediaUrl(source.filePath);return;
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
      enableSourceActions();
    } catch (error) {
      if (token === generation) status.textContent = `无法打开图片：${error.message}`;
    }
    updateGalleryNav();
  }

  // The composer can remove an attachment while its preview is open. Drop the
  // matching gallery entry; if the visible image is the one removed, leave the
  // preview entirely instead of showing a stale image.
  function removeSource(filePath) {
    if (!dialog.open) return;
    const normalize = value => String(value || '').replaceAll('\\', '/').toLowerCase();
    const key = normalize(filePath);
    if (!key) return;
    const index = gallery.findIndex(item => normalize(item.filePath) === key);
    if (index < 0) return;
    if (index === galleryIndex) { close(); return; }
    gallery.splice(index, 1);
    if (index < galleryIndex) galleryIndex -= 1;
    updateGalleryNav();
  }

  async function open(nextSource, options = {}) {
    const items = Array.isArray(options?.gallery) ? options.gallery.filter(Boolean) : [];
    gallery = items.length ? items : [nextSource];
    const requested = Number(options?.index);
    galleryIndex = Number.isInteger(requested)
      ? Math.max(0, Math.min(gallery.length - 1, requested))
      : 0;
    if (!dialog.open) {
      previousFocus = document.activeElement;
      document.body.classList.add('image-preview-open');
      const app = document.querySelector('#app');
      if (app?.classList.contains('full-agent-chat')) {
        const composer = document.querySelector('#composerStage');
        if (composer) {
          composerParking = document.createComment('image-preview-composer-home');
          composer.before(composerParking);
          mount.append(composer);
        }
      }
      dialog.show();
      updateComposerInset();
      requestAnimationFrame(updateComposerInset);
    }
    await loadSource(gallery[galleryIndex]);
    updateComposerInset();
  }
  window.yanImageOverlay = { open, close, removeSource, localMediaUrl };
})();

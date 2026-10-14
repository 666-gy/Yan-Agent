(() => {
  'use strict';
  const BACKGROUND_PROMPT = '移除此图像的背景。保持所有前景主体不变且完整，边缘干净平滑。将背景设为透明。';
  const icons = window.YanImageEditorIcons;
  const svg = body => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
  const chevron = svg('<path d="m7 10 5 5 5-5"/>');
  const downloadIcon = svg('<path d="M12 3v12m-4-4 4 4 4-4M4 16v3a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-3"/>');
  const panel = document.createElement('section');
  panel.id = 'rs-image-editor';
  panel.className = 'rs-panel image-editor';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-label', '用户附件');
  panel.innerHTML = `
    <div class="image-editor-stage" tabindex="0" aria-label="图片画布"><div class="image-editor-canvas"><div class="image-editor-picture"><img class="image-editor-image" alt="用户附件" draggable="false" hidden><canvas class="image-editor-selection" aria-label="涂抹要移除的区域"></canvas></div></div></div>
    <div class="image-editor-toolbar">
      <div class="image-editor-tools" role="toolbar" aria-label="图片工具">
        <button type="button" data-action="annotate" disabled title="标注">${svg('<path d="M3 18 15 4l3 3L6 21H3v-3Zm12-14 2-2 3 3-2 2M10 18c4-7 7-6 4-1s4 4 6-2"/>')}标注</button>
        <button type="button" data-action="comment" disabled title="添加评论">${svg('<path d="M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM12 7v8m-4-4h8"/>')}添加评论</button>
        <button type="button" data-action="background" disabled>${icons['refresh-ccw-sparkles']}移除背景</button>
        <button type="button" data-action="erase" disabled title="擦除选定区域">${svg('<path d="m4 13 9-10 8 8-9 10H9l-5-5v-3Zm5-5 8 8"/>')}擦除</button>
        <button type="button" data-action="resize" aria-haspopup="menu" aria-expanded="false" disabled>${icons.images}调整大小</button>
      </div>
      <div class="image-editor-erase-tools" role="toolbar" aria-label="擦除工具" hidden>
        <span class="image-editor-erase-hint">在要移除的内容上涂抹</span>
        <button type="button" data-action="undo" aria-label="撤销涂抹" title="撤销">${svg('<path d="m9 5-5 5 5 5M4 10h10a6 6 0 0 1 0 12"/>')}</button>
        <button type="button" data-action="redo" aria-label="重做涂抹" title="重做">${svg('<path d="m15 5 5 5-5 5M20 10H10a6 6 0 0 0 0 12"/>')}</button>
        <button type="button" data-action="erase-send">发送</button>
        <button type="button" data-action="erase-cancel" aria-label="取消擦除" title="取消">${svg('<path d="m7 7 10 10M7 17 17 7"/>')}</button>
      </div>
      <div class="image-editor-actions">
        <div class="image-editor-open" role="group" aria-label="用其他应用打开"><button type="button" data-action="reveal" title="在资源管理器中打开" aria-label="在资源管理器中打开" disabled><img src="assets/windows-explorer.png" alt=""></button><button type="button" data-action="default" title="用 Windows 图片管理器打开" aria-label="用 Windows 图片管理器打开" disabled><img src="assets/windows-photos.png" alt=""></button></div>
        <button type="button" data-action="download" aria-label="下载图片" title="下载图片" disabled>${downloadIcon}</button>
        <button type="button" data-action="zoom" aria-label="缩放比例" aria-haspopup="menu" aria-expanded="false" disabled><span class="image-editor-zoom-label">100%</span>${chevron}</button>
      </div>
    </div>
    <label class="image-editor-brush-control" hidden><input class="image-editor-brush-size" type="range" min="8" max="240" value="100" aria-label="橡皮大小" orient="vertical"></label>
    <div class="image-editor-eraser-cursor" hidden></div>
    <div class="image-editor-menu" role="menu" hidden></div>
    <div class="image-editor-status" role="status" hidden></div>`;
  document.querySelector('#rightSidebar .rs-content').append(panel);
  const stage = panel.querySelector('.image-editor-stage');
  const canvas = panel.querySelector('.image-editor-canvas');
  const image = panel.querySelector('.image-editor-image');
  const menu = panel.querySelector('.image-editor-menu');
  const status = panel.querySelector('.image-editor-status');
  const button = action => panel.querySelector(`[data-action="${action}"]`);
  let current = null, attachment = null, annotatedAttachment = null;
  let version = 0, scale = 1, fit = true, ready = false, working = false, menuAnchor = null;
  const activeActions = ['annotate', 'comment', 'erase', 'background', 'resize', 'reveal', 'default', 'download', 'zoom'];
  const eraser = window.createImageEraseLayer({ panel, image, onChange: updateEraseTools, drawAnnotations: ctx => annotations.drawComposite(ctx) });
  const annotations = window.createImageAnnotationLayer({ panel, image, onComment: () => void perform('comment', addComment), onChange: state => {
    if (annotatedAttachment?.revision !== state.revision) annotatedAttachment = null;
    updateEraseTools(eraser.state());
  } });
  function updateEraseTools(selection) {
    const annotating = annotations.state().enabled;
    panel.querySelector('.image-editor-tools').hidden = selection.enabled || annotating;
    panel.querySelector('.image-editor-erase-tools').hidden = !selection.enabled;
    panel.querySelector('.image-editor-brush-control').hidden = !selection.enabled && !annotating;
    panel.querySelector('.image-editor-erase-hint').hidden = selection.canUndo || selection.canRedo;
    for (const action of ['undo', 'redo']) button(action).hidden = !selection.canUndo && !selection.canRedo;
    button('undo').disabled = working || !selection.canUndo;
    button('redo').disabled = working || !selection.canRedo;
    button('erase-send').disabled = working || !selection.hasSelection;
    button('erase-cancel').disabled = working;
  }
  function availability() {
    activeActions.forEach(action => { button(action).disabled = !ready || working; });
    eraser.lock(working); updateEraseTools(eraser.state());
    annotations.lock(working);
  }
  // Notifications go through the app's shared toast; the inline status is kept
  // only for the canvas loading/error placeholder that has no toast equivalent.
  function message(text, error = false, notice = true) {
    if (notice) {
      if (text) window.toast?.(text, { error });
      status.textContent = '';
      status.hidden = true;
      status.dataset.error = 'false';
      return;
    }
    status.textContent = text;
    status.hidden = !text;
    status.dataset.error = String(error);
  }
  function closeMenu() {
    menu.hidden = true;
    menuAnchor?.setAttribute('aria-expanded', 'false');
    menuAnchor = null;
  }
  function layout() {
    if (!ready || !stage.clientWidth || !stage.clientHeight) return;
    const padding = getComputedStyle(canvas);
    const px = parseFloat(padding.paddingLeft) + parseFloat(padding.paddingRight);
    const py = parseFloat(padding.paddingTop) + parseFloat(padding.paddingBottom);
    if (fit) scale = Math.min(1, Math.max(1, stage.clientWidth - px) / image.naturalWidth, Math.max(1, stage.clientHeight - py) / image.naturalHeight);
    const width = Math.round(image.naturalWidth * scale), height = Math.round(image.naturalHeight * scale);
    image.style.width = `${width}px`; image.style.height = `${height}px`;
    canvas.style.width = `${Math.max(stage.clientWidth, width + px)}px`;
    canvas.style.height = `${Math.max(stage.clientHeight, height + py)}px`;
    panel.querySelector('.image-editor-zoom-label').textContent = `${Math.round(scale * 100)}%`;
  }
  function zoom(value) {
    const before = image.getBoundingClientRect(), bounds = stage.getBoundingClientRect();
    const x = bounds.left + stage.clientWidth / 2, y = bounds.top + stage.clientHeight / 2;
    const fx = (x - before.left) / before.width, fy = (y - before.top) / before.height;
    fit = value === 'fit';
    if (!fit) scale = Number(value);
    layout();
    const after = image.getBoundingClientRect();
    stage.scrollLeft += after.left + fx * after.width - x;
    stage.scrollTop += after.top + fy * after.height - y;
  }
  function showMenu(kind) {
    annotations.closeMenus();
    const anchor = button(kind);
    if (menuAnchor === anchor) { closeMenu(); return; }
    closeMenu();
    const item = (action, label, suffix = '') => `<button type="button" role="menuitem" data-menu-action="${action}">${label}<span>${suffix}</span></button>`;
    if (kind === 'zoom') menu.innerHTML = [.25, .5, 1, 1.5, 2].map(value => item(`zoom:${value}`, `${value * 100}%`, !fit && scale === value ? '✓' : '')).join('') + '<hr>' + item('zoom:fit', '缩放至适合窗口', fit ? '✓' : '');
    if (kind === 'resize') menu.innerHTML = [['正方形', '1:1'], ['竖向', '3:4'], ['故事版式', '9:16'], ['横向', '4:3'], ['宽屏', '16:9']].map(([label, ratio]) => {
      const [w, h] = ratio.split(':').map(Number);
      return item(`resize:${ratio}`, `${svg(`<rect x="${12 - 7 * Math.min(1, w / h)}" y="${12 - 7 * Math.min(1, h / w)}" width="${14 * Math.min(1, w / h)}" height="${14 * Math.min(1, h / w)}" rx="2"/>`)}${label}`, ratio);
    }).join('');
    menu.hidden = false; menuAnchor = anchor; anchor.setAttribute('aria-expanded', 'true');
    const rect = anchor.getBoundingClientRect(), root = panel.getBoundingClientRect();
    menu.style.left = `${Math.max(8, Math.min(rect.left - root.left, panel.clientWidth - menu.offsetWidth - 8))}px`;
    menu.style.top = `${Math.max(8, Math.min(rect.bottom - root.top + 6, panel.clientHeight - menu.offsetHeight - 8))}px`;
    menu.querySelector('button')?.focus();
  }
  async function materialize() {
    if (annotations.state().hasContent) {
      if (annotatedAttachment?.revision === annotations.state().revision) return annotatedAttachment.file;
      const token = version, dataUrl = annotations.exportImage(), revision = annotations.state().revision;
      const result = await api.uploadFile(`${current.originalName.replace(/\.[^.]+$/, '')}-标注.png`, dataUrl.split(',')[1], 'image/png');
      if (result?.error || !result?.path) throw new Error(result?.error || '无法保存标注图片');
      if (token !== version || revision !== annotations.state().revision) throw new Error('图片已切换或标注已更改');
      annotatedAttachment = { revision, file: { ...result, kind: 'image', mimeType: 'image/png' } };
      return annotatedAttachment.file;
    }
    if (attachment) return attachment;
    const token = version;
    const result = await api.uploadFile(current.name || 'image.png', image.src.split(',')[1], current.mimeType || 'image/png');
    if (result?.error || !result?.path) throw new Error(result?.error || '无法保存图片附件');
    if (token !== version) throw new Error('图片已切换');
    attachment = { ...result, kind: 'image' };
    return attachment;
  }
  async function perform(action, fn) {
    if (!ready || working) return;
    const token = version;
    working = true; availability(); closeMenu();
    const target = button(action);
    target?.setAttribute('aria-busy', 'true');
    message('正在处理…');
    try { await fn(token); }
    catch (error) { if (token === version) message(error.message || String(error), true); }
    finally {
      if (token === version) { working = false; availability(); }
      target?.removeAttribute('aria-busy');
    }
  }
  async function save(token) {
    const file = await materialize();
    if (token !== version) return;
    const result = await api.downloadImageFile(file.path);
    if (token !== version) return;
    if (result?.error) throw new Error(result.error);
    message(result?.ok ? '图片已保存' : '');
  }
  async function reveal(token, useDefault = false) {
    const file = await materialize();
    if (token !== version) return;
    const result = useDefault ? await api.openImageDefault(file.path) : await api.revealFile(file.path);
    if (result?.error) throw new Error(result.error);
    if (token === version) message('');
  }
  async function resize(ratio, token) {
    await sendImagePrompt(`将宽高比设为 ${ratio}`, token);
  }
  async function addComment(token) {
    const session = state.currentSession;
    const file = await materialize();
    if (token !== version) return;
    if (!session || session !== state.currentSession) throw new Error('当前任务已切换，请重新添加评论');
    const key = value => String(value || '').replace(/\\/g, '/').toLowerCase();
    const editFile = { ...file, imageEdit: annotations.state().hasContent ? 'annotation' : 'source' };
    const existing = state.attachments.find(item => key(item.path) === key(file.path));
    if (existing) existing.imageEdit = editFile.imageEdit;
    else state.attachments.push(editFile);
    const draft = getComposerText();
    if (!draft.startsWith('修改此图片：')) setComposerText(`修改此图片：${draft ? `\n${draft}` : ''}`);
    renderAttachments(); updateSendState();
    if (browserFocusMode) setBrowserFocusComposerMode('expanded', { focus: true });
    input.focus(); input.dispatchEvent(new Event('input', { bubbles: true }));
    const range = document.createRange(); range.selectNodeContents(input); range.collapse(false);
    const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range);
    message('图片和提示词已放入输入框');
  }
  async function sendImagePrompt(prompt, token, selectionData = null) {
    const session = state.currentSession;
    if (!session) throw new Error('请先打开一个任务');
    const file = await materialize();
    if (token !== version) return;
    const files = [{ ...file, imageEdit: annotations.state().hasContent ? 'annotation' : 'source' }];
    if (selectionData) {
      const marked = await api.uploadFile(`${current.originalName.replace(/\.[^.]+$/, '')}-选定移除区域.png`, selectionData.split(',')[1], 'image/png');
      if (token !== version) return;
      if (marked?.error || !marked?.path) throw new Error(marked?.error || '无法保存选区');
      files.push({ ...marked, kind: 'image', mimeType: 'image/png', imageEdit: 'selection' });
    }
    if (session !== state.currentSession) throw new Error('当前任务已切换，请重新发送');
    const modelSelection = normalizeModelSelectionSnapshot(getAgentModelSelection());
    if (!validateQueuedModelPayload(prompt, files, modelSelection)) throw new Error('当前模型无法接收这张图片，请先检查模型配置');
    if (isCurrentSessionExecutionActive()) {
      if (!queueCurrentComposerTurn({ text: prompt, attachments: files })) throw new Error('当前任务已有待发送消息或正在停止，请稍后重试');
      message('已加入当前任务的待发送消息');
      return true;
    }
    message('已发送到当前任务');
    const result = await submitMessage(prompt, files, [], { modelSelection, session });
    if (token === version && result?.ok === false) throw new Error(result.error === 'busy' ? '任务忙碌，请稍后重试' : (result.error || '发送失败'));
    return result?.ok !== false;
  }
  panel.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target || target.disabled) return;
    const action = target.dataset.action, menuAction = target.dataset.menuAction;
    if (['zoom', 'resize'].includes(action)) return showMenu(action);
    if (action === 'download') return void perform('download', save);
    if (action === 'reveal') return void perform('reveal', token => reveal(token));
    if (action === 'default') return void perform('default', token => reveal(token, true));
    if (action === 'background') return void perform('background', token => sendImagePrompt(BACKGROUND_PROMPT, token));
    if (action === 'comment') return void perform('comment', addComment);
    if (action === 'annotate') { closeMenu(); message(''); eraser.reset(); annotations.enter(); return; }
    if (action === 'erase') { closeMenu(); message(''); annotations.exit(); eraser.enter(); return; }
    if (action === 'erase-cancel') { eraser.reset(); message(''); return; }
    if (action === 'undo') return eraser.undo();
    if (action === 'redo') return eraser.redo();
    if (action === 'erase-send') return void perform('erase-send', async token => {
      const sent = await sendImagePrompt('抹除此图像中的选定区域', token, eraser.exportSelection());
      if (sent && token === version) eraser.reset();
    });
    if (menuAction?.startsWith('zoom:')) { zoom(menuAction.slice(5)); closeMenu(); button('zoom').focus(); }
    if (menuAction?.startsWith('resize:')) void perform('resize', token => resize(menuAction.slice(7), token));
  });
  document.addEventListener('pointerdown', event => { if (!menu.contains(event.target) && !menuAnchor?.contains(event.target)) closeMenu(); });
  panel.addEventListener('keydown', event => {
    if (eraser.state().enabled && menu.hidden && !working) {
      if (event.key === 'Escape') { eraser.reset(); message(''); event.stopPropagation(); return; }
      if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation();
        if (event.shiftKey || event.key.toLowerCase() === 'y') eraser.redo(); else eraser.undo();
        return;
      }
    }
    if (menu.hidden) return;
    if (event.key === 'Escape') { const anchor = menuAnchor; closeMenu(); anchor?.focus(); event.stopPropagation(); }
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const items = [...menu.querySelectorAll('button')], index = items.indexOf(document.activeElement);
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    }
  });
  stage.addEventListener('wheel', event => {
    event.preventDefault();
    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? stage.clientHeight : 1;
    stage.scrollTop += event.deltaY * unit; stage.scrollLeft += event.deltaX * unit;
  }, { passive: false });
  let resizeFrame = 0;
  new ResizeObserver(() => {
    cancelAnimationFrame(resizeFrame);
    resizeFrame = requestAnimationFrame(() => { layout(); closeMenu(); });
  }).observe(stage);
  function reset() {
    ++version; ready = working = false; current = attachment = annotatedAttachment = null; eraser.reset(); annotations.reset();
    image.hidden = true; image.removeAttribute('src'); closeMenu(); availability(); message('');
  }
  async function open(source) {
    reset();
    const token = version;
    const tab = createRightSidebarTab('image-editor');
    activateRightSidebarTab(tab.id); setBrowserFocusMode(true);
    message('正在加载图片…', false, false);
    try {
      const result = source.filePath ? await api.readImageFile(source.filePath) : await api.readGeneratedImage(source.assetId);
      if (token !== version) return;
      if (result?.error || !result?.dataUrl) throw new Error(result?.error || '图片无法读取');
      const decoded = new Image(); decoded.src = result.dataUrl; await decoded.decode();
      if (token !== version) return;
      current = { name: result.name || source.name || 'image.png', originalName: result.name || source.name || 'image.png', mimeType: result.mimeType };
      const filePath = source.filePath || result.path;
      attachment = filePath ? { path: filePath, name: current.name, size: result.size, mimeType: result.mimeType, kind: 'image' } : null;
      image.src = result.dataUrl; await image.decode();
      if (token !== version) return;
      image.alt = current.name; image.hidden = false;
      ready = true; fit = true; layout(); stage.scrollLeft = stage.scrollTop = 0; availability(); message('');
    } catch (error) { if (token === version) message(`无法打开图片：${error.message}`, true, false); }
  }
  window.YanImageEditor = { open, reset, hasEdits: () => annotations.state().hasEdits, confirmClose: () => annotations.requestClose() };
})();

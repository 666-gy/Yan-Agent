(() => {
  'use strict';
  const dialog = document.createElement('dialog');
  dialog.id = 'drawingBoard';
  dialog.className = 'image-editor drawing-board';
  dialog.setAttribute('aria-label', '绘图画板');
  dialog.innerHTML = `
    <div class="image-editor-stage"><div class="drawing-paper"><img class="image-editor-image" alt="绘图画布" draggable="false"></div></div>
    <div class="image-editor-toolbar"></div>
    <button type="button" class="drawing-close" aria-label="关闭画板" title="关闭画板">${ICONS.close}</button>
    <label class="image-editor-brush-control"><input class="image-editor-brush-size" type="range" min="1" max="40" value="4" aria-label="线条粗细"></label>
    <button type="button" class="drawing-confirm" aria-label="确认绘图" title="确认绘图" disabled>${ICONS.check}</button>`;
  document.body.append(dialog);
  const image = dialog.querySelector('img');
  const stage = dialog.querySelector('.image-editor-stage');
  const confirm = dialog.querySelector('.drawing-confirm');
  const closeButton = dialog.querySelector('.drawing-close');
  let saving = false, version = 0, sessionId = '', previousFocus;
  const annotations = window.createImageAnnotationLayer({
    panel: dialog, image, standalone: true, initialColor: '#000000', initialTool: 'select',
    onChange: next => { confirm.disabled = saving || !next.hasContent; },
    onClose: close
  });
  const toolbar = dialog.querySelector('.image-annotation-tools');
  const core = document.createElement('div'); core.className = 'drawing-tools';
  const history = document.createElement('div'); history.className = 'drawing-history';
  for (const name of ['select', 'pen', 'text', 'shapes', 'eraser']) core.append(toolbar.querySelector(`[data-annotation="${name}"]`));
  for (const name of ['undo', 'redo']) history.append(toolbar.querySelector(`[data-annotation="${name}"]`));
  toolbar.append(core, history);
  const menuAction = document.querySelector('#drawingAction');
  menuAction.querySelector('.drawing-action-icon').append(core.querySelector('[data-annotation="pen"] svg').cloneNode(true));
  function close() {
    if (saving) return;
    ++version;
    dialog.close();
    annotations.reset();
    image.removeAttribute('src');
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  }
  function layout() {
    if (!dialog.open || !image.naturalWidth) return;
    const scale = Math.min(stage.clientWidth / image.naturalWidth, stage.clientHeight / image.naturalHeight);
    image.style.width = `${Math.round(image.naturalWidth * scale)}px`;
    image.style.height = `${Math.round(image.naturalHeight * scale)}px`;
  }
  new ResizeObserver(layout).observe(stage);
  async function open() {
    if (dialog.open) return;
    if (!state.currentSession) await newSession();
    setAttachmentMenuOpen(false);
    previousFocus = document.activeElement;
    sessionId = state.currentSession?.id;
    const token = ++version;
    dialog.showModal();
    annotations.reset();
    const paper = document.createElement('canvas');
    paper.width = Math.max(1, stage.clientWidth); paper.height = Math.max(1, stage.clientHeight);
    const ctx = paper.getContext('2d'); ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, paper.width, paper.height);
    image.src = paper.toDataURL('image/png');
    await image.decode();
    if (token !== version || !dialog.open) return;
    layout(); annotations.enter();
    dialog.querySelector('.image-editor-annotations').setAttribute('aria-label', '绘图画布');
    core.querySelector('[data-annotation="select"]').focus({ preventScroll: true });
  }
  closeButton.addEventListener('click', () => void annotations.requestClose());
  dialog.addEventListener('cancel', event => { event.preventDefault(); void annotations.requestClose(); });
  dialog.addEventListener('keydown', event => event.stopPropagation());
  confirm.addEventListener('click', async () => {
    if (saving) return;
    const dataUrl = annotations.exportImage();
    if (!annotations.state().hasContent) return;
    if (sessionId !== state.currentSession?.id) { toast('当前任务已切换，请重新打开画板', { error: true }); return; }
    const token = version, fileName = `绘图-${Date.now()}.png`, previousAttachments = new Set(state.attachments);
    saving = true; annotations.lock(true); confirm.disabled = closeButton.disabled = true;
    confirm.setAttribute('aria-busy', 'true');
    try {
      const bytes = Uint8Array.from(atob(dataUrl.split(',')[1]), char => char.charCodeAt(0));
      await addAttachment(new File([bytes], fileName, { type: 'image/png' }), {
        imageOnly: true, shouldAccept: () => token === version && dialog.open && sessionId === state.currentSession?.id
      });
      const added = state.attachments.some(item => !previousAttachments.has(item) && item.name === fileName);
      if (token === version && added && sessionId === state.currentSession?.id) {
        saving = false; close();
        if (browserFocusMode) setBrowserFocusComposerMode('expanded', { focus: true });
        input.focus({ preventScroll: true });
      }
    } catch (error) { toast(error.message || '无法保存绘图', { error: true }); }
    finally {
      saving = false; annotations.lock(false); closeButton.disabled = false;
      confirm.disabled = !annotations.state().hasContent; confirm.removeAttribute('aria-busy');
    }
  });
  menuAction.addEventListener('click', () => { void open().catch(error => toast(error.message, { error: true })); });
  window.YanDrawingBoard = { open };
})();

'use strict';

// Native editing/undo and selection, with a synchronized syntax and line-number layer.
window.createProjectFileEditor = ({ value, path, firstLine, onChange, onReference }) => {
  const host = document.createElement('div');
  host.className = 'pf-editor-host';
  host.innerHTML = '<div class="pf-gutter"><div></div></div><div class="pf-edit-surface"><pre class="pf-code pf-editor-highlight" aria-hidden="true"><code></code></pre><textarea class="pf-editor" spellcheck="false" wrap="off" aria-label="编辑文件"></textarea></div><button class="pf-reference" type="button" hidden>添加至对话</button>';
  const editor = host.querySelector('textarea');
  const gutter = host.querySelector('.pf-gutter');
  const numbers = gutter.firstChild;
  const highlight = host.querySelector('code');
  const paintLayer = highlight.parentElement;
  const reference = host.querySelector('.pf-reference');
  editor.value = value;
  let generation = 0;
  let highlightTimer;
  let selectionKind = 'text';
  let anchor = null;
  let dragY = 0;
  let scrollFrame = 0;
  const escape = text => text.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const lineStarts = () => { const starts = [0]; for (let i = 0; i < editor.value.length; i++) if (editor.value[i] === '\n') starts.push(i + 1); return starts; };
  const syncScroll = () => {
    numbers.style.transform = `translateY(${-editor.scrollTop}px)`;
    paintLayer.scrollTop = editor.scrollTop;
    paintLayer.scrollLeft = editor.scrollLeft;
    positionReference();
  };
  const paint = () => {
    const version = ++generation;
    highlight.textContent = editor.value + '\n';
    numbers.innerHTML = lineStarts().map((_, index) => `<button type="button" class="pf-line-number" data-line="${index}" aria-label="选择第 ${firstLine() + index} 行">${firstLine() + index}</button>`).join('');
    clearTimeout(highlightTimer);
    highlightTimer = setTimeout(async () => {
      const lines = await window.YanFileHighlight?.(editor.value, path).catch(() => null);
      if (!lines || version !== generation) return;
      highlight.innerHTML = lines.map(tokens => tokens.map(token => `<span style="--pf-dark:${escape(token.htmlStyle['--shiki-dark'])};--pf-light:${escape(token.htmlStyle.color)}">${escape(token.content)}</span>`).join('')).join('\n') + '\n';
      syncScroll();
    }, 100);
    syncScroll();
  };
  const selected = () => {
    const start = editor.selectionStart, end = editor.selectionEnd;
    if (start === end && selectionKind !== 'lines') return null;
    const startLine = firstLine() + editor.value.slice(0, start).split('\n').length - 1;
    const endLine = firstLine() + editor.value.slice(0, Math.max(start, end - 1)).split('\n').length - 1;
    return { kind: selectionKind, startLine, endLine, text: editor.value.slice(start, end) };
  };
  const measure = document.createElement('canvas').getContext('2d');
  const positionReference = () => {
    if (reference.hidden) return;
    const style = getComputedStyle(editor);
    const lineHeight = parseFloat(style.lineHeight);
    const backward = editor.selectionDirection === 'backward';
    const offset = backward ? editor.selectionStart : Math.max(editor.selectionStart, editor.selectionEnd - 1);
    const prefix = editor.value.slice(0, offset);
    const line = prefix.split('\n').length - 1;
    const y = parseFloat(style.paddingTop) + line * lineHeight - editor.scrollTop;
    reference.style.visibility = y + lineHeight < 0 || y > editor.clientHeight ? 'hidden' : '';
    let x = gutter.offsetWidth;
    if (selectionKind === 'text') {
      measure.font = style.font;
      const lineStart = prefix.lastIndexOf('\n') + 1;
      const text = editor.value.slice(lineStart, backward ? offset : editor.selectionEnd).replace(/\t/g, (_, index) => ' '.repeat(4 - index % 4));
      x += measure.measureText(text).width - editor.scrollLeft + parseFloat(style.paddingLeft);
    }
    const below = y + lineHeight + 4;
    const top = below + reference.offsetHeight <= host.clientHeight - 4 ? below : y - reference.offsetHeight - 4;
    reference.style.left = Math.max(4, Math.min(x, host.clientWidth - reference.offsetWidth - 8)) + 'px';
    reference.style.top = Math.max(4, top) + 'px';
  };
  new ResizeObserver(positionReference).observe(host);
  const showReference = () => {
    const selection = selected();
    reference.hidden = !selection;
    positionReference();
    numbers.querySelectorAll('button').forEach(button => {
      const line = firstLine() + Number(button.dataset.line);
      button.classList.toggle('selected', !!selection && line >= selection.startLine && line <= selection.endLine);
    });
  };
  const selectLines = index => {
    const starts = lineStarts();
    const lo = Math.min(anchor, index), hi = Math.max(anchor, index);
    editor.focus({ preventScroll: true });
    editor.setSelectionRange(starts[lo], starts[hi + 1] ?? editor.value.length, index < anchor ? 'backward' : 'forward');
    selectionKind = 'lines';
    showReference();
  };
  const lineAt = y => {
    const style = getComputedStyle(editor);
    return Math.max(0, Math.min(lineStarts().length - 1, Math.floor((y - editor.getBoundingClientRect().top + editor.scrollTop - parseFloat(style.paddingTop)) / parseFloat(style.lineHeight))));
  };
  const dragScroll = () => {
    if (anchor === null || !host.isConnected) return;
    const rect = gutter.getBoundingClientRect();
    if (dragY < rect.top) editor.scrollTop -= 18;
    else if (dragY > rect.bottom) editor.scrollTop += 18;
    selectLines(lineAt(dragY)); syncScroll();
    scrollFrame = requestAnimationFrame(dragScroll);
  };
  gutter.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !event.target.closest('[data-line]')) return;
    event.preventDefault();
    anchor = Number(event.target.closest('[data-line]').dataset.line);
    dragY = event.clientY;
    gutter.setPointerCapture(event.pointerId);
    selectLines(anchor);
    scrollFrame = requestAnimationFrame(dragScroll);
  });
  gutter.addEventListener('pointermove', event => { if (anchor !== null) dragY = event.clientY; });
  const stopDrag = () => { anchor = null; cancelAnimationFrame(scrollFrame); };
  gutter.addEventListener('pointerup', stopDrag);
  gutter.addEventListener('lostpointercapture', stopDrag);
  gutter.addEventListener('keydown', event => {
    if (['Enter', ' '].includes(event.key) && event.target.dataset.line !== undefined) {
      event.preventDefault(); anchor = Number(event.target.dataset.line); selectLines(anchor); anchor = null;
    }
  });
  editor.addEventListener('pointerdown', () => { selectionKind = 'text'; reference.hidden = true; });
  editor.addEventListener('pointerup', showReference);
  editor.addEventListener('keyup', () => { selectionKind = 'text'; showReference(); });
  let lastValue = editor.value;
  editor.addEventListener('input', () => { if (editor.value === lastValue) return; lastValue = editor.value; selectionKind = 'text'; reference.hidden = true; onChange(editor.value); paint(); });
  editor.addEventListener('scroll', syncScroll);
  reference.addEventListener('pointerdown', event => event.preventDefault());
  reference.addEventListener('click', async () => {
    const selection = selected();
    if (!selection) return;
    reference.disabled = true;
    try { await onReference(selection); reference.hidden = true; }
    finally { reference.disabled = false; }
  });
  paint();
  return host;
};

(() => {
  'use strict';
  window.createImageEraseLayer = ({ panel, image, onChange, drawAnnotations = () => {} }) => {
    const surface = panel.querySelector('.image-editor-selection');
    const cursor = panel.querySelector('.image-editor-eraser-cursor');
    const slider = panel.querySelector('.image-editor-brush-size');
    let enabled = false, locked = false, strokes = [], undone = [], active = null, pointer = null, brushSize = 100;
    const state = () => ({ enabled, hasSelection: strokes.length > 0, canUndo: strokes.length > 0, canRedo: undone.length > 0 });
    const color = () => getComputedStyle(panel).getPropertyValue('--accent').trim() || '#3399ff';
    function draw(ctx, stroke) {
      ctx.lineWidth = stroke.size; ctx.lineCap = ctx.lineJoin = 'round';
      ctx.beginPath();
      const first = stroke.points[0];
      ctx.moveTo(first.x, first.y);
      for (const point of stroke.points.slice(1)) ctx.lineTo(point.x, point.y);
      if (stroke.points.length === 1) {
        ctx.arc(first.x, first.y, stroke.size / 2, 0, Math.PI * 2); ctx.fill();
      } else ctx.stroke();
    }
    function render() {
      const ctx = surface.getContext('2d');
      ctx.clearRect(0, 0, surface.width, surface.height);
      ctx.fillStyle = ctx.strokeStyle = color();
      for (const stroke of strokes) draw(ctx, stroke);
      onChange(state());
    }
    function finish() {
      const id = pointer; pointer = null; active = null;
      if (id !== null && surface.hasPointerCapture(id)) surface.releasePointerCapture(id);
    }
    function reset() {
      finish(); enabled = false; strokes = []; undone = []; cursor.hidden = true;
      panel.classList.remove('is-erasing'); render();
    }
    function enter() {
      reset(); enabled = true;
      slider.min = '8'; slider.max = '240'; slider.value = String(brushSize); slider.setAttribute('aria-label', '橡皮大小');
      surface.width = image.naturalWidth; surface.height = image.naturalHeight;
      panel.classList.add('is-erasing'); render();
    }
    function point(event) {
      const rect = surface.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * surface.width / rect.width, y: (event.clientY - rect.top) * surface.height / rect.height };
    }
    function moveCursor(event) {
      const rect = panel.getBoundingClientRect(), size = Number(slider.value);
      cursor.style.width = cursor.style.height = `${size}px`;
      cursor.style.left = `${event.clientX - rect.left}px`; cursor.style.top = `${event.clientY - rect.top}px`;
      cursor.hidden = !enabled || locked;
    }
    surface.addEventListener('pointerdown', event => {
      if (!enabled || locked || event.button !== 0 || pointer !== null) return;
      event.preventDefault(); pointer = event.pointerId;
      surface.setPointerCapture(pointer); moveCursor(event);
      active = { size: Number(slider.value) * surface.width / surface.getBoundingClientRect().width, points: [point(event)] };
      strokes.push(active); undone = []; render();
    });
    surface.addEventListener('pointermove', event => {
      moveCursor(event);
      if (!active || event.pointerId !== pointer || locked) return;
      for (const item of event.getCoalescedEvents?.().length ? event.getCoalescedEvents() : [event]) active.points.push(point(item));
      render();
    });
    for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) surface.addEventListener(name, event => {
      if (event.pointerId === pointer) finish();
    });
    surface.addEventListener('pointerleave', () => { cursor.hidden = true; });
    panel.querySelector('.image-editor-stage').addEventListener('scroll', () => { cursor.hidden = true; });
    slider.addEventListener('input', () => { if (enabled) { brushSize = Number(slider.value); cursor.style.width = cursor.style.height = `${slider.value}px`; } });
    return {
      enter, reset, state,
      lock(value) { locked = value; slider.disabled = value; if (value) { finish(); cursor.hidden = true; } },
      undo() { if (locked) return; finish(); if (strokes.length) undone.push(strokes.pop()); render(); },
      redo() { if (locked) return; finish(); if (undone.length) strokes.push(undone.pop()); render(); },
      exportSelection() {
        finish();
        if (!strokes.length) throw new Error('请先涂抹要移除的区域');
        const output = document.createElement('canvas'); output.width = image.naturalWidth; output.height = image.naturalHeight;
        const ctx = output.getContext('2d'); ctx.drawImage(image, 0, 0);
        drawAnnotations(ctx);
        ctx.globalAlpha = .5; ctx.drawImage(surface, 0, 0);
        return output.toDataURL('image/png');
      }
    };
  };
})();

(() => {
  'use strict';
  const G = window.YanImageAnnotationGeometry, T = window.YanImageAnnotationText, NS = 'http://www.w3.org/2000/svg';
  const clone = value => JSON.parse(JSON.stringify(value));
  let layerSequence = 0;
  const icon = path => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
  const colors = [
    ['黑色', '#000000'], ['灰色', '#6b7280'], ['棕色', '#92400e'], ['红色', '#dc2626'], ['橙色', '#f97316'], ['琥珀色', '#f59e0b'],
    ['绿色', '#16a34a'], ['青绿色', '#0d9488'], ['青色', '#06b6d4'], ['蓝色', '#2563eb'], ['靛蓝色', '#4f46e5'], ['紫色', '#9333ea'], ['粉色', '#db2777']
  ];
  function element(name, attributes = {}) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, String(value));
    return node;
  }
  window.createImageAnnotationLayer = ({ panel, image, onChange, onComment, onClose, standalone = false, initialColor = '#dc2626', initialTool = 'pen' }) => {
    const maskPrefix = `image-annotation-mask-${++layerSequence}`;
    const surface = element('svg', { class: 'image-editor-annotations', 'aria-label': '标注画布', tabindex: '0' });
    const art = element('g', { class: 'image-annotation-art' }), controls = element('g', { class: 'image-annotation-handles' }), masks = element('defs');
    surface.append(masks, art, controls);
    image.after(surface);
    const toolbar = document.createElement('div'); toolbar.className = 'image-annotation-tools'; toolbar.hidden = true;
    toolbar.setAttribute('role', 'toolbar'); toolbar.setAttribute('aria-label', '标注工具');
    const toolButton = (action, label, path, extra = '') => `<button type="button" data-annotation="${action}" aria-label="${label}" title="${label}" ${extra}>${icon(path)}</button>`;
    toolbar.innerHTML =
      toolButton('select', '选择与移动', 'm4 3 17 8-8 3-4 8Z', 'aria-pressed="false"') +
      toolButton('pen', '画笔', 'M3 17C6 9 13 1 16 4S4 20 9 20s11-13 12-9-6 9-3 10', 'aria-pressed="true"') +
      toolButton('text', '文字', 'M5 6V4h14v2M12 4v16m-4 0h8', 'aria-pressed="false"') +
      toolButton('shapes', '形状', 'M14 8a6 6 0 1 0-6 6M11 11h10v10H11Z', 'aria-haspopup="menu" aria-expanded="false"') +
      '<button type="button" data-annotation="colors" aria-label="标注颜色" title="颜色" aria-haspopup="menu" aria-expanded="false"><span class="image-annotation-color-dot"></span></button>' +
      toolButton('eraser', '橡皮：擦除标注', 'm3 13 10-10 8 8-10 10H9l-6-6Zm4-4 10 10', 'aria-pressed="false"') +
      '<span class="image-annotation-divider"></span>' +
      toolButton('undo', '撤销标注', 'm8 4-5 5 5 5M3 9h11a6 6 0 0 1 0 12') +
      toolButton('redo', '重做标注', 'm16 4 5 5-5 5M21 9H10a6 6 0 0 0 0 12') +
      '<span class="image-annotation-divider"></span>' +
      toolButton('comment', '添加评论', 'M21 11a9 9 0 0 1-9 9H4l-2 2V11a9 9 0 0 1 19 0ZM12 7v8m-4-4h8') +
      toolButton('close', '退出标注', 'm5 5 14 14M5 19 19 5');
    panel.querySelector('.image-editor-toolbar').prepend(toolbar);
    const palette = document.createElement('div'); palette.className = 'image-annotation-palette'; palette.hidden = true;
    palette.setAttribute('role', 'group'); palette.setAttribute('aria-label', '标注颜色选择器');
    palette.innerHTML = '<label class="image-annotation-custom" title="自定义颜色"><input type="color" value="#dc2626" aria-label="自定义标注颜色"></label>' +
      colors.map(([label, color]) => `<button type="button" data-color="${color}" aria-label="${label}" title="${label}" aria-pressed="false" style="--swatch:${color}"></button>`).join('');
    const shapesMenu = document.createElement('div'); shapesMenu.className = 'image-annotation-shapes'; shapesMenu.hidden = true;
    shapesMenu.setAttribute('role', 'menu'); shapesMenu.setAttribute('aria-label', '标注形状');
    shapesMenu.innerHTML = G.shapes.map(([type, label, path]) => `<button type="button" role="menuitemradio" aria-checked="false" data-shape="${type}" aria-label="${label}" title="${label}">${icon(path)}</button>`).join('');
    const cursor = document.createElement('div'); cursor.className = 'image-annotation-cursor'; cursor.hidden = true;
    panel.append(palette, shapesMenu, cursor);
    const slider = panel.querySelector('.image-editor-brush-size'), stage = panel.querySelector('.image-editor-stage');
    const probe = document.createElement('canvas').getContext('2d');
    const button = action => toolbar.querySelector(`[data-annotation="${action}"]`);
    let enabled = false, locked = false, objects = [], selectedId = null, tool = initialTool, color = initialColor, brushSize = 4, eraserSize = 32;
    let history = [], future = [], gesture = null, nextId = 1, nextEraseId = 1, revision = 0, styleBefore = null, frame = 0;
    let editingText = null, textSize = 24;
    let fullscreen = standalone || document.querySelector('#app').classList.contains('browser-focus-mode');
    const discardDialog = window.createImageDiscardDialog(panel);
    const selected = () => objects.find(object => object.id === selectedId);
    const textEditor = T.createEditor(surface, controls, element, value => {
      const object = objects.find(item => item.id === editingText?.id);
      if (!object) return;
      object.text = value; T.grow(object); render();
    }, () => { finishText(); surface.focus({ preventScroll: true }); });
    const zoom = () => image.getBoundingClientRect().width / image.naturalWidth || 1;
    const state = () => ({ enabled, hasContent: objects.length > 0, hasEdits: objects.length > 0 || history.length > 0 || future.length > 0, revision });
    function record(before) {
      if (JSON.stringify(before) === JSON.stringify(objects)) return;
      history.push({ before, after: clone(objects) });
      if (history.length > 100) history.shift();
      future = []; ++revision; onChange(state());
    }
    function finishStyle() { if (styleBefore) { const before = styleBefore; styleBefore = null; record(before); } }
    function render() {
      cancelAnimationFrame(frame); frame = 0;
      masks.replaceChildren();
      for (const object of objects) {
        if (!object.erasures?.length) continue;
        const mask = element('mask', { id: `${maskPrefix}-${object.id}`, maskUnits: 'userSpaceOnUse', x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight, 'mask-type': 'luminance' });
        mask.append(element('rect', { width: image.naturalWidth, height: image.naturalHeight, fill: 'white' }));
        for (const stroke of object.erasures) mask.append(element('path', { d: G.erasePath(stroke), transform: `matrix(${(stroke.matrix || [1,0,0,1,0,0]).join(' ')})`, fill: 'none', stroke: 'black', 'stroke-width': stroke.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }));
        masks.append(mask);
      }
      art.replaceChildren(...objects.map(object => {
        const node = object.type === 'text' ? T.node(object, element) : element('path', {
          d: G.path(object), fill: 'none', stroke: object.color, 'stroke-width': object.width, 'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        });
        node.setAttribute('data-object-id', object.id); node.setAttribute('data-type', object.type);
        if (object.erasures?.length) node.setAttribute('mask', `url(#${maskPrefix}-${object.id})`);
        if (editingText?.id === object.id) node.setAttribute('visibility', 'hidden');
        return node;
      }));
      textEditor.sync(objects.find(object => object.id === editingText?.id));
      controls.replaceChildren();
      const object = selected(), z = zoom();
      if (enabled && (tool === 'select' || editingText) && object) {
        if (!G.isLine(object)) {
          const b = G.bounds(object);
          controls.append(element('rect', { x: b.left, y: b.top, width: b.width, height: b.height, fill: 'none', stroke: 'var(--ie-focus)', 'stroke-width': 1 / z, 'stroke-dasharray': `${4 / z} ${3 / z}` }));
          if (object.type === 'text') {
            for (const [name,x1,y1,x2,y2] of [['n',b.left,b.top,b.right,b.top],['e',b.right,b.top,b.right,b.bottom],['s',b.left,b.bottom,b.right,b.bottom],['w',b.left,b.top,b.left,b.bottom]]) controls.append(element('line', {
              x1,y1,x2,y2, stroke: 'transparent', 'stroke-width': 8/z, 'data-handle': name, class: `image-annotation-resize-edge handle-${name}`
            }));
          }
        }
        for (const [name, x, y] of G.handles(object)) controls.append(element('circle', {
          cx: x, cy: y, r: 4 / z, fill: 'var(--ie-paper)', stroke: 'var(--ie-focus)', 'stroke-width': 1.5 / z,
          'data-handle': name, class: `image-annotation-handle handle-${name}`
        }));
      }
      toolbar.hidden = !enabled;
      panel.classList.toggle('is-annotating', enabled);
      surface.dataset.tool = tool;
      surface.style.pointerEvents = enabled && fullscreen && !locked ? 'auto' : 'none';
      for (const name of ['select', 'pen', 'eraser', 'text']) button(name).setAttribute('aria-pressed', String(tool === name));
      button('shapes').setAttribute('aria-pressed', String(G.shapes.some(([type]) => type === tool)));
      for (const b of toolbar.querySelectorAll('button')) b.disabled = locked;
      button('undo').disabled = locked || history.length === 0;
      button('redo').disabled = locked || future.length === 0;
      toolbar.querySelector('.image-annotation-color-dot').style.backgroundColor = color;
      for (const b of palette.querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', String(b.dataset.color === color));
      for (const b of shapesMenu.querySelectorAll('[data-shape]')) b.setAttribute('aria-checked', String(b.dataset.shape === tool));
      palette.querySelector('input').value = color;
    }
    function scheduleRender() { if (!frame) frame = requestAnimationFrame(render); }
    function syncSlider() {
      if (!enabled) return;
      if (tool === 'text' || selected()?.type === 'text') {
        const object = selected();
        slider.min = '8'; slider.max = '96';
        slider.value = String(object?.type === 'text' ? object.fontSize*zoom()*(object.y2-object.y1)/object.baseHeight : textSize);
        slider.setAttribute('aria-label', '标注文字大小'); slider.disabled = locked; return;
      }
      slider.min = tool === 'eraser' ? '8' : '1'; slider.max = tool === 'eraser' ? '160' : '40';
      slider.value = String(tool === 'eraser' ? eraserSize : brushSize);
      slider.setAttribute('aria-label', tool === 'eraser' ? '标注橡皮大小' : '标注线条粗细'); slider.disabled = locked;
    }
    function closeMenus() {
      finishStyle(); palette.hidden = !standalone; shapesMenu.hidden = true;
      button('colors').setAttribute('aria-expanded', 'false'); button('shapes').setAttribute('aria-expanded', 'false');
    }
    function positionMenu(menu, anchor) {
      const box = anchor.getBoundingClientRect(), root = panel.getBoundingClientRect();
      menu.style.left = `${Math.max(8, Math.min(box.left + box.width / 2 - root.left - menu.offsetWidth / 2, panel.clientWidth - menu.offsetWidth - 8))}px`;
      menu.style.top = `${Math.max(8, Math.min(box.bottom - root.top + 8, panel.clientHeight - menu.offsetHeight - 8))}px`;
    }
    function toggleMenu(name) {
      const menu = name === 'colors' ? palette : shapesMenu, opening = menu.hidden;
      closeMenus(); cursor.hidden = true;
      if (opening) { menu.hidden = false; button(name).setAttribute('aria-expanded', 'true'); positionMenu(menu, button(name)); menu.querySelector('button')?.focus(); }
    }
    function setTool(next) {
      finishGesture(); finishText(); closeMenus(); tool = next; cursor.hidden = true;
      if (next !== 'select') selectedId = null;
      syncSlider(); render();
    }
    function changeColor(value, final = true) {
      if (locked || !/^#[0-9a-f]{6}$/i.test(value)) return;
      color = value.toLowerCase();
      const object = selected();
      if (object) { styleBefore ||= clone(objects); object.color = color; }
      if (final) finishStyle(); render();
    }
    function point(event) {
      const rect = surface.getBoundingClientRect();
      return { x: (event.clientX - rect.left) * image.naturalWidth / rect.width, y: (event.clientY - rect.top) * image.naturalHeight / rect.height };
    }
    function findAt(p) { return [...objects].reverse().find(object => G.hit(probe, object, p, 6 / zoom())); }
    function select(object) {
      selectedId = object?.id || null;
      if (object) { color = object.color; brushSize = Math.max(1, Math.min(40, object.width * zoom())); }
      syncSlider();
    }
    function startText(point, existing = null) {
      finishText(); closeMenus();
      const before = clone(objects), z = zoom();
      let object = existing;
      if (!object) {
        const width = Math.min(220/z, image.naturalWidth), height = Math.min(64/z, image.naturalHeight);
        const x = Math.max(0, Math.min(point.x, image.naturalWidth-width)), y = Math.max(0, Math.min(point.y, image.naturalHeight-height));
        object = { id: nextId++, type: 'text', text: '', color, width: 1, fontSize: textSize/z, fontFamily: getComputedStyle(panel).fontFamily, baseWidth: width, baseHeight: height, x1: x, y1: y, x2: x+width, y2: y+height };
        objects.push(object);
      }
      editingText = { id: object.id, before }; selectedId = object.id; tool = 'text';
      syncSlider(); render(); textEditor.focus();
    }
    function finishText(cancel = false) {
      if (!editingText) return;
      const edit = editingText, object = objects.find(item => item.id === edit.id); editingText = null;
      if (cancel) objects = edit.before;
      else {
        if (object && !object.text.trim()) objects = objects.filter(item => item.id !== edit.id);
        record(edit.before);
      }
      tool = 'select'; if (!selected()) selectedId = null;
      textEditor.sync(null); syncSlider(); render();
    }
    function eraseBetween(from, to) {
      const radius = eraserSize / (2 * zoom()), length = Math.hypot(to.x - from.x, to.y - from.y);
      const steps = Math.max(1, Math.ceil(length / Math.max(1, radius / 2)));
      for (const object of objects) {
        const last = object.erasures?.at(-1);
        if (last?.id === gesture.eraseId) { last.points.push(to); continue; }
        for (let i = 0; i <= steps; i++) {
          if (!G.hit(probe, object, { x: from.x + (to.x - from.x) * i / steps, y: from.y + (to.y - from.y) * i / steps }, radius, false, false)) continue;
          (object.erasures ||= []).push({ id: gesture.eraseId, width: radius * 2, points: [from, to] });
          break;
        }
      }
    }
    function moveCursor(event) {
      const root = panel.getBoundingClientRect();
      const size = tool === 'eraser' ? eraserSize : brushSize;
      cursor.style.width = cursor.style.height = `${Math.max(4, size)}px`;
      cursor.style.left = `${event.clientX - root.left}px`; cursor.style.top = `${event.clientY - root.top}px`;
      cursor.style.setProperty('--annotation-color', tool === 'eraser' ? 'var(--ie-muted)' : color);
      cursor.hidden = !enabled || !fullscreen || locked || !['pen', 'eraser'].includes(tool);
    }
    surface.addEventListener('pointerdown', event => {
      if (!enabled || !fullscreen || locked || event.button !== 0 || gesture) return;
      if (event.composedPath().includes(textEditor.foreign)) return;
      event.preventDefault(); closeMenus();
      const p = point(event), handle = event.target.getAttribute('data-handle'), before = clone(objects);
      if (tool === 'text' && !handle) { startText(p); return; }
      if (!editingText) surface.focus({ preventScroll: true });
      gesture = { pointer: event.pointerId, start: p, last: p, before, tool: editingText && handle ? 'select' : tool, moved: false, handle, eraseId: nextEraseId++ };
      surface.setPointerCapture(event.pointerId);
      if (gesture.tool === 'select') {
        const object = handle ? selected() : findAt(p); select(object);
        gesture.original = object ? clone(object) : null;
      } else if (tool === 'eraser') eraseBetween(p, p);
      else if (tool === 'pen') {
        const object = { id: nextId++, type: 'pen', color, width: brushSize / zoom(), points: [p] };
        objects.push(object); gesture.object = object;
      } else {
        const object = { id: nextId++, type: tool, color, width: brushSize / zoom(), x1: p.x, y1: p.y, x2: p.x, y2: p.y };
        objects.push(object); gesture.object = object;
      }
      moveCursor(event); render();
    });
    surface.addEventListener('pointermove', event => {
      moveCursor(event);
      if (!gesture || gesture.pointer !== event.pointerId) return;
      const p = point(event);
      if (Math.hypot(p.x - gesture.start.x, p.y - gesture.start.y) * zoom() > 3) gesture.moved = true;
      if (gesture.tool === 'select' && gesture.original) {
        const object = selected();
        if (gesture.handle) G.resize(object, gesture.original, gesture.handle, p);
        else {
          Object.assign(object, clone(gesture.original));
          G.translate(object, p.x - gesture.start.x, p.y - gesture.start.y);
        }
      } else if (gesture.tool === 'eraser') eraseBetween(gesture.last, p);
      else if (gesture.object?.type === 'pen') {
        const events = event.getCoalescedEvents?.();
        for (const item of events?.length ? events : [event]) gesture.object.points.push(point(item));
      } else if (gesture.object) { gesture.object.x2 = p.x; gesture.object.y2 = p.y; }
      gesture.last = p; scheduleRender();
    });
    function finishGesture(cancel = false) {
      if (!gesture) return;
      const done = gesture; gesture = null;
      if (surface.hasPointerCapture(done.pointer)) surface.releasePointerCapture(done.pointer);
      if (cancel) objects = done.before;
      else {
        // A plain click away from marks returns to selection, without a stray dot or zero-size shape.
        if (done.object && !done.moved) {
          objects = done.before; tool = 'select'; select(findAt(done.start));
        } else if (done.object && done.tool !== 'pen') { tool = 'select'; select(done.object); }
        if (!editingText) record(done.before);
      }
      render();
    }
    surface.addEventListener('pointerup', event => { if (event.pointerId === gesture?.pointer) finishGesture(); });
    surface.addEventListener('pointercancel', event => { if (event.pointerId === gesture?.pointer) finishGesture(true); });
    surface.addEventListener('lostpointercapture', event => { if (event.pointerId === gesture?.pointer) finishGesture(); });
    surface.addEventListener('pointerleave', () => { cursor.hidden = true; });
    surface.addEventListener('dblclick', event => {
      if (!enabled || !fullscreen || locked || editingText || tool !== 'select') return;
      const object = findAt(point(event));
      if (object?.type === 'text') { event.preventDefault(); startText(point(event), object); }
    });
    stage.addEventListener('pointerdown', event => {
      if (enabled && fullscreen && !locked && !event.composedPath().includes(surface) && event.button === 0) { setTool('select'); selectedId = null; render(); }
    });
    function undo(redo = false) {
      if (locked) return;
      finishGesture(); finishText(); finishStyle();
      const entry = (redo ? future : history).pop(); if (!entry) return;
      (redo ? history : future).push(entry); objects = clone(redo ? entry.after : entry.before);
      if (!selected()) selectedId = null;
      ++revision; onChange(state()); render();
    }
    function exit() {
      finishGesture(); finishText(); closeMenus(); enabled = false; cursor.hidden = true; selectedId = null;
      render(); onChange(state());
    }
    function reset() {
      discardDialog.cancel(); finishGesture(true); finishText(true); closeMenus(); enabled = false; objects = []; selectedId = null; history = []; future = []; ++revision;
      cursor.hidden = true; render(); onChange(state());
    }
    async function requestClose() {
      if (locked) return false;
      finishGesture(); finishText(); closeMenus(); cursor.hidden = true;
      if (!state().hasEdits) { exit(); onClose?.(); return true; }
      if (!await discardDialog.ask()) return false;
      reset(); onClose?.(); return true;
    }
    toolbar.addEventListener('click', event => {
      const target = event.target.closest('button'); if (!target || target.disabled || locked) return;
      const action = target.dataset.annotation;
      if (['select', 'pen', 'eraser', 'text'].includes(action)) setTool(action);
      else if (['shapes', 'colors'].includes(action)) toggleMenu(action);
      else if (['undo', 'redo'].includes(action)) undo(action === 'redo');
      else if (action === 'comment') { finishGesture(); finishText(); closeMenus(); onComment?.(); }
      else if (action === 'close') void requestClose();
    });
    palette.addEventListener('click', event => { const b = event.target.closest('[data-color]'); if (b) { changeColor(b.dataset.color); closeMenus(); } });
    palette.querySelector('input').addEventListener('input', event => changeColor(event.target.value, false));
    palette.querySelector('input').addEventListener('change', () => { finishStyle(); render(); });
    shapesMenu.addEventListener('click', event => { const b = event.target.closest('[data-shape]'); if (b) { setTool(b.dataset.shape); surface.focus({ preventScroll: true }); } });
    slider.addEventListener('input', () => {
      if (!enabled || locked) return;
      if (tool === 'eraser') eraserSize = Number(slider.value);
      else if (tool === 'text' || selected()?.type === 'text') {
        textSize = Number(slider.value);
        const object = selected();
        if (object?.type === 'text') {
          styleBefore ||= clone(objects);
          object.fontSize = textSize/(zoom()*(object.y2-object.y1)/object.baseHeight); T.grow(object);
        }
      }
      else {
        brushSize = Number(slider.value);
        const object = selected(); if (object) { styleBefore ||= clone(objects); object.width = brushSize / zoom(); }
      }
      render();
    });
    slider.addEventListener('change', () => { if (enabled) { finishStyle(); render(); } });
    document.addEventListener('pointerdown', event => {
      if (!editingText) return;
      const path = event.composedPath();
      if (path.includes(textEditor.foreign) || path.some(node => node?.getAttribute?.('data-handle'))) return;
      finishText();
    }, true);
    document.addEventListener('pointerdown', event => {
      if (!palette.contains(event.target) && !shapesMenu.contains(event.target) && !button('colors').contains(event.target) && !button('shapes').contains(event.target)) closeMenus();
    });
    panel.addEventListener('keydown', event => {
      if (!enabled || !fullscreen || locked || event.target.closest('input,textarea,[contenteditable="true"]')) return;
      if (event.key === 'Escape') {
        event.preventDefault(); event.stopPropagation();
        if (gesture) finishGesture(true);
        else if (!palette.hidden || !shapesMenu.hidden) closeMenus();
        else if (selectedId) { selectedId = null; setTool('select'); }
        else void requestClose();
      } else if ((event.ctrlKey || event.metaKey) && ['z', 'y'].includes(event.key.toLowerCase())) {
        event.preventDefault(); event.stopPropagation(); undo(event.shiftKey || event.key.toLowerCase() === 'y');
      } else if (['Delete', 'Backspace'].includes(event.key) && selected()) {
        event.preventDefault(); const before = clone(objects); objects = objects.filter(object => object.id !== selectedId); selectedId = null; record(before); render();
      }
    });
    stage.addEventListener('scroll', () => { cursor.hidden = true; });
    new ResizeObserver(() => { if (enabled) { cursor.hidden = true; closeMenus(); scheduleRender(); } }).observe(image);
    new MutationObserver(() => {
      const next = standalone || document.querySelector('#app').classList.contains('browser-focus-mode');
      if (next === fullscreen) return;
      finishGesture(); finishText(); closeMenus(); cursor.hidden = true; fullscreen = next; render();
    }).observe(document.querySelector('#app'), { attributes: true, attributeFilter: ['class'] });
    function drawComposite(ctx) { G.draw(ctx, objects); }
    return {
      state, closeMenus, drawComposite, requestClose,
      enter() {
        enabled = true; tool = initialTool; selectedId = null;
        surface.setAttribute('viewBox', `0 0 ${image.naturalWidth} ${image.naturalHeight}`);
        syncSlider(); render(); onChange(state());
      },
      exit,
      reset,
      lock(value) { if (value) { finishGesture(); finishText(); finishStyle(); closeMenus(); cursor.hidden = true; } locked = value; syncSlider(); render(); },
      exportImage() {
        finishGesture(); finishText(); finishStyle();
        const result = document.createElement('canvas'); result.width = image.naturalWidth; result.height = image.naturalHeight;
        const ctx = result.getContext('2d'); ctx.drawImage(image, 0, 0); drawComposite(ctx);
        return result.toDataURL('image/png');
      }
    };
  };
})();

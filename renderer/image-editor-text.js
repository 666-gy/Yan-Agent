(() => {
  'use strict';
  const measure = document.createElement('canvas').getContext('2d');
  const graphemes = new Intl.Segmenter(undefined, { granularity: 'grapheme' });
  function layout(object) {
    const size = object.fontSize, padding = size / 6, lineHeight = size * 1.25;
    measure.font = `${size}px ${object.fontFamily}`;
    const lines = [], available = Math.max(1, object.baseWidth - padding * 2);
    for (const paragraph of object.text.split('\n')) {
      let line = '';
      for (const { segment } of graphemes.segment(paragraph)) {
        if (line && measure.measureText(line + segment).width > available) { lines.push(line); line = ''; }
        line += segment;
      }
      lines.push(line);
    }
    const metrics = measure.measureText('Mg'), ascent = metrics.fontBoundingBoxAscent || size * .9, descent = metrics.fontBoundingBoxDescent || size * .25;
    return { lines, padding, lineHeight, baseline: padding + (lineHeight - ascent - descent) / 2 + ascent, height: padding * 2 + lines.length * lineHeight };
  }
  function grow(object) {
    const needed = layout(object).height;
    if (needed > object.baseHeight) {
      const scale = (object.y2 - object.y1) / object.baseHeight;
      object.baseHeight = needed; object.y2 = object.y1 + needed * scale;
    }
  }
  function node(object, element) {
    const result = element('g'), scaled = element('g', { transform: `translate(${object.x1} ${object.y1}) scale(${(object.x2-object.x1)/object.baseWidth} ${(object.y2-object.y1)/object.baseHeight})` });
    const { lines, padding, lineHeight, baseline } = layout(object);
    const text = element('text', { fill: object.color, 'font-size': object.fontSize, 'font-family': object.fontFamily, 'font-weight': '400', 'xml:space': 'preserve', style: 'white-space:pre' });
    lines.forEach((line, index) => { const span = element('tspan', { x: padding, y: baseline + index * lineHeight }); span.textContent = line; text.append(span); });
    scaled.append(text); result.append(scaled); return result;
  }
  function draw(ctx, object) {
    const { lines, padding, lineHeight, baseline } = layout(object);
    ctx.save(); ctx.translate(object.x1, object.y1); ctx.scale((object.x2-object.x1)/object.baseWidth, (object.y2-object.y1)/object.baseHeight);
    ctx.font = `${object.fontSize}px ${object.fontFamily}`; ctx.fillStyle = object.color; ctx.textBaseline = 'alphabetic';
    lines.forEach((line, index) => ctx.fillText(line, padding, baseline + index * lineHeight));
    ctx.restore();
  }
  function hit(object, point, tolerance, interior) {
    const sx = (object.x2-object.x1)/object.baseWidth, sy = (object.y2-object.y1)/object.baseHeight;
    const x = (point.x-object.x1)/sx, y = (point.y-object.y1)/sy;
    if (interior) return x >= -tolerance/sx && x <= object.baseWidth+tolerance/sx && y >= -tolerance/sy && y <= object.baseHeight+tolerance/sy;
    // Eraser intersection follows text rows; the pixel mask only removes glyphs it touches.
    const { lines, padding, lineHeight } = layout(object); measure.font = `${object.fontSize}px ${object.fontFamily}`;
    return lines.some((line, index) => line && x >= padding-tolerance/sx && x <= padding+measure.measureText(line).width+tolerance/sx && y >= padding+index*lineHeight-tolerance/sy && y <= padding+(index+1)*lineHeight+tolerance/sy);
  }
  function createEditor(surface, controls, element, onInput, onFinish) {
    const foreign = element('foreignObject', { class: 'image-annotation-text-editor' });
    const input = document.createElement('textarea');
    input.className = 'image-annotation-text-input'; input.setAttribute('aria-label', '图片标注文字');
    input.setAttribute('placeholder', '输入文字'); input.spellcheck = false;
    foreign.append(input);
    input.addEventListener('input', () => onInput(input.value));
    input.addEventListener('keydown', event => {
      event.stopPropagation();
      if (!event.isComposing && (event.key === 'Escape' || ((event.ctrlKey || event.metaKey) && event.key === 'Enter'))) { event.preventDefault(); onFinish(); }
    });
    return {
      foreign, input,
      sync(object) {
        if (!object) { foreign.remove(); return; }
        if (!foreign.isConnected) surface.insertBefore(foreign, controls);
        foreign.setAttribute('x', '0'); foreign.setAttribute('y', '0');
        foreign.setAttribute('width', object.baseWidth); foreign.setAttribute('height', object.baseHeight);
        foreign.setAttribute('transform', `translate(${object.x1} ${object.y1}) scale(${(object.x2-object.x1)/object.baseWidth} ${(object.y2-object.y1)/object.baseHeight})`);
        input.style.fontFamily = object.fontFamily; input.style.fontSize = `${object.fontSize}px`;
        input.style.lineHeight = `${object.fontSize * 1.25}px`; input.style.padding = `${object.fontSize / 6}px`;
        input.style.color = object.color;
        if (input.value !== object.text) input.value = object.text;
      },
      focus() { input.focus({ preventScroll: true }); input.setSelectionRange(input.value.length, input.value.length); }
    };
  }
  window.YanImageAnnotationText = { layout, grow, node, draw, hit, createEditor };
})();

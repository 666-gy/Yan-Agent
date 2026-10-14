(() => {
  'use strict';
  const shapes = [
    ['line', '线条', 'M5 19 19 5'],
    ['arrow', '箭头', 'M5 19 19 5M10 5h9v9'],
    ['rectangle', '矩形', 'M5 4h14v16H5Z'],
    ['ellipse', '椭圆', 'M20 12a8 8 0 1 1-16 0 8 8 0 0 1 16 0'],
    ['triangle', '三角形', 'M12 4 21 20H3Z'],
    ['diamond', '菱形', 'M12 3 22 12 12 21 2 12Z'],
    ['star', '星形', 'm12 3 2.8 5.8 6.4.9-4.6 4.5 1.1 6.4-5.7-3-5.7 3 1.1-6.4-4.6-4.5 6.4-.9Z'],
    ['heart', '心形', 'M12 21 3.6 12.6C-2 6.5 6.2-.7 12 6c5.8-6.7 14 .5 8.4 6.6Z']
  ];
  const isLine = object => ['line', 'arrow'].includes(object.type);
  const identity = [1, 0, 0, 1, 0, 0];
  function erasePath(stroke) { return path({ type: 'pen', points: stroke.points }); }
  function transformErasures(object, original, transform) {
    if (!original.erasures) return;
    const [a, b, c, d, e, f] = transform;
    object.erasures = original.erasures.map(stroke => {
      const [u, v, w, x, y, z] = stroke.matrix || identity;
      return { ...stroke, matrix: [a*u+c*v, b*u+d*v, a*w+c*x, b*w+d*x, a*y+c*z+e, b*y+d*z+f] };
    });
  }
  function isErased(ctx, object, point) {
    return (object.erasures || []).some(stroke => {
      const [a, b, c, d, e, f] = stroke.matrix || identity, determinant = a*d-b*c;
      if (Math.abs(determinant) < 1e-10) return false;
      const x = point.x-e, y = point.y-f;
      ctx.lineWidth = stroke.width;
      return ctx.isPointInStroke(new Path2D(erasePath(stroke)), (d*x-c*y)/determinant, (a*y-b*x)/determinant);
    });
  }
  function bounds(object) {
    const points = object.points || [{ x: object.x1, y: object.y1 }, { x: object.x2, y: object.y2 }];
    let left = Infinity, top = Infinity, right = -Infinity, bottom = -Infinity;
    for (const p of points) { left = Math.min(left, p.x); right = Math.max(right, p.x); top = Math.min(top, p.y); bottom = Math.max(bottom, p.y); }
    return { left, top, right, bottom, width: right - left, height: bottom - top };
  }
  function path(object) {
    if (object.type === 'pen') {
      const p = object.points;
      return `M${p[0].x} ${p[0].y}` + (p.length === 1 ? `l.01 0` : p.slice(1).map(point => `L${point.x} ${point.y}`).join(''));
    }
    const { x1, y1, x2, y2 } = object;
    if (isLine(object)) {
      let result = `M${x1} ${y1}L${x2} ${y2}`;
      if (object.type === 'arrow') {
        const angle = Math.atan2(y2 - y1, x2 - x1), size = Math.max(10, object.width * 3.5);
        for (const sign of [-1, 1]) result += `M${x2 - size * Math.cos(angle + sign * .48)} ${y2 - size * Math.sin(angle + sign * .48)}L${x2} ${y2}`;
      }
      return result;
    }
    const b = bounds(object), x = b.left, y = b.top, w = b.width, h = b.height, cx = x + w / 2, cy = y + h / 2;
    if (object.type === 'rectangle') return `M${x} ${y}H${x + w}V${y + h}H${x}Z`;
    if (object.type === 'ellipse') return `M${x} ${cy}a${w / 2} ${h / 2} 0 1 0 ${w} 0a${w / 2} ${h / 2} 0 1 0 ${-w} 0`;
    if (object.type === 'triangle') return `M${cx} ${y}L${x + w} ${y + h}H${x}Z`;
    if (object.type === 'diamond') return `M${cx} ${y}L${x + w} ${cy} ${cx} ${y + h} ${x} ${cy}Z`;
    if (object.type === 'heart') return `M${cx} ${y + h}C${x - w * .4} ${y + h * .35} ${x + w * .08} ${y - h * .38} ${cx} ${y + h * .22}C${x + w * .92} ${y - h * .38} ${x + w * 1.4} ${y + h * .35} ${cx} ${y + h}Z`;
    if (object.type === 'star') {
      const vertices = Array.from({ length: 10 }, (_, index) => {
        const angle = -Math.PI / 2 + index * Math.PI / 5, radius = index % 2 ? .45 : 1;
        return `${cx + Math.cos(angle) * w / 2 * radius} ${cy + Math.sin(angle) * h / 2 * radius}`;
      });
      return `M${vertices.join('L')}Z`;
    }
    return '';
  }
  function draw(ctx, objects) {
    ctx.save(); ctx.lineCap = ctx.lineJoin = 'round';
    let scratch;
    for (const object of objects) {
      let target = ctx;
      if (object.erasures?.length) {
        scratch ||= document.createElement('canvas');
        if (scratch.width !== ctx.canvas.width || scratch.height !== ctx.canvas.height) { scratch.width = ctx.canvas.width; scratch.height = ctx.canvas.height; }
        target = scratch.getContext('2d'); target.clearRect(0, 0, scratch.width, scratch.height);
      }
      target.lineCap = target.lineJoin = 'round'; target.strokeStyle = object.color; target.lineWidth = object.width;
      if (object.type === 'text') window.YanImageAnnotationText.draw(target, object);
      else target.stroke(new Path2D(path(object)));
      if (object.erasures?.length) {
        target.save(); target.globalCompositeOperation = 'destination-out';
        for (const stroke of object.erasures) {
          target.save(); target.transform(...(stroke.matrix || identity)); target.lineWidth = stroke.width;
          target.stroke(new Path2D(erasePath(stroke))); target.restore();
        }
        target.restore(); ctx.drawImage(scratch, 0, 0);
      }
    }
    ctx.restore();
  }
  function hit(ctx, object, point, tolerance, interior = true, respectErasures = true) {
    ctx.lineCap = ctx.lineJoin = 'round';
    if (respectErasures && isErased(ctx, object, point)) return false;
    if (object.type === 'text') return window.YanImageAnnotationText.hit(object, point, tolerance, interior);
    ctx.lineWidth = object.width + tolerance * 2;
    const shape = new Path2D(path(object));
    return ctx.isPointInStroke(shape, point.x, point.y) || (interior && object.type !== 'pen' && !isLine(object) && ctx.isPointInPath(shape, point.x, point.y));
  }
  function translate(object, dx, dy) {
    transformErasures(object, object, [1, 0, 0, 1, dx, dy]);
    if (object.points) object.points = object.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    else { object.x1 += dx; object.x2 += dx; object.y1 += dy; object.y2 += dy; }
  }
  function handles(object) {
    if (isLine(object)) return [['start', object.x1, object.y1], ['end', object.x2, object.y2]];
    const b = bounds(object);
    if (object.type === 'text') return [['nw',b.left,b.top], ['n',(b.left+b.right)/2,b.top], ['ne',b.right,b.top], ['e',b.right,(b.top+b.bottom)/2], ['se',b.right,b.bottom], ['s',(b.left+b.right)/2,b.bottom], ['sw',b.left,b.bottom], ['w',b.left,(b.top+b.bottom)/2]];
    return [['nw', b.left, b.top], ['ne', b.right, b.top], ['se', b.right, b.bottom], ['sw', b.left, b.bottom]];
  }
  function resize(object, original, handle, point) {
    if (object.type === 'text') {
      const b = bounds(original), minimum = 8;
      const left = handle.includes('w') ? Math.min(point.x, b.right-minimum) : b.left;
      const right = handle.includes('e') ? Math.max(point.x, b.left+minimum) : b.right;
      const top = handle.includes('n') ? Math.min(point.y, b.bottom-minimum) : b.top;
      const bottom = handle.includes('s') ? Math.max(point.y, b.top+minimum) : b.bottom;
      const sx = (right-left)/b.width, sy = (bottom-top)/b.height;
      transformErasures(object, original, [sx,0,0,sy,left-sx*b.left,top-sy*b.top]);
      Object.assign(object, { x1: left, y1: top, x2: right, y2: bottom });
      return;
    }
    if (isLine(object)) {
      const suffix = handle === 'start' ? '1' : '2'; object[`x${suffix}`] = point.x; object[`y${suffix}`] = point.y;
      const ox = original.x2-original.x1, oy = original.y2-original.y1, nx = object.x2-object.x1, ny = object.y2-object.y1;
      const length = ox*ox+oy*oy;
      if (length > 1e-8) {
        const a = (nx*ox+ny*oy)/length, b = (ny*ox-nx*oy)/length;
        transformErasures(object, original, [a, b, -b, a, object.x1-a*original.x1+b*original.y1, object.y1-b*original.x1-a*original.y1]);
      }
      return;
    }
    const b = bounds(original), anchorX = handle.includes('w') ? b.right : b.left, anchorY = handle.includes('n') ? b.bottom : b.top;
    const originX = handle.includes('w') ? b.left : b.right, originY = handle.includes('n') ? b.top : b.bottom;
    const sx = Math.abs(originX - anchorX) < .001 ? 1 : (point.x - anchorX) / (originX - anchorX);
    const sy = Math.abs(originY - anchorY) < .001 ? 1 : (point.y - anchorY) / (originY - anchorY);
    transformErasures(object, original, [sx, 0, 0, sy, anchorX*(1-sx), anchorY*(1-sy)]);
    if (original.points) {
      object.points = original.points.map(p => ({ x: anchorX + (p.x - anchorX) * sx, y: anchorY + (p.y - anchorY) * sy }));
    } else { object.x1 = anchorX; object.y1 = anchorY; object.x2 = point.x; object.y2 = point.y; }
  }
  window.YanImageAnnotationGeometry = { shapes, isLine, bounds, path, erasePath, draw, hit, translate, handles, resize };
})();

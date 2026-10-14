'use strict';
// Feedback follows the real system pointer; no second cursor or idle animation.
const canvas = document.getElementById('pointer-feedback');
const ctx = canvas.getContext('2d');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
let last, points = [], clicks = [], frame;
function resize() {
  canvas.width = innerWidth * devicePixelRatio;
  canvas.height = innerHeight * devicePixelRatio;
  ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
}
addEventListener('resize', resize); resize();
window.controlPointerFeedback = event => {
  const now = performance.now();
  if (event.type === 'click') clicks.push({ ...event, time: now });
  if (event.type === 'move' && last && !reducedMotion.matches
    && Math.hypot(event.x - last.x, event.y - last.y) > 1) {
    points.push({ x: last.x, y: last.y, toX: event.x, toY: event.y, time: now });
  }
  last = event;
  if (!frame && (points.length || clicks.length)) frame = requestAnimationFrame(draw);
};
function draw(now) {
  frame = null;
  ctx.clearRect(0, 0, innerWidth, innerHeight);
  points = points.filter(p => now - p.time < 180);
  clicks = clicks.filter(p => now - p.time < 480);
  ctx.lineCap = 'round';
  for (const p of points) {
    ctx.globalAlpha = (1 - (now - p.time) / 180) * .45;
    ctx.strokeStyle = '#58bfff'; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.toX, p.toY); ctx.stroke();
  }
  for (const p of clicks) {
    const progress = (now - p.time) / 480;
    ctx.globalAlpha = 1 - progress;
    ctx.strokeStyle = '#75d2ff'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(p.x, p.y, reducedMotion.matches ? 14 : 8 + progress * 25, 0, Math.PI * 2); ctx.stroke();
    ctx.fillStyle = '#39adff'; ctx.globalAlpha *= .25; ctx.fill();
  }
  ctx.globalAlpha = 1;
  if (points.length || clicks.length) frame = requestAnimationFrame(draw);
}

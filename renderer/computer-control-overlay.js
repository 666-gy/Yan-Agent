'use strict';

const $ = (sel) => document.querySelector(sel);

function setGlow(active) {
  $('#overlayGlow').classList.toggle('hidden', !active);
}

function setTopText(text) {
  const el = $('#overlayTopText');
  if (el && text) el.textContent = text;
}

function setTargetBounds(bounds) {
  const border = $('#overlayTargetBorder');
  if (!bounds || !bounds.visible) {
    border.classList.add('hidden');
    return;
  }
  border.classList.remove('hidden');
  border.style.left = `${bounds.x}px`;
  border.style.top = `${bounds.y}px`;
  border.style.width = `${bounds.width}px`;
  border.style.height = `${bounds.height}px`;
}

window.electronAPI?.receive('computer:overlay:bounds', (bounds) => {
  setTargetBounds(bounds);
});

window.electronAPI?.receive('computer:overlay:state', (state) => {
  setGlow(state.glow !== false);
  setTopText(state.text || '');
  setTargetBounds(state.bounds);
});

setGlow(true);

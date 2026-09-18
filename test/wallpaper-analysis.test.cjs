'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { computeWallpaperMetrics, resolveWallpaperPath } = require('../lib/wallpaper-analysis');

function solid(width, height, [r, g, b], { bgra = false } = {}) {
  const pixels = Buffer.alloc(width * height * 4);
  const count = width * height;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    pixels[offset] = bgra ? b : r;
    pixels[offset + 1] = g;
    pixels[offset + 2] = bgra ? r : b;
    pixels[offset + 3] = 255;
  }
  return pixels;
}

test('pure red reads as hue 0 with full saturation and the sRGB red luminance', () => {
  const metrics = computeWallpaperMetrics(solid(4, 4, [255, 0, 0]), 4, 4);
  assert.equal(metrics.hue, 0);
  assert.ok(metrics.sat > 0.95, `sat=${metrics.sat}`);
  assert.ok(Math.abs(metrics.luma - 0.2126) < 0.01, `luma=${metrics.luma}`);
  assert.equal(metrics.colorful, true);
});

test('BGRA channel order is honored', () => {
  const metrics = computeWallpaperMetrics(solid(4, 4, [255, 0, 0], { bgra: true }), 4, 4, { bgra: true });
  assert.equal(metrics.hue, 0);
  assert.ok(Math.abs(metrics.luma - 0.2126) < 0.01, `luma=${metrics.luma}`);
});

test('neutral grey reports no dominant hue and zero saturation', () => {
  const metrics = computeWallpaperMetrics(solid(4, 4, [128, 128, 128]), 4, 4);
  assert.equal(metrics.hue, -1);
  assert.equal(metrics.sat, 0);
  assert.equal(metrics.colorful, false);
  assert.ok(metrics.luma > 0.2 && metrics.luma < 0.23, `luma=${metrics.luma}`);
});

test('pure blue reads as hue 240', () => {
  const metrics = computeWallpaperMetrics(solid(4, 4, [0, 0, 255]), 4, 4);
  assert.equal(metrics.hue, 240);
});

test('missing pixels fall back to neutral metrics', () => {
  assert.deepEqual(computeWallpaperMetrics(null, 4, 4), { luma: 0.5, hue: -1, sat: 0, colorful: false });
});

test('resolveWallpaperPath allows built-in wallpapers and blocks outside files', () => {
  const rendererRoot = 'C:\\app\\renderer';
  const uploads = 'C:\\data\\uploads';
  const builtIn = resolveWallpaperPath('assets/wallpapers/%E5%89%91%E4%B8%8E%E6%A8%B1.jpg', { rendererRoot, roots: [] });
  assert.equal(builtIn, 'C:\\app\\renderer\\assets\\wallpapers\\剑与樱.jpg');
  const outside = resolveWallpaperPath('C:\\Windows\\win.ini', { rendererRoot, roots: [uploads] });
  assert.equal(outside, '');
  const uploaded = resolveWallpaperPath('file:///C:/data/uploads/w1.png', { rendererRoot, roots: [uploads] });
  assert.ok(uploaded.toLowerCase().endsWith('w1.png'), `uploaded=${uploaded}`);
  const remote = resolveWallpaperPath('https://example.com/w.jpg', { rendererRoot, roots: [uploads] });
  assert.equal(remote, '');
});

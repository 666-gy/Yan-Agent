'use strict';

// Wallpaper compatibility analysis.
//
// The renderer asks the main process for compact metrics (average luminance,
// dominant hue, saturation) of the active wallpaper so surfaces, scrims and
// accents can adapt to it. Pixel math lives here so it can be unit-tested
// without Electron; only `analyzeWallpaperSource` touches nativeImage.

const path = require('path');
const { fileURLToPath } = require('url');

const SAMPLE_SIZE = 32;

function clamp01(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.min(1, number));
}

function srgbToLinear(channel) {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

/**
 * Average relative luminance + dominant hue/saturation of a raw bitmap.
 * `pixels` is RGBA by default; pass `{ bgra: true }` for
 * nativeImage.toBitmap() data (BGRA on little-endian).
 */
function computeWallpaperMetrics(pixels, width, height, options = {}) {
  const columns = Math.max(0, Math.floor(Number(width) || 0));
  const rows = Math.max(0, Math.floor(Number(height) || 0));
  const count = columns * rows;
  if (!pixels || !count || pixels.length < count * 4) {
    return { luma: 0.5, hue: -1, sat: 0, colorful: false };
  }
  const bgra = options.bgra === true;
  let lumaSum = 0;
  let satSum = 0;
  let hueX = 0;
  let hueY = 0;
  let hueWeight = 0;
  for (let index = 0; index < count; index += 1) {
    const offset = index * 4;
    const first = pixels[offset];
    const second = pixels[offset + 1];
    const third = pixels[offset + 2];
    const r = bgra ? third : first;
    const g = second;
    const b = bgra ? first : third;
    lumaSum += 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const chroma = max - min;
    satSum += max > 0 ? chroma / max : 0;
    if (chroma < 18) continue;
    let hue;
    if (max === r) hue = ((g - b) / chroma) % 6;
    else if (max === g) hue = (b - r) / chroma + 2;
    else hue = (r - g) / chroma + 4;
    hue *= 60;
    if (hue < 0) hue += 360;
    const weight = chroma / 255;
    hueX += Math.cos((hue * Math.PI) / 180) * weight;
    hueY += Math.sin((hue * Math.PI) / 180) * weight;
    hueWeight += weight;
  }
  let hue = -1;
  if (hueWeight > count * 0.02) {
    hue = Math.round(((Math.atan2(hueY, hueX) * 180) / Math.PI + 360) % 360);
  }
  return {
    luma: clamp01(lumaSum / count),
    hue,
    sat: clamp01(satSum / count),
    colorful: hue >= 0
  };
}

/** Resolve a renderer-supplied wallpaper source into an allowed local file. */
function resolveWallpaperPath(source, options = {}) {
  const value = String(source || '').trim();
  if (!value) return '';
  if (/^assets\/wallpapers\//i.test(value)) {
    if (!options.rendererRoot) return '';
    try {
      // Only the built-in wallpaper folder is reachable through this branch.
      return path.join(
        options.rendererRoot,
        ...value.split('/').filter(Boolean).map(part => decodeURIComponent(part))
      );
    } catch {
      return '';
    }
  }
  let candidate = '';
  if (/^file:/i.test(value)) {
    try {
      candidate = fileURLToPath(value);
    } catch {
      return '';
    }
  } else if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
    candidate = value;
  } else {
    return '';
  }
  const resolved = path.resolve(candidate);
  const roots = (Array.isArray(options.roots) ? options.roots : [])
    .map(root => path.resolve(String(root || '')).toLowerCase());
  const inside = roots.some(root => resolved.toLowerCase().startsWith(`${root}${path.sep}`) || resolved.toLowerCase() === root);
  return inside ? resolved : '';
}

function loadNativeImage() {
  try {
    const electron = require('electron');
    return electron?.nativeImage || null;
  } catch {
    return null;
  }
}

function analyzeWallpaperFile(filePath) {
  const nativeImage = loadNativeImage();
  if (!nativeImage || !filePath) return null;
  const image = nativeImage.createFromPath(filePath);
  if (!image || image.isEmpty()) return null;
  const size = image.getSize();
  if (!size.width || !size.height) return null;
  const resized = image.resize({ width: SAMPLE_SIZE, height: SAMPLE_SIZE, quality: 'good' });
  const bitmap = resized.toBitmap();
  const resizedSize = resized.getSize();
  return computeWallpaperMetrics(bitmap, resizedSize.width, resizedSize.height, { bgra: true });
}

/**
 * Analyze a wallpaper source as sent by the renderer.
 * `context = { rendererRoot, roots }` restricts reads to the built-in
 * wallpaper folder and the uploads folder.
 */
function analyzeWallpaperSource(source, context = {}) {
  const filePath = resolveWallpaperPath(source, context);
  if (!filePath) return { ok: false, error: 'unsupported-source' };
  const metrics = analyzeWallpaperFile(filePath);
  if (!metrics) return { ok: false, error: 'unreadable-image' };
  return {
    ok: true,
    luma: metrics.luma,
    hue: metrics.hue,
    sat: metrics.sat,
    colorful: metrics.colorful
  };
}

module.exports = {
  SAMPLE_SIZE,
  analyzeWallpaperSource,
  computeWallpaperMetrics,
  resolveWallpaperPath
};

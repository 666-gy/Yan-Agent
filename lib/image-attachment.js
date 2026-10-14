'use strict';

// OpenCode resizes oversized JPEGs to PNG first. Photographs can consequently
// grow several times larger on the wire and are replayed on every tool turn.
// Resize JPEGs before entering the kernel, keeping its 2000px geometry limit
// and the JPEG encoding. The original attachment on disk is never changed.
function resizedJpegAttachment(filePath, filename, mime, { nativeImage } = {}) {
  if (mime !== 'image/jpeg') return null;
  try {
    nativeImage ||= require('electron').nativeImage;
    if (!nativeImage) return null;
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) return null;
    const { width, height } = image.getSize();
    const scale = Math.min(1, 2000 / width, 2000 / height);
    if (scale === 1) return null;
    const resized = image.resize({ width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)), quality: 'best' });
    const bytes = resized.toJPEG(90);
    // Stay inside the kernel's existing 5 MiB base64 limit. Its normalizer
    // remains responsible for unusual images and decoding/size failures.
    if (!bytes.length || Math.ceil(bytes.length / 3) * 4 > 5 * 1024 * 1024) return null;
    return { type: 'file', mime: 'image/jpeg', filename,
      url: `data:image/jpeg;base64,${bytes.toString('base64')}` };
  } catch {
    return null;
  }
}

module.exports = { resizedJpegAttachment };

'use strict';

const { parentPort, workerData } = require('node:worker_threads');
const fs = require('node:fs');
const photon = require('@silvia-odwyer/photon-node');
const { MAX_INLINE_IMAGE_BYTES } = require('../attachment-policy');

try {
  const decoded = photon.PhotonImage.new_from_byteslice(fs.readFileSync(workerData.path));
  try {
    const scale = Math.min(1, 2000 / decoded.get_width(), 2000 / decoded.get_height());
    let width = Math.max(1, Math.round(decoded.get_width() * scale));
    let height = Math.max(1, Math.round(decoded.get_height() * scale));
    let result;
    for (let attempt = 0; attempt < 16 && !result; attempt++) {
      const resized = photon.resize(decoded, width, height, photon.SamplingFilter.Lanczos3);
      try {
        for (const mime of ['image/png', 'image/jpeg']) {
          const bytes = mime === 'image/png' ? resized.get_bytes() : resized.get_bytes_jpeg(85);
          if (bytes.length && Math.ceil(bytes.length / 3) * 4 <= MAX_INLINE_IMAGE_BYTES) {
            const output = workerData.path + (mime === 'image/png' ? '.vision.png' : '.vision.jpg');
            fs.writeFileSync(output, bytes, { flag: 'wx' });
            result = { inlinePath: output, inlineMimeType: mime };
            break;
          }
        }
      } finally { resized.free(); }
      width = Math.max(1, Math.floor(width * 0.75));
      height = Math.max(1, Math.floor(height * 0.75));
    }
    if (!result) throw new Error('图片压缩失败');
    parentPort.postMessage(result);
  } finally { decoded.free(); }
} catch (error) {
  parentPort.postMessage({ error: `图片无法解码或压缩：${error.message || error}` });
}

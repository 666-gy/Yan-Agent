'use strict';

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Transform } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { Worker } = require('node:worker_threads');
const { sanitizeUploadName } = require('./upload-store');
const { checkAttachmentSize, isImageAttachment } = require('../attachment-policy');

function compressImage(file) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(path.join(__dirname, 'attachment-image-worker.js'), { workerData: { path: file } });
    const timeout = setTimeout(() => {
      received = true;
      void worker.terminate().then(() => reject(new Error('图片处理超时，请缩小图片后重试')), reject);
    }, 60000);
    let received = false;
    worker.once('message', result => {
      received = true; clearTimeout(timeout);
      result.error ? reject(new Error(result.error)) : resolve(result);
    });
    worker.once('error', error => { clearTimeout(timeout); reject(error); });
    worker.once('exit', () => { clearTimeout(timeout); if (!received) reject(new Error('图片处理进程已退出')); });
  });
}

function createAttachmentUploader({ filesDir }) {
  let queue = Promise.resolve();
  async function upload({ name, sourcePath, data, mimeType = '' }, progress = () => {}) {
    const safeName = sanitizeUploadName(name);
    await fsp.mkdir(filesDir, { recursive: true });
    const target = path.join(filesDir, `${Date.now()}_${crypto.randomUUID()}_${safeName}`);
    let written = 0;
    try {
      if (sourcePath) {
        const stat = await fsp.stat(sourcePath);
        if (!stat.isFile()) throw new Error('只能上传普通文件');
        checkAttachmentSize(stat.size);
        progress(0);
        let last = -1;
        const meter = new Transform({ transform(chunk, _encoding, done) {
          written += chunk.length;
          try {
            checkAttachmentSize(written);
            const percent = Math.min(99, Math.floor(written / Math.max(stat.size, 1) * 100));
            if (percent !== last) { last = percent; progress(percent); }
            done(null, chunk);
          } catch (error) { done(error); }
        } });
        await pipeline(fs.createReadStream(sourcePath), meter, fs.createWriteStream(target, { flags: 'wx' }));
      } else {
        // Clipboard/generated blobs have no native path. Bound the legacy IPC
        // payload before decoding; disk-backed files always use the stream above.
        const b64 = String(data || '');
        if (b64.length > Math.ceil(20 * 1024 * 1024 / 3) * 4) throw new Error('无本地路径的附件不能超过 20 MiB，请保存为文件后添加');
        const buffer = Buffer.from(b64, 'base64');
        checkAttachmentSize(buffer.length);
        written = buffer.length;
        await fsp.writeFile(target, buffer, { flag: 'wx' });
      }
      const meta = { name: safeName, path: target, size: written, mimeType: String(mimeType), mode: 'reference' };
      if (isImageAttachment(meta)) {
        Object.assign(meta, await compressImage(target), { mode: 'inline' });
      }
      progress(100);
      return meta;
    } catch (error) {
      await Promise.all([target, target + '.vision.png', target + '.vision.jpg'].map(file => fsp.unlink(file).catch(() => {})));
      throw error;
    }
  }
  return (payload, progress) => {
    const operation = queue.then(() => upload(payload, progress));
    queue = operation.catch(() => {});
    return operation;
  };
}

module.exports = { createAttachmentUploader };

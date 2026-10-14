const test = require('node:test');
const assert = require('node:assert/strict');
const { resizedJpegAttachment } = require('../lib/image-attachment');

test('oversized JPEG stays JPEG within kernel geometry instead of expanding into PNG', () => {
  let geometry, quality;
  const bytes = Buffer.from('resized-jpeg');
  const nativeImage = { createFromPath: () => ({ isEmpty: () => false,
    getSize: () => ({ width: 2358, height: 1294 }), resize: options => {
      geometry = options;
      return { toJPEG: value => { quality = value; return bytes; } };
    } }) };
  const part = resizedJpegAttachment('fixture.jpg', 'fixture.jpg', 'image/jpeg', { nativeImage });
  assert.deepEqual(geometry, { width: 2000, height: 1098, quality: 'best' });
  assert.equal(quality, 90);
  assert.equal(part.mime, 'image/jpeg');
  assert.deepEqual(Buffer.from(part.url.split(',')[1], 'base64'), bytes);
});

test('small JPEG, PNG, unavailable decoder and oversized output retain the kernel fallback', () => {
  const nativeImage = { createFromPath: () => ({ isEmpty: () => false,
    getSize: () => ({ width: 800, height: 1200 }), resize: () => { throw new Error('must not resize'); } }) };
  assert.equal(resizedJpegAttachment('fixture.jpg', 'fixture.jpg', 'image/jpeg', { nativeImage }), null);
  assert.equal(resizedJpegAttachment('fixture.png', 'fixture.png', 'image/png', { nativeImage }), null);
  assert.equal(resizedJpegAttachment('fixture.jpg', 'fixture.jpg', 'image/jpeg', { nativeImage: { createFromPath() { throw new Error('decode failed'); } } }), null);
  nativeImage.createFromPath = () => ({ isEmpty: () => false, getSize: () => ({ width: 4000, height: 2000 }),
    resize: () => ({ toJPEG: () => Buffer.alloc(4 * 1024 * 1024) }) });
  assert.equal(resizedJpegAttachment('fixture.jpg', 'fixture.jpg', 'image/jpeg', { nativeImage }), null);
});

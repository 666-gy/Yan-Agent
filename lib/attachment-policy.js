'use strict';

const MAX_ATTACHMENT_BYTES = 320 * 1024 * 1024;
const MAX_TURN_ATTACHMENT_BYTES = 640 * 1024 * 1024;
const MAX_INLINE_IMAGE_BYTES = 2 * 1024 * 1024; // Encoded base64 budget.

function isImageAttachment(item = {}) {
  return item.kind !== 'directory' && (item.kind === 'image' || /^image\//i.test(item.mimeType || '') || /\.(png|jpe?g|webp|gif)$/i.test(item.name || item.path || ''));
}

function checkAttachmentSize(size) {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error('附件大小无效');
  if (size > MAX_ATTACHMENT_BYTES) throw new Error('单个附件不能超过 320 MiB');
}

module.exports = { MAX_ATTACHMENT_BYTES, MAX_TURN_ATTACHMENT_BYTES, MAX_INLINE_IMAGE_BYTES, isImageAttachment, checkAttachmentSize };

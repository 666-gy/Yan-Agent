'use strict';
const fs = require('node:fs');
const crypto = require('node:crypto');
const MIN = 32 * 1024, MAX = 512 * 1024, MASK = 131071;
// Deterministic content-defined boundaries survive insertions and file shifts.
const gear = Array.from({ length: 256 }, (_, i) => crypto.createHash('sha256').update(`yan-chunk-v1:${i}`).digest().readUInt32LE());
const digest = data => crypto.createHash('sha256').update(data).digest('hex');
async function indexFile(file) {
  const chunks = [], full = crypto.createHash('sha512');
  let pending = Buffer.allocUnsafe(MAX), length = 0, rolling = 0, offset = 0;
  const flush = () => {
    chunks.push({ offset, size: length, sha256: digest(pending.subarray(0, length)) });
    offset += length; length = 0; rolling = 0;
  };
  for await (const data of fs.createReadStream(file)) {
    full.update(data);
    for (const byte of data) {
      pending[length++] = byte; rolling = ((rolling << 1) + gear[byte]) >>> 0;
      if (length >= MIN && ((rolling & MASK) === 0 || length === MAX)) flush();
    }
  }
  if (length) flush();
  return { schemaVersion: 1, algorithm: 'yan-gear-sha256-v1', size: offset, sha512: full.digest('base64'), chunks };
}
function validateIndex(index, size, sha512) {
  if (index?.schemaVersion !== 1 || index.algorithm !== 'yan-gear-sha256-v1'
    || !Number.isSafeInteger(size) || size <= 0 || size > 8 * 1024 ** 3
    || index.size !== size || index.sha512 !== sha512 || !/^[A-Za-z0-9+/]{86}==$/.test(sha512)
    || !Array.isArray(index.chunks) || index.chunks.length > 262144) throw new Error('Invalid update chunk index');
  let end = 0;
  for (const chunk of index.chunks) {
    if (chunk.offset !== end || !Number.isInteger(chunk.size) || chunk.size < 1 || chunk.size > MAX
      || !/^[a-f0-9]{64}$/.test(chunk.sha256)) throw new Error('Invalid update chunk range');
    end += chunk.size;
  }
  if (end !== size) throw new Error('Incomplete update chunk index');
  return index;
}
module.exports = { indexFile, validateIndex, digest, MAX };

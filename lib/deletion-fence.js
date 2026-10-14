'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Empty hash markers contain no conversation content. They prevent delayed
// writers (including those restored after a crash) from recreating deleted IDs.
function createDeletionFence(root) {
  const directory = path.join(root, '.deleted');
  const marker = id => path.join(directory, crypto.createHash('sha256').update(process.platform === 'win32' ? String(id).trim().toLowerCase() : String(id).trim()).digest('hex'));
  return {
    has(id) {
      try { fs.statSync(marker(id)); return true; }
      catch (error) { if (error.code === 'ENOENT') return false; throw error; }
    },
    mark(id) {
      fs.mkdirSync(directory, { recursive: true });
      const fd = fs.openSync(marker(id), 'a');
      try { fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    }
  };
}
module.exports = { createDeletionFence };

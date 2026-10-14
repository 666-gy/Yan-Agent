'use strict';

// Upload store (plan T3.6): where user attachments live and which paths the
// app is allowed to read back. Pure path logic, no Electron dependency.

const path = require('path');

function sanitizeUploadName(name) {
  const base = path.basename(String(name || 'attachment'));
  return base.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'attachment';
}

function createUploadStore({ filesDir }) {
  // Uploaded attachments may be edited or re-read only inside the uploads dir.
  function resolveStoredUploadPath(filePath) {
    const resolved = path.resolve(String(filePath || ''));
    const relative = path.relative(path.resolve(filesDir), resolved);
    if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return null;
    return resolved;
  }

  return Object.freeze({ filesDir, resolveStoredUploadPath });
}

module.exports = { createUploadStore, sanitizeUploadName };

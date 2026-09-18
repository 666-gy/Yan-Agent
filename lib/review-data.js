'use strict';

// Shared by the renderer and IPC. A manifest must never touch/copy patches,
// rows, images or original documents, even when the persisted run has them.
(() => {
  function projectReviewSummary(summary, { includeDiff = false, paths = null } = {}) {
    if (!Array.isArray(summary?.files)) return null;
    const selected = Array.isArray(paths) && paths.length
      ? new Set(paths.map(value => String(value || '').replace(/\\/g, '/')))
      : null;
    const files = [];
    for (const item of summary.files) {
      const path = String(item?.path || item?.file || '').replace(/\\/g, '/');
      if (!path || (selected && !selected.has(path))) continue;
      const file = {
        path,
        status: String(item.status || 'modified'),
        additions: Math.max(0, Number(item.additions) || 0),
        deletions: Math.max(0, Number(item.deletions) || 0)
      };
      for (const key of ['oldPath', 'newPath', 'binary', 'partial']) {
        if (item[key] != null) file[key] = item[key];
      }
      if (includeDiff) {
        if (item.diff) file.diff = item.diff;
        if (item.patch) file.patch = item.patch;
      }
      files.push(file);
    }
    return {
      source: summary.source || 'opencode',
      count: files.length,
      additions: files.reduce((total, file) => total + file.additions, 0),
      deletions: files.reduce((total, file) => total + file.deletions, 0),
      files
    };
  }

  const api = { projectReviewSummary };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else globalThis.YanReviewData = api;
})();

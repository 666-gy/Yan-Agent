/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
async function getRunWorkspace(runCtx) {
  if (runCtx && runCtx.workspace !== undefined) return runCtx.workspace;
  return api().getWorkspace();
}

/**
 * Resolve relative paths against this run's workspace.
 * Absolute paths are kept but main-process sandbox still enforces workspace containment.
 */
async function resolveWorkspacePath(filePath, runCtx) {
  const p = String(filePath || '').trim();
  if (!p) return p;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\') || p.startsWith('/')) {
    // Absolute: return as-is; main process will reject escapes.
    return p.replace(/\//g, p.includes('\\') || /^[a-zA-Z]:/.test(p) ? '\\' : '/');
  }
  // Reject obvious traversal in relative form early (defense in depth).
  const segments = p.replace(/\\/g, '/').split('/').filter(Boolean);
  if (segments.some(seg => seg === '..') && runCtx?.accessMode !== 'full') {
    const err = new Error(`Path escapes workspace: ${p}`);
    err.code = 'PATH_ESCAPE';
    throw err;
  }
  const ws = await getRunWorkspace(runCtx);
  if (!ws) return p;
  const sep = ws.includes('\\') ? '\\' : '/';
  const base = ws.replace(/[\\/]+$/, '');
  const rel = p.replace(/^[\\/]+/, '').replace(/\//g, sep);
  return `${base}${sep}${rel}`;
}

/**
 * Safe resolve that returns tool-error shaped failure instead of throw.
 */
async function resolveWorkspacePathSafe(filePath, runCtx) {
  try {
    const resolved = await resolveWorkspacePath(filePath, runCtx);
    return { ok: true, path: resolved };
  } catch (error) {
    return {
      ok: false,
      error: error?.message || String(error),
      code: error?.code || 'PATH_ESCAPE'
    };
  }
}

  K.getRunWorkspace = getRunWorkspace;
  K.resolveWorkspacePath = resolveWorkspacePath;
  K.resolveWorkspacePathSafe = resolveWorkspacePathSafe;
})(window.YanKernel);

/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
async function getRunWorkspace(runCtx) {
  if (runCtx && runCtx.workspace !== undefined) return runCtx.workspace;
  return api().getWorkspace();
}

// 相对路径统一解析到本轮任务的 workspace root。
async function resolveWorkspacePath(filePath, runCtx) {
  const p = String(filePath || '').trim();
  if (!p) return p;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) return p;
  const ws = await getRunWorkspace(runCtx);
  if (!ws) return p;
  const sep = ws.includes('\\') ? '\\' : '/';
  const base = ws.replace(/[\\/]+$/, '');
  const rel = p.replace(/^[\\/]+/, '').replace(/\//g, sep);
  return `${base}${sep}${rel}`;
}
  K.getRunWorkspace = getRunWorkspace;
  K.resolveWorkspacePath = resolveWorkspacePath;
})(window.YanKernel);

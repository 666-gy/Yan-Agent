/* Yan Agent — kernel module */
(function (K) {
  'use strict';
  const deps = () => K._deps;
  const api = () => deps().api;
// 相对路径统一解析到 workspace root，避免模型传 src/foo.ts 时读写失败
async function resolveWorkspacePath(filePath) {
  const p = String(filePath || '').trim();
  if (!p) return p;
  if (/^[a-zA-Z]:[\\/]/.test(p) || p.startsWith('\\\\')) return p;
  const ws = await api().getWorkspace();
  if (!ws) return p;
  const sep = ws.includes('\\') ? '\\' : '/';
  const base = ws.replace(/[\\/]+$/, '');
  const rel = p.replace(/^[\\/]+/, '').replace(/\//g, sep);
  return `${base}${sep}${rel}`;
}
  K.resolveWorkspacePath = resolveWorkspacePath;
})(window.YanKernel);

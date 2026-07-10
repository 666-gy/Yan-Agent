/* Yan Agent — kernel bootstrap */
window.YanKernel = window.YanKernel || {};
window.YanKernel._deps = null;
window.YanKernel.init = function (deps) {
  if (!deps || !deps.api) throw new Error('YanKernel.init requires deps.api');
  this._deps = deps;
};

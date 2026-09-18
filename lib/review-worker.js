'use strict';

const { Worker, isMainThread, parentPort } = require('node:worker_threads');

if (!isMainThread) {
  const changes = require('./run-change-summary');
  const caches = new Map();
  parentPort.on('message', async ({ id, operation, args }) => {
    try {
      let result;
      if (operation === 'toolChanges') {
        const [workspace, messages, options] = args;
        if (options.cacheKey) {
          const key = `${options.cacheKey}:${options.includeDiff !== false}`;
          if (!caches.has(key)) caches.set(key, new Map());
          options.cache = caches.get(key);
          if (caches.size > 8) caches.delete(caches.keys().next().value);
        }
        if (options.sweep) {
          options.baselines = await changes.collectWorkspaceFileSweep(workspace, { startTime: options.startTime, paths: options.paths });
        }
        result = await changes.summarizeOpenCodeToolChanges(workspace, messages, options);
      } else if (operation === 'openCodeDiffs') result = changes.summarizeOpenCodeDiffs(...args);
      else if (operation === 'legacyChanges') result = await changes.summarizeRunChanges(...args);
      else if (operation === 'gitReview') result = await require('./git-service').review(...args);
      else throw new Error('Unknown review operation');
      parentPort.postMessage({ id, result });
    } catch (error) {
      parentPort.postMessage({ id, error: error?.message || String(error) });
    }
  });
} else {
  // One worker bounds simultaneous diff computation. It is released when idle
  // and cannot keep Electron alive. Failed jobs leave the queue usable.
  let worker = null;
  let active = null;
  let sequence = 0;
  let idleTimer = null;
  const queue = [];

  function finish(error, result) {
    const job = active;
    if (!job) return;
    active = null;
    clearTimeout(job.timer);
    if (error) job.reject(error);
    else job.resolve(result);
    pump();
  }

  function pump() {
    if (active) return;
    clearTimeout(idleTimer);
    if (!queue.length) {
      idleTimer = setTimeout(() => {
        const idle = worker;
        worker = null;
        void idle?.terminate();
      }, 5000);
      idleTimer.unref();
      worker?.unref();
      return;
    }
    if (!worker) {
      const current = new Worker(__filename, { resourceLimits: { maxOldGenerationSizeMb: 256 } });
      worker = current;
      current.on('message', message => {
        if (worker !== current || active?.id !== message.id) return;
        finish(message.error ? new Error(message.error) : null, message.result);
      });
      const failed = error => {
        if (worker !== current) return;
        worker = null;
        void current.terminate();
        finish(error);
      };
      current.on('error', failed);
      current.on('exit', code => failed(new Error(`审阅计算进程已退出 (${code})`)));
    }
    const current = worker;
    const job = queue.shift();
    active = job;
    current.ref();
    job.timer = setTimeout(() => {
      if (worker !== current || active !== job) return;
      worker = null;
      void current.terminate();
      finish(new Error('审阅计算超时，请选择单个文件查看。'));
    }, 30_000);
    try { current.postMessage({ id: job.id, operation: job.operation, args: job.args }); }
    catch (error) { finish(error); }
  }

  function runReviewTask(operation, ...args) {
    if (queue.length >= 8) return Promise.reject(new Error('审阅计算正在进行，请稍后重试。'));
    return new Promise((resolve, reject) => {
      queue.push({ id: ++sequence, operation, args, resolve, reject });
      pump();
    });
  }
  module.exports = { runReviewTask };
}

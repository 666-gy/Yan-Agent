'use strict';
const path = require('node:path');
const { Worker } = require('node:worker_threads');
function buildRepoMapBackground(workspace, { signal, timeoutMs = 15000, ...options } = {}) {
  if (signal?.aborted) return Promise.reject(new Error('Repository map cancelled'));
  return new Promise((resolve, reject) => {
    const workerPath = path.join(__dirname, 'repo-map-worker.js').replace(/app\.asar([/\\])/, 'app.asar.unpacked$1');
    const worker = new Worker(workerPath, { workerData: { workspace, options } });
    let done = false;
    const finish = (error, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      void worker.terminate();
      error ? reject(error) : resolve(value);
    };
    const abort = () => finish(new Error('Repository map cancelled'));
    const timer = setTimeout(() => finish(new Error('Repository map timed out')), timeoutMs);
    signal?.addEventListener('abort', abort, { once: true });
    worker.once('message', result => finish(result.error ? new Error(result.error) : null, result.text));
    worker.once('error', error => finish(error));
    worker.once('exit', code => { if (!done) finish(new Error(`Repository map worker exited (${code})`)); });
  });
}
module.exports = { buildRepoMapBackground };

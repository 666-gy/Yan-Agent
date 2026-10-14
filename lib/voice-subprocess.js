'use strict';
const { spawn } = require('node:child_process');

// The upstream provider only needs this subset of DSH's managed subprocess API.
function createSubprocessAdapter({ executable = process.execPath } = {}) {
  const children = new Set();
  function spawnWorker(options) {
    const child = spawn(executable, options.argv.slice(1), { cwd: options.cwd,
      env: { ...process.env, ...options.env }, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    children.add(child);
    let stderr = '';
    child.stderr.on('data', chunk => { stderr = (stderr + chunk.toString()).slice(-options.stdio.stderr.maxBytes); });
    const done = new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', (code, signal) => { children.delete(child); resolve({ code, signal }); });
    });
    // Spawn errors can arrive before the provider attaches its readiness observer.
    void done.catch(() => {});
    return { stdout: child.stdout, done, collected: { stderr: { readFrom: () => ({ text: stderr }) } },
      terminate: () => { if (child.exitCode === null) child.kill(); }, waitForExit: () => done };
  }
  return { spawn: spawnWorker, terminateAll: () => { for (const child of children) child.kill(); } };
}
module.exports = { createSubprocessAdapter };

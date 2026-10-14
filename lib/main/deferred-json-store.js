'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

function createDeferredJsonStore(file, snapshot, { delay = 250, onError = console.error } = {}) {
  let dirty = false, timer, running;
  async function flush() {
    clearTimeout(timer); timer = null;
    if (running) { await running; if (dirty) return flush(); return; }
    if (!dirty) return;
    running = (async () => {
      while (dirty) {
        dirty = false;
        const temporary = `${file}.pending-${process.pid}`;
        try {
          const value = JSON.stringify(snapshot());
          await fs.mkdir(path.dirname(file), { recursive: true });
          const handle = await fs.open(temporary, 'w');
          try { await handle.writeFile(value, 'utf8'); await handle.sync(); } finally { await handle.close(); }
          await fs.rename(temporary, file);
        } catch (error) {
          dirty = true;
          await fs.rm(temporary, { force: true }).catch(() => {});
          throw error;
        }
      }
    })();
    try { await running; } finally { running = null; }
  }
  function schedule() {
    dirty = true;
    if (!timer) timer = setTimeout(() => { flush().catch(onError); }, delay);
  }
  return { schedule, flush };
}
module.exports = { createDeferredJsonStore };

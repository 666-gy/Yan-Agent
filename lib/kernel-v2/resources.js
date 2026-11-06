'use strict';

// V2 owns all location/MCP workers in one process tree. Release that tree after
// a quiet period, and serialize the next admission behind its shutdown.
function createResources({ stop, isBusy = async () => false, idleMs = 30000, log = console }) {
  let active = 0, closed = false, timer;
  let maintenance = Promise.resolve();
  function arm() {
    clearTimeout(timer);
    if (closed || active) return;
    timer = setTimeout(() => {
      if (closed || active) return;
      maintenance = maintenance.catch(() => {}).then(async () => {
        // Keep the process alive while native session work is still active.
        if (await isBusy()) { arm(); return; }
        await stop();
      }).catch(error => { log.warn?.(`[kernel-v2] idle cleanup: ${error.message}`); arm(); });
    }, idleMs);
    timer.unref?.();
  }
  return {
    get active() { return active; },
    async use(operation) {
      if (closed) throw new Error('V2 adapter is closing');
      active++;
      clearTimeout(timer);
      try {
        await maintenance;
        if (closed) throw new Error('V2 adapter is closing');
        return await operation();
      } finally { active--; arm(); }
    },
    async close() {
      closed = true;
      clearTimeout(timer);
      await maintenance;
    }
  };
}

module.exports = { createResources };

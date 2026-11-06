'use strict';

function waitWithSignal(promise, signal) {
  if (!signal) return promise;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

// One owner per Location/server. Native session activity protects long model
// requests, approvals and delegated work; call leases protect local races too.
function createMcpLifecycle({ connect, disconnect, isBusy, onDisconnect = () => {}, idleMs = 300000,
  pollMs = Math.min(1000, Math.max(10, idleMs / 4)), log = console }) {
  const states = new Map();
  let closed = false, timer, sweeping = false, wasBusy = false;
  const stateFor = name => {
    if (!states.has(name)) states.set(name, { name, connected: false, pending: null, closing: null,
      waiters: 0, calls: 0, idleSince: Date.now(), abort: null });
    return states.get(name);
  };
  const touch = state => { state.idleSince = Date.now(); };
  async function stop(state) {
    if (state.closing) return state.closing;
    state.closing = (async () => {
      await disconnect(state.name);
      state.connected = false;
      onDisconnect(state.name);
    })().finally(() => { state.closing = null; });
    return state.closing;
  }
  function schedule() {
    if (closed || timer || ![...states.values()].some(s => s.connected || s.pending)) return;
    timer = setTimeout(() => { timer = null; void sweep(); }, pollMs);
    timer.unref?.();
  }
  async function sweep() {
    if (closed || sweeping) return;
    sweeping = true;
    try {
      const busy = await isBusy();
      if (closed) return;
      const justFinished = wasBusy && !busy;
      wasBusy = busy;
      for (const state of states.values()) {
        if (busy || justFinished || state.calls || state.waiters || state.pending) { touch(state); continue; }
        if (state.connected && Date.now() - state.idleSince >= idleMs) await stop(state);
      }
    } catch (error) {
      // A failed activity check must never kill potentially active work.
      for (const state of states.values()) touch(state);
      log.warn?.(`[kernel-v2] MCP idle cleanup: ${error.message}`);
    } finally { sweeping = false; schedule(); }
  }
  return {
    isConnected: name => !!states.get(name)?.connected && !states.get(name)?.closing,
    touch() { for (const state of states.values()) touch(state); },
    async connect(name, signal) {
      if (closed) throw new Error('MCP runtime is closing');
      signal?.throwIfAborted();
      const state = stateFor(name);
      state.waiters++;
      touch(state);
      try {
        if (state.closing) await waitWithSignal(state.closing, signal);
        signal?.throwIfAborted();
        if (closed) throw new Error('MCP runtime is closing');
        if (!state.pending) {
          const abort = new AbortController();
          let ownsStartup = !state.connected;
          state.abort = abort;
          state.pending = (async () => {
            try {
              const result = await connect(name, abort.signal, () => { ownsStartup = true; });
              abort.signal.throwIfAborted();
              if (closed) throw new Error('MCP runtime is closing');
              state.connected = true;
              return result;
            } catch (error) {
              // A timed-out/cancelled HTTP request may already have spawned its
              // child. Explicitly disconnect before permitting a later retry.
              // Cancelling a second Session's connection check must not stop
              // a healthy shared service that another Session is still using.
              try { if (ownsStartup) await stop(state); }
              catch (cleanupError) {
                state.connected = true; // retry cleanup on the idle sweep
                log.warn?.(`[kernel-v2] MCP startup cleanup: ${cleanupError.message}`);
              }
              throw error;
            }
          })().finally(() => { state.pending = null; state.abort = null; touch(state); schedule(); });
        }
        return await waitWithSignal(state.pending, signal);
      } finally {
        state.waiters--;
        touch(state);
        if (!state.waiters && state.pending) state.abort?.abort(new Error('MCP connection cancelled'));
        schedule();
      }
    },
    async use(name, signal, operation) {
      const state = stateFor(name);
      if (closed || !state.connected || state.closing) throw new Error(`MCP ${name} is disconnected; call ${name}_connect first.`);
      signal?.throwIfAborted();
      state.calls++;
      touch(state);
      try { return await operation(); }
      finally { state.calls--; touch(state); schedule(); }
    },
    close() {
      closed = true;
      clearTimeout(timer);
      for (const state of states.values()) state.abort?.abort(new Error('MCP runtime is closing'));
      // The kernel owns process teardown when the Location/plugin is disposed.
    }
  };
}
module.exports = { createMcpLifecycle };

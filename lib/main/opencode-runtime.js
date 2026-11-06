'use strict';

// Sidecar lifetime, prewarming and background leases. All mutable cells are
// owned by the main composition root, including promises and idle timers.
const { OpenCodeV2Pool: OpenCodeSidecar } = require('../kernel-v2/pool');
const { OpenCodeProviderAdapter, registerAdapter } = require('../yan-core');

function createOpenCodeRuntime(deps) {
  let closingSidecar = null;
  let prewarmTarget = '';
  const {
    appRoot,
    dataDir,
    MAX_CONCURRENT_AGENT_RUNS,
    OPENCODE_IDLE_RELEASE_MS,
    openCodeActiveRuns,
    configStore,
    mcpRuntimeConfig,
    openCodeSidecar,
    openCodeProviderAdapter,
    openCodeIdleReleaseTimer,
    openCodePrewarmPromise,
    openCodeBackgroundLeases,
    getMainWindow,
    isQuitting,
    Sidecar = OpenCodeSidecar,
    createProviderAdapter = sidecar => registerAdapter(new OpenCodeProviderAdapter(sidecar))
  } = deps;

  function getOpenCodeSidecar() {
    if (!openCodeSidecar.get()) {
      openCodeSidecar.set(new Sidecar({
        appRoot,
        dataDir,
        log: console,
        waitForPreviousClose: () => closingSidecar,
        // The pool's per-session lease must honor the desktop idle policy too.
        // Otherwise its 30s default tears down kernels despite the 30min outer timer.
        instanceIdleMs: OPENCODE_IDLE_RELEASE_MS,
        maxKernels: MAX_CONCURRENT_AGENT_RUNS
      }));
      openCodeProviderAdapter.set(null);
    }
    return openCodeSidecar.get();
  }

  function getOpenCodeProviderAdapter(sidecar = getOpenCodeSidecar()) {
    if (!openCodeProviderAdapter.get() || openCodeProviderAdapter.get().sidecar !== sidecar) {
      openCodeProviderAdapter.set(createProviderAdapter(sidecar));
    }
    return openCodeProviderAdapter.get();
  }

  async function ensureOpenCodeSidecar(initialConfig = {}) {
    if (openCodeIdleReleaseTimer.get()) {
      clearTimeout(openCodeIdleReleaseTimer.get());
      openCodeIdleReleaseTimer.set(null);
    }
    if (closingSidecar) {
      // A failed idle release is already logged. A new turn must still be able to
      // build a fresh kernel instead of inheriting that teardown error.
      try { await closingSidecar; } catch {}
    }
    const sidecar = getOpenCodeSidecar();
    await sidecar.start(initialConfig);
    return sidecar;
  }

  function setMainRendererBackgroundThrottling(enabled) {
    if (!getMainWindow() || getMainWindow().isDestroyed()) return;
    try { getMainWindow().webContents.setBackgroundThrottling?.(enabled); } catch {}
  }

  function scheduleOpenCodeIdleRelease() {
    if (openCodeIdleReleaseTimer.get()) clearTimeout(openCodeIdleReleaseTimer.get());
    openCodeIdleReleaseTimer.set(null);
    if (isQuitting() || openCodeActiveRuns.size || openCodeBackgroundLeases.get() || !openCodeSidecar.get()) return;
    openCodeIdleReleaseTimer.set(setTimeout(async () => {
      openCodeIdleReleaseTimer.set(null);
      if (isQuitting() || openCodeActiveRuns.size || openCodeBackgroundLeases.get() || !openCodeSidecar.get()) return;
      const idleSidecar = openCodeSidecar.get();
      try {
        if (await idleSidecar.hasBackgroundWork?.()) { scheduleOpenCodeIdleRelease(); return; }
      } catch (error) {
        console.warn('[opencode] idle activity check failed:', error.message);
        scheduleOpenCodeIdleRelease();
        return;
      }
      // A new turn can be admitted while the native activity check is in flight.
      if (openCodeActiveRuns.size || openCodeBackgroundLeases.get() || openCodeSidecar.get() !== idleSidecar) return;
      openCodeSidecar.set(null);
      openCodeProviderAdapter.set(null);
      closingSidecar = Promise.resolve(idleSidecar.close())
        .finally(() => { closingSidecar = null; });
      closingSidecar.catch(error => console.warn('[opencode] idle shutdown failed:', error.message));
      console.log(`[opencode] released idle kernel and MCP runtimes after ${OPENCODE_IDLE_RELEASE_MS}ms`);
    }, OPENCODE_IDLE_RELEASE_MS));
    openCodeIdleReleaseTimer.get().unref?.();
  }

  function refreshAgentRuntimeActivity() {
    const busy = openCodeActiveRuns.size > 0;
    setMainRendererBackgroundThrottling(!busy);
    if (busy) {
      if (openCodeIdleReleaseTimer.get()) clearTimeout(openCodeIdleReleaseTimer.get());
      openCodeIdleReleaseTimer.set(null);
    } else {
      scheduleOpenCodeIdleRelease();
    }
  }

  async function prewarmOpenCodeSidecar(options = {}) {
    if (isQuitting()) return { ok: false, error: 'Yan Agent is closing' };
    if (openCodeActiveRuns.size) return { ok: true, skipped: 'active-runs' };
    const target = JSON.stringify([options.yanSessionId || '', options.directory || '']);
    if (openCodePrewarmPromise.get()) {
      if (target === prewarmTarget) return openCodePrewarmPromise.get();
      // Switching chats during startup must not consume the next chat's warmup.
      return openCodePrewarmPromise.get().catch(() => {}).then(() => prewarmOpenCodeSidecar(options));
    }
    prewarmTarget = target;
    openCodePrewarmPromise.set((async () => {
      const cfg = configStore.loadConfig();
      const servers = mcpRuntimeConfig.getOpenCodeMcpServers(cfg);
      const config = mcpRuntimeConfig.getOpenCodeRuntimeConfig(cfg, { mcpServers: servers,
        ...(options.selection ? { selection: options.selection } : {}) });
      const sidecar = await ensureOpenCodeSidecar(config);
      const directory = String(options.directory || '').trim();
      if (directory) await sidecar.prewarm(config, directory, {
        yanSessionId: options.yanSessionId, openCodeSessionId: options.openCodeSessionId
      });
      scheduleOpenCodeIdleRelease();
      return sidecar.status();
    })().finally(() => { openCodePrewarmPromise.set(null); }));
    return openCodePrewarmPromise.get();
  }

  async function withOpenCodeBackgroundLease(operation) {
    openCodeBackgroundLeases.set(openCodeBackgroundLeases.get() + 1);
    if (openCodeIdleReleaseTimer.get()) clearTimeout(openCodeIdleReleaseTimer.get());
    openCodeIdleReleaseTimer.set(null);
    try {
      return await operation();
    } finally {
      openCodeBackgroundLeases.set(Math.max(0, openCodeBackgroundLeases.get() - 1));
      scheduleOpenCodeIdleRelease();
    }
  }

  return { getOpenCodeSidecar, getOpenCodeProviderAdapter, ensureOpenCodeSidecar, setMainRendererBackgroundThrottling, scheduleOpenCodeIdleRelease, refreshAgentRuntimeActivity, prewarmOpenCodeSidecar, withOpenCodeBackgroundLease };
}

module.exports = { createOpenCodeRuntime };

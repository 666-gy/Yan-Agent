'use strict';

// Sidecar lifetime, prewarming and background leases. All mutable cells are
// owned by the main composition root, including promises and idle timers.
const { OpenCodeSidecar } = require('../opencode-sidecar');
const { OpenCodeProviderAdapter, registerAdapter } = require('../yan-core');

function createOpenCodeRuntime(deps) {
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
    openCodeIdleReleaseTimer.set(setTimeout(() => {
      openCodeIdleReleaseTimer.set(null);
      if (isQuitting() || openCodeActiveRuns.size || openCodeBackgroundLeases.get() || !openCodeSidecar.get()) return;
      const idleSidecar = openCodeSidecar.get();
      openCodeSidecar.set(null);
      openCodeProviderAdapter.set(null);
      idleSidecar.close();
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
    if (openCodePrewarmPromise.get()) return openCodePrewarmPromise.get();
    openCodePrewarmPromise.set((async () => {
      const cfg = configStore.loadConfig();
      const servers = mcpRuntimeConfig.getOpenCodeMcpServers(cfg);
      const config = mcpRuntimeConfig.getOpenCodeRuntimeConfig(cfg, { mcpServers: servers });
      const sidecar = await ensureOpenCodeSidecar(config);
      const directory = String(options.directory || '').trim();
      if (directory) await sidecar.prewarm(config, directory);
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

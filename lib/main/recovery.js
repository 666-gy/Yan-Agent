'use strict';

// Interrupted-run recovery (plan T6.4): the per-run reconciliation log that
// lets a reloaded renderer catch up, and the replay of recovering Turns from
// the Yan Core journal. Moved verbatim from main.js; the core handles and the
// window arrive through live getters.

function createRecoveryRuntime(deps) {
  const { openCodeEventBatcher, getYanCore, getMainWindow } = deps;

  function sendOpenCodeRendererEvent(runId, event) {
    try { getYanCore()?.ingestProviderEvent(runId, event); } catch (error) {
      console.warn('[yan-core] provider event ingestion failed:', error?.message || error);
    }
    recordOpenCodeReconcileEvent(runId, event);
    const win = getMainWindow();
  if (!win || win.isDestroyed()) {
      openCodeEventBatcher.flush(runId);
      return;
    }
    if (openCodeEventBatcher.push(runId, event)) return;
    openCodeEventBatcher.flush(runId);
    win.webContents.send('opencode:event', { runId, event });
  }

  // ---------------------------------------------------------------------------
  // OpenCode run reconciliation: keep a recent per-run event log so a reloaded
  // renderer can catch up on runs that are still executing (or just finished)
  // inside the kernel instead of losing them forever.
  // ---------------------------------------------------------------------------
  const OPENCODE_RECONCILE_EVENT_CAP = 400;
  const OPENCODE_RECONCILE_COMPLETED_TTL_MS = 60_000;
  const openCodeRunReconcile = new Map(); // runId -> { meta, events, completed, completedAt }

  function ensureOpenCodeReconcileRun(runId, meta = {}) {
    const id = String(runId || '');
    if (!id || openCodeRunReconcile.has(id)) return openCodeRunReconcile.get(id);
    const entry = {
      meta: {
        runLane: meta.runLane || 'interactive',
        yanSessionId: String(meta.yanSessionId || ''),
        workspace: String(meta.workspace || ''),
        startedAt: Number(meta.startedAt) || Date.now()
      },
      events: [],
      completed: null,
      completedAt: 0
    };
    openCodeRunReconcile.set(id, entry);
    return entry;
  }

  function recordOpenCodeReconcileEvent(runId, event) {
    const entry = openCodeRunReconcile.get(String(runId || ''));
    if (!entry || entry.completed) return;
    entry.events.push(event);
    if (entry.events.length > OPENCODE_RECONCILE_EVENT_CAP) {
      entry.events.splice(0, entry.events.length - OPENCODE_RECONCILE_EVENT_CAP);
    }
  }

  function completeOpenCodeReconcileRun(runId, completedResult) {
    const entry = openCodeRunReconcile.get(String(runId || ''));
    if (!entry || entry.completed) return;
    entry.completed = completedResult || null;
    entry.completedAt = Date.now();
    const timer = setTimeout(() => openCodeRunReconcile.delete(String(runId)), OPENCODE_RECONCILE_COMPLETED_TTL_MS);
    timer.unref?.();
  }

  function flushOpenCodeRendererEvents(runId) {
    openCodeEventBatcher.flush(runId);
  }

  // ---------------------------------------------------------------------------
  // Interrupted-run recovery: Yan Core journals every provider event that fed
  // the renderer, so a Turn that died with the previous process can be replayed
  // from disk instead of vanishing from the session UI.
  // ---------------------------------------------------------------------------
  const OPENCODE_RECOVERY_MAX_RUNS = 13;
  const OPENCODE_RECOVERY_MAX_EVENTS_PER_RUN = 8_000;
  const OPENCODE_RECOVERY_MAX_BYTES_PER_RUN = 8 * 1024 * 1024;
  const OPENCODE_RECOVERY_MAX_TOTAL_BYTES = 16 * 1024 * 1024;

  // Rebuild the exact renderer-facing event from one journal entry. Mapped
  // provider events keep their original payload under `raw`; lifecycle entries
  // and payloads flattened by the protocol size guard are not replayable.
  function recoveryRendererEvent(coreEvent) {
    const payload = coreEvent?.payload;
    if (!payload || typeof payload !== 'object' || !payload.rawType) return null;
    const raw = payload.raw;
    if (raw && typeof raw === 'object' && typeof raw.type === 'string' && raw.type) return raw;
    if (payload.data && typeof payload.data === 'object') {
      return { type: String(payload.rawType), data: payload.data };
    }
    return null;
  }

  function recoveringCoreTurns(core = getYanCore()) {
    try {
      const turns = core?.getState?.()?.turns;
      if (!turns || typeof turns !== 'object') return [];
      return Object.values(turns)
        .filter(turn => turn && !turn.recovery?.replayedAt && (turn.status === 'recovering' || (turn.status === 'aborted' && turn.recovery)))
        .sort((left, right) => (Number(right.createdAt) || 0) - (Number(left.createdAt) || 0));
    } catch (error) {
      console.warn('[opencode] recovering Turn lookup failed:', error?.message || error);
      return [];
    }
  }

  function buildRecoveredRunDescriptors(runIds = [], core = getYanCore()) {
    const requested = new Set((Array.isArray(runIds) ? runIds : []).map(id => String(id || '')).filter(Boolean));
    const turns = recoveringCoreTurns(core).filter(turn => !requested.size || requested.has(String(turn.id)));
    const descriptors = [];
    if (!turns.length) return descriptors;
    // One journal read for every recovering Turn: the file can be tens of
    // megabytes, and re-parsing it per Turn would stall startup after a crash.
    const journalEvents = typeof core.readJournalEvents === 'function' ? core.readJournalEvents() : null;
    let totalBytes = 0;
    for (const turn of turns.slice(0, OPENCODE_RECOVERY_MAX_RUNS)) {
      const journal = core.listTurnEvents(turn.id, {
        maxEvents: OPENCODE_RECOVERY_MAX_EVENTS_PER_RUN,
        events: journalEvents
      });
      const events = [];
      let bytes = 0;
      let dropped = 0;
      // Newest events first while budgeting: the tail is what the user last saw.
      for (let index = journal.events.length - 1; index >= 0; index -= 1) {
        const rendererEvent = recoveryRendererEvent(journal.events[index]);
        // Lifecycle/telemetry entries are expected and not replayable; they are
        // not recoverable content and must not mark the slice as truncated.
        if (!rendererEvent) continue;
        const estimated = JSON.stringify(rendererEvent)?.length || 0;
        if (estimated > OPENCODE_RECOVERY_MAX_BYTES_PER_RUN) {
          dropped += 1;
          continue;
        }
        if (bytes + estimated > OPENCODE_RECOVERY_MAX_BYTES_PER_RUN
          || totalBytes + estimated > OPENCODE_RECOVERY_MAX_TOTAL_BYTES) {
          dropped += index + 1;
          break;
        }
        events.push(rendererEvent);
        bytes += estimated;
        totalBytes += estimated;
      }
      events.reverse();
      const thread = core.getThread?.(turn.threadId) || null;
      descriptors.push({
        runId: String(turn.id || ''),
        yanSessionId: String(turn.threadId || ''),
        workspace: String(thread?.workspace || ''),
        startedAt: Number(turn.startedAt) || Number(turn.createdAt) || 0,
        lastEventAt: Number(journal.lastTimestamp) || Number(turn.updatedAt) || 0,
        configSnapshot: turn.configSnapshot && typeof turn.configSnapshot === 'object' ? turn.configSnapshot : {},
        intent: turn.intent && typeof turn.intent === 'object' ? { prompt: String(turn.intent.prompt || '') } : {},
        events,
        journalEvents: journal.total,
        truncated: journal.truncated === true || dropped > 0
      });
    }
    return descriptors;
  }

  return {
    sendOpenCodeRendererEvent,
    OPENCODE_RECONCILE_EVENT_CAP,
    OPENCODE_RECONCILE_COMPLETED_TTL_MS,
    openCodeRunReconcile,
    ensureOpenCodeReconcileRun,
    recordOpenCodeReconcileEvent,
    completeOpenCodeReconcileRun,
    flushOpenCodeRendererEvents,
    OPENCODE_RECOVERY_MAX_RUNS,
    OPENCODE_RECOVERY_MAX_EVENTS_PER_RUN,
    OPENCODE_RECOVERY_MAX_BYTES_PER_RUN,
    OPENCODE_RECOVERY_MAX_TOTAL_BYTES,
    recoveryRendererEvent,
    recoveringCoreTurns,
    buildRecoveredRunDescriptors,
  };
}

module.exports = { createRecoveryRuntime };

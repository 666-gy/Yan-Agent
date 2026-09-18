'use strict';

const { EventEmitter } = require('node:events');
const {
  clipText,
  cloneJson,
  createEvent,
  createItem,
  createThread,
  createTurn,
  isTerminalItemStatus,
  isTerminalTurnStatus,
  MAX_ITEMS_PER_TURN,
  normalizeId,
  normalizeIntent,
  normalizeResult
} = require('./protocol');
const { canTransition, transitionTurn } = require('./state-machine');
const { YanCoreStore } = require('./store');
const { classifyToolCapabilities } = require('./tools');

const PROVIDER_EVENT_MAP = Object.freeze({
  // startTurn() emits the authoritative lifecycle event. The provider's
  // started notification is retained as telemetry so it cannot duplicate it.
  'yan.opencode.started': 'provider.event',
  'message.part.delta': 'message.delta',
  // Some OpenCode runtimes expose the normalized stream under the legacy
  // session.next.* names. Treat those deltas as transient stream events too;
  // otherwise every token becomes a synchronous provider.event persistence
  // cycle, which blocks the IPC callback and delays the renderer.
  'session.next.text.delta': 'message.delta',
  'session.next.reasoning.delta': 'reasoning.delta',
  'message.part.updated': 'provider.event',
  'message.updated': 'provider.event',
  'session.next.tool.called': 'tool.started',
  'session.next.tool.success': 'tool.completed',
  'session.next.tool.failed': 'tool.completed',
  'session.diff': 'provider.event',
  'file.edited': 'file.edited',
  'context.updated': 'context.updated',
  'context.compacted': 'context.compacted',
  'yan.context.budget': 'context.updated',
  'yan.context.compression.started': 'context.compaction.started',
  'yan.context.compression.completed': 'context.compaction.completed',
  'yan.context.compression.failed': 'context.compaction.failed',
  'yan.delivery.acceptance.started': 'delivery.acceptance.started',
  'yan.delivery.acceptance.repaired': 'delivery.acceptance.repaired',
  'yan.delivery.acceptance.passed': 'delivery.acceptance.passed',
  'yan.delivery.acceptance.failed': 'delivery.acceptance.failed',
  // OpenCode can emit this event before its own retry loop. It is evidence of
  // a provider error, not an authoritative Turn failure. Final status comes
  // from completeTurn() after the provider settles.
  'session.error': 'provider.error',
  'yan.model.retrying': 'turn.retrying'
});

// Tool calls become persisted Items with deterministic IDs so streamed
// lifecycle events and the final result converge on the same record.
function toolItemId(turnId, callId) {
  return `${turnId}:tool:${String(callId || 'unknown').slice(0, 120)}`;
}

function fileItemId(turnId, filePath) {
  const normalized = String(filePath || 'unknown').replace(/\\/g, '/').slice(0, 180);
  return `${turnId}:file:${normalized}`;
}

function defaultTelemetry(timestamp = Date.now()) {
  return {
    intentReceivedAt: timestamp,
    firstEventAt: 0,
    firstTokenAt: 0,
    firstToolCompletedAt: 0,
    finalSubmittedAt: 0,
    cancelRequestedAt: 0,
    cancelSettledAt: 0,
    eventCount: 0,
    retries: 0,
    backpressureDrops: 0,
    recoveryCount: 0,
    intentToTurnMs: 0,
    intentToFirstEventMs: 0,
    intentToFirstTokenMs: 0,
    firstTokenToFinalMs: 0,
    cancelLatencyMs: 0
  };
}

function contextTokensOf(info = {}) {
  const tokens = info?.tokens || {};
  return (Number(tokens.input) || 0)
    + (Number(tokens.output) || 0)
    + (Number(tokens.cache?.read) || 0)
    + (Number(tokens.cache?.write) || 0);
}

function normalizedStatusOf(result = {}) {
  if (result?.status === 'interrupted') return 'cancelled';
  if (result?.status === 'error') return 'failed';
  return 'completed';
}

// Only authoritative Turn/Thread lifecycle transitions rewrite state.json
// synchronously. High-frequency events (stream deltas, tool progress,
// provider telemetry, item updates) are still appended to the durable JSONL
// log immediately, but are folded into a debounced snapshot write: a
// synchronous full-state rewrite per tool event serialized the whole Core
// state on Electron's main thread and could freeze the UI for a minute while
// trailing commands ran. lastEventSequence() covers the crash gap in between.
const IMMEDIATE_PERSIST_EVENT_TYPES = new Set([
  'turn.created',
  'turn.started',
  'turn.queued',
  'turn.dequeued',
  'turn.completed',
  'turn.aborted',
  'turn.failed',
  'turn.incomplete',
  'turn.cancel.requested',
  'thread.created',
  'thread.updated',
  'thread.recovered',
  'thread.deleted',
  'provider.error',
  'delivery.acceptance.started',
  'delivery.acceptance.repaired',
  'delivery.acceptance.passed',
  'delivery.acceptance.failed'
]);
const TRAILING_PERSIST_DELAY_MS = 500;
// A nonstop event stream keeps resetting the debounce; cap how far state.json
// may lag behind the in-memory state before the pending write is let through.
const TRAILING_PERSIST_MAX_DELAY_MS = 2_500;

function emptyState() {
  return {
    version: 1,
    nextEventSequence: 0,
    threads: {},
    turns: {},
    intents: {},
    items: {},
    updatedAt: 0
  };
}

function mapProviderEvent(raw = {}) {
  const rawType = String(raw.type || '');
  const data = raw.data || raw.properties || {};
  const part = data.part || {};
  let type = PROVIDER_EVENT_MAP[rawType] || 'provider.event';
  if (rawType === 'message.part.delta') {
    const field = String(data.field || raw.properties?.field || 'text');
    type = field === 'reasoning' ? 'reasoning.delta' : 'message.delta';
  }
  if (rawType === 'message.part.updated' && part.type === 'tool') {
    const status = String(part.state?.status || '');
    type = ['completed', 'error'].includes(status) ? 'tool.completed' : 'tool.progress';
  }
  const payload = {
    provider: 'opencode',
    rawType,
    data: cloneJson(data),
    raw: cloneJson(raw)
  };
  if (type === 'message.delta' || type === 'reasoning.delta') {
    payload.delta = clipText(data.delta ?? raw.delta ?? part.text ?? '', 16_000);
  }
  if (type === 'tool.started' || type === 'tool.progress' || type === 'tool.completed') {
    payload.callId = String(data.callID || part.callID || part.id || '');
    payload.tool = String(data.tool || part.tool || '');
    payload.status = String(part.state?.status || '');
  }
  return { type, payload };
}

class YanCore extends EventEmitter {
  constructor({ rootDir, store = null, clock = Date.now, idFactory = null, logger = console, cancelTimeoutMs = 90_000 } = {}) {
    super();
    if (!rootDir && !store) throw new TypeError('YanCore requires rootDir or store.');
    this.clock = clock;
    this.idFactory = idFactory;
    this.logger = logger;
    this.cancelTimeoutMs = Math.max(1, Number(cancelTimeoutMs) || 90_000);
    this.cancelTimers = new Map();
    // Turns started by THIS process. A non-terminal Turn that is not in this
    // set was loaded from disk and cannot still be running: its kernel died
    // with the previous process, so startTurn() settles it instead of
    // refusing the thread forever.
    this.localTurnIds = new Set();
    this.store = store || new YanCoreStore({ rootDir, logger });
    this.state = { ...emptyState(), ...this.store.load() };
    this.state.threads ||= {};
    this.state.turns ||= {};
    this.state.intents ||= {};
    this.state.items ||= {};
    for (const turn of Object.values(this.state.turns)) {
      if (!turn || typeof turn !== 'object') continue;
      turn.itemIds = Array.isArray(turn.itemIds) ? turn.itemIds : [];
      turn.telemetry = { ...defaultTelemetry(Number(turn.createdAt) || Date.now()), ...(turn.telemetry || {}) };
      turn.telemetry.eventCount = Math.max(0, Number(turn.telemetry.eventCount) || 0);
      turn.telemetry.retries = Math.max(0, Number(turn.telemetry.retries) || 0);
      turn.telemetry.backpressureDrops = Math.max(0, Number(turn.telemetry.backpressureDrops) || 0);
      turn.telemetry.recoveryCount = Math.max(0, Number(turn.telemetry.recoveryCount) || 0);
    }
    for (const item of Object.values(this.state.items)) {
      const ownerTurn = item && this.state.turns[String(item.turnId || '')];
      if (!ownerTurn || !item.id) continue;
      ownerTurn.itemIds ||= [];
      if (!ownerTurn.itemIds.includes(item.id) && ownerTurn.itemIds.length < MAX_ITEMS_PER_TURN) ownerTurn.itemIds.push(item.id);
    }
    // Delta events advance nextEventSequence without an immediate state
    // write, so the stored cursor can lag the log tail after a crash.
    this.state.nextEventSequence = Math.max(
      Number(this.state.nextEventSequence) || 0,
      this.store.lastEventSequence?.() || 0
    );
    this.turnToThread = new Map(Object.values(this.state.turns).map(turn => [String(turn.id), String(turn.threadId)]));
    this.persistTimer = null;
    this.persistScheduledAt = 0;
    this.persist();
  }

  persist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
    this.persistScheduledAt = 0;
    this.state.updatedAt = Number(this.clock()) || Date.now();
    this.store.save(this.state);
  }

  // Trailing debounce: while a burst keeps producing events, the single
  // snapshot write slides to the end of the burst instead of rewriting the
  // whole state mid-burst. The max delay bounds staleness on a stream that
  // never goes quiet.
  schedulePersist() {
    const now = Date.now();
    if (this.persistTimer) {
      if (now - (Number(this.persistScheduledAt) || now) >= TRAILING_PERSIST_MAX_DELAY_MS) return;
      clearTimeout(this.persistTimer);
    } else {
      this.persistScheduledAt = now;
    }
    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      try {
        this.persist();
      } catch (error) {
        this.logger?.warn?.('[yan-core] trailing persist failed:', error?.message || error);
      }
    }, TRAILING_PERSIST_DELAY_MS);
    this.persistTimer.unref?.();
  }

  snapshot() {
    return cloneJson(this.state);
  }

  getThread(threadId) {
    return cloneJson(this.state.threads[String(threadId || '')] || null);
  }

  getTurn(turnId) {
    return cloneJson(this.state.turns[String(turnId || '')] || null);
  }

  getItem(turnId, itemId) {
    const item = this.state.items[String(itemId || '')];
    if (!item || (turnId && String(item.turnId || '') !== String(turnId))) return null;
    return cloneJson(item);
  }

  listItems(turnId) {
    const turn = this.state.turns[String(turnId || '')];
    const ids = Array.isArray(turn?.itemIds) ? turn.itemIds : [];
    return ids.map(id => cloneJson(this.state.items[id])).filter(Boolean);
  }

  // Durable journal slice for one Turn, in sequence order. Every provider
  // event that fed the renderer is appended to the JSONL log, so an
  // interrupted Turn can be replayed after a restart even though the live
  // renderer state died with the process. The tail is what the user saw last,
  // so callers keep the newest events when a Turn overflows the cap.
  readJournalEvents() {
    try {
      return this.store.readEvents({ afterSequence: 0, limit: Number.MAX_SAFE_INTEGER });
    } catch (error) {
      this.logger?.warn?.('[yan-core] recovery journal read failed:', error?.message || error);
      return [];
    }
  }

  listTurnEvents(turnId, { maxEvents = 8_000, events = null } = {}) {
    const id = String(turnId || '');
    if (!id) return { events: [], total: 0, truncated: false, lastTimestamp: 0 };
    const stored = Array.isArray(events) ? events : this.readJournalEvents();
    const all = [];
    for (const event of stored) {
      if (String(event?.turnId || '') !== id) continue;
      all.push(event);
    }
    const cap = Math.max(1, Number(maxEvents) || 8_000);
    const truncated = all.length > cap;
    const slice = truncated ? all.slice(all.length - cap) : all;
    return {
      events: cloneJson(slice),
      total: all.length,
      truncated,
      lastTimestamp: Number(slice[slice.length - 1]?.timestamp) || 0
    };
  }

  // Upsert-by-id keeps streamed tool lifecycle events and the final result
  // converged on one Item per tool call.
  upsertItem(turnId, input = {}) {
    const turn = this.state.turns[String(turnId || '')];
    if (!turn) return null;
    const id = String(input.id || '');
    if (!id) return null;
    const existing = this.state.items[id];
    if (existing) {
      if (!Array.isArray(turn.itemIds)) turn.itemIds = [];
      if (!turn.itemIds.includes(id)) turn.itemIds.push(id);
      existing.threadId = existing.threadId || turn.threadId;
      existing.turnId = existing.turnId || turn.id;
      const nextStatus = input.status || existing.status;
      existing.status = nextStatus;
      if (input.payload && typeof input.payload === 'object') {
        existing.payload = { ...existing.payload, ...cloneJson(input.payload) };
      }
      existing.updatedAt = Number(this.clock()) || Date.now();
      this.emitEvent('item.updated', turn.threadId, turn.id, { item: cloneJson(existing) });
      return cloneJson(existing);
    }
    const item = createItem({
      ...input,
      id,
      threadId: turn.threadId,
      turnId: turn.id
    }, { clock: this.clock, idFactory: this.idFactory });
    this.state.items[item.id] = item;
    turn.itemIds = Array.isArray(turn.itemIds) ? turn.itemIds : [];
    turn.itemIds.push(item.id);
    this.pruneTurnItems(turn);
    this.emitEvent('item.created', turn.threadId, turn.id, { item: cloneJson(item) });
    return cloneJson(item);
  }

  // Items are capped per turn; the oldest terminal items are evicted first so
  // a long-running turn cannot grow state.json without bound.
  pruneTurnItems(turn) {
    if (!Array.isArray(turn.itemIds) || turn.itemIds.length <= MAX_ITEMS_PER_TURN) return;
    const evictable = turn.itemIds.filter(id => {
      const item = this.state.items[id];
      return item && isTerminalItemStatus(item.status);
    });
    let excess = turn.itemIds.length - MAX_ITEMS_PER_TURN;
    const prunedIds = [];
    for (const id of evictable) {
      if (excess <= 0) break;
      delete this.state.items[id];
      turn.itemIds.splice(turn.itemIds.indexOf(id), 1);
      prunedIds.push(id);
      excess -= 1;
    }
    if (prunedIds.length) {
      this.emitEvent('item.pruned', turn.threadId, turn.id, { itemIds: prunedIds });
    }
  }

  // Authoritative per-turn context accounting, fed by provider usage events,
  // budget pushes, and compaction outcomes. Renderer only displays this.
  updateContextStats(turn, patch = {}) {
    const stats = turn.contextStats && typeof turn.contextStats === 'object'
      ? { ...turn.contextStats }
      : { contextTokens: 0, lastObservedTokens: 0, window: 0, softThreshold: 0, compactionCount: 0 };
    if (Number.isFinite(Number(patch.contextTokens))) stats.contextTokens = Math.max(0, Number(patch.contextTokens));
    if (Number.isFinite(Number(patch.lastObservedTokens))) stats.lastObservedTokens = Math.max(stats.lastObservedTokens || 0, Number(patch.lastObservedTokens));
    if (Number.isFinite(Number(patch.window))) stats.window = Math.max(0, Number(patch.window));
    if (Number.isFinite(Number(patch.softThreshold))) stats.softThreshold = Math.max(0, Number(patch.softThreshold));
    if (Number.isFinite(Number(patch.compactionCount))) stats.compactionCount = Math.max(0, Number(patch.compactionCount));
    if (patch.compactionReset) {
      stats.contextTokens = Number(patch.contextTokens) || 0;
      stats.lastObservedTokens = 0;
    }
    stats.updatedAt = Number(this.clock()) || Date.now();
    turn.contextStats = stats;
  }

  getContextState(threadId) {
    const target = String(threadId || '');
    const thread = this.state.threads[target];
    if (!thread) return null;
    const turnIds = Array.isArray(thread.turnIds) ? thread.turnIds : [];
    const activeTurnId = thread.activeTurnId || turnIds.at(-1) || '';
    const turn = this.state.turns[activeTurnId];
    if (!turn) return { threadId: target, turnId: '', status: thread.status, contextStats: null };
    return {
      threadId: target,
      turnId: turn.id,
      status: turn.status,
      configSnapshotId: turn.configSnapshotId,
      contextStats: cloneJson(turn.contextStats || null)
    };
  }

  getState({ threadId = '', includeEvents = false, afterSequence = 0, limit = 500 } = {}) {
    const targetThreadId = String(threadId || '');
    const state = this.snapshot();
    if (targetThreadId) {
      state.threads = state.threads[targetThreadId] ? { [targetThreadId]: state.threads[targetThreadId] } : {};
      state.turns = Object.fromEntries(Object.entries(state.turns).filter(([, turn]) => turn.threadId === targetThreadId));
      state.intents = Object.fromEntries(Object.entries(state.intents).filter(([, intent]) => intent.threadId === targetThreadId));
      state.items = Object.fromEntries(Object.entries(state.items).filter(([, item]) => item.threadId === targetThreadId));
    }
    if (includeEvents) state.events = this.store.readEvents({ afterSequence, limit });
    return state;
  }

  emitEvent(type, threadId, turnId, payload = {}) {
    this.state.nextEventSequence = Math.max(0, Number(this.state.nextEventSequence) || 0) + 1;
    const turn = turnId ? this.state.turns[String(turnId)] : null;
    if (turn) {
      const timestamp = Number(this.clock()) || Date.now();
      turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || timestamp);
      turn.telemetry.eventCount = Math.max(0, Number(turn.telemetry.eventCount) || 0) + 1;
      turn.telemetry.firstEventAt ||= timestamp;
      if (type === 'turn.started' && turn.startedAt && turn.telemetry.intentReceivedAt) {
        turn.telemetry.intentToTurnMs = Math.max(0, turn.startedAt - turn.telemetry.intentReceivedAt);
      }
      if (turn.telemetry.firstEventAt && turn.telemetry.intentReceivedAt) {
        turn.telemetry.intentToFirstEventMs = Math.max(0, turn.telemetry.firstEventAt - turn.telemetry.intentReceivedAt);
      }
      if ((type === 'message.delta' || type === 'reasoning.delta') && payload?.delta) {
        turn.telemetry.firstTokenAt ||= timestamp;
        if (turn.telemetry.firstTokenAt && turn.telemetry.intentReceivedAt) {
          turn.telemetry.intentToFirstTokenMs = Math.max(0, turn.telemetry.firstTokenAt - turn.telemetry.intentReceivedAt);
        }
      }
      if (type === 'turn.retrying') turn.telemetry.retries += 1;
      if (type === 'tool.completed') turn.telemetry.firstToolCompletedAt ||= timestamp;
    }
    let eventPayload = turn?.configSnapshotId && payload?.configSnapshotId == null
      ? { ...payload, configSnapshotId: turn.configSnapshotId }
      : { ...payload };
    if (turn && (String(type).startsWith('turn.') || String(type).startsWith('context.'))) {
      eventPayload = {
        ...eventPayload,
        telemetry: cloneJson(turn.telemetry),
        ...(turn.contextStats ? { contextStats: cloneJson(turn.contextStats) } : {})
      };
    }
    const event = createEvent({
      type,
      threadId,
      turnId,
      payload: eventPayload,
      timestamp: this.clock()
    }, { clock: this.clock, sequence: this.state.nextEventSequence, idFactory: this.idFactory });
    this.store.appendEvent(event);
    if (IMMEDIATE_PERSIST_EVENT_TYPES.has(event.type)) this.persist();
    else this.schedulePersist();
    this.emit('event', event);
    return event;
  }

  ensureThread(input = {}) {
    const id = normalizeId(input.id, 'thread', this.idFactory);
    const existing = this.state.threads[id];
    if (existing) return existing;
    const thread = createThread({ ...input, id }, { clock: this.clock, idFactory: this.idFactory });
    this.state.threads[id] = thread;
    this.persist();
    this.emitEvent('thread.created', id, '', { thread });
    return thread;
  }

  updateThread(threadId, patch = {}) {
    const id = String(threadId || '');
    const thread = this.state.threads[id];
    if (!thread) return null;
    if (patch.workspace !== undefined) thread.workspace = clipText(patch.workspace, 1_024);
    if (patch.title !== undefined) thread.title = clipText(patch.title || '新对话', 240);
    if (patch.metadata && typeof patch.metadata === 'object') thread.metadata = cloneJson(patch.metadata);
    if (patch.status && ['idle', 'running', 'waiting_for_tool', 'waiting_for_user', 'compacting', 'recovering'].includes(String(patch.status))) {
      thread.status = String(patch.status);
    }
    thread.updatedAt = Number(this.clock()) || Date.now();
    this.emitEvent('thread.updated', id, '', { thread: cloneJson(thread) });
    return cloneJson(thread);
  }

  startTurn({ threadId, turnId = '', configSnapshotId = '', configSnapshot = {}, intent = {}, workspace = '', title = '' } = {}) {
    const targetThreadId = normalizeId(threadId, 'thread', this.idFactory);
    const requestedTurnId = normalizeId(turnId, 'turn', this.idFactory);
    const existing = this.state.turns[requestedTurnId];
    if (existing) {
      if (String(existing.threadId) !== String(targetThreadId)) {
        throw Object.assign(new Error(`Turn "${requestedTurnId}" belongs to another Thread.`), {
          code: 'YAN_TURN_THREAD_MISMATCH', turnId: requestedTurnId, threadId: targetThreadId
        });
      }
      this.localTurnIds.add(existing.id);
      return cloneJson(existing);
    }
    const thread = this.ensureThread({ id: targetThreadId, workspace, title });
    // One live Turn per Thread. A non-terminal Turn from a previous process
    // (crash, kill) can never resume — its kernel is gone — so it is settled
    // as aborted to unblock the Thread instead of bricking it forever.
    let active = Object.values(this.state.turns).find(candidate => (
      candidate && String(candidate.threadId) === String(thread.id) && !isTerminalTurnStatus(candidate.status)
    ));
    while (active) {
      if (this.localTurnIds.has(active.id)) {
        throw Object.assign(new Error(`Thread "${thread.id}" already has an active Turn.`), {
          code: 'YAN_THREAD_BUSY',
          threadId: thread.id,
          turnId: active.id
        });
      }
      this.logger?.warn?.(`[yan-core] settling stale Turn ${active.id} (${active.status}) from a previous process as aborted.`);
      this.transitionTurn(active.id, 'aborted', { reason: 'stale_after_restart' });
      active = Object.values(this.state.turns).find(candidate => (
        candidate && String(candidate.threadId) === String(thread.id) && !isTerminalTurnStatus(candidate.status)
      ));
    }
    const turn = createTurn({
      id: requestedTurnId,
      threadId: thread.id,
      configSnapshotId,
      configSnapshot,
      intent
    }, { clock: this.clock, idFactory: this.idFactory });
    this.state.turns[turn.id] = turn;
    this.localTurnIds.add(turn.id);
    this.turnToThread.set(turn.id, thread.id);
    thread.turnIds = Array.isArray(thread.turnIds) ? thread.turnIds : [];
    if (!thread.turnIds.includes(turn.id)) thread.turnIds.push(turn.id);
    thread.activeTurnId = turn.id;
    thread.status = 'running';
    thread.updatedAt = Number(this.clock()) || Date.now();
    this.emitEvent('turn.created', thread.id, turn.id, { turn: cloneJson(turn) });
    transitionTurn(turn, 'running', { now: this.clock });
    this.emitEvent('turn.started', thread.id, turn.id, { turn: cloneJson(turn) });
    this.persist();
    return cloneJson(turn);
  }

  enqueueIntent({ threadId, intentId = '', intent = {} } = {}) {
    const targetThreadId = normalizeId(threadId, 'thread', this.idFactory);
    const thread = this.ensureThread({ id: targetThreadId });
    const id = normalizeId(intentId, 'intent', this.idFactory);
    const existing = this.state.intents[id];
    // Intent IDs are idempotency keys. A retry must never resurrect or
    // duplicate an intent that was already consumed or explicitly deleted.
    if (existing) return cloneJson(existing);
    const record = {
      id,
      threadId: thread.id,
      status: 'queued',
      intent: normalizeIntent(intent),
      createdAt: Number(this.clock()) || Date.now(),
      updatedAt: Number(this.clock()) || Date.now()
    };
    this.state.intents[id] = record;
    this.persist();
    this.emitEvent('turn.queued', thread.id, id, { intent: cloneJson(record) });
    return cloneJson(record);
  }

  consumeIntent(intentId) {
    const id = String(intentId || '');
    const intent = this.state.intents[id];
    if (!intent || intent.status !== 'queued') return null;
    intent.status = 'consumed';
    intent.dispatchingAt = Number(this.clock()) || Date.now();
    intent.updatedAt = Number(this.clock()) || Date.now();
    this.emitEvent('turn.dequeued', intent.threadId, id, {
      intent: cloneJson(intent),
      reason: 'consumed'
    });
    return cloneJson(intent);
  }

  ackIntent(intentId) {
    const id = String(intentId || '');
    const intent = this.state.intents[id];
    if (!intent || intent.status === 'deleted') return null;
    if (intent.status !== 'consumed') return cloneJson(intent);
    intent.status = 'dispatched';
    intent.ackedAt = Number(this.clock()) || Date.now();
    intent.updatedAt = Number(this.clock()) || Date.now();
    this.persist();
    this.emitEvent('turn.dequeued', intent.threadId, id, {
      intent: cloneJson(intent),
      reason: 'dispatched'
    });
    return cloneJson(intent);
  }

  requeueIntent(intentId) {
    const id = String(intentId || '');
    const intent = this.state.intents[id];
    if (!intent || intent.status === 'deleted') return null;
    if (intent.status === 'queued') return cloneJson(intent);
    if (intent.status !== 'consumed') return null;
    intent.status = 'queued';
    intent.updatedAt = Number(this.clock()) || Date.now();
    this.persist();
    this.emitEvent('turn.queued', intent.threadId, id, { intent: cloneJson(intent), restored: true });
    return cloneJson(intent);
  }

  deleteIntent(intentId, reason = 'user_removed') {
    const id = String(intentId || '');
    const intent = this.state.intents[id];
    if (!intent) return { ok: false, error: 'Yan Intent 不存在。' };
    if (intent.status === 'deleted') return { ok: true, alreadyDeleted: true };
    intent.status = 'deleted';
    intent.deleteReason = clipText(reason, 240);
    intent.updatedAt = Number(this.clock()) || Date.now();
    this.persist();
    this.emitEvent('turn.dequeued', intent.threadId, id, { intent: cloneJson(intent), reason: intent.deleteReason });
    return { ok: true, intent: cloneJson(intent) };
  }

  listQueuedIntents(threadId = '') {
    const target = String(threadId || '');
    return Object.values(this.state.intents)
      .filter(intent => intent.status === 'queued' && (!target || intent.threadId === target))
      .sort((left, right) => Number(left.createdAt) - Number(right.createdAt))
      .map(cloneJson);
  }

  transitionTurn(turnId, nextStatus, payload = {}) {
    const turn = this.state.turns[String(turnId || '')];
    if (!turn) return null;
    if (isTerminalTurnStatus(turn.status)) return cloneJson(turn);
    if (!canTransition(turn.status, nextStatus)) {
      this.logger.warn?.(`[yan-core] ignored invalid transition ${turn.status} -> ${nextStatus} for ${turn.id}`);
      return cloneJson(turn);
    }
    transitionTurn(turn, nextStatus, { now: this.clock });
    turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || Date.now());
    if (isTerminalTurnStatus(nextStatus) && turn.cancelRequested) {
      turn.telemetry.cancelSettledAt ||= Number(this.clock()) || Date.now();
      if (turn.telemetry.cancelRequestedAt) {
        turn.telemetry.cancelLatencyMs = Math.max(0, turn.telemetry.cancelSettledAt - turn.telemetry.cancelRequestedAt);
      }
    }
    if (isTerminalTurnStatus(nextStatus)) this.clearCancelTimer(turn.id);
    const thread = this.state.threads[turn.threadId];
    if (thread) {
      thread.status = ['completed', 'aborted', 'failed', 'incomplete'].includes(nextStatus) ? 'idle' : nextStatus;
      thread.activeTurnId = thread.status === 'idle' ? '' : turn.id;
      thread.updatedAt = Number(this.clock()) || Date.now();
    }
    this.emitEvent(`turn.${nextStatus}`, turn.threadId, turn.id, {
      ...payload,
      turn: cloneJson(turn),
      ...(thread ? { thread: cloneJson(thread) } : {})
    });
    return cloneJson(turn);
  }

  ingestProviderEvent(runId, rawEvent = {}) {
    const turnId = String(runId || '');
    const turn = this.state.turns[turnId];
    if (!turn || isTerminalTurnStatus(turn.status)) return null;
    const mapped = mapProviderEvent(rawEvent);
    if (mapped.type === 'turn.started' && turn.status === 'created') this.transitionTurn(turn.id, 'running');
    if (mapped.type === 'tool.started' && canTransition(turn.status, 'waiting_for_tool')) this.transitionTurn(turn.id, 'waiting_for_tool', { source: 'opencode' });
    if (mapped.type === 'tool.completed' && canTransition(turn.status, 'running')) this.transitionTurn(turn.id, 'running', { source: 'opencode' });
    if (mapped.type === 'context.compaction.started' && canTransition(turn.status, 'compacting')) {
      this.transitionTurn(turn.id, 'compacting', { source: 'opencode' });
    }
    this.applyItemAndContextSideEffects(turn, mapped);
    const event = this.emitEvent(mapped.type, turn.threadId, turn.id, mapped.payload);
    if (mapped.type === 'context.compaction.completed' || mapped.type === 'context.compaction.failed') {
      if (canTransition(turn.status, 'running')) this.transitionTurn(turn.id, 'running', { source: 'opencode' });
    }
    return cloneJson(event);
  }

  applyItemAndContextSideEffects(turn, mapped) {
    const data = mapped.payload?.data && typeof mapped.payload.data === 'object' ? mapped.payload.data : {};
    if (mapped.type === 'tool.started' || mapped.type === 'tool.progress' || mapped.type === 'tool.completed') {
      const callId = String(mapped.payload.callId || '');
      if (!callId) return;
      const status = mapped.type === 'tool.completed'
        ? (String(mapped.payload.status || '') === 'error' ? 'failed' : 'completed')
        : 'running';
      this.upsertItem(turn.id, {
        id: toolItemId(turn.id, callId),
        type: 'tool_call',
        status,
        payload: {
          callId,
          tool: String(mapped.payload.tool || ''),
          capabilities: classifyToolCapabilities(mapped.payload.tool || ''),
          output: clipText(data.part?.state?.output ?? data.state?.output ?? data.output ?? '', 2_000)
        }
      });
      return;
    }
    if (mapped.payload?.rawType === 'message.updated') {
      const info = data.info || {};
      if (String(info?.role || '') === 'assistant') {
        const observed = contextTokensOf(info);
        if (observed > 0) this.updateContextStats(turn, { lastObservedTokens: observed });
      }
      return;
    }
    if (mapped.type === 'context.updated') {
      this.updateContextStats(turn, {
        window: Number(data.contextWindow ?? data.window) || undefined,
        softThreshold: Number(data.softThreshold ?? data.threshold) || undefined
      });
      return;
    }
    if (mapped.type === 'context.compaction.started') {
      this.upsertItem(turn.id, {
        id: `${turn.id}:compaction:${Number(data.count || data.round) || (turn.contextStats?.compactionCount || 0) + 1}`,
        type: 'compaction',
        status: 'running',
        payload: { beforeTokens: Number(data.beforeTokens) || 0, threshold: Number(data.threshold) || 0 }
      });
      return;
    }
    if (mapped.type === 'context.compaction.completed') {
      const afterTokens = Number(data.afterTokens) || 0;
      const compactionIndex = Number(data.count || data.round) || (turn.contextStats?.compactionCount || 0) + 1;
      this.updateContextStats(turn, {
        compactionReset: true,
        contextTokens: afterTokens,
        compactionCount: (turn.contextStats?.compactionCount || 0) + 1
      });
      this.upsertItem(turn.id, {
        id: `${turn.id}:compaction:${compactionIndex}`,
        type: 'compaction',
        status: 'completed',
        payload: {
          beforeTokens: Number(data.beforeTokens) || 0,
          afterTokens,
          threshold: Number(data.threshold) || 0,
          automatic: data.automatic !== false
        }
      });
      return;
    }
    if (mapped.type === 'context.compaction.failed') {
      this.upsertItem(turn.id, {
        id: `${turn.id}:compaction:${Number(data.count || data.round) || (turn.contextStats?.compactionCount || 0) + 1}`,
        type: 'compaction',
        status: 'failed',
        payload: { error: clipText(data.message || data.error || '', 1_000) }
      });
    }
    if (mapped.type === 'file.edited') {
      const filePath = data.file || data.path || data.filename || '';
      if (filePath) {
        this.upsertItem(turn.id, {
          id: fileItemId(turn.id, filePath),
          type: 'file_change',
          status: 'completed',
          payload: {
            file: clipText(filePath, 1_024),
            status: clipText(data.status || 'modified', 40),
            additions: Math.max(0, Number(data.additions) || 0),
            deletions: Math.max(0, Number(data.deletions) || 0)
          }
        });
      }
    }
  }

  completeTurn(runId, result = {}) {
    const turnId = String(runId || '');
    const turn = this.state.turns[turnId];
    if (!turn) return null;
    const normalized = normalizeResult(result);
    if (isTerminalTurnStatus(turn.status)) {
      // Already settled (cancel ack timeout, watchdog). Keep the late provider
      // outcome for audit, but pin result.status to the settled state and do
      // not emit a second terminal event.
      turn.result = {
        ...(turn.result || {}),
        ...normalized,
        status: turn.status === 'completed' ? 'done'
          : turn.status === 'aborted' ? 'interrupted'
            : turn.status === 'failed' ? 'error'
              : (turn.result?.status || normalized.status)
      };
      this.persist();
      return cloneJson(turn);
    }
    const lateSuccess = turn.cancelRequested
      && ['done', 'completed', 'success'].includes(String(normalized.status || '').toLowerCase());
    // A cancellation timeout can settle the Turn before a provider's promise
    // resolves. Do not let that late success overwrite the aborted result or
    // create a misleading final assistant Item.
    if (lateSuccess) {
      turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || Date.now());
      turn.telemetry.cancelSettledAt ||= Number(this.clock()) || Date.now();
      this.clearCancelTimer(turnId);
      if (!isTerminalTurnStatus(turn.status)) {
        turn.result = {
          ...(turn.result || {}),
          status: 'interrupted',
          text: turn.result?.text || '',
          error: ''
        };
        this.transitionTurn(turn.id, 'aborted', { reason: 'late_success_after_cancel' });
      }
      this.persist();
      return cloneJson(turn);
    }
    this.clearCancelTimer(turnId);
    if (!turn.result) turn.result = normalized;
    else turn.result = { ...turn.result, ...normalized };
    turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || Date.now());
    turn.telemetry.finalSubmittedAt = Number(this.clock()) || Date.now();
    if (turn.telemetry.firstTokenAt) {
      turn.telemetry.firstTokenToFinalMs = Math.max(0, turn.telemetry.finalSubmittedAt - turn.telemetry.firstTokenAt);
    }
    if (turn.telemetry.cancelRequestedAt) {
      turn.telemetry.cancelLatencyMs = Math.max(0, turn.telemetry.finalSubmittedAt - turn.telemetry.cancelRequestedAt);
    }
    this.deriveFinalItems(turn, result);
    const requestedStatus = turn.status === 'aborted' || turn.cancelRequested
      ? 'aborted'
      : (['done', 'completed', 'success'].includes(String(normalized.status || '').toLowerCase()) ? 'completed'
        : (normalized.status === 'interrupted' ? 'aborted'
          : (normalized.status === 'error' ? 'failed' : 'incomplete')));
    if (!isTerminalTurnStatus(turn.status)) this.transitionTurn(turn.id, requestedStatus, { result: cloneJson(turn.result) });
    else this.persist();
    return cloneJson(turn);
  }

  // Finalization converges everything the live event stream may have missed:
  // tool calls, the final message, usage, and an explicit error item.
  deriveFinalItems(turn, result = {}) {
    const toolCalls = Array.isArray(result.toolCalls) ? result.toolCalls.slice(0, MAX_ITEMS_PER_TURN) : [];
    for (const call of toolCalls) {
      const callId = String(call?.callId || '');
      if (!callId) continue;
      this.upsertItem(turn.id, {
        id: toolItemId(turn.id, callId),
        type: 'tool_call',
        status: call?.ok === true || String(call?.status || '') === 'completed' ? 'completed' : 'failed',
        payload: {
          callId,
          tool: String(call?.name || ''),
          capabilities: classifyToolCapabilities(call?.name || ''),
          output: clipText(call?.output ?? '', 2_000)
        }
      });
    }
    const changes = Array.isArray(result.changes) ? result.changes.slice(0, MAX_ITEMS_PER_TURN) : [];
    for (const change of changes) {
      const filePath = String(change?.path || change?.file || '').trim();
      if (!filePath) continue;
      this.upsertItem(turn.id, {
        id: fileItemId(turn.id, filePath),
        type: 'file_change',
        status: 'completed',
        payload: {
          file: clipText(filePath, 1_024),
          status: clipText(change?.status || 'modified', 40),
          additions: Math.max(0, Number(change?.additions) || 0),
          deletions: Math.max(0, Number(change?.deletions) || 0),
          ...(change?.diff ? { diff: clipText(change.diff, 16_000) } : {})
        }
      });
    }
    this.upsertItem(turn.id, {
      id: `${turn.id}:message`,
      type: 'message',
      status: normalizedStatusOf(result),
      payload: { text: clipText(result?.text ?? '', 4_000), emptyFinalText: result?.emptyFinalText === true }
    });
    if (result?.usage && typeof result.usage === 'object') {
      this.updateContextStats(turn, { contextTokens: Number(result.usage.contextTokens) || undefined });
      this.upsertItem(turn.id, {
        id: `${turn.id}:context`,
        type: 'context',
        status: 'completed',
        payload: {
          input: Number(result.usage.input) || 0,
          output: Number(result.usage.output) || 0,
          cacheRead: Number(result.usage.cacheRead) || 0,
          cacheWrite: Number(result.usage.cacheWrite) || 0,
          cost: Number(result.usage.cost) || 0
        }
      });
    }
    const errorText = String(result?.error || '').trim();
    if (errorText) {
      this.upsertItem(turn.id, {
        id: `${turn.id}:error`,
        type: 'error',
        status: 'failed',
        payload: { message: clipText(errorText, 2_000) }
      });
    }
  }

  requestCancel(runId, reason = 'user_cancelled') {
    const turn = this.state.turns[String(runId || '')];
    if (!turn) return { ok: false, cancelled: false, error: 'Yan Turn 不存在。' };
    if (isTerminalTurnStatus(turn.status)) return { ok: true, cancelled: false, alreadySettled: true, status: turn.status };
    if (turn.cancelRequested) return { ok: true, cancelled: true, pending: true, turn: cloneJson(turn) };
    turn.cancelRequested = true;
    turn.cancelReason = clipText(reason, 240);
    turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || Date.now());
    turn.telemetry.cancelRequestedAt ||= Number(this.clock()) || Date.now();
    // Three-phase cancel: requested -> kernel settles -> turn.aborted via
    // completeTurn(). The turn stays non-terminal so provider events keep
    // flowing; the ack timeout force-settles a wedged kernel.
    this.emitEvent('turn.cancel.requested', turn.threadId, turn.id, {
      reason: turn.cancelReason,
      turn: cloneJson(turn)
    });
    this.scheduleCancelTimeout(turn.id);
    return { ok: true, cancelled: true, turn: cloneJson(turn) };
  }

  scheduleCancelTimeout(turnId) {
    const id = String(turnId || '');
    if (!id || this.cancelTimers.has(id)) return;
    const timer = setTimeout(() => {
      this.cancelTimers.delete(id);
      const turn = this.state.turns[id];
      if (!turn || isTerminalTurnStatus(turn.status) || !turn.cancelRequested) return;
      this.logger?.warn?.(`[yan-core] cancel ack timeout for ${id}; force-settling as aborted.`);
      this.transitionTurn(id, 'aborted', { reason: 'cancel_ack_timeout' });
    }, this.cancelTimeoutMs);
    timer.unref?.();
    this.cancelTimers.set(id, timer);
  }

  clearCancelTimer(turnId) {
    const id = String(turnId || '');
    const timer = this.cancelTimers.get(id);
    if (!timer) return;
    clearTimeout(timer);
    this.cancelTimers.delete(id);
  }

  recoverInterruptedTurns() {
    const recovered = [];
    for (const turn of Object.values(this.state.turns)) {
      if (isTerminalTurnStatus(turn.status) || turn.status === 'recovering') continue;
      const previousStatus = turn.status;
      turn.recovery = { previousStatus, recoveredAt: Number(this.clock()) || Date.now() };
      turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || Date.now());
      turn.telemetry.recoveryCount = Math.max(0, Number(turn.telemetry.recoveryCount) || 0) + 1;
      if (canTransition(previousStatus, 'recovering')) {
        transitionTurn(turn, 'recovering', { now: this.clock });
        const thread = this.state.threads[turn.threadId];
        if (thread) {
          thread.status = 'recovering';
          thread.activeTurnId = turn.id;
          thread.updatedAt = Number(this.clock()) || Date.now();
        }
        this.emitEvent('thread.recovered', turn.threadId, turn.id, {
          previousStatus,
          thread: cloneJson(this.state.threads[turn.threadId]),
          turn: cloneJson(turn)
        });
        recovered.push(cloneJson(turn));
      }
    }
    if (recovered.length) this.persist();
    return recovered;
  }

  recordTelemetry(turnId, patch = {}) {
    const turn = this.state.turns[String(turnId || '')];
    if (!turn || !patch || typeof patch !== 'object') return null;
    turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || Date.now());
    for (const key of Object.keys(defaultTelemetry())) {
      if (!Object.prototype.hasOwnProperty.call(patch, key)) continue;
      const value = Number(patch[key]);
      if (!Number.isFinite(value) || value < 0) continue;
      if (key.endsWith('At')) turn.telemetry[key] = value || turn.telemetry[key] || 0;
      else turn.telemetry[key] = Math.max(0, value);
    }
    turn.updatedAt = Number(this.clock()) || Date.now();
    this.persist();
    return cloneJson(turn.telemetry);
  }

  recordBackpressure(turnId, info = {}) {
    const turn = this.state.turns[String(turnId || '')];
    if (!turn) return null;
    turn.telemetry ||= defaultTelemetry(Number(turn.createdAt) || Date.now());
    turn.telemetry.backpressureDrops = Math.max(0, Number(turn.telemetry.backpressureDrops) || 0)
      + Math.max(0, Number(info.dropped || info.droppedTotal || 0) || 0);
    turn.updatedAt = Number(this.clock()) || Date.now();
    this.emitEvent('provider.event', turn.threadId, turn.id, {
      kind: 'backpressure',
      dropped: Math.max(0, Number(info.dropped || info.droppedTotal || 0) || 0),
      pending: Math.max(0, Number(info.pending) || 0),
      cap: Math.max(0, Number(info.cap) || 0),
      telemetry: cloneJson(turn.telemetry)
    });
    return cloneJson(turn.telemetry);
  }

  deleteThread(threadId, { force = false } = {}) {
    const id = String(threadId || '');
    const thread = this.state.threads[id];
    if (!thread) return { ok: false, error: 'Yan Thread 不存在。', code: 'YAN_THREAD_NOT_FOUND' };
    const turns = Object.values(this.state.turns).filter(turn => String(turn.threadId) === id);
    const active = turns.find(turn => !isTerminalTurnStatus(turn.status));
    if (active && !force) {
      return { ok: false, error: 'Thread 仍有运行中的 Turn。', code: 'YAN_THREAD_RUNNING', turnId: active.id };
    }
    for (const timerId of turns.map(turn => turn.id)) this.clearCancelTimer(timerId);
    const turnIds = turns.map(turn => turn.id);
    const itemIds = Object.values(this.state.items)
      .filter(item => String(item.threadId) === id)
      .map(item => item.id);
    const intentIds = Object.values(this.state.intents)
      .filter(intent => String(intent.threadId) === id)
      .map(intent => intent.id);
    delete this.state.threads[id];
    for (const turnId of turnIds) {
      delete this.state.turns[turnId];
      this.turnToThread.delete(turnId);
    }
    for (const itemId of itemIds) delete this.state.items[itemId];
    for (const intentId of intentIds) delete this.state.intents[intentId];
    this.persist();
    this.emitEvent('thread.deleted', id, '', { turnIds, itemIds, intentIds });
    return { ok: true, id, turnIds, itemIds, intentIds };
  }
}

module.exports = {
  PROVIDER_EVENT_MAP,
  YanCore,
  emptyState,
  mapProviderEvent
};

'use strict';

const { cloneJson } = require('./protocol');

function emptyProjection() {
  return { threads: {}, turns: {}, intents: {}, items: {}, lastSequence: 0 };
}

function isTerminal(status) {
  return ['completed', 'aborted', 'failed', 'incomplete'].includes(String(status || ''));
}

class YanEventProjector {
  constructor(initialState = null) {
    this.state = { ...emptyProjection(), ...(cloneJson(initialState) || {}) };
    this.state.threads ||= {};
    this.state.turns ||= {};
    this.state.intents ||= {};
    this.state.items ||= {};
    this.state.lastSequence = Math.max(0, Number(this.state.lastSequence) || 0);
    this.seenEventIds = new Set();
  }

  apply(event, { snapshot = true } = {}) {
    if (!event || typeof event !== 'object') return { applied: false, reason: 'invalid_event' };
    const eventId = String(event.eventId || '');
    const sequence = Number(event.sequence) || 0;
    if (eventId && this.seenEventIds.has(eventId)) return { applied: false, reason: 'duplicate' };
    if (this.state.lastSequence > 0 && sequence <= this.state.lastSequence) return { applied: false, reason: 'out_of_order' };
    if (eventId) this.seenEventIds.add(eventId);
    this.state.lastSequence = Math.max(this.state.lastSequence, sequence);
    const threadId = String(event.threadId || '');
    const turnId = String(event.turnId || '');
    const payload = event.payload && typeof event.payload === 'object' ? event.payload : {};
    if (event.type === 'thread.created' || event.type === 'thread.updated' || event.type === 'thread.recovered') {
      const threadPatch = payload.thread && typeof payload.thread === 'object'
        ? payload.thread
        : payload;
      if (threadId) {
        this.state.threads[threadId] = {
          ...(this.state.threads[threadId] || { id: threadId, turnIds: [] }),
          ...cloneJson(threadPatch || {})
        };
        this.state.threads[threadId].turnIds = Array.isArray(this.state.threads[threadId].turnIds)
          ? this.state.threads[threadId].turnIds
          : [];
      }
    }
    if (event.type === 'turn.queued' || event.type === 'turn.dequeued') {
      const intent = payload.intent && typeof payload.intent === 'object' ? payload.intent : null;
      if (intent?.id) {
        this.state.intents[intent.id] = {
          ...(this.state.intents[intent.id] || {}),
          ...cloneJson(intent)
        };
      }
    }
    if (event.type === 'item.created' || event.type === 'item.updated') {
      const item = payload.item && typeof payload.item === 'object' ? payload.item : null;
      if (item?.id) {
        this.state.items[item.id] = {
          ...(this.state.items[item.id] || {}),
          ...cloneJson(item)
        };
        const ownerTurnId = String(item.turnId || turnId || '');
        const ownerTurn = ownerTurnId ? this.state.turns[ownerTurnId] : null;
        if (ownerTurn) {
          ownerTurn.itemIds = Array.isArray(ownerTurn.itemIds) ? ownerTurn.itemIds : [];
          if (!ownerTurn.itemIds.includes(item.id)) ownerTurn.itemIds.push(item.id);
        }
      }
    }
    if (event.type === 'item.pruned' && Array.isArray(payload.itemIds)) {
      for (const itemId of payload.itemIds) {
        delete this.state.items[String(itemId || '')];
        const itemKey = String(itemId || '');
        for (const ownerTurn of Object.values(this.state.turns)) {
          if (Array.isArray(ownerTurn.itemIds)) ownerTurn.itemIds = ownerTurn.itemIds.filter(id => id !== itemKey);
        }
      }
    }
    const turnLifecycleTypes = new Set([
      'turn.created', 'turn.started', 'turn.running', 'turn.retrying',
      'turn.cancel.requested', 'turn.waiting_for_tool', 'turn.waiting_for_user',
      'turn.compacting', 'turn.completed', 'turn.aborted', 'turn.failed',
      'turn.incomplete', 'context.updated', 'context.compacted',
      'context.compaction.started', 'context.compaction.completed',
      'context.compaction.failed',
      'delivery.acceptance.started', 'delivery.acceptance.repaired',
      'delivery.acceptance.passed', 'delivery.acceptance.failed'
    ]);
    if (turnLifecycleTypes.has(event.type) && turnId) {
      const existing = this.state.turns[turnId] || { id: turnId, threadId, itemIds: [] };
      const next = { ...existing };
      if (payload.turn && typeof payload.turn === 'object') Object.assign(next, cloneJson(payload.turn));
      if (payload.telemetry && typeof payload.telemetry === 'object') {
        next.telemetry = { ...(next.telemetry || {}), ...cloneJson(payload.telemetry) };
      }
      if (payload.contextStats && typeof payload.contextStats === 'object') {
        next.contextStats = { ...(next.contextStats || {}), ...cloneJson(payload.contextStats) };
      }
      if (!next.threadId) next.threadId = threadId;
      if (!next.id) next.id = turnId;
      next.itemIds = Array.isArray(next.itemIds) ? next.itemIds : [];
      const statusByEvent = {
        'turn.running': 'running',
        'turn.retrying': next.status || 'running',
        'turn.started': 'running',
        'turn.cancel.requested': next.status || 'running',
        'turn.waiting_for_tool': 'waiting_for_tool',
        'turn.waiting_for_user': 'waiting_for_user',
        'turn.compacting': 'compacting',
        'turn.completed': 'completed',
        'turn.aborted': 'aborted',
        'turn.failed': 'failed',
        'turn.incomplete': 'incomplete'
      };
      if (statusByEvent[event.type] && !(payload.turn && payload.turn.status)) next.status = statusByEvent[event.type];
      this.state.turns[turnId] = next;
      const ownerThreadId = String(next.threadId || threadId || '');
      if (ownerThreadId) {
        const ownerThread = this.state.threads[ownerThreadId] ||= { id: ownerThreadId, turnIds: [], status: 'idle', activeTurnId: '' };
        const hasThreadSnapshot = payload.thread && typeof payload.thread === 'object';
        if (hasThreadSnapshot) Object.assign(ownerThread, cloneJson(payload.thread));
        ownerThread.turnIds = Array.isArray(ownerThread.turnIds) ? ownerThread.turnIds : [];
        if (!ownerThread.turnIds.includes(turnId)) ownerThread.turnIds.push(turnId);
        if (isTerminal(next.status)) {
          if (ownerThread.activeTurnId === turnId) ownerThread.activeTurnId = '';
          if (!ownerThread.activeTurnId) ownerThread.status = 'idle';
        } else {
          ownerThread.activeTurnId = turnId;
          ownerThread.status = next.status || 'running';
        }
        if (!hasThreadSnapshot) ownerThread.updatedAt = Number(next.updatedAt || event.timestamp) || ownerThread.updatedAt || 0;
      }
    }
    if (event.type === 'thread.recovered' && turnId && payload.turn && typeof payload.turn === 'object') {
      const recovered = cloneJson(payload.turn);
      this.state.turns[turnId] = {
        ...(this.state.turns[turnId] || {}),
        ...recovered,
        telemetry: { ...(this.state.turns[turnId]?.telemetry || {}), ...(recovered.telemetry || {}) },
        itemIds: Array.isArray(recovered.itemIds) ? recovered.itemIds : (this.state.turns[turnId]?.itemIds || [])
      };
      const ownerThread = this.state.threads[String(recovered.threadId || threadId || '')];
      if (ownerThread) {
        ownerThread.activeTurnId = turnId;
        ownerThread.status = recovered.status || 'recovering';
        ownerThread.turnIds = Array.isArray(ownerThread.turnIds) ? ownerThread.turnIds : [];
        if (!ownerThread.turnIds.includes(turnId)) ownerThread.turnIds.push(turnId);
      }
    }
    if (event.type === 'thread.deleted') {
      const deletedTurnIds = new Set((Array.isArray(payload.turnIds) ? payload.turnIds : []).map(id => String(id || '')));
      const deletedItemIds = new Set((Array.isArray(payload.itemIds) ? payload.itemIds : []).map(id => String(id || '')));
      const deletedIntentIds = new Set((Array.isArray(payload.intentIds) ? payload.intentIds : []).map(id => String(id || '')));
      for (const [id, turn] of Object.entries(this.state.turns)) if (deletedTurnIds.has(id) || String(turn.threadId) === threadId) delete this.state.turns[id];
      for (const [id, item] of Object.entries(this.state.items)) if (deletedItemIds.has(id) || String(item.threadId) === threadId) delete this.state.items[id];
      for (const [id, intent] of Object.entries(this.state.intents)) if (deletedIntentIds.has(id) || String(intent.threadId) === threadId) delete this.state.intents[id];
      delete this.state.threads[threadId];
    }
    return snapshot ? { applied: true, state: this.snapshot() } : { applied: true };
  }

  applyAll(events = [], { collectResults = true } = {}) {
    const results = [];
    if (!events || typeof events[Symbol.iterator] !== 'function') return results;
    for (const event of events) {
      const result = this.apply(event, { snapshot: false });
      if (collectResults) results.push(result);
    }
    return results;
  }

  snapshot() {
    return cloneJson(this.state);
  }
}

module.exports = { YanEventProjector, emptyProjection };

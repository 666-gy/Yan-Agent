'use strict';

const crypto = require('node:crypto');

const PROTOCOL_VERSION = 1;
const MAX_ID_LENGTH = 160;
const MAX_TEXT_LENGTH = 16_000;
const MAX_EVENT_PAYLOAD_BYTES = 128 * 1024;

const TURN_STATUSES = Object.freeze([
  'created',
  'queued',
  'running',
  'waiting_for_tool',
  'waiting_for_user',
  'compacting',
  'completed',
  'aborted',
  'failed',
  'incomplete',
  'recovering'
]);

const TERMINAL_TURN_STATUSES = new Set(['completed', 'aborted', 'failed', 'incomplete']);

const EVENT_TYPES = Object.freeze([
  'thread.created',
  'thread.recovered',
  'thread.updated',
  'thread.deleted',
  'turn.created',
  'turn.queued',
  'turn.dequeued',
  'turn.retrying',
  'turn.started',
  'turn.cancel.requested',
  'turn.waiting_for_tool',
  'turn.waiting_for_user',
  'turn.compacting',
  'turn.completed',
  'turn.aborted',
  'turn.failed',
  'turn.incomplete',
  'item.created',
  'item.updated',
  'item.pruned',
  'message.delta',
  'reasoning.delta',
  'tool.started',
  'tool.progress',
  'tool.completed',
  'context.updated',
  'context.compacted',
  'context.compaction.started',
  'context.compaction.completed',
  'context.compaction.failed',
  'delivery.acceptance.started',
  'delivery.acceptance.repaired',
  'delivery.acceptance.passed',
  'delivery.acceptance.failed',
  'file.edited',
  'provider.event',
  'provider.error',
  'event.ignored'
]);

// A persisted Item is the unit of work inside a Turn: a message, a tool call,
// a compaction, a file change, or a context snapshot. Events remain the
// transport; Items are the replayable state.
const ITEM_TYPES = Object.freeze([
  'message',
  'reasoning',
  'tool_call',
  'file_change',
  'compaction',
  'context',
  'error'
]);

const ACTIVE_ITEM_STATUSES = Object.freeze(['created', 'running']);
const TERMINAL_ITEM_STATUSES = Object.freeze(['completed', 'failed', 'cancelled']);
const MAX_ITEMS_PER_TURN = 400;

function now() {
  return Date.now();
}

function makeId(prefix = 'id', idFactory = null) {
  if (typeof idFactory === 'function') return String(idFactory(prefix));
  return `${prefix}_${now().toString(36)}_${crypto.randomBytes(5).toString('hex')}`;
}

function normalizeId(value, fallbackPrefix = 'id', idFactory = null) {
  const normalized = String(value || '').trim().slice(0, MAX_ID_LENGTH);
  return normalized || makeId(fallbackPrefix, idFactory);
}

function clipText(value, max = MAX_TEXT_LENGTH) {
  return String(value ?? '').replace(/\r\n?/g, '\n').slice(0, max);
}

function cloneJson(value) {
  if (value === undefined) return undefined;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return String(value);
  }
}

function payloadWithinLimit(value, maxBytes = MAX_EVENT_PAYLOAD_BYTES) {
  const cloned = cloneJson(value);
  if (cloned === undefined) return {};
  try {
    const serialized = JSON.stringify(cloned);
    if (Buffer.byteLength(serialized, 'utf8') <= maxBytes) return cloned;
    return {
      truncated: true,
      preview: clipText(serialized, Math.max(256, maxBytes - 64))
    };
  } catch {
    return { truncated: true, preview: clipText(String(value), maxBytes - 64) };
  }
}

function normalizeConfigSnapshot(input = {}) {
  const snapshot = cloneJson(input && typeof input === 'object' ? input : {});
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) return {};
  return snapshot;
}

function normalizeIntent(input = {}) {
  const intent = input && typeof input === 'object' ? input : {};
  const attachments = Array.isArray(intent.attachments)
    ? intent.attachments.slice(0, 32).map(item => ({
      name: clipText(item?.name, 240),
      mimeType: clipText(item?.mimeType, 160),
      size: Math.max(0, Number(item?.size) || 0),
      path: clipText(item?.path, 1_024)
    })).filter(item => item.name || item.path)
    : [];
  const selectedSkills = Array.isArray(intent.selectedSkills)
    ? intent.selectedSkills.slice(0, 64).map(skill => ({
      id: clipText(typeof skill === 'string' ? skill : skill?.id, 160),
      name: clipText(typeof skill === 'string' ? skill : skill?.name, 160)
    })).filter(skill => skill.id || skill.name)
    : [];
  return {
    prompt: clipText(intent.prompt, MAX_TEXT_LENGTH),
    attachments,
    selectedSkills,
    skillCalls: Array.isArray(intent.skillCalls) ? cloneJson(intent.skillCalls.slice(0, 64)) : [],
    modelSelection: intent.modelSelection && typeof intent.modelSelection === 'object'
      ? payloadWithinLimit(intent.modelSelection, 8 * 1024)
      : null,
    workMode: clipText(intent.workMode, 40),
    createdAt: Number(intent.createdAt) || now()
  };
}

function normalizeDeliveryContract(input) {
  if (!input || typeof input !== 'object') return null;
  const contract = {};
  for (const field of ['intent', 'artifact', 'scope', 'direction', 'worldview', 'decisions', 'acceptance']) {
    const value = clipText(input[field], 1_200);
    if (value) contract[field] = value;
  }
  return Object.keys(contract).length ? contract : null;
}

function normalizeDeliveryReview(input) {
  if (!input || typeof input !== 'object') return null;
  const review = {};
  const contractId = clipText(input.contractId, 64);
  const verdict = clipText(input.verdict, 24);
  if (contractId) review.contractId = contractId;
  if (verdict) review.verdict = verdict;
  if (input.criteria && typeof input.criteria === 'object') {
    review.criteria = payloadWithinLimit(input.criteria, 16 * 1024);
  }
  return Object.keys(review).length ? review : null;
}

function normalizeResult(input = {}) {
  const result = input && typeof input === 'object' ? input : {};
  const delivery = result.delivery && typeof result.delivery === 'object'
    ? {
      intent: clipText(result.delivery.intent, 32),
      artifact: clipText(result.delivery.artifact, 32),
      acceptanceRounds: Math.max(0, Number(result.delivery.acceptanceRounds) || 0),
      repairRounds: Math.max(0, Number(result.delivery.repairRounds) || 0),
      verified: result.delivery.verified === true,
      skipped: result.delivery.skipped === true,
      skipReason: clipText(result.delivery.skipReason, 32),
      prechecked: result.delivery.prechecked === true,
      visualWaived: result.delivery.visualWaived === true,
      visualOptOut: result.delivery.visualOptOut === true,
      failure: clipText(result.delivery.failure, 2_000),
      contractId: clipText(result.delivery.contractId, 64)
    }
    : null;
  if (delivery) {
    const contract = normalizeDeliveryContract(result.delivery.contract);
    const review = normalizeDeliveryReview(result.delivery.review);
    if (contract) delivery.contract = contract;
    if (review) delivery.review = review;
  }
  return {
    status: clipText(result.status, 32),
    text: clipText(result.text ?? result.textContent, MAX_TEXT_LENGTH),
    error: clipText(result.error, 4_000),
    completedAt: Number(result.completedAt) || 0,
    openCodeSessionId: clipText(result.openCodeSessionId, 240),
    ...(delivery ? { delivery } : {})
  };
}

function createThread(input = {}, { clock = now, idFactory = null } = {}) {
  const timestamp = Number(clock()) || now();
  return {
    id: normalizeId(input.id, 'thread', idFactory),
    workspace: clipText(input.workspace, 1_024),
    title: clipText(input.title || '新对话', 240),
    status: 'idle',
    activeTurnId: '',
    turnIds: [],
    createdAt: timestamp,
    updatedAt: timestamp,
    metadata: payloadWithinLimit(input.metadata || {}, 16 * 1024)
  };
}

function createTurn(input = {}, { clock = now, idFactory = null } = {}) {
  const timestamp = Number(clock()) || now();
  const threadId = normalizeId(input.threadId, 'thread', idFactory);
  return {
    id: normalizeId(input.id, 'turn', idFactory),
    threadId,
    status: 'created',
    cancelRequested: false,
    configSnapshotId: normalizeId(input.configSnapshotId || input.snapshotId, 'snapshot', idFactory),
    configSnapshot: normalizeConfigSnapshot(input.configSnapshot),
    intent: normalizeIntent(input.intent),
    itemIds: Array.isArray(input.itemIds) ? input.itemIds.map(id => String(id || '')).filter(Boolean).slice(0, MAX_ITEMS_PER_TURN) : [],
    telemetry: {
      intentReceivedAt: Number(input.telemetry?.intentReceivedAt) || timestamp,
      firstEventAt: Number(input.telemetry?.firstEventAt) || 0,
      firstTokenAt: Number(input.telemetry?.firstTokenAt) || 0,
      firstToolCompletedAt: Number(input.telemetry?.firstToolCompletedAt) || 0,
      finalSubmittedAt: Number(input.telemetry?.finalSubmittedAt) || 0,
      cancelRequestedAt: Number(input.telemetry?.cancelRequestedAt) || 0,
      cancelSettledAt: Number(input.telemetry?.cancelSettledAt) || 0,
      eventCount: Math.max(0, Number(input.telemetry?.eventCount) || 0),
      retries: Math.max(0, Number(input.telemetry?.retries) || 0),
      backpressureDrops: Math.max(0, Number(input.telemetry?.backpressureDrops) || 0),
      recoveryCount: Math.max(0, Number(input.telemetry?.recoveryCount) || 0),
      intentToTurnMs: Math.max(0, Number(input.telemetry?.intentToTurnMs) || 0),
      intentToFirstEventMs: Math.max(0, Number(input.telemetry?.intentToFirstEventMs) || 0),
      intentToFirstTokenMs: Math.max(0, Number(input.telemetry?.intentToFirstTokenMs) || 0),
      firstTokenToFinalMs: Math.max(0, Number(input.telemetry?.firstTokenToFinalMs) || 0),
      cancelLatencyMs: Math.max(0, Number(input.telemetry?.cancelLatencyMs) || 0)
    },
    result: null,
    createdAt: timestamp,
    startedAt: 0,
    completedAt: 0,
    updatedAt: timestamp,
    recovery: null
  };
}

function createEvent(input = {}, { clock = now, sequence = 0, idFactory = null } = {}) {
  const type = String(input.type || 'provider.event');
  return {
    protocolVersion: PROTOCOL_VERSION,
    eventId: normalizeId(input.eventId, 'evt', idFactory),
    sequence: Math.max(0, Number(sequence) || 0),
    type: EVENT_TYPES.includes(type) ? type : 'provider.event',
    threadId: input.threadId ? normalizeId(input.threadId, 'thread', idFactory) : '',
    turnId: input.turnId ? normalizeId(input.turnId, 'turn', idFactory) : '',
    timestamp: Number(input.timestamp) || Number(clock()) || now(),
    payload: payloadWithinLimit(input.payload || {})
  };
}

function isTerminalTurnStatus(status) {
  return TERMINAL_TURN_STATUSES.has(String(status || ''));
}

function createItem(input = {}, { clock = now, idFactory = null } = {}) {
  const timestamp = Number(clock()) || now();
  const type = ITEM_TYPES.includes(input.type) ? input.type : 'message';
  const status = [...ACTIVE_ITEM_STATUSES, ...TERMINAL_ITEM_STATUSES].includes(input.status)
    ? input.status
    : 'created';
  return {
    id: normalizeId(input.id, 'item', idFactory),
    threadId: input.threadId ? normalizeId(input.threadId, 'thread', idFactory) : '',
    turnId: input.turnId ? normalizeId(input.turnId, 'turn', idFactory) : '',
    type,
    status,
    payload: payloadWithinLimit(input.payload || {}, 32 * 1024),
    createdAt: Number(input.createdAt) || timestamp,
    updatedAt: timestamp
  };
}

function isTerminalItemStatus(status) {
  return TERMINAL_ITEM_STATUSES.includes(String(status || ''));
}

function publicTurn(turn) {
  if (!turn) return null;
  return cloneJson(turn);
}

module.exports = {
  ACTIVE_ITEM_STATUSES,
  EVENT_TYPES,
  ITEM_TYPES,
  MAX_EVENT_PAYLOAD_BYTES,
  MAX_ITEMS_PER_TURN,
  PROTOCOL_VERSION,
  TERMINAL_ITEM_STATUSES,
  TERMINAL_TURN_STATUSES,
  TURN_STATUSES,
  clipText,
  cloneJson,
  createEvent,
  createItem,
  createThread,
  createTurn,
  isTerminalItemStatus,
  isTerminalTurnStatus,
  makeId,
  normalizeConfigSnapshot,
  normalizeId,
  normalizeIntent,
  normalizeResult,
  payloadWithinLimit,
  publicTurn
};

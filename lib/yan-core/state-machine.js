'use strict';

const { TURN_STATUSES } = require('./protocol');

const ALLOWED_TRANSITIONS = Object.freeze({
  created: new Set(['queued', 'running', 'recovering', 'aborted', 'failed']),
  queued: new Set(['running', 'aborted', 'failed']),
  running: new Set(['waiting_for_tool', 'waiting_for_user', 'compacting', 'recovering', 'completed', 'aborted', 'failed', 'incomplete']),
  waiting_for_tool: new Set(['running', 'waiting_for_user', 'compacting', 'recovering', 'completed', 'aborted', 'failed', 'incomplete']),
  waiting_for_user: new Set(['running', 'waiting_for_tool', 'recovering', 'completed', 'aborted', 'failed', 'incomplete']),
  compacting: new Set(['running', 'recovering', 'aborted', 'failed', 'incomplete']),
  recovering: new Set(['queued', 'running', 'aborted', 'failed']),
  completed: new Set(),
  aborted: new Set(),
  failed: new Set(),
  incomplete: new Set()
});

class InvalidTurnTransitionError extends Error {
  constructor(from, to, turnId = '') {
    super(`Invalid Yan Turn transition${turnId ? ` for ${turnId}` : ''}: ${from} -> ${to}`);
    this.name = 'InvalidTurnTransitionError';
    this.code = 'YAN_INVALID_TURN_TRANSITION';
    this.from = from;
    this.to = to;
    this.turnId = turnId;
  }
}

function isKnownTurnStatus(status) {
  return TURN_STATUSES.includes(String(status || ''));
}

function canTransition(from, to) {
  const source = String(from || '');
  const target = String(to || '');
  if (!isKnownTurnStatus(source) || !isKnownTurnStatus(target)) return false;
  if (source === target) return true;
  return ALLOWED_TRANSITIONS[source]?.has(target) === true;
}

function assertTransition(from, to, turnId = '') {
  if (!canTransition(from, to)) throw new InvalidTurnTransitionError(from, to, turnId);
  return true;
}

function transitionTurn(turn, nextStatus, { now = Date.now } = {}) {
  if (!turn || typeof turn !== 'object') throw new TypeError('A Turn object is required.');
  const next = String(nextStatus || '');
  assertTransition(turn.status, next, turn.id);
  if (turn.status === next) return turn;
  const timestamp = Number(now()) || Date.now();
  turn.status = next;
  turn.updatedAt = timestamp;
  if (next === 'running' && !turn.startedAt) turn.startedAt = timestamp;
  if (['completed', 'aborted', 'failed', 'incomplete'].includes(next)) turn.completedAt = timestamp;
  return turn;
}

module.exports = {
  ALLOWED_TRANSITIONS,
  InvalidTurnTransitionError,
  assertTransition,
  canTransition,
  isKnownTurnStatus,
  transitionTurn
};

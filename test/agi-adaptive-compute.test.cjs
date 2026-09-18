'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { createEscalationTracker, raiseEffort } = require('../lib/agi/adaptive-compute');

test('defaults to tier 0 with best-of-1 until a signal appears', () => {
  const tracker = createEscalationTracker();
  const initial = tracker.decide();
  assert.equal(initial.escalate, false);
  assert.equal(initial.tier, 0);
  assert.equal(initial.bestOfN, 1);
  assert.equal(typeof initial.reason, 'string');
  assert.ok(initial.reason.length > 0);

  tracker.observe({ type: 'tool', ok: true, key: 'read' });
  tracker.observe({ type: 'acceptance', ok: true });
  assert.equal(tracker.decide().tier, 0);
  const state = tracker.state();
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.acceptanceFails, 0);
  assert.equal(state.repeatedCount, 0);
});

test('consecutive tool failures escalate to tier 1 at the threshold', () => {
  const tracker = createEscalationTracker({ failureThreshold: 2 });
  tracker.observe({ type: 'tool', ok: false, key: 'a' });
  assert.equal(tracker.decide().tier, 0);
  tracker.observe({ type: 'tool', ok: false, key: 'b' });
  const decision = tracker.decide();
  assert.equal(decision.escalate, true);
  assert.equal(decision.tier, 1);
  assert.equal(decision.bestOfN, 2);
  assert.ok(decision.reason.includes('升级'));
});

test('a single acceptance failure escalates to tier 1 and success resets it', () => {
  const tracker = createEscalationTracker();
  tracker.observe({ type: 'acceptance', ok: false, key: 'accept-1' });
  assert.equal(tracker.decide().tier, 1);
  tracker.observe({ type: 'acceptance', ok: true });
  assert.equal(tracker.state().acceptanceFails, 0);
  assert.equal(tracker.decide().tier, 0);
});

test('repeated acceptance failures escalate to tier 2 with capped best-of-n', () => {
  const tracker = createEscalationTracker({ maxBestOfN: 4 });
  tracker.observe({ type: 'acceptance', ok: false });
  tracker.observe({ type: 'acceptance', ok: false });
  const decision = tracker.decide();
  assert.equal(decision.escalate, true);
  assert.equal(decision.tier, 2);
  assert.equal(decision.bestOfN, 4);
});

test('double tool failures or repeated loops escalate to tier 2', () => {
  const toolTracker = createEscalationTracker({ failureThreshold: 3 });
  for (let i = 0; i < 6; i += 1) toolTracker.observe({ type: 'tool', ok: false });
  assert.equal(toolTracker.decide().tier, 2);
  assert.equal(toolTracker.decide().bestOfN, 3);

  const loopTracker = createEscalationTracker();
  for (let i = 0; i < 6; i += 1) loopTracker.observe({ type: 'loop' });
  assert.equal(loopTracker.state().repeatedCount, 6);
  const decision = loopTracker.decide();
  assert.equal(decision.tier, 2);
  assert.ok(decision.reason.includes('循环'));
});

test('repeated keys accumulate and a key change resets the counter', () => {
  const tracker = createEscalationTracker();
  tracker.observe({ type: 'tool', ok: true, key: 'search' });
  assert.equal(tracker.state().repeatedCount, 0);
  tracker.observe({ type: 'tool', ok: true, key: 'search' });
  assert.equal(tracker.state().repeatedCount, 1);

  tracker.observe({ type: 'tool', ok: true, key: 'other' });
  assert.equal(tracker.state().repeatedCount, 0);
  assert.equal(tracker.state().lastKey, 'other');
  tracker.observe({ type: 'tool', ok: true, key: 'other' });
  assert.equal(tracker.state().repeatedCount, 1);
});

test('tool success clears consecutive failures and returns to tier 0', () => {
  const tracker = createEscalationTracker({ failureThreshold: 2 });
  tracker.observe({ type: 'tool', ok: false });
  tracker.observe({ type: 'tool', ok: false });
  assert.equal(tracker.decide().tier, 1);
  tracker.observe({ type: 'tool', ok: true });
  assert.equal(tracker.state().consecutiveFailures, 0);
  assert.equal(tracker.decide().tier, 0);
});

test('raiseEffort climbs the ladder, clamps at max and treats unknown as medium', () => {
  assert.equal(raiseEffort('low'), 'medium');
  assert.equal(raiseEffort('low', 2), 'high');
  assert.equal(raiseEffort('high', 5), 'max');
  assert.equal(raiseEffort('max'), 'max');
  assert.equal(raiseEffort('unknown'), 'high');
  assert.equal(raiseEffort('unknown', 0), 'medium');
  assert.equal(raiseEffort('medium', -3), 'medium');
  assert.equal(raiseEffort(), 'high');
  assert.equal(raiseEffort('XHIGH'), 'max');
});

test('reset clears counters and the last key', () => {
  const tracker = createEscalationTracker({ failureThreshold: 2 });
  tracker.observe({ type: 'tool', ok: false, key: 'a' });
  tracker.observe({ type: 'tool', ok: false, key: 'a' });
  tracker.observe({ type: 'acceptance', ok: false });
  assert.equal(tracker.decide().escalate, true);

  tracker.reset();
  const state = tracker.state();
  assert.equal(state.consecutiveFailures, 0);
  assert.equal(state.acceptanceFails, 0);
  assert.equal(state.repeatedCount, 0);
  assert.equal(state.lastKey, null);
  assert.equal(state.tier, 0);
  assert.equal(state.bestOfN, 1);
});

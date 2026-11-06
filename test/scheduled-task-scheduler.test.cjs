'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { createScheduledTaskScheduler, nextRunAt } = require('../lib/main/scheduled-task-scheduler');

function localDate(year, month, day, hour = 0, minute = 0, second = 0) {
  return new Date(year, month - 1, day, hour, minute, second, 0).getTime();
}

test('nextRunAt is strictly future and never replays a missed daily run', () => {
  const base = { status: 'active', frequency: 'daily', hour: 9, minute: 0, lastRunAt: 0 };
  assert.equal(nextRunAt(base, localDate(2026, 11, 1, 8, 0)), localDate(2026, 11, 1, 9, 0));
  assert.equal(nextRunAt(base, localDate(2026, 11, 1, 9, 0)), localDate(2026, 11, 2, 9, 0));
  assert.equal(nextRunAt(base, localDate(2026, 11, 1, 9, 30)), localDate(2026, 11, 2, 9, 0));
  assert.equal(nextRunAt({ ...base, lastRunAt: localDate(2026, 11, 1, 9, 0) }, localDate(2026, 11, 1, 8, 0)), localDate(2026, 11, 2, 9, 0));
});

test('nextRunAt honors weekly weekday and today-run suppression', () => {
  const weekly = { status: 'active', frequency: 'weekly', weekday: 1, hour: 9, minute: 0, lastRunAt: 0 };
  // 2026-11-01 is Sunday; the next Monday is 2026-11-02.
  assert.equal(nextRunAt(weekly, localDate(2026, 11, 1, 8, 0)), localDate(2026, 11, 2, 9, 0));
  assert.equal(nextRunAt({ ...weekly, lastRunAt: localDate(2026, 11, 2, 9, 0) }, localDate(2026, 11, 2, 8, 0)), localDate(2026, 11, 9, 9, 0));
  assert.equal(nextRunAt({ ...weekly, status: 'paused' }, localDate(2026, 11, 1, 8, 0)), null);
});

test('scheduler dispatches only an on-time active run to a ready renderer', () => {
  const scheduledAt = localDate(2026, 11, 1, 9, 0);
  const sent = [];
  const store = {
    list: () => [{
      id: 'sched_due',
      status: 'active',
      frequency: 'daily',
      hour: 9,
      minute: 0,
      lastRunAt: 0
    }]
  };
  const window = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
  const scheduler = createScheduledTaskScheduler({
    store,
    getMainWindow: () => window,
    isRendererReady: () => true,
    now: () => scheduledAt + 5_000
  });
  assert.deepEqual(scheduler.dispatchDue(scheduledAt, scheduledAt + 5_000), ['sched_due']);
  assert.equal(sent.length, 1);
  assert.equal(sent[0][0], 'scheduled-task:run');
  assert.equal(sent[0][1].scheduledAt, scheduledAt);

  sent.length = 0;
  assert.deepEqual(scheduler.dispatchDue(scheduledAt, scheduledAt + 120_000), []);
  assert.equal(sent.length, 0);
});

test('scheduler skips paused, already-run and renderer-not-ready tasks', () => {
  const scheduledAt = localDate(2026, 11, 1, 9, 0);
  const sent = [];
  const base = { id: 'sched_task', status: 'active', frequency: 'daily', hour: 9, minute: 0, lastRunAt: 0 };
  const window = { isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } };
  const make = (task, ready = true) => createScheduledTaskScheduler({
    store: { list: () => [task] },
    getMainWindow: () => window,
    isRendererReady: () => ready,
    now: () => scheduledAt
  });
  assert.deepEqual(make({ ...base, status: 'paused' }).dispatchDue(scheduledAt, scheduledAt), []);
  assert.deepEqual(make({ ...base, lastRunAt: scheduledAt }).dispatchDue(scheduledAt, scheduledAt), []);
  assert.deepEqual(make(base, false).dispatchDue(scheduledAt, scheduledAt), []);
  assert.equal(sent.length, 0);
});

test('scheduler start arms the next occurrence and fires it through the renderer channel', () => {
  const from = localDate(2026, 11, 1, 8, 0);
  const scheduledAt = localDate(2026, 11, 1, 9, 0);
  let clock = from;
  let captured = null;
  let cleared = 0;
  const sent = [];
  const scheduler = createScheduledTaskScheduler({
    store: { list: () => [{ id: 'sched_timer', status: 'active', frequency: 'daily', hour: 9, minute: 0, lastRunAt: 0 }] },
    getMainWindow: () => ({ isDestroyed: () => false, webContents: { send: (...args) => sent.push(args) } }),
    isRendererReady: () => true,
    now: () => clock,
    setTimer: (fn, delay) => { captured = { fn, delay }; return 1; },
    clearTimer: () => { cleared += 1; }
  });
  scheduler.start();
  assert.equal(captured.delay, 60 * 60 * 1000);
  assert.equal(scheduler.getNextAt(), scheduledAt);
  clock = scheduledAt + 2_000;
  captured.fn();
  assert.equal(sent.length, 1);
  assert.equal(sent[0][1].scheduledAt, scheduledAt);
  assert.equal(scheduler.getNextAt(), localDate(2026, 11, 2, 9, 0));
  scheduler.stop();
  assert.ok(cleared >= 1);
});

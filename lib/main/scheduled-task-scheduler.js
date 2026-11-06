'use strict';

// Daily/weekly scheduler for scheduled tasks. Timing lives in the main
// process; the renderer owns the actual agent run so the same path is used for
// automatic and manual executions.

const MAX_LOOKAHEAD_DAYS = 370;

function sameLocalDay(left, right) {
  const a = new Date(Number(left) || 0);
  const b = new Date(Number(right) || 0);
  return a.getFullYear() === b.getFullYear()
    && a.getMonth() === b.getMonth()
    && a.getDate() === b.getDate();
}

function clampInteger(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

// Strictly future occurrence: a task that was due while the app was closed is
// never replayed. Starting the app after today's time naturally moves the
// candidate to tomorrow (or the next matching weekday).
function nextRunAt(task, from = Date.now()) {
  if (!task || task.status !== 'active') return null;
  const hour = clampInteger(task.hour, 0, 23, 9);
  const minute = clampInteger(task.minute, 0, 59, 0);
  const weekly = task.frequency === 'weekly';
  const weekday = clampInteger(task.weekday, 0, 6, 1);
  const base = new Date(Number(from) || Date.now());
  const candidate = new Date(base.getFullYear(), base.getMonth(), base.getDate(), hour, minute, 0, 0);
  if (candidate.getTime() <= base.getTime()) candidate.setDate(candidate.getDate() + 1);
  for (let index = 0; index < MAX_LOOKAHEAD_DAYS; index += 1) {
    if (weekly && candidate.getDay() !== weekday) {
      candidate.setDate(candidate.getDate() + 1);
      continue;
    }
    if (task.lastRunAt && sameLocalDay(task.lastRunAt, candidate.getTime())) {
      candidate.setDate(candidate.getDate() + 1);
      continue;
    }
    return candidate.getTime();
  }
  return null;
}

function createScheduledTaskScheduler({
  store,
  getMainWindow,
  isRendererReady,
  now = () => Date.now(),
  setTimer = setTimeout,
  clearTimer = clearTimeout,
  lateToleranceMs = 60_000,
  logger = console
}) {
  let timer = null;
  let nextAt = 0;
  let started = false;
  let stopped = false;

  function clearScheduledTimer() {
    if (timer) clearTimer(timer);
    timer = null;
  }

  function refresh() {
    if (!started || stopped) return;
    clearScheduledTimer();
    const at = now();
    let best = null;
    for (const task of store.list()) {
      const candidate = nextRunAt(task, at);
      if (candidate && (!best || candidate < best.at)) best = { task, at: candidate };
    }
    if (!best) {
      nextAt = 0;
      return;
    }
    nextAt = best.at;
    const delay = Math.max(250, best.at - at);
    timer = setTimer(() => {
      timer = null;
      const scheduledAt = nextAt;
      try {
        dispatchDue(scheduledAt);
      } finally {
        if (started && !stopped) refresh();
      }
    }, delay);
  }

  function dispatchDue(scheduledAt, at = now()) {
    if (stopped || !Number.isFinite(scheduledAt)) return [];
    // A timer that wakes up after the machine slept or the event loop stalled
    // must not replay a missed run.
    if (at - scheduledAt > lateToleranceMs) return [];
    if (at < scheduledAt - 1_000) return [];
    const win = getMainWindow?.();
    if (!win || win.isDestroyed?.() || !isRendererReady?.()) return [];
    const sent = [];
    for (const task of store.list()) {
      if (task.status !== 'active') continue;
      if (nextRunAt(task, scheduledAt - 1) !== scheduledAt) continue;
      try {
        win.webContents.send('scheduled-task:run', { task, scheduledAt });
        sent.push(task.id);
      } catch (error) {
        logger.warn?.(`[scheduled-tasks] dispatch failed for ${task.id}: ${error?.message || error}`);
      }
    }
    return sent;
  }

  function start() {
    if (started) return;
    started = true;
    stopped = false;
    refresh();
  }

  function stop() {
    stopped = true;
    started = false;
    clearScheduledTimer();
    nextAt = 0;
  }

  return {
    start,
    stop,
    refresh,
    dispatchDue,
    getNextAt: () => nextAt
  };
}

module.exports = { createScheduledTaskScheduler, nextRunAt, sameLocalDay };

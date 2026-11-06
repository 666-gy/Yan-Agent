'use strict';

// Scheduled task records for the scheduled-tasks page. This store owns
// persistence and validation; scheduling lives in scheduled-task-scheduler.js.

const fs = require('node:fs');
const crypto = require('node:crypto');
const { writeAtomic } = require('./yan-core/store');

const FREQUENCIES = new Set(['daily', 'weekly']);
const EFFORTS = new Set(['low', 'medium', 'high', 'xhigh', 'max']);
const STATUSES = new Set(['active', 'paused']);
const RUN_STATUSES = new Set(['', 'running', 'success', 'error']);

function clone(value) {
  return value == null ? value : JSON.parse(JSON.stringify(value));
}

function integerInRange(value, min, max, fallback) {
  const number = Number(value);
  return Number.isInteger(number) && number >= min && number <= max ? number : fallback;
}

function normalizeModelSelection(input, fallback = {}) {
  const source = input && typeof input === 'object' ? input : fallback;
  return {
    providerId: String(source?.providerId || ''),
    supplierId: String(source?.supplierId || ''),
    modelId: String(source?.modelId || ''),
    modelType: 'text',
    name: String(source?.name || source?.modelId || '')
  };
}

function deriveTitle(description) {
  const firstLine = String(description || '').split(/\r?\n/).map(line => line.trim()).find(Boolean) || '';
  return (firstLine || '定时任务').slice(0, 60);
}

function createScheduledTasksStore({ file }) {
  let tasks = load();

  function load() {
    try {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return Array.isArray(parsed?.tasks) ? parsed.tasks : [];
    } catch {
      return [];
    }
  }

  function persist() {
    writeAtomic(file, { version: 1, tasks });
  }

  function normalize(input = {}, base = {}) {
    const description = input.description !== undefined
      ? String(input.description || '').trim()
      : String(base.description || '').trim();
    if (!description) throw new Error('任务说明不能为空');
    const frequency = FREQUENCIES.has(input.frequency) ? input.frequency
      : FREQUENCIES.has(base.frequency) ? base.frequency : 'daily';
    const status = STATUSES.has(input.status) ? input.status
      : STATUSES.has(base.status) ? base.status : 'active';
    const lastRunAtValue = Number(input.lastRunAt !== undefined ? input.lastRunAt : base.lastRunAt);
    const lastRunAt = Number.isFinite(lastRunAtValue) && lastRunAtValue > 0 ? Math.floor(lastRunAtValue) : 0;
    const lastRunStatus = RUN_STATUSES.has(input.lastRunStatus) ? input.lastRunStatus
      : RUN_STATUSES.has(base.lastRunStatus) ? base.lastRunStatus : '';
    return {
      title: deriveTitle(description),
      description,
      workspace: String(input.workspace !== undefined ? input.workspace : base.workspace || '').trim(),
      newTaskEachRun: input.newTaskEachRun !== undefined ? Boolean(input.newTaskEachRun)
        : base.newTaskEachRun !== undefined ? Boolean(base.newTaskEachRun) : true,
      frequency,
      weekday: integerInRange(input.weekday, 0, 6, integerInRange(base.weekday, 0, 6, 1)),
      hour: integerInRange(input.hour, 0, 23, integerInRange(base.hour, 0, 23, 9)),
      minute: integerInRange(input.minute, 0, 59, integerInRange(base.minute, 0, 59, 0)),
      modelSelection: normalizeModelSelection(input.modelSelection, base.modelSelection),
      effort: EFFORTS.has(input.effort) ? input.effort : EFFORTS.has(base.effort) ? base.effort : 'medium',
      status,
      lastRunAt,
      lastRunStatus,
      sessionId: String(input.sessionId !== undefined ? input.sessionId : base.sessionId || '').trim()
    };
  }

  function list() {
    return tasks
      .map(task => clone(task))
      .sort((left, right) => (Number(right.updatedAt) || 0) - (Number(left.updatedAt) || 0));
  }

  function get(id) {
    const task = tasks.find(item => item.id === String(id || ''));
    return task ? clone(task) : null;
  }

  function create(input = {}) {
    const fields = normalize(input);
    const now = Date.now();
    const task = {
      id: `sched_${crypto.randomUUID()}`,
      ...fields,
      createdAt: now,
      updatedAt: now
    };
    tasks = [task, ...tasks.filter(item => item.id !== task.id)];
    persist();
    return clone(task);
  }

  function update(id, patch = {}) {
    const index = tasks.findIndex(item => item.id === String(id || ''));
    if (index < 0) throw new Error('定时任务不存在');
    const current = tasks[index];
    const fields = normalize({ ...current, ...patch, description: patch.description !== undefined ? patch.description : current.description }, current);
    const next = { ...current, ...fields, updatedAt: Date.now() };
    tasks[index] = next;
    persist();
    return clone(next);
  }

  function remove(id) {
    const next = tasks.filter(item => item.id !== String(id || ''));
    if (next.length === tasks.length) return false;
    tasks = next;
    persist();
    return true;
  }

  return { list, get, create, update, remove };
}

module.exports = { createScheduledTasksStore };

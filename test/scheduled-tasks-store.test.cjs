'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { createScheduledTasksStore } = require('../lib/scheduled-tasks-store');

test('scheduled task store rejects empty descriptions, persists and updates', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-scheduled-store-'));
  const file = path.join(dir, 'scheduled-tasks.json');
  try {
    const store = createScheduledTasksStore({ file });
    assert.throws(() => store.create({ description: '   ' }), /任务说明不能为空/);
    const task = store.create({
      description: '每天整理昨天的开发进度',
      workspace: 'C:\\work\\demo',
      newTaskEachRun: true,
      frequency: 'weekly',
      weekday: 5,
      hour: 14,
      minute: 30,
      effort: 'high',
      modelSelection: { providerId: 'p', supplierId: 's', modelId: 'm', name: 'Model' }
    });
    assert.match(task.id, /^sched_/);
    assert.equal(task.title, '每天整理昨天的开发进度');
    assert.equal(task.frequency, 'weekly');
    assert.equal(task.weekday, 5);
    assert.equal(task.hour, 14);
    assert.equal(task.minute, 30);
    assert.equal(task.effort, 'high');
    assert.equal(task.modelSelection.modelType, 'text');
    assert.equal(task.lastRunAt, 0);
    assert.equal(task.lastRunStatus, '');

    const ran = store.update(task.id, { lastRunAt: 1_760_000_000_000, lastRunStatus: 'error' });
    assert.equal(ran.lastRunAt, 1_760_000_000_000);
    assert.equal(ran.lastRunStatus, 'error');
    assert.equal(ran.description, '每天整理昨天的开发进度');

    const reloaded = createScheduledTasksStore({ file });
    assert.equal(reloaded.list().length, 1);
    assert.equal(reloaded.get(task.id).description, '每天整理昨天的开发进度');
    assert.equal(reloaded.get(task.id).lastRunAt, 1_760_000_000_000);
    assert.equal(reloaded.get(task.id).lastRunStatus, 'error');

    const updated = store.update(task.id, { description: '每周整理开发进度' });
    assert.equal(updated.title, '每周整理开发进度');
    assert.equal(updated.weekday, 5);
    assert.throws(() => store.update(task.id, { description: '' }), /任务说明不能为空/);

    assert.equal(store.remove(task.id), true);
    assert.equal(store.list().length, 0);
    assert.equal(createScheduledTasksStore({ file }).list().length, 0);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

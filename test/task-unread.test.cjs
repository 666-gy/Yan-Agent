'use strict';

// Completion attention shares the durable task-unread set with the context
// menu. A focused task clears the marker; an unfocused task gains it.

const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

test('markCompleted sets and clears the task unread marker', () => {
  const values = new Map();
  global.localStorage = {
    getItem: key => values.get(key) || null,
    setItem: (key, value) => values.set(key, value)
  };
  global.document = {
    addEventListener() {},
    getElementById() { return null; }
  };
  global.window = {};
  delete require.cache[require.resolve(path.resolve(__dirname, '../renderer/task-menu.js'))];
  require('../renderer/task-menu.js');
  const menu = global.window.YanTaskMenu;
  assert.ok(menu, 'task menu should expose its unread API');

  assert.equal(menu.markCompleted('sess_a', false), true);
  assert.equal(menu.isUnread('sess_a'), true);
  assert.equal(menu.hasUnread(), true);
  assert.equal(menu.markCompleted('sess_a', false), false, 'already unread stays idempotent');

  assert.equal(menu.markCompleted('sess_a', true), true);
  assert.equal(menu.isUnread('sess_a'), false);
  assert.equal(menu.hasUnread(), false);

  assert.equal(menu.markUnread('sess_b'), true);
  assert.equal(menu.markRead('sess_b'), true);
  assert.equal(menu.markRead('sess_b'), false);
  delete global.localStorage;
  delete global.document;
  delete global.window;
});

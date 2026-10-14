'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { parseTaskLink, registerProtocol, registerTaskDeepLinks } = require('../lib/main/task-deep-links');

test('task links accept only session routes, without commands, paths or query parameters', () => {
  assert.equal(parseTaskLink('yanagent://tasks/sess_abcdef'), 'sess_abcdef');
  for (const link of ['https://tasks/sess_abcdef', 'yanagent://tasks/../secret', 'yanagent://tasks/sess_abcdef?run=cmd',
    'yanagent://tasks/sess_abcdef#x', 'yanagent://tasks/sess_%61bcdef', 'yanagent://other/sess_abcdef', 'yanagent://tasks/sess_ABCD/extra']) {
    assert.equal(parseTaskLink(link), null);
  }
});
test('protocol registration chooses a persistent launcher and skips isolated tests', () => {
  const calls = []; const app = { setAsDefaultProtocolClient: (...args) => calls.push(args) };
  registerProtocol(app, 'C:/App', { defaultApp: true, execPath: 'electron.exe', env: {} });
  registerProtocol(app, 'C:/App', { env: {} });
  registerProtocol(app, 'C:/App', { env: { PORTABLE_EXECUTABLE_FILE: 'C:/Yan.exe' } });
  registerProtocol(app, 'C:/App', { env: { YAN_E2E_MODE: '1' } });
  assert.deepEqual(calls, [['yanagent', 'electron.exe', ['C:/App']], ['yanagent'], ['yanagent', 'C:/Yan.exe']]);
});
test('cold-start links wait for renderer readiness, warm links dispatch, unrelated senders are rejected', async () => {
  const app = new EventEmitter(); app.isReady = () => true;
  const handlers = new Map(), sent = []; let focused = 0;
  const webContents = new EventEmitter();
  webContents.isLoadingMainFrame = () => false;
  webContents.send = (...args) => sent.push(args);
  let win = null;
  const service = registerTaskDeepLinks({ app, ipcMain: { handle: (name, handler) => handlers.set(name, handler) },
    windows: { getMainWindow: () => win }, paths: {} }, {
    argv: ['yanagent://tasks/sess_cold'], store: { readSessionRecord: async id => id === 'sess_gone' ? null : { id } },
    createWindow: () => { throw new Error('must not create a duplicate startup window'); }, focusWindow: () => focused++
  });
  service.acceptArgs(['yanagent://tasks/sess_latest']);
  win = { isDestroyed: () => false, webContents };
  assert.equal(handlers.get('task-link:ready')({ sender: {} }), null);
  assert.deepEqual(handlers.get('task-link:ready')({ sender: webContents }), { sessionId: 'sess_latest' });
  service.acceptArgs(['yanagent://tasks/sess_warm']);
  assert.deepEqual(sent[0], ['task-link:open', { sessionId: 'sess_warm' }]);
  assert.equal(await handlers.get('session:deep-link')({ sender: webContents }, 'sess_copy'), 'yanagent://tasks/sess_copy');
  await assert.rejects(handlers.get('session:deep-link')({ sender: {} }, 'sess_copy'));
  await assert.rejects(handlers.get('session:deep-link')({ sender: webContents }, 'sess_gone'));
  assert.ok(focused > 0);
});

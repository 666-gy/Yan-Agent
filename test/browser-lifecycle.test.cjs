'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { registerBrowserLifecycle } = require('../lib/main/browser-lifecycle');
test('sleep protects edits, media, downloads, Agent and attached debuggers; resumes and cleans up', async () => {
  const app = Object.assign(new EventEmitter(), { whenReady: async () => {} });
  const partition = Object.assign(new EventEmitter(), { registerPreloadScript() {} });
  const main = { isDestroyed: () => false, webContents: { mainFrame: {} } };
  let attached = false, safe = true, audible = false, capturing = false;
  const commands = [];
  const contents = Object.assign(new EventEmitter(), { id: 1, isDestroyed: () => false, hostWebContents: main.webContents,
    getType: () => 'webview', session: partition, isLoading: () => false, isCurrentlyAudible: () => audible,
    isBeingCaptured: () => capturing, executeJavaScript: async () => safe,
    debugger: { isAttached: () => attached, attach: () => { attached = true; }, detach: () => { attached = false; },
      sendCommand: async (command, options) => commands.push(options.state) } });
  const handlers = new Map(), listeners = new Map();
  const service = registerBrowserLifecycle({ app, ipcMain: { handle: (name, fn) => handlers.set(name, fn), on: (name, fn) => listeners.set(name, fn) },
    session: { fromPartition: () => partition }, webContents: { fromId: () => contents }, dialog: {} },
  { getMainWindow: () => main, BROWSER_PARTITION: 'test', idleMs: 0 });
  await Promise.resolve();
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  const activity = value => handlers.get('browser:tab-activity')(event, { id: 1, ...value });
  await activity({ active: false }); const state = service.tabs.get(1);
  for (const guard of ['active','protected','edited','downloads','exporting','capturing']) {
    state[guard] = true; await service.sleep(state); assert.equal(attached, false, guard); state[guard] = false;
  }
  audible = true; await service.sleep(state); assert.equal(attached, false); audible = false;
  capturing = true; await service.sleep(state); assert.equal(attached, false); capturing = false;
  safe = false; await service.sleep(state); assert.equal(attached, false); safe = true;
  attached = true; await service.sleep(state); assert.deepEqual(commands, []); attached = false;
  const item = new EventEmitter(); partition.emit('will-download', {}, item, contents);
  await service.sleep(state); assert.equal(attached, false); item.emit('done');
  await service.sleep(state); assert.equal(state.frozen, true);
  await activity({ active: true }); assert.equal(attached, false); assert.deepEqual(commands, ['frozen','active']);
  const capture = () => handlers.get('browser:capture-page')(event, 1);
  let finishCapture;
  contents.capturePage = async (_rect, options) => {
    assert.deepEqual(options, { stayHidden: true, stayAwake: true });
    return new Promise(resolve => { finishCapture = resolve; });
  };
  const pending = capture(); await Promise.resolve();
  assert.equal(state.capturing, true);
  await assert.rejects(capture(), /SCREENSHOT_BUSY/);
  finishCapture({ isEmpty: () => false, toDataURL: () => 'data:image/png;base64,test' });
  assert.equal(await pending, 'data:image/png;base64,test');
  assert.equal(state.capturing, false);
  contents.capturePage = async () => { throw new Error('capture failed'); };
  await assert.rejects(capture(), /capture failed/);
  assert.equal(state.capturing, false);
  await assert.rejects(handlers.get('browser:capture-page')({ sender: {} }, 1), /无权/);
  listeners.get('browser:tab-edited')({ sender: contents }); assert.equal(state.edited, true);
  contents.emit('did-start-navigation', {}, 'https://test', false, true); assert.equal(state.edited, false);
  await assert.rejects(handlers.get('browser:tab-activity')({ sender: {} }, { id: 1 }), /无权/);
  contents.emit('destroyed'); assert.equal(service.tabs.size, 0); app.emit('will-quit');
});

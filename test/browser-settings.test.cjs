'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { registerBrowserSettings } = require('../lib/main/browser-settings');
const { normalizeBrowserPreferences } = require('../lib/browser-preferences');

test('browser preference defaults and invalid values normalize consistently', () => {
  assert.deepEqual(normalizeBrowserPreferences(null), { enabled: true, webTarget: 'external', localTarget: 'builtin', showFullUrl: false, downloadDirectory: '', askDownloadLocation: false, historyPolicy: 'ask', siteToolsEnabled: true });
  assert.deepEqual(normalizeBrowserPreferences({ enabled: false, webTarget: 'builtin', localTarget: 'external', showFullUrl: true }), { enabled: false, webTarget: 'builtin', localTarget: 'external', showFullUrl: true, downloadDirectory: '', askDownloadLocation: false, historyPolicy: 'ask', siteToolsEnabled: true });
  assert.deepEqual(normalizeBrowserPreferences({ enabled: 'false', webTarget: 'unknown' }), normalizeBrowserPreferences());
});

test('browser data APIs isolate the main frame, honor routing and only clear selected records', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-browser-api-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'browser-history.json');
  fs.writeFileSync(file, JSON.stringify({ history: [
    { id: 'recent', time: Date.now() }, { id: 'old', time: Date.now() - 86400000 * 10 }
  ], downloads: [{ id: 'download', time: Date.now() }] }));
  const handlers = new Map(), opened = [], cleared = [];
  const partition = Object.assign(new EventEmitter(), {
    cookies: { get: async () => [{ domain: 'example.com' }, { domain: 'example.com' }] },
    clearStorageData: async () => cleared.push('sites'), clearCache: async () => cleared.push('cache')
  });
  const app = Object.assign(new EventEmitter(), { getPath: () => dir, whenReady: async () => {} });
  const main = { isDestroyed: () => false, webContents: { mainFrame: {} } };
  const event = { sender: main.webContents, senderFrame: main.webContents.mainFrame };
  let browser = normalizeBrowserPreferences();
  registerBrowserSettings({ app, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, session: { fromPartition: () => partition }, shell: { openExternal: async url => opened.push(url) } }, {
    BROWSER_PARTITION: 'test', getMainWindow: () => main, configStore: { loadConfig: () => ({ browser }) }
  });
  const invoke = (name, payload) => handlers.get(`browser:${name}`)(event, payload);
  assert.throws(() => handlers.get('browser:history')({ sender: {}, senderFrame: {} }), /无权/);
  assert.throws(() => handlers.get('browser:history')({ sender: main.webContents, senderFrame: {} }), /无权/);
  assert.deepEqual(await invoke('open-link', 'https://example.com'), { target: 'external' });
  assert.deepEqual(opened, ['https://example.com']);
  for (const url of ['http://localhost:3000', 'http://127.0.0.1:8080', 'http://[::1]:3000', 'http://test.localhost']) {
    assert.equal((await invoke('open-link', url)).target, 'builtin');
  }
  browser = { webTarget: 'builtin', localTarget: 'external' };
  assert.equal((await invoke('open-link', 'https://example.com')).target, 'builtin');
  assert.equal((await invoke('open-link', 'http://localhost:3000')).target, 'external');
  await assert.rejects(invoke('open-link', 'javascript:alert(1)'), /不支持/);
  assert.equal((await invoke('data-summary', 'hour')).history, 1);
  assert.equal((await invoke('data-summary', 'all')).history, 2);
  await assert.rejects(invoke('clear-selected', { types: ['unknown'] }), /无效/);
  await invoke('clear-selected', { range: 'hour', types: ['history'] });
  assert.deepEqual(invoke('history').map(item => item.id), ['old']);
  assert.deepEqual(cleared, []);
  assert.equal(JSON.parse(fs.readFileSync(file)).downloads.length, 1);
  await invoke('clear-selected', { range: 'all', types: ['history', 'downloads', 'sites', 'cache'] });
  assert.deepEqual(cleared, ['sites', 'cache']);
  assert.deepEqual(JSON.parse(fs.readFileSync(file)), { history: [], downloads: [] });
  // A separate registration simulates the next app launch loading persisted data.
  registerBrowserSettings({ app, ipcMain: { handle: (name, fn) => handlers.set(name, fn) }, session: { fromPartition: () => partition }, shell: {} }, {
    BROWSER_PARTITION: 'test', getMainWindow: () => main, configStore: { loadConfig: () => ({ browser }) }
  });
  assert.deepEqual(invoke('history'), []);
});

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-splash-'));
const bootstrap = path.join(temp, 'main.cjs');
// Observe the real production startup without changing its splash timing.
fs.writeFileSync(bootstrap, `
const { app } = require('electron');
global.splashEvents = [];
app.on('browser-window-created', (_, win) => {
  let url = '';
  win.webContents.on('did-finish-load', () => { url = win.webContents.getURL(); });
  for (const event of ['show', 'closed']) win.on(event, () => {
    if (event === 'show') url = win.webContents.getURL();
    global.splashEvents.push({ event, url, at: Date.now(), id: win.id });
  });
});
require(${JSON.stringify(path.join(appRoot, 'main.js'))});
`);

(async () => {
  let application;
  try {
    application = await electron.launch({
      executablePath: require('electron'), args: [bootstrap], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '0', YAN_E2E_USER_DATA_DIR: path.join(temp, 'data') }
    });
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.waitForURL('**/splash/index.html');
    await page.waitForSelector('canvas');
    const state = await page.evaluate(async () => {
      await document.fonts.ready;
      const canvas = document.querySelector('canvas');
      return {
        title: document.querySelector('h1').textContent,
        font: document.fonts.check('72px "Yan Serif"'),
        webgl: !!canvas.getContext('webgl2'),
        size: [canvas.width, canvas.height],
        remote: performance.getEntriesByType('resource').filter(entry => /^https?:/.test(entry.name)).length
      };
    });
    assert.equal(state.title, 'Yan Agent');
    assert.equal(state.font, true);
    assert.equal(state.webgl, true);
    assert.ok(state.size[0] >= 680 && state.size[1] >= 380);
    assert.equal(state.remote, 0);
    const first = await page.screenshot();
    await page.waitForTimeout(250);
    const second = await page.screenshot();
    assert.ok(!first.equals(second), 'Ghost Fibers must animate between frames');
    const artifacts = path.join(appRoot, 'output', 'playwright');
    fs.mkdirSync(artifacts, { recursive: true });
    fs.writeFileSync(path.join(artifacts, 'splash.png'), second);
    await page.waitForEvent('close', { timeout: 15000 });
    const events = await application.evaluate(() => global.splashEvents);
    const shown = events.find(event => event.event === 'show' && event.url.includes('/splash/'));
    const closed = events.find(event => event.event === 'closed' && event.id === shown?.id);
    assert.ok(shown && closed, 'splash shows and closes');
    const duration = closed.at - shown.at;
    assert.ok(duration >= 2950 && duration < 4000, `visible for ${duration}ms`);
    assert.ok(events.some(event => event.event === 'show' && event.id !== shown.id && event.at >= closed.at));
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ...state, duration, errors, screenshot: path.join(artifacts, 'splash.png') }));
  } finally {
    if (application) await application.close();
    fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

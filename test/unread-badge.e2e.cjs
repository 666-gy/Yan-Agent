'use strict';
// The app-level unread badge: the rail home button and the Windows taskbar
// overlay both follow the number of completed tasks the user has not opened.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-unread-badge-'));
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => {
      document.querySelector('#yanStartupHello')?.remove();
      const el = document.getElementById('app');
      if (el) el.inert = false;
    });
    await page.waitForTimeout(400);

    await app.evaluate(({ BrowserWindow }) => {
      const win = BrowserWindow.getAllWindows().find(item => /renderer[\\/]index\.html/.test(item.webContents.getURL()));
      globalThis.__overlayCalls = [];
      const original = win.setOverlayIcon.bind(win);
      win.setOverlayIcon = (icon, description) => {
        globalThis.__overlayCalls.push({ description, hasIcon: !!icon });
        return original(icon, description);
      };
    });

    const setUnread = count => page.evaluate(n => {
      for (const session of [...state.sessions]) window.YanTaskMenu.markRead(session.id);
      state.sessions = state.sessions.filter(session => !String(session.id).startsWith('unread-badge-'));
      for (let index = 1; index <= n; index += 1) {
        const id = `unread-badge-${index}`;
        state.sessions.push({ id, title: `未查看任务 ${index}`, updatedAt: Date.now() - index, workspace: '' });
        window.YanTaskMenu.markUnread(id);
      }
      renderSessionList();
      const button = document.querySelector('.app-rail-button[data-nav="tasks"]');
      const dot = getComputedStyle(button, '::after');
      return {
        hasUnread: button.classList.contains('has-unread'),
        content: dot.content,
        width: dot.width,
        height: dot.height,
        radius: dot.borderRadius,
        label: button.getAttribute('aria-label')
      };
    }, count);

    const two = await setUnread(2);
    await page.waitForTimeout(300);
    const twoCalls = await app.evaluate(() => globalThis.__overlayCalls.slice());
    assert.equal(two.hasUnread, true);
    assert.ok(two.content === '""' || two.content === '', 'the rail keeps a dot, not a count');
    assert.equal(two.width, '7px');
    assert.equal(two.height, '7px');
    assert.equal(two.radius, '50%');
    assert.match(two.label, /2 个任务已完成未查看/);
    assert.deepEqual(twoCalls.at(-1), { description: 'Yan Agent · 2 个任务已完成未查看', hasIcon: true });

    const twelve = await setUnread(12);
    await page.waitForTimeout(300);
    const twelveCalls = await app.evaluate(() => globalThis.__overlayCalls.slice());
    assert.equal(twelve.hasUnread, true);
    assert.equal(twelve.width, '7px');
    assert.ok(twelve.content === '""' || twelve.content === '');
    assert.match(twelve.label, /12 个任务已完成未查看/);
    assert.deepEqual(twelveCalls.at(-1), { description: 'Yan Agent · 12 个任务已完成未查看', hasIcon: true });

    const cleared = await page.evaluate(() => {
      for (const session of [...state.sessions]) window.YanTaskMenu.markRead(session.id);
      state.sessions = state.sessions.filter(session => !String(session.id).startsWith('unread-badge-'));
      renderSessionList();
      const button = document.querySelector('.app-rail-button[data-nav="tasks"]');
      return {
        hasCountAttribute: Object.prototype.hasOwnProperty.call(button.dataset, 'unreadCount'),
        hasUnread: button.classList.contains('has-unread'),
        label: button.getAttribute('aria-label')
      };
    });
    await page.waitForTimeout(300);
    const clearedCalls = await app.evaluate(() => globalThis.__overlayCalls.slice());
    assert.equal(cleared.hasCountAttribute, false);
    assert.equal(cleared.hasUnread, false);
    assert.equal(cleared.label, 'Yan Agent');
    assert.deepEqual(clearedCalls.at(-1), { description: '', hasIcon: false });
    assert.deepEqual(errors, []);
    console.log('unread-badge e2e passed');
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });

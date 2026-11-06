'use strict';
// Completion attention must follow the task page the user is actually looking
// at: a task that finishes while its page is focused stays read, and the
// settings workspace counts as not being on the task page.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');

(async () => {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-task-attention-'));
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
    await page.evaluate(async () => { if (!state.currentSession) await newSession(); });
    await page.waitForTimeout(400);

    const result = await page.evaluate(async () => {
      const out = {};
      const id = state.currentSession.id;
      const row = () => document.querySelector(`.session-item[data-id="${id}"]`);
      const rail = () => document.querySelector('.app-rail-button[data-nav="tasks"]');

      out.focused = isTaskPageFocused(id);

      markTaskCompletionAttention({ id }, 'completed');
      renderSessionList();
      out.focusedCompletion = {
        unread: window.YanTaskMenu.isUnread(id),
        rowUnread: !!row()?.classList.contains('is-unread'),
        railUnread: !!rail()?.classList.contains('has-unread')
      };

      // A marker left behind while the page is focused must not survive a render.
      window.YanTaskMenu.markUnread(id);
      renderSessionList();
      out.renderBackstop = {
        unread: window.YanTaskMenu.isUnread(id),
        rowUnread: !!row()?.classList.contains('is-unread')
      };

      openSettings('general');
      out.settingsOpen = {
        focused: isTaskPageFocused(id),
        settingsMode: document.querySelector('#app').classList.contains('settings-mode')
      };
      markTaskCompletionAttention({ id }, 'completed');
      renderSessionList();
      out.settingsCompletion = {
        unread: window.YanTaskMenu.isUnread(id),
        rowUnread: !!row()?.classList.contains('is-unread'),
        railUnread: !!rail()?.classList.contains('has-unread')
      };

      closeSettings();
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      out.afterClose = {
        unread: window.YanTaskMenu.isUnread(id),
        rowUnread: !!row()?.classList.contains('is-unread'),
        focused: isTaskPageFocused(id)
      };

      const title = document.querySelector('#taskBarTitle');
      const style = getComputedStyle(title);
      out.title = { weight: style.fontWeight, color: style.color };
      return out;
    });

    assert.equal(result.focused, true, 'the open task page starts focused');
    assert.deepEqual(result.focusedCompletion, { unread: false, rowUnread: false, railUnread: false },
      'a completion on the focused task page must not mark it unread');
    assert.deepEqual(result.renderBackstop, { unread: false, rowUnread: false },
      'the focused task row never paints an unread marker');
    assert.deepEqual(result.settingsOpen, { focused: false, settingsMode: true },
      'the settings workspace is not the task page');
    assert.deepEqual(result.settingsCompletion, { unread: true, rowUnread: true, railUnread: true },
      'a completion while settings is open marks the task unread');
    assert.deepEqual(result.afterClose, { unread: false, rowUnread: false, focused: true },
      'closing settings returns to the task page and clears the marker');
    assert.equal(result.title.weight, '650', 'the task title is bold');
    assert.equal(result.title.color, 'rgb(255, 255, 255)', 'the task title uses the strong text color');
    assert.deepEqual(errors, [], 'no page errors');
    console.log('task-attention e2e passed');
  } finally {
    await app?.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exit(1); });

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
fs.mkdirSync(path.join(root, '.yanagent'), { recursive: true });
const userData = fs.mkdtempSync(path.join(root, '.yanagent/capsule-fullscreen-'));

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(() => window.YanStartupHello?.skip?.());
    await page.locator('#yanStartupHello').waitFor({ state: 'detached' });
    await page.evaluate(async () => {
      await newSession({ forceNew: true });
      state.currentSession.messages = [{ role: 'user', content: 'Capsule layout regression' }];
      setEmptyState(false);
      updateTaskBar();
      openRightSidebarTool('browser');
      setBrowserFocusMode(true);
    });
    const checkPlacement = async () => {
      await page.locator('#taskCapsuleBtn').click();
      await page.waitForFunction(() => getComputedStyle(document.querySelector('#taskCapsulePanel')).opacity === '1');
      return page.evaluate(() => {
        const panel = document.querySelector('#taskCapsulePanel');
        const rect = panel.getBoundingClientRect();
        return {
          inChat: panel.parentElement.id === 'chatMainColumn',
          buttons: ['taskBarMoreBtn', 'taskCapsuleBtn'].map(id => {
            const button = document.getElementById(id);
            const box = button.getBoundingClientRect();
            return { id, below: rect.top >= box.bottom,
              reachable: button.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2)) };
          })
        };
      });
    };
    await page.locator('[data-agent-chat-tab]').click();
    const fullscreen = await checkPlacement();
    assert.equal(fullscreen.inChat, true);
    for (const button of fullscreen.buttons) {
      assert.equal(button.below, true, `${button.id} must be above the panel`);
      assert.equal(button.reachable, true, `${button.id} must remain clickable`);
    }
    await page.locator('#taskCapsuleOpenMenuBtn').click();
    await page.locator('#rightSidebarTabStrip [data-rs-tab]').first().click();
    const closed = await page.evaluate(() => ({
      open: taskCapsulePanelOpen,
      menu: taskCapsuleMenuOpen,
      aria: document.querySelector('#taskCapsulePanel').getAttribute('aria-hidden'),
      expanded: document.querySelector('#taskCapsuleBtn').getAttribute('aria-expanded'),
      pointer: getComputedStyle(document.querySelector('#taskCapsulePanel')).pointerEvents
    }));
    assert.deepEqual(closed, { open: false, menu: false, aria: 'true', expanded: 'false', pointer: 'none' });
    await page.evaluate(() => setTaskCapsulePanelOpen(true));
    assert.equal(await page.evaluate(() => taskCapsulePanelOpen), false, 'cannot open over the default tab');
    await page.locator('[data-agent-chat-tab]').click();
    assert.equal(await page.evaluate(() => taskCapsulePanelOpen), false, 'returning must not resurrect the panel');
    await page.evaluate(() => setBrowserFocusMode(false));
    const normal = await checkPlacement();
    assert.equal(normal.inChat, true);
    for (const button of normal.buttons) assert.ok(button.below && button.reachable, `${button.id} normal layout`);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, fullscreen, closed, normal }));
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

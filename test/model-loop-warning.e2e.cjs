'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-loop-warning-'));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-general').click();
    const toggle = page.locator('#generalLoopNotification');
    assert.equal(await toggle.isChecked(), true);
    await toggle.uncheck();
    await page.waitForFunction(() => state.config.general.loopNotification === false);
    assert.equal(await page.locator('[data-general-setting="loopRepeatCount"]').count(), 0);
    await toggle.check();
    await page.waitForFunction(() => state.config.general.loopNotification === true);
    const persisted = await page.evaluate(() => api.getConfig());
    assert.equal(persisted.general.loopNotification, true);
    assert.equal(Object.hasOwn(persisted.general, 'loopRepeatCount'), false);
    const result = await page.evaluate(() => {
      const context = { runId: 'loop-ui-test', sessionId: state.currentSession?.id, utility: true };
      initOpenCodeRunState(context);
      const notifications = [];
      const previous = window.Notification;
      window.Notification = class {
        static permission = 'granted';
        constructor(title, options) { notifications.push({ title, body: options.body }); }
      };
      try {
        const event = { type: 'yan.model.loop-warning', data: { id: 1, kind: 'tool', timestamp: Date.now(), message: '工具调用及结果连续重复 5 次，疑似陷入循环。任务仍在继续。' } };
        applyOpenCodeEvent(context, event, { deferEffects: true });
        applyOpenCodeEvent(context, event, { deferEffects: true });
        context.replayingHistory = true;
        applyOpenCodeEvent(context, { ...event, data: { ...event.data, id: 2 } }, { deferEffects: true });
        context.replayingHistory = false;
        state.config.general.loopNotification = false;
        applyOpenCodeEvent(context, { ...event, data: { ...event.data, id: 3 } }, { deferEffects: true });
        state.config.general.loopNotification = true;
        return { notifications, status: context.activeAgentRun.status, error: context.openCodeError,
          warnings: context.activeAgentRun.timeline.filter(item => item.openCodeKey?.startsWith('loop-warning:')).length };
      } finally { window.Notification = previous; }
    });
    assert.equal(result.notifications.length, 1);
    assert.match(result.notifications[0].body, /任务仍在继续/);
    assert.equal(result.status, 'working');
    assert.equal(result.error, undefined);
    assert.equal(result.warnings, 3);
    await page.locator('#generalLoopNotification').scrollIntoViewIfNeeded();
    const output = path.join(root, 'output/playwright/model-loop-warning.png');
    fs.mkdirSync(path.dirname(output), { recursive: true });
    await page.screenshot({ path: output });
    assert.deepEqual(errors, []);
    console.log('Loop warning settings persistence, renderer deduplication, replay suppression and continued working status passed.');
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

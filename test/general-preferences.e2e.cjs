'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-general-'));
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
    const choose = async (id, label, key, value) => {
      await page.locator(`#${id}-trigger`).click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await page.waitForFunction(([key, value]) => state.config.general[key] === value, [key, value]);
    };
    await page.locator('#settings-tab-configuration').click();
    await page.locator('#configurationAccessMode-trigger').click();
    await page.getByRole('option', { name: /^完整访问权限/ }).click();
    await page.waitForFunction(() => state.config.agent.sandboxMode === 'full');
    await page.locator('#configurationAccessMode-trigger').click();
    await page.getByRole('option', { name: /^工作空间写入/ }).click();
    await page.waitForFunction(() => state.config.agent.sandboxMode === 'workspace-write');
    await page.locator('#settings-tab-general').click();
    await choose('generalTerminalShell', '命令提示符 (cmd)', 'terminalShell', 'cmd');
    const installed = await page.evaluate(() => api.getVsCodeStatus());
    if (process.env.YAN_TEST_REQUIRE_VSCODE === '1') {
      assert.equal(installed.available, true);
      assert.equal(installed.source, 'registry');
      console.log(`VS Code detected without PATH: ${installed.executable}`);
    }
    await page.locator('#generalCompletionNotification-trigger').click();
    assert.ok((await page.locator('.appearance-picker-panel:popover-open').boundingBox()).width >= 200);
    await page.keyboard.press('Escape');
    const output = path.join(root, 'output/playwright/general-preferences');
    fs.mkdirSync(output, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.evaluate(() => applyTheme('light'));
    const fixed = await page.evaluate(async () => {
      const cfg = await api.setConfig({ agent: { disableAutoFormatter: false }, permissions: { allowFileRead: false, allowFileWrite: false, allowShell: false, allowNetwork: false } });
      const permissions = await api.setPermissions({ allowFileWrite: false, allowShell: false });
      return { fast: cfg.agent.disableAutoFormatter, permissions };
    });
    assert.equal(fixed.fast, true);
    for (const key of ['allowFileRead', 'allowFileWrite', 'allowShell', 'allowNetwork']) assert.equal(fixed.permissions[key], true);
    assert.equal(await page.locator('#disableAutoFormatter, #permRead, #permWrite, #permShell, #permNet').count(), 0);
    for (const [sound, label] of [['bell', '双音铃'], ['chime', '风铃']]) {
      await choose('generalNotificationSound', label, 'notificationSound', sound);
      await page.locator('#generalSoundPreview').click();
      await page.waitForTimeout(80);
    }
    await page.screenshot({ path: path.join(output, 'notification-bells.png') });
    await choose('generalCompletionNotification', '从不', 'completionNotification', 'never');
    await choose('generalNotificationSound', '静音', 'notificationSound', 'none');
    await page.locator('#generalPermissionNotification').uncheck();
    await page.waitForFunction(() => !state.config.general.permissionNotification);
    await page.locator('#generalQuestionNotification').uncheck();
    await page.waitForFunction(() => !state.config.general.questionNotification);
    const notificationState = await page.evaluate(() => {
      const original = window.Notification;
      window.Notification = class { static permission = 'granted'; };
      try {
        return { completion: canNotifyGeneral('completion'), permission: canNotifyGeneral('permission'),
          question: canNotifyGeneral('question'), silent: generalNotificationOptions().silent };
      } finally { window.Notification = original; }
    });
    assert.deepEqual(notificationState, { completion: false, permission: false, question: false, silent: true });
    await page.locator('#generalStandaloneChat').check();
    await page.waitForFunction(() => state.config.general.standaloneQuickChat);
    const subagentToggle = page.locator('#generalSubagentExpand');
    assert.equal(await subagentToggle.isChecked(), true);
    await subagentToggle.uncheck();
    await page.waitForFunction(() => state.config.general.expandSubagentPanel === false);
    await page.reload();
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    const settings = await page.evaluate(() => state.config.general);
    assert.equal(settings.terminalShell, 'cmd');
    assert.equal(settings.notificationSound, 'none');
    assert.equal(settings.standaloneQuickChat, true);
    assert.equal(settings.expandSubagentPanel, false);
    await page.evaluate(async workspace => {
      await newSession();
      state.currentSession.workspace = workspace;
      await newSession();
    }, root);
    assert.equal(await page.evaluate(() => state.currentSession.workspace), root);
    await page.evaluate(() => newSession({ standalone: true }));
    assert.equal(await page.evaluate(() => state.currentSession.workspace || ''), '');
    assert.deepEqual(errors, []);
    console.log('General preferences: access mode, pickers, notifications, persistence and standalone chat passed.');
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

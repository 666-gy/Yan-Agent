'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { createComputerControlStore } = require('../lib/computer-control-store');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-control-ui-'));
const output = path.join(root, 'output/playwright/computer-control');
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root, env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile } });
    const page = await app.firstWindow(); await page.waitForFunction(() => window.__YAN_APP_READY__);
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-computer-control').click();
    await page.locator('#computerControlEnabled').check();
    assert.equal(await page.locator('#computerControlHistory').textContent(), '暂无');
    await page.locator('#computerControlEnabled').uncheck();
    await page.waitForFunction(async () => (await window.yan.getComputerControlSettings()).enabled === false);
    await page.locator('#settings-tab-general').click(); await page.locator('#settings-tab-computer-control').click();
    assert.equal(await page.locator('#computerControlEnabled').isChecked(), false);
    // Use the real picker IPC with only the native selection dialog substituted.
    await app.evaluate(({ dialog }, exe) => { dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [exe] }); }, require('electron'));
    await page.locator('#computerControlAdd').click(); await page.waitForFunction(() => document.querySelector('#computerControlAllowed .computer-app-logo')?.src.startsWith('data:image/'));
    const dataDir = path.join(profile, 'YanData');
    const store = createComputerControlStore(dataDir);
    const item = store.record(require('electron'), 'Electron'); store.writeExperience(item.id, '# 操作经验\n\n## 经验教训\n操作后读取最新状态。\n\n## 复盘\n验证窗口中的结果。');
    await page.locator('#settings-tab-general').click(); await page.locator('#settings-tab-computer-control').click();
    await page.locator('[data-computer-action="experience"]').waitFor();
    assert.match(await page.locator('.computer-brand').getAttribute('src'), /skill-logos\/computer-use\.png$/);
    const buttons = await page.locator('#tab-computer-control .icon-btn').evaluateAll(items => items.map(item => {
      const style = getComputedStyle(item); return { border: style.borderTopWidth, radius: style.borderRadius, width: style.width, height: style.height };
    }));
    assert.ok(buttons.length >= 4);
    for (const button of buttons) { assert.equal(button.border, '0px'); assert.equal(button.radius, '50%'); assert.equal(button.width, button.height); }
    assert.ok(await page.locator('#computerControlAllowed .computer-app-logo').evaluate(image => image.naturalWidth >= 256));
    fs.mkdirSync(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.screenshot({ path: path.join(output, `${theme}.png`) });
    }
    await page.locator('[data-computer-action="experience"]').click();
    await page.locator('#computerExperienceTitle').waitFor();
    assert.equal(await page.locator('#computerControlDetail article h1').textContent(), '操作经验');
    await page.screenshot({ path: path.join(output, 'experience.png') });
    await page.locator('#computerControlDetail [data-computer-action="back"]').click();
    await page.locator('[data-computer-action="delete"]').click();
    await page.locator('#computerControlCancel').click(); assert.match(store.experience(item.id).markdown, /经验教训/);
    await page.locator('[data-computer-action="delete"]').click();
    await page.screenshot({ path: path.join(output, 'delete-confirmation.png') });
    await page.locator('#computerControlConfirm').click();
    await page.waitForFunction(() => !document.getElementById('computerControlDeleteDialog').open);
    assert.equal(store.list().length, 0); assert.equal(store.settings().allowedApps.length, 1);
    assert.equal(await page.locator('#computerControlHistory .computer-app-row').count(), 0);
    assert.equal(await page.locator('#computerControlDeleteError').textContent(), '');
    assert.throws(() => store.experience(item.id), /不存在/);
    // Verify deletion still targets the selected row when several records are present.
    const second = store.record('C:\\Apps\\SecondMusic.exe', 'Second Music');
    store.writeExperience(second.id, '# 第二个应用的经验');
    await page.locator('#settings-tab-general').click(); await page.locator('#settings-tab-computer-control').click();
    await page.locator('#computerControlHistory .computer-app-row').filter({ hasText: 'Second Music' }).locator('[data-computer-action="delete"]').click();
    await page.locator('#computerControlConfirm').click();
    await page.waitForFunction(() => !document.getElementById('computerControlDeleteDialog').open);
    assert.throws(() => store.experience(second.id), /不存在/);
    assert.equal(store.list().length, 0);
    assert.deepEqual(errors, []);
    console.log('PASS settings, real EXE icon, persistence, Markdown detail, cancel/delete isolation, light/dark UI');
  } finally {
    await app?.close(); await fs.promises.rm(profile, { recursive: true, force: true, maxRetries: 20, retryDelay: 200 });
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-memory-settings-'));
(async () => {
  const app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
    env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
  try {
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-memory').click();
    for (const id of ['memorySave', 'memoryDelete']) {
      assert.ok((await page.locator(`#${id}`).boundingBox()).width >= 80);
    }
    assert.equal(await page.locator('[data-work-mode="evolution"]').count(), 0);
    const input = page.locator('#memoryInstructions');
    await input.fill(Array.from({ length: 12 }, (_, i) => `说明 ${i}`).join('\n'));
    const dimensions = await input.evaluate(el => ({ height: el.clientHeight, scroll: el.scrollHeight, line: parseFloat(getComputedStyle(el).lineHeight), padding: parseFloat(getComputedStyle(el).paddingTop) + parseFloat(getComputedStyle(el).paddingBottom), resize: getComputedStyle(el).resize }));
    assert.ok(Math.abs(dimensions.height - dimensions.padding - 6 * dimensions.line) <= 1, 'six visible lines, allowing device-pixel border rounding');
    assert.ok(dimensions.scroll > dimensions.height);
    assert.equal(dimensions.resize, 'none');
    await page.locator('#memorySave').click();
    await page.waitForFunction(() => state.config.memory.instructions.includes('说明 11'));
    await page.locator('#memoryEnabled').uncheck();
    await page.waitForFunction(() => state.config.memory.enabled === false);
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-memory').click();
    assert.equal(await page.locator('#memoryEnabled').isChecked(), false);
    assert.match(await input.inputValue(), /说明 11/);
    await page.locator('#memoryDelete').click();
    assert.equal(await page.locator('#memoryDeleteDialog').isVisible(), true);
    await page.waitForFunction(() => {
      const rect = document.querySelector('#memoryDeleteDialog').getBoundingClientRect();
      return Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 1 && Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 1;
    });
    await page.locator('#memoryDeleteCancel').click();
    await page.locator('#memoryDelete').click();
    await page.locator('#memoryDeleteConfirm').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent === '已删除所有记忆');
    assert.match(await input.inputValue(), /说明 11/);
    fs.mkdirSync(path.join(root, 'output/playwright/memory'), { recursive: true });
    await page.locator('#settings-tab-pet').click();
    await page.evaluate(() => {
      document.querySelector('#petDeleteDesc').textContent = '测试宠物';
      document.querySelector('#petDeleteDialog').showModal();
    });
    await page.waitForFunction(() => {
      const rect = document.querySelector('#petDeleteDialog').getBoundingClientRect();
      return Math.abs(rect.x + rect.width / 2 - innerWidth / 2) < 1 && Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 1;
    });
    await page.screenshot({ path: path.join(root, 'output/playwright/memory/pet-confirm.png') });
    await page.locator('#petDeleteCancel').click();
    await page.locator('#settings-tab-memory').click();
    await page.locator('#memoryDelete').click();
    await page.waitForFunction(() => {
      const rect = document.querySelector('#memoryDeleteDialog').getBoundingClientRect();
      return Math.abs(rect.y + rect.height / 2 - innerHeight / 2) < 1;
    });
    await page.screenshot({ path: path.join(root, 'output/playwright/memory/memory-confirm.png') });
    await page.locator('#memoryDeleteCancel').click();
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.screenshot({ path: path.join(root, `output/playwright/memory/${theme}.png`) });
    }
    for (const width of [320, 375, 414, 768]) {
      await page.setViewportSize({ width, height: 900 });
      assert.ok(await input.evaluate(el => el.getBoundingClientRect().right <= innerWidth));
    }
    console.log('Memory settings: six rows, scroll, save, persistence, toggle, confirmation, deletion, themes and responsive layout passed.');
  } finally { await app.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

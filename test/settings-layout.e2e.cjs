'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-settings-layout-'));
const output = path.join(root, 'output', 'playwright', 'settings-layout');

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData }
    });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await page.setViewportSize({ width: 1440, height: 1000 });
    fs.mkdirSync(output, { recursive: true });
    await page.locator('#settingsBtn').click();
    assert.equal(await page.locator('#settingsOverlay').getAttribute('data-active-tab'), 'general');
    assert.deepEqual(await page.locator('#settingsSidebarNav .sheet-nav-text').allTextContents(), ['常规', '配置', 'API 配置', '视觉中继', '关于', '外观', '壁纸', '记忆', '应用快照', '宠物']);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settings-tab-general');
    await page.screenshot({ path: path.join(output, 'initial-general.png') });

    // Keyboard navigation moves focus and activates the corresponding panel.
    await page.keyboard.press('ArrowDown');
    assert.equal(await page.locator('#tab-configuration').getAttribute('aria-hidden'), 'false');
    await page.keyboard.press('End');
    assert.equal(await page.locator('#tab-pet').getAttribute('aria-hidden'), 'false');
    await page.keyboard.press('Home');
    const sidebarBefore = await page.locator('.settings-sidebar').boundingBox();
    await page.locator('#settings-tab-configuration').click();
    await page.locator('#ttsRateRange').scrollIntoViewIfNeeded();
    assert.deepEqual(await page.locator('.settings-sidebar').boundingBox(), sidebarBefore);
    await page.locator('#ttsVoice-trigger').click();
    await page.locator('.appearance-picker-panel:popover-open').waitFor();
    await page.keyboard.press('Escape');
    await page.locator('.appearance-picker-panel:popover-open').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#settingsOverlay').isVisible(), true, 'Escape closes a dialog before the settings workspace');

    // Exercise a real persisted setting, then reopen to verify hydration.
    await page.locator('#settings-tab-general').click();
    const before = await page.locator('#generalQuestionNotification').isChecked();
    await page.locator('#generalQuestionNotification').click();
    await page.waitForFunction(value => state.config.general.questionNotification === value, !before);
    await page.locator('#appRail [data-nav="tasks"]').click();
    assert.equal(await page.evaluate(() => document.activeElement.id), 'settingsBtn');
    await page.locator('#settingsBtn').click();
    assert.equal(await page.locator('#generalQuestionNotification').isChecked(), !before);
    await page.locator('#generalQuestionNotification').click();
    await page.waitForFunction(value => state.config.general.questionNotification === value, before);
    await page.locator('#settings-tab-logo').click();
    await page.locator('[data-theme-choice="light"]').click();
    await page.waitForFunction(() => state.config.theme === 'light' && document.documentElement.dataset.theme === 'light');
    await page.locator('[data-theme-choice="dark"]').click();
    await page.waitForFunction(() => state.config.theme === 'dark' && document.documentElement.dataset.theme === 'dark');
    await page.locator('#toast').waitFor({ state: 'hidden' });

    for (const theme of ['dark', 'light']) {
      await page.evaluate(value => applyTheme(value), theme);
      for (const tab of ['general', 'api', 'vision-relay', 'about', 'logo']) {
        await page.locator(`#settings-tab-${tab}`).click();
        assert.equal(await page.locator('.sheet-content').evaluate(el => el.scrollTop), 0);
        const heading = await page.locator('.settings-page-heading').boundingBox();
        const panel = await page.locator(`#tab-${tab}`).boundingBox();
        assert.ok(Math.abs(heading.x - panel.x) < 1, `${tab}: heading and rows share the same left edge`);
        await page.mouse.move(1400, 980);
        await page.waitForTimeout(180); // Capture settled navigation colors.
        await page.screenshot({ path: path.join(output, `${theme}-${tab}.png`) });
      }
    }

    await page.locator('#settings-tab-general').click();
    await page.locator('#generalLanguage-trigger').click();
    await page.getByRole('option', { name: 'English', exact: true }).click();
    await page.waitForFunction(() => document.documentElement.lang === 'en');
    await page.locator('#settings-tab-about').click();
    await page.waitForFunction(() => document.querySelector('#settingsSectionTitle').textContent === 'About');
    await page.screenshot({ path: path.join(output, 'light-about-english.png') });

    // Electron normally enforces a desktop minimum; renderer viewport checks
    // also cover compact windows and translated controls without clipping.
    for (const width of [768, 414, 375, 320]) {
      await page.setViewportSize({ width, height: 900 });
      for (const tab of ['general', 'api', 'vision-relay', 'about', 'logo']) {
        await page.locator(`#settings-tab-${tab}`).click();
        const overflow = await page.locator('.sheet-content').evaluate(el => ({ client: el.clientWidth, scroll: el.scrollWidth }));
        assert.ok(overflow.scroll <= overflow.client + 1, `${width}px ${tab}: ${JSON.stringify(overflow)}`);
        const outside = await page.locator(`#tab-${tab}`).evaluate(panel => {
          const rect = panel.getBoundingClientRect();
          return [...panel.querySelectorAll('button, input, label, h2, h3')].filter(el => {
            const box = el.getBoundingClientRect();
            return box.width && box.height && (box.right > rect.right + 1 || box.left < rect.left - 1);
          }).map(el => el.id || el.className);
        });
        assert.deepEqual(outside, [], `${width}px ${tab}: controls stay inside the panel`);
        if (width === 375) await page.screenshot({ path: path.join(output, `compact-${tab}.png`) });
      }
    }
    assert.deepEqual(errors, []);
    console.log(`Settings navigation, dialogs, persistence, themes, localization and responsive layout passed. Screenshots: ${output}`);
  } finally {
    await app?.close();
    try { fs.rmSync(userData, { recursive: true, force: true, maxRetries: 4, retryDelay: 200 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


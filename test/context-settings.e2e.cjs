'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-context-settings-e2e-'));
const screenshotDir = String(process.env.YAN_CONTEXT_SETTINGS_SCREENSHOT_DIR || '').trim();

async function launch() {
  return electron.launch({
    executablePath: require('electron'),
    args: [appRoot],
    cwd: appRoot,
    env: {
      ...process.env,
      YAN_E2E_MODE: '1',
      YAN_E2E_USER_DATA_DIR: userDataDir
    }
  });
}

async function openContextSettings(page) {
  await page.locator('#settingsBtn').click();
  await page.locator('#settingsOverlay:not(.hidden)').waitFor();
  await page.locator('[data-tab="general"]').click();
  await page.locator('#tab-general.active').waitFor();
  await page.locator('#contextConfigOpen').click();
  await page.locator('#contextConfigDialog[open]').waitFor();
}

(async () => {
  let application;
  try {
    application = await launch();
    let page = await application.firstWindow();
    await page.waitForFunction(() => typeof window.yan !== 'undefined');
    await openContextSettings(page);

    const sectionOrder = await page.locator('#tab-general .general-settings-section').evaluateAll(sections => (
      sections.map(section => section.getAttribute('aria-labelledby'))
    ));
    assert.ok(sectionOrder.indexOf('generalPermissionsTitle') < sectionOrder.indexOf('generalContextTitle'));
    assert.ok(sectionOrder.indexOf('generalContextTitle') < sectionOrder.indexOf('generalApplicationTitle'));
    assert.equal(await page.locator('#contextConfigDialog.provider-config-dialog.conn-wizard-dialog').count(), 1);
    assert.equal(await page.locator('#contextMaxInput.mcp-pill-input').inputValue(), '1000');
    assert.equal(await page.locator('#contextThresholdInput.mcp-pill-input').inputValue(), '800');
    assert.deepEqual(await page.locator('.context-k-suffix').allTextContents(), ['k', 'k']);
    if (screenshotDir) {
      fs.mkdirSync(screenshotDir, { recursive: true });
      await page.screenshot({ path: path.join(screenshotDir, 'context-settings-desktop.png') });
      await page.evaluate(() => applyTheme('light'));
      await page.screenshot({ path: path.join(screenshotDir, 'context-settings-light.png') });
      await page.evaluate(() => applyTheme('dark'));
      await page.setViewportSize({ width: 480, height: 760 });
      await page.screenshot({ path: path.join(screenshotDir, 'context-settings-narrow.png') });
      await page.setViewportSize({ width: 1280, height: 820 });
    }

    await page.locator('#contextMaxInput').fill('2048.5foo..');
    assert.equal(await page.locator('#contextMaxInput').inputValue(), '2048.5');
    await page.locator('#contextConfigNext').click();
    assert.equal(await page.locator('#contextConfigStepLabel').textContent(), '2 / 2');
    assert.equal(await page.locator('[data-context-config-page="1"]').getAttribute('aria-hidden'), 'false');
    await page.locator('#contextThresholdInput').fill('1536.25bar');
    assert.equal(await page.locator('#contextThresholdInput').inputValue(), '1536.25');
    await page.locator('#contextConfigNext').click();
    await page.locator('#contextConfigDialog').waitFor({ state: 'hidden' });
    await page.waitForFunction(async () => {
      const config = await window.yan.getConfig();
      return config.context?.maxTokens === 2_048_500
        && config.context?.compactionThreshold === 1_536_250;
    });

    await application.close();
    application = await launch();
    page = await application.firstWindow();
    await page.waitForFunction(() => typeof window.yan !== 'undefined');
    await openContextSettings(page);
    assert.equal(await page.locator('#contextMaxInput').inputValue(), '2048.5');
    assert.equal(await page.locator('#contextThresholdInput').inputValue(), '1536.25');
    await page.evaluate(async () => {
      const config = await window.yan.setConfig({ language: 'en' });
      applyLanguage(config.language);
    });
    await page.waitForFunction(() => document.querySelector('#generalContextTitle')?.textContent === 'Context');
    const contextChinese = await page.locator('#generalContextTitle, #contextConfigOpen, #contextConfigDialog').evaluateAll(nodes => (
      nodes.flatMap(node => [
        node.textContent,
        ...[...node.querySelectorAll('[aria-label]')].map(item => item.getAttribute('aria-label'))
      ]).filter(value => /[\u3400-\u9fff]/.test(value || ''))
    ));
    assert.deepEqual(contextChinese, []);
    console.log(JSON.stringify({
      ok: true,
      context: await page.evaluate(() => window.yan.getConfig().then(config => config.context))
    }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

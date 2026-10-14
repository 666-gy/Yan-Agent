'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const { buildOpenCodeConfig } = require('../lib/opencode-sidecar');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-configuration-'));
const output = path.join(root, 'output/playwright/configuration');
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.setViewportSize({ width: 1440, height: 1050 });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-configuration').click();
    assert.equal(await page.locator('#settingsSectionDescription').textContent(), '配置新聊天的权限与朗读以及智能体的回复');
    assert.deepEqual(await page.locator('#tab-configuration h2').allTextContents(), ['智能体默认设置', '朗读']);
    assert.equal(await page.locator('#tab-general #contextConfigOpen, #tab-general #ttsVoicePicker').count(), 0);
    assert.doesNotMatch(await page.locator('#tab-configuration').innerText(), /批准策略|网页搜索/);
    for (const [id, label, key, value] of [
      ['configurationAccessMode', '只读', 'sandboxMode', 'read-only'],
      ['configurationVerbosity', '高', 'replyVerbosity', 'high'],
      ['configurationReasoningSummary', '无', 'reasoningSummary', 'none']
    ]) {
      await page.locator(`#${id}-trigger`).click();
      await page.locator('.appearance-picker-option').filter({ has: page.locator('.settings-picker-label > span:first-child', { hasText: new RegExp(`^${label}$`) }) }).click();
      await page.waitForFunction(([key, value]) => state.config.agent[key] === value, [key, value]);
    }
    await page.locator('#ttsVoice-trigger').click();
    await page.locator('.appearance-picker-option').nth(1).click();
    await page.waitForFunction(() => !document.querySelector('#ttsVoice').disabled);
    const voice = await page.evaluate(() => state.config.tts.voice);
    await page.locator('#ttsRateRange').fill('20');
    await page.locator('#ttsRateRange').dispatchEvent('change');
    await page.waitForFunction(() => state.config.tts.rate === 20);
    assert.equal(await page.locator('#configurationResponseTimeout').inputValue(), '2');
    assert.equal(await page.evaluate(() => responseHardLimitMs()), 120000);
    await page.locator('#configurationResponseTimeout').fill('5');
    await page.locator('#configurationResponseTimeout').dispatchEvent('change');
    await page.waitForFunction(() => state.config.agent.responseTimeoutMinutes === 5);
    assert.equal(await page.evaluate(() => responseHardLimitMs()), 300000);
    // The saved value is the same one the kernel provider build consumes:
    // 5 minutes must become a 300000ms provider header timeout, not a UI-only shell.
    const providerConfig = buildOpenCodeConfig({ providerId: 'deepseek', modelId: 'deepseek-v4-flash', responseTimeoutMinutes: 5 });
    assert.equal(providerConfig.provider.deepseek.options.headerTimeout, 300000, 'provider header timeout follows the configured cap');
    fs.mkdirSync(output, { recursive: true });
    for (const theme of ['light', 'dark']) {
      await page.evaluate(theme => applyTheme(theme), theme);
      await page.screenshot({ path: path.join(output, `${theme}.png`), animations: 'disabled' });
      await page.locator('#ttsVoice-trigger').click();
      const voicePanel = page.locator('.appearance-picker-panel:popover-open');
      assert.equal(await voicePanel.locator('[aria-selected="true"]').count(), 1);
      await voicePanel.screenshot({ path: path.join(output, `${theme}-voice.png`), animations: 'disabled' });
      await page.keyboard.press('Escape');
      for (const id of ['configurationAccessMode', 'configurationVerbosity', 'configurationReasoningSummary']) {
        await page.locator(`#${id}-trigger`).click();
        const panel = page.locator('.settings-picker-detailed:popover-open');
        assert.ok(Math.abs((await panel.boundingBox()).width - 300) < 1);
        assert.ok(await panel.locator('.settings-picker-description').count() >= 3);
        assert.equal(await panel.locator('[aria-selected="true"]').count(), 1);
        await panel.screenshot({ path: path.join(output, `${theme}-${id}.png`), animations: 'disabled' });
        await page.keyboard.press('Escape');
      }
    }
    for (const width of [768, 414, 375, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      assert.equal(await page.locator('.sheet-content').evaluate(el => el.scrollWidth > el.clientWidth + 1), false, `${width}px overflow`);
    }
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click(); await page.locator('#settings-tab-configuration').click();
    assert.equal(await page.locator('#configurationVerbosity').inputValue(), 'high');
    assert.equal(await page.locator('#configurationAccessMode').inputValue(), 'read-only');
    assert.equal(await page.locator('#configurationReasoningSummary').inputValue(), 'none');
    assert.equal(await page.locator('#configurationResponseTimeout').inputValue(), '5');
    assert.equal(await page.evaluate(() => state.config.tts.voice), voice);
    assert.equal(await page.locator('#ttsRateRange').inputValue(), '20');
    assert.deepEqual(errors, []);
    console.log('Configuration page: custom pickers, speech, persistence, themes and narrow layouts passed.');
  } finally {
    await app?.close();
    await fs.promises.rm(userData, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

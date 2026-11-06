'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-confetti-'));
(async () => {
  let app;
  try {
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-general').click();
    const toggle = page.locator('#generalConfetti');
    await toggle.scrollIntoViewIfNeeded();
    assert.equal(await toggle.isChecked(), true);
    assert.equal(await page.locator('#tab-general > section:last-child h2').textContent(), '趣味实验');
    fs.mkdirSync(path.join(root, 'output/playwright/confetti'), { recursive: true });
    await page.screenshot({ path: path.join(root, 'output/playwright/confetti/settings.png') });
    assert.equal((await page.evaluate(() => window.YanConfetti.fire())).fired, true);
    await page.waitForTimeout(600);
    await page.screenshot({ path: path.join(root, 'output/playwright/confetti/fired.png') });
    assert.equal(await page.locator('#yan-confetti').evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await toggle.uncheck();
    await page.waitForFunction(() => state.config.general.confettiEnabled === false);
    assert.equal(await page.locator('#yan-confetti').count(), 0);
    assert.equal((await page.evaluate(() => window.YanConfetti.fire())).reason, 'disabled');
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    assert.equal(await page.evaluate(() => state.config.general.confettiEnabled), false);
    await page.evaluate(async () => { state.config = await api.setConfig({ general: { confettiEnabled: true } }); });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal((await page.evaluate(() => window.YanConfetti.fire())).reason, 'reduced_motion');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    assert.equal((await page.evaluate(() => window.YanConfetti.fire({ emojis: [] }))).fired, true);
    await page.waitForFunction(() => !document.getElementById('yan-confetti'), { timeout: 5000 });
    console.log('Confetti E2E passed: settings persistence, animation, click-through, stop, reduced motion, cleanup.');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

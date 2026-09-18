'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-work-mode-config-'));
const configPath = path.join(userData, 'YanData', 'config.json');
fs.mkdirSync(path.dirname(configPath), { recursive: true });
fs.writeFileSync(configPath, JSON.stringify({ agent: { workMode: 'absolute' } }));

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const ready = () => page.waitForFunction(() => typeof quickInputHandlerReady !== 'undefined' && quickInputHandlerReady);
    await ready();
    assert.equal(await page.evaluate(() => getCurrentWorkMode()), 'normal');
    assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).agent.workMode, 'normal');
    assert.equal(await page.locator('#workModeIndicator').isVisible(), false);
    await page.locator('#attachBtn').click();
    await page.locator('#composerWorkModeAction').click();
    assert.deepEqual(await page.locator('#composerWorkModeView .composer-add-action-name').allTextContents(), ['目标', '计划', '自进化']);
    for (const mode of ['goal', 'plan', 'evolution']) {
      await page.locator(`#composerWorkModeView [data-work-mode="${mode}"]`).click();
      await page.waitForFunction(mode => getCurrentWorkMode() === mode, mode);
      await page.reload();
      await ready();
      assert.equal(await page.evaluate(() => getCurrentWorkMode()), mode);
      await page.locator('#workModeIndicator').click();
      await page.waitForFunction(() => getCurrentWorkMode() === 'normal');
      await page.locator('#attachBtn').click();
      await page.locator('#composerWorkModeAction').click();
    }
    const output = path.join(root, 'output', 'work-mode-cleanup');
    fs.mkdirSync(output, { recursive: true });
    await page.screenshot({ path: path.join(output, 'work-mode-menu.png') });
    const normalized = await page.evaluate(async () => {
      const config = await api.setConfig({ agent: { workMode: 'unknown' } });
      return config.agent.workMode;
    });
    assert.equal(normalized, 'normal');
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, migration: 'normal', modes: ['goal', 'plan', 'evolution'], errors }));
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

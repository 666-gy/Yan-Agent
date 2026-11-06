'use strict';
// Regression: a fresh install has no model selected. The composer must say so
// instead of borrowing the legacy api.model placeholder (agnes-2.0-flash).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-fresh-model-'));
fs.mkdirSync(path.join(profile, 'YanData'), { recursive: true });
// Only disable the startup animation; no connections, keys or model selection.
fs.writeFileSync(
  path.join(profile, 'YanData', 'config.json'),
  JSON.stringify({ general: { startupAnimation: false } }),
);
const evidence = path.join(root, 'output', 'playwright', 'fresh-model-selection');
fs.mkdirSync(evidence, { recursive: true });

(async () => {
  let app;
  try {
    app = await electron.launch({
      executablePath: require('electron'),
      args: [root],
      cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: profile },
    });
    const page = await app.firstWindow();
    page.setDefaultTimeout(20000);
    await page.waitForFunction(
      () => window.__YAN_APP_READY__ && typeof state !== 'undefined' && state.config,
    );
    await page.waitForTimeout(600);

    const pill = (await page.locator('#modelPillName').textContent()).trim();
    assert.equal(pill, '未选择模型');
    const aria = await page.locator('#modelPill').getAttribute('aria-label');
    assert.match(aria, /未选择模型/);
    assert.doesNotMatch(aria, /agnes/i);

    // No model: sending must not create a run; it should open the picker.
    await page.locator('#composerInput').fill('你好');
    await page.locator('#sendBtn').click();
    await page.waitForTimeout(800);
    const menuOpen = await page.locator('#modelQuickMenu').evaluate(node => !node.classList.contains('hidden'));
    assert.equal(menuOpen, true, 'model quick menu should open when no model is selected');
    const draft = await page.evaluate(() => getComposerText());
    assert.equal(draft, '你好', 'the draft must be kept when the send is blocked');
    const assistantCount = await page.locator('.message.assistant').count();
    assert.equal(assistantCount, 0, 'no run should start without a model');

    await page.screenshot({ path: path.join(evidence, 'fresh-no-model.png') });
    console.log('PASS fresh model selection shows 未选择模型 and blocks sending');
  } finally {
    if (app) await app.close().catch(() => {});
    fs.rmSync(profile, { recursive: true, force: true });
  }
})().catch(error => {
  console.error('FAIL', error);
  process.exitCode = 1;
});

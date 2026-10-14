const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron } = require('playwright');
const root = path.resolve(__dirname, '..');
(async () => {
  let app;
  try {
    const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-quick-review-'));
    app = await _electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.locator('#settingsBtn').click();
    const toggle = page.locator('#generalQuickReview');
    assert.equal(await toggle.isChecked(), false);
    async function renderFixture() {
      return page.evaluate(() => {
        let body = document.getElementById('quick-review-fixture');
        if (!body) { body = document.createElement('div'); body.id = 'quick-review-fixture'; document.getElementById('messages').appendChild(body); }
        const run = { status: 'completed', changeSummary: { count: 1, additions: 2, deletions: 1, files: [{ path: 'example.js', additions: 2, deletions: 1 }] } };
        renderRunChangeSummary(body, run);
        return { panels: body.querySelectorAll('.run-change-summary').length, files: run.changeSummary.files.length };
      });
    }
    assert.deepEqual(await renderFixture(), { panels: 0, files: 1 });
    await toggle.check();
    await page.waitForFunction(() => state.config.general.showQuickReview === true);
    assert.deepEqual(await renderFixture(), { panels: 1, files: 1 });
    assert.equal(await page.evaluate(async () => (await api.getConfig()).general.showQuickReview), true);
    await toggle.uncheck();
    await page.waitForFunction(() => state.config.general.showQuickReview === false && !document.querySelector('#messages .run-change-summary'));
    assert.deepEqual(await renderFixture(), { panels: 0, files: 1 });
    await page.reload();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    assert.equal(await page.evaluate(() => state.config.general.showQuickReview), false);
    assert.deepEqual(await renderFixture(), { panels: 0, files: 1 });
    console.log('PASS quick review default off, enable, disable, retained changes, persisted reload');
  } finally { await app?.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });

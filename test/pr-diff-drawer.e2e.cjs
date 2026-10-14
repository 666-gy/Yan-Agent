'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-settings-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')], env: {
      ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('gh:pr-diff');
      globalThis.diffCalls = 0;
      ipcMain.handle('gh:pr-diff', () => { globalThis.diffCalls++; return { ok: true, diff: 'diff --git a/example.js b/example.js\n--- a/example.js\n+++ b/example.js\n@@ -1 +1 @@\n-old\n+new\n' }; });
    });
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      showMainPage('code-review');
      await window.YanCodeReview.openDiff({ number: 7, headRefName: 'feature', baseRefName: 'main' });
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelector('main .file'));
    assert.equal(await page.locator('#rightSidebarTabbar').isVisible(), false);
    assert.equal(await page.locator('#rightSidebarFocusBtn').isVisible(), false);
    assert.equal(await page.locator('#prDiffClose').count(), 0);
    await page.evaluate(() => renderRightSidebarTabs());
    assert.equal(await page.locator('#rs-review').evaluate(el => el.inert), false);
    assert.equal(await page.locator('#rs-review').getAttribute('aria-hidden'), 'false');
    const widths = await page.evaluate(() => ({ actual: document.querySelector('#rightSidebar').getBoundingClientRect().width, max: YanCodeReview.maxDiffWidth(), tabs: openRightSidebarTabs.length }));
    assert.ok(widths.actual <= widths.max + 1);
    assert.equal(widths.tabs, 0);
    await page.locator('#rightResizeHandle').hover();
    await page.mouse.down();
    await page.mouse.move(100, 400);
    await page.mouse.up();
    assert.ok(await page.evaluate(() => document.querySelector('#rightSidebar').getBoundingClientRect().width <= YanCodeReview.maxDiffWidth() + 1));
    const frame = page.frames().find(f => f.url().includes('yan-dsh-code-review'));
    assert.equal(await frame.locator('main .file').count(), 1);
    assert.equal(await frame.locator('[data-reference-file]').count(), 0);
    assert.equal(await frame.locator('#yan-review-scope').isEnabled(), true);
    await frame.locator('#yan-review-scope').hover();
    await frame.locator('#yan-review-scope').click();
    assert.equal(await frame.locator('#yan-review-scope-menu').isVisible(), true);
    assert.equal(await frame.locator('#yan-review-scope-all').getAttribute('aria-checked'), 'true');
    assert.equal(await frame.locator('#yan-review-scope-uncommitted').isVisible(), false);
    assert.equal(await frame.locator('#yan-review-compare').isVisible(), false);
    await frame.locator('#yan-review-scope-all').click();
    assert.equal(await frame.locator('#yan-review-scope-menu').isVisible(), false);
    await frame.locator('#yan-review-scope').focus();
    await frame.locator('#yan-review-scope').press('ArrowDown');
    assert.equal(await frame.locator('#yan-review-scope-menu').isVisible(), true);
    await frame.locator('#yan-review-scope-all').press('Escape');
    assert.equal(await frame.locator('#yan-review-scope-menu').isVisible(), false);
    await frame.locator('.filehead').click();
    assert.equal(await frame.locator('main .file').evaluate(el => el.classList.contains('yan-file-collapsed')), true);
    await frame.locator('.filehead').click();
    await frame.locator('#yan-review-search').click();
    await frame.locator('#yan-review-search-input').fill('example');
    await frame.locator('#yan-review-search-close').click();
    await frame.locator('#yan-review-wrap').click();
    assert.equal(await frame.locator('html').evaluate(el => el.classList.contains('yan-no-wrap')), true);
    assert.equal(await frame.locator('.yan-review-pill #yan-review-close').count(), 1);
    await frame.locator('#yan-review-close').click();
    await page.waitForFunction(() => !document.querySelector('#app').classList.contains('pr-diff-open'));
    assert.equal(await page.locator('#rightSidebar').isVisible(), false);
    const open = async (pr = {}) => {
      await page.evaluate(pr => YanCodeReview.openDiff({ number: 7, headRefName: 'feature', baseRefName: 'main', ...pr }), pr);
      await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelector('main .file'));
    };
    await open();
    assert.equal(await app.evaluate(() => globalThis.diffCalls), 1);
    const oldGeneration = await page.locator('#yanDshReviewFrame').getAttribute('src');
    await page.frames().find(f => f.url().includes('yan-dsh-code-review')).locator('#yan-review-refresh').click();
    await page.waitForFunction(old => document.querySelector('#yanDshReviewFrame')?.getAttribute('src') !== old && document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelector('main .file'), oldGeneration);
    assert.equal(await app.evaluate(() => globalThis.diffCalls), 2);
    await open({ number: 8 });
    assert.equal(await app.evaluate(() => globalThis.diffCalls), 3);
    await open({ headRefOid: 'changed-head' });
    assert.equal(await app.evaluate(() => globalThis.diffCalls), 4);
    await open();
    assert.equal(await app.evaluate(() => globalThis.diffCalls), 4);
    console.log('PR diff drawer interaction, cache reuse/invalidation, refresh, width bounds and pill close passed');
  } finally {
    await app?.close();
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

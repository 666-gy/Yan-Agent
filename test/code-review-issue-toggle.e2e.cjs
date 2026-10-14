'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-issues-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')], env: {
      ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('gh:review-project');
      ipcMain.handle('gh:review-project', () => ({ ok: true,
        repository: { nameWithOwner: 'o/r', url: 'https://github.com/o/r', developer: 'o', permission: 'WRITE' },
        prs: [{ number: 1, title: 'Fix A', headRefName: 'fix-a', baseRefName: 'main', url: 'https://github.com/o/r/pull/1', author: { login: 'o' }, isDraft: false, mergeable: 'MERGEABLE', mergeStateStatus: 'CLEAN', headRepository: { viewerPermission: 'WRITE' } }] }));
      ipcMain.removeHandler('gh:issue-list');
      globalThis.issueListCalls = 0;
      globalThis.issueDelay = 0;
      ipcMain.handle('gh:issue-list', async () => { globalThis.issueListCalls++;
        const delay = Number(globalThis.issueDelay) || 0;
        if (delay) await new Promise(resolve => setTimeout(resolve, delay));
        return { ok: true,
          issues: [{ number: 3, title: 'Crash on save', state: 'open', url: 'https://github.com/o/r/issues/3', author: 'yan', updatedAt: '2026-10-01T00:00:00Z', labels: ['bug'] }] }; });
    });
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      showMainPage('code-review');
      window.YanCodeReview.select('C:\\yan-e2e\\repo');
    });
    await page.waitForFunction(() => document.querySelector('#codeReviewPrTitle')?.textContent.includes('Pull Requests'));
    const titleText = () => page.locator('#codeReviewPrTitle').textContent();
    const createText = () => page.locator('[data-review-action="create"]').textContent();
    const toggleText = () => page.locator('[data-review-action="toggle-view"]').textContent();
    assert.match(await titleText(), /Pull Requests\s*1/);
    assert.match(await toggleText(), /查看issue/);
    assert.match(await createText(), /新建PR/);
    assert.equal(await page.locator('[data-pr-number="1"]').count(), 1);
    const prShot = process.env.YAN_REVIEW_PR_SCREENSHOT;
    if (prShot) await page.locator('.code-review-pr-heading').screenshot({ path: prShot });

    await page.locator('[data-review-action="toggle-view"]').click();
    await page.waitForFunction(() => document.querySelector('#codeReviewPrTitle')?.textContent.includes('Issues'));
    await page.waitForFunction(() => document.querySelector('[data-issue-number="3"]'));
    assert.match(await titleText(), /Issues\s*1/);
    assert.match(await toggleText(), /查看PR/);
    assert.match(await createText(), /新建issue/);
    assert.equal(await page.locator('[data-issue-number="3"]').count(), 1);
    assert.equal(await app.evaluate(() => globalThis.issueListCalls), 1);

    // Refreshing in Issue mode must lock and grey the button, the list and the
    // card actions exactly like PR mode, then unlock when the request settles.
    await app.evaluate(() => { globalThis.issueDelay = 500; });
    await page.locator('[data-review-action="refresh"]').click();
    await page.waitForFunction(() => document.querySelector('[data-review-action="refresh"]')?.disabled === true);
    assert.equal(await page.locator('.code-review-pr-list').getAttribute('aria-busy'), 'true');
    assert.equal(await page.locator('[data-review-action="create"]').isDisabled(), true);
    assert.equal(await page.locator('[data-review-action="toggle-view"]').isDisabled(), true);
    assert.equal(await page.locator('[data-issue-number="3"] [data-review-action="ask"]').isDisabled(), true);
    await page.waitForFunction(() => document.querySelector('[data-review-action="refresh"]')?.disabled === false);
    assert.equal(await page.locator('.code-review-pr-list').getAttribute('aria-busy'), 'false');
    assert.equal(await page.locator('[data-issue-number="3"] [data-review-action="ask"]').isDisabled(), false);
    assert.equal(await app.evaluate(() => globalThis.issueListCalls), 2);
    await app.evaluate(() => { globalThis.issueDelay = 0; });
    const output = process.env.YAN_REVIEW_ISSUES_SCREENSHOT;
    if (output) await page.locator('.code-review-pr-heading').screenshot({ path: output });

    await page.locator('[data-review-action="toggle-view"]').click();
    await page.waitForFunction(() => document.querySelector('#codeReviewPrTitle')?.textContent.includes('Pull Requests'));
    assert.equal(await page.locator('[data-issue-number="3"]').count(), 0);
    assert.equal(await page.locator('[data-pr-number="1"]').count(), 1);
    assert.equal(await app.evaluate(() => globalThis.issueListCalls), 2);
    console.log('Code review PR/Issue toggle, titles, create labels, lazy issue load and refresh busy-state passed');
  } finally {
    await app?.close();
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

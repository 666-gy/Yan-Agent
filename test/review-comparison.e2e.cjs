'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-comparison-'));
const repo = path.join(root, 'repo');
fs.mkdirSync(repo);
const git = (...args) => execFileSync('git', ['-C', repo, ...args], { windowsHide: true, stdio: 'pipe' });
git('init', '-b', 'main');
git('config', 'user.name', 'Test');
git('config', 'user.email', 'test@example.com');
fs.writeFileSync(path.join(repo, 'base.txt'), 'base\n');
git('add', '.'); git('commit', '-m', 'base');
git('checkout', '-b', 'feature');
fs.writeFileSync(path.join(repo, 'feature.txt'), 'committed feature\n');
git('add', '.'); git('commit', '-m', 'feature');
fs.writeFileSync(path.join(repo, 'local.txt'), 'untracked local\n');
(async () => {
  let app;
  try {
    const appRoot = path.resolve(__dirname, '..');
    app = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: path.join(root, 'profile') } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async workspace => {
      if (!state.currentSession) await newSession();
      state.currentSession.workspace = workspace;
      taskGitState.workspace = workspace;
      taskGitState.status = (await api.gitStatus(workspace)).status;
      openTaskGitChanges();
    }, repo);
    const waitCount = count => page.waitForFunction(n => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelectorAll('main .file').length === n, count);
    const frame = () => page.frames().find(f => f.url().includes('yan-dsh-code-review'));
    await waitCount(2);
    assert.equal(await frame().locator('[data-review-range-base]').textContent(), 'main');
    await frame().locator('main .file .filehead').first().hover();
    await frame().locator('[data-reference-file]').first().click();
    await page.waitForFunction(() => state.attachments.length === 1);
    assert.equal(await page.evaluate(() => state.attachments[0].name), 'feature.txt');
    await frame().locator('[data-reference-file]').first().click();
    assert.equal(await page.evaluate(() => state.attachments.length), 1);
    await frame().locator('main .file .filehead').first().click();
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelectorAll('.dsh-cr-row').length > 0);
    await frame().locator('.dsh-cr-num[data-cr-line]').first().click();
    const editor = frame().locator('.comment-input');
    assert.match(await editor.getAttribute('placeholder'), /在第\d+行添加评论/);
    assert.equal(await frame().locator('.comment-actions').count(), 0);
    assert.equal(await editor.evaluate(el => getComputedStyle(el).borderRadius), '0px');
    assert.equal(await editor.evaluate(el => getComputedStyle(el).outlineStyle), 'none');
    assert.equal(await editor.evaluate(el => getComputedStyle(el).boxShadow), 'none');
    assert.equal(await editor.evaluate(el => el.getBoundingClientRect().height), 32);
    await editor.fill('one\ntwo\nthree');
    assert.ok(await editor.evaluate(el => el.getBoundingClientRect().height) <= 52);
    assert.equal(await frame().locator('.yan-comment-send').evaluate(el => getComputedStyle(el).borderTopWidth), '0px');
    await frame().locator('.yan-comment-send').click();
    assert.equal(await frame().locator('.comment-draft').count(), 0);
    await frame().evaluate(() => {
      document.querySelector('#yan-review-scope').click();
      document.querySelector('#yan-review-scope-uncommitted').click();
    });
    await waitCount(1);
    assert.deepEqual(await page.evaluate(() => rsReviewState.summary.files.map(f => f.path)), ['local.txt']);
    assert.equal(await frame().locator('[data-review-range-base]').textContent(), 'feature');
    await frame().evaluate(() => {
      document.querySelector('#yan-review-scope').click();
      document.querySelector('#yan-review-scope-all').click();
    });
    await waitCount(2);
    await frame().evaluate(() => {
      document.querySelector('#yan-review-scope').click();
      document.querySelector('#yan-review-compare').click();
      [...document.querySelectorAll('#yan-review-branch-list button')].find(b => b.textContent.includes('feature')).click();
    });
    await waitCount(1);
    assert.equal(await frame().locator('[data-review-range-base]').textContent(), 'feature');
    assert.equal(await page.evaluate(() => rsReviewState.comparisonByWorkspace.get(state.currentSession.workspace).baseBranch), 'feature');
    console.log('Review comparison IPC, selector refresh, branch selection and lazy diff passed');
  } finally {
    if (app) await app.close();
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
    catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });


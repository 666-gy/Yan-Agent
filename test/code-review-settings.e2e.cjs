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
      ipcMain.removeHandler('gh:connection-status');
      let call = 0;
      ipcMain.handle('gh:connection-status', () => ++call === 1
        ? { ok: true, installed: true, connected: false, accounts: [] }
        : { ok: true, installed: true, connected: true, accounts: [{ active: true, connected: true, login: 'review-user', host: 'github.com' }] });
    });
    await page.locator('#settingsBtn').click();
    await page.locator('#settings-tab-code-review').click();
    await page.waitForFunction(() => document.querySelector('#reviewGithubStatus').textContent === '未连接 GitHub');
    assert.match(await page.locator('#reviewGithubNotice').textContent(), /gh auth login/);
    const navIcon = await page.locator('#settings-tab-code-review svg').getAttribute('data-keyline-icon');
    assert.equal(navIcon, await page.locator('#codeReviewNavBtn svg').getAttribute('data-keyline-icon'));
    await page.locator('#reviewInstructions').fill('关注数据模型和并发问题');
    await page.locator('#reviewInstructions').press('Tab');
    await page.waitForFunction(() => state.config.git.reviewInstructions === '关注数据模型和并发问题');
    await page.locator('#reviewGithubRefresh').click();
    await page.waitForFunction(() => document.querySelector('#reviewGithubStatus').textContent.includes('review-user'));
    const persisted = JSON.parse(fs.readFileSync(path.join(root, 'YanData', 'config.json'), 'utf8'));
    assert.equal(persisted.git.reviewInstructions, '关注数据模型和并发问题');
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      let sent;
      const previous = submitMessage;
      submitMessage = async prompt => { sent = prompt; };
      try { await startGitReview('/review 只看 API'); } finally { submitMessage = previous; }
      if (!sent.includes('关注数据模型和并发问题') || !sent.includes('只看 API')) throw new Error('review instructions missing');
    });
    const output = process.env.YAN_REVIEW_SETTINGS_SCREENSHOT;
    if (output) await page.screenshot({ path: output });
    console.log('Code review settings navigation, persistence, review prompt and GitHub refresh passed');
  } finally {
    await app?.close();
    try { fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); } catch (error) { if (!['EPERM', 'EBUSY', 'ENOTEMPTY'].includes(error.code)) throw error; }
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

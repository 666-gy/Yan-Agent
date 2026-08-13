'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-git-ui-e2e-'));
const userDataDir = path.join(testRoot, 'user-data');
const workspace = path.join(testRoot, 'workspace');
const remote = path.join(testRoot, 'remote.git');
const outputDir = path.join(appRoot, 'output', 'playwright');
const screenshotPath = path.join(outputDir, `yan-git-workbench-${Date.now()}.png`);
const changesScreenshotPath = path.join(outputDir, `yan-git-changes-${Date.now()}.png`);
const diffScreenshotPath = path.join(outputDir, `yan-git-diff-${Date.now()}.png`);
const compactScreenshotPath = path.join(outputDir, `yan-git-compact-${Date.now()}.png`);
const wideScreenshotPath = path.join(outputDir, `yan-git-wide-${Date.now()}.png`);
const lightScreenshotPath = path.join(outputDir, `yan-git-light-${Date.now()}.png`);

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
fs.writeFileSync(path.join(workspace, 'README.md'), '# Git workbench\n', 'utf8');
execFileSync('git', ['init', '--bare', remote], { windowsHide: true });

async function waitForGitIdle(page) {
  await page.waitForFunction(() => document.querySelector('#rs-git')?.getAttribute('aria-busy') !== 'true'
    && !document.querySelector('#rs-git')?.classList.contains('is-busy'));
}

async function openActionDialog(page, trigger) {
  await page.locator(trigger).click();
  await page.locator('#gitActionDialog[open]').waitFor();
}

(async () => {
  let application;
  const pageErrors = [];
  try {
    application = await electron.launch({
      executablePath: require('electron'),
      args: [appRoot],
      cwd: appRoot,
      env: {
        ...process.env,
        YAN_E2E_MODE: '1',
        YAN_E2E_USER_DATA_DIR: userDataDir
      }
    });
    const page = await application.firstWindow();
    page.on('pageerror', error => pageErrors.push(error.message));
    await page.waitForFunction(() => document.readyState === 'complete'
      && typeof openRightSidebarTool === 'function'
      && document.querySelector('#rs-git')?.dataset.bound === 'true'
      && state.currentSession);

    await page.evaluate(async targetWorkspace => {
      const updated = await window.yan.setSessionWorkspace(state.currentSession.id, targetWorkspace, false);
      state.currentSession.workspace = updated.workspace;
      state.config = await window.yan.activateWorkspace(updated.workspace);
      syncCurrentSessionWorkspace(updated.workspace);
      updateTaskBar();
      setRightSidebarOpen(true);
    }, workspace);
    await page.locator('#rightSidebarLauncher [data-rs-open-tool="git"]').click();
    await page.locator('#rs-git.active').waitFor();
    await waitForGitIdle(page);

    assert.equal(await page.locator('[data-rs-tab="git"] .rs-work-tab-label').textContent(), 'Git');
    assert.equal(await page.locator('#gitUnavailableTitle').textContent(), '当前目录不是 Git 仓库');
    assert.equal(await page.locator('#gitInitBtn').isVisible(), true);
    assert.equal(await page.locator('#gitCloneBtn').isVisible(), true);

    await page.locator('#gitInitBtn').click();
    await page.locator('#gitWorkspace:not(.hidden)').waitFor();
    await waitForGitIdle(page);
    assert.equal(await page.locator('#gitRepositoryName').textContent(), 'workspace');
    assert.match(await page.locator('#gitRepositoryMeta').textContent(), /1 个变更/);
    assert.equal(await page.evaluate(() => document.querySelector('#gitBranchSelect')?.dataset.value), 'local:main');
    assert.equal(await page.locator('#gitChangeCount').textContent(), '1');
    await page.screenshot({ path: changesScreenshotPath, fullPage: false });

    await page.locator('#gitChangeList [data-git-diff]').click();
    await page.locator('#gitDiffPanel:not(.hidden)').waitFor();
    assert.match(await page.locator('#gitDiffTitle').textContent(), /README\.md/);
    assert.match(await page.locator('#gitDiffContent').textContent(), /Git workbench/);
    await page.screenshot({ path: diffScreenshotPath, fullPage: false });
    await page.locator('#gitDiffCloseBtn').click();

    await page.locator('[data-git-view="remotes"]').click();
    await openActionDialog(page, '#gitIdentityBtn');
    await page.locator('#gitActionFields [name="name"]').fill('Yan UI Test');
    await page.locator('#gitActionFields [name="email"]').fill('git-ui@example.com');
    await page.locator('#gitActionSubmit').click();
    await waitForGitIdle(page);
    assert.equal(await page.locator('#gitIdentityLabel').textContent(), 'Yan UI Test <git-ui@example.com>');

    await page.locator('[data-git-view="changes"]').click();
    await page.locator('#gitChangeList [data-git-stage-action="stage"]').click();
    await waitForGitIdle(page);
    assert.equal(await page.locator('#gitChangeList [data-git-change-staged="true"]').count(), 1);
    await page.locator('#gitCommitMessage').fill('Initial UI commit');
    assert.equal(await page.locator('#gitCommitBtn').isEnabled(), true);
    await page.locator('#gitCommitBtn').click();
    await waitForGitIdle(page);
    assert.equal(await page.locator('#gitChangeCount').textContent(), '0');
    assert.equal(await page.locator('#gitChangeSummary').textContent(), '工作区干净');

    await page.locator('[data-git-view="history"]').click();
    await page.waitForFunction(() => document.querySelector('#gitHistoryList')?.textContent.includes('Initial UI commit'));
    assert.match(await page.locator('#gitHistoryList').textContent(), /Yan UI Test/);

    await openActionDialog(page, '#gitCreateBranchBtn');
    await page.locator('#gitActionFields [name="name"]').fill('feature/git-ui');
    await page.locator('#gitActionSubmit').click();
    await waitForGitIdle(page);
    assert.equal(await page.evaluate(() => document.querySelector('#gitBranchSelect')?.dataset.value), 'local:feature/git-ui');
    await page.locator('#gitBranchSelect').click();
    await page.locator('#gitBranchDropdown .git-branch-option[data-value="local:main"]').click();
    await waitForGitIdle(page);
    assert.equal(await page.evaluate(() => document.querySelector('#gitBranchSelect')?.dataset.value), 'local:main');

    await page.locator('[data-git-view="remotes"]').click();
    await openActionDialog(page, '#gitAddRemoteBtn');
    await page.locator('#gitActionFields [name="name"]').fill('origin');
    await page.locator('#gitActionFields [name="url"]').fill(remote);
    await page.locator('#gitActionSubmit').click();
    await waitForGitIdle(page);
    assert.equal(await page.locator('#gitRemoteList [data-git-remote="origin"]').count(), 1);

    await openActionDialog(page, '#gitRemoteList [data-git-remote="origin"] [data-git-remote-action="edit"]');
    await page.keyboard.press('Escape');
    await page.locator('#gitActionDialog:not([open])').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#gitRemoteList [data-git-remote="origin"]').count(), 1);

    await openActionDialog(page, '#gitRemoteList [data-git-remote="origin"] [data-git-remote-action="remove"]');
    await page.locator('#gitActionCancel').click();
    await page.locator('#gitActionDialog:not([open])').waitFor({ state: 'hidden' });
    assert.equal(await page.locator('#gitRemoteList [data-git-remote="origin"]').count(), 1);

    assert.equal(await page.locator('#gitPushBtn').isEnabled(), true);
    await page.locator('#gitPushBtn').click();
    await waitForGitIdle(page);
    await page.waitForFunction(() => document.querySelector('#gitSyncBadge')?.textContent === '已同步');
    assert.equal(execFileSync('git', ['--git-dir', remote, 'show', '-s', '--format=%s', 'refs/heads/main'], {
      encoding: 'utf8',
      windowsHide: true
    }).trim(), 'Initial UI commit');

    assert.equal(await page.locator('#gitFetchBtn').isEnabled(), true);
    assert.equal(await page.locator('#gitPullBtn').isEnabled(), true);
    await page.locator('#gitFetchBtn').click();
    await waitForGitIdle(page);
    await page.screenshot({ path: screenshotPath, fullPage: false });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
    await page.screenshot({ path: lightScreenshotPath, fullPage: false });
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));

    const geometry = await page.locator('#rs-git').evaluate(panel => {
      const panelRect = panel.getBoundingClientRect();
      const workspaceRect = panel.querySelector('#gitWorkspace').getBoundingClientRect();
      const tabsRect = panel.querySelector('.git-view-tabs').getBoundingClientRect();
      return {
        panelWidth: panelRect.width,
        panelHeight: panelRect.height,
        workspaceInsidePanel: workspaceRect.left >= panelRect.left && workspaceRect.right <= panelRect.right + 1,
        tabsInsidePanel: tabsRect.left >= panelRect.left && tabsRect.right <= panelRect.right + 1,
        horizontalOverflow: panel.scrollWidth > panel.clientWidth + 1
      };
    });
    assert.equal(geometry.workspaceInsidePanel, true, JSON.stringify(geometry));
    assert.equal(geometry.tabsInsidePanel, true, JSON.stringify(geometry));
    assert.equal(geometry.horizontalOverflow, false, JSON.stringify(geometry));
    const responsiveGeometry = await page.evaluate(async () => {
      const widths = [];
      for (const width of [280, 640]) {
        document.documentElement.style.setProperty('--rs-w', `${width}px`);
        await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const panel = document.querySelector('#rs-git');
        const bounds = panel.getBoundingClientRect();
        widths.push({
          requested: width,
          actual: bounds.width,
          horizontalOverflow: panel.scrollWidth > panel.clientWidth + 1,
          toolbarOverflow: panel.querySelector('.git-toolbar').scrollWidth > panel.querySelector('.git-toolbar').clientWidth + 1,
          workspaceOverflow: panel.querySelector('#gitWorkspace').scrollWidth > panel.querySelector('#gitWorkspace').clientWidth + 1
        });
      }
      document.documentElement.style.removeProperty('--rs-w');
      return widths;
    });
    for (const width of responsiveGeometry) {
      assert.equal(width.horizontalOverflow, false, JSON.stringify(responsiveGeometry));
      assert.equal(width.toolbarOverflow, false, JSON.stringify(responsiveGeometry));
      assert.equal(width.workspaceOverflow, false, JSON.stringify(responsiveGeometry));
    }
    await page.evaluate(() => document.documentElement.style.setProperty('--rs-w', '280px'));
    await page.screenshot({ path: compactScreenshotPath, fullPage: false });
    await page.evaluate(() => document.documentElement.style.setProperty('--rs-w', '640px'));
    await page.screenshot({ path: wideScreenshotPath, fullPage: false });
    await page.evaluate(() => document.documentElement.style.removeProperty('--rs-w'));
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      ok: true,
      screenshotPath,
      changesScreenshotPath,
      diffScreenshotPath,
      compactScreenshotPath,
      wideScreenshotPath,
      lightScreenshotPath,
      workspace,
      remote,
      geometry,
      responsiveGeometry
    }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

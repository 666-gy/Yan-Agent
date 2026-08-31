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
const dialogScreenshotPath = path.join(outputDir, `yan-git-commit-dialog-${Date.now()}.png`);
const graphScreenshotPath = path.join(outputDir, `yan-git-graph-${Date.now()}.png`);

function runGit(args) {
  return execFileSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim();
}

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
runGit(['init', '-b', 'main']);
runGit(['config', 'user.name', 'Yan UI Test']);
runGit(['config', 'user.email', 'git-ui@example.com']);
fs.writeFileSync(path.join(workspace, 'README.md'), '# Git workbench\n', 'utf8');
runGit(['add', 'README.md']);
runGit(['commit', '-m', 'Initial UI commit']);
runGit(['branch', 'feature/test']);
runGit(['switch', '-c', 'pr-source']);
fs.writeFileSync(path.join(workspace, 'PR.md'), '# Merged work\n', 'utf8');
runGit(['add', 'PR.md']);
runGit(['commit', '-m', 'Merged PR work']);
const prCommit = runGit(['rev-parse', 'HEAD']);
runGit(['update-ref', 'refs/remotes/origin/pr-1', prCommit]);
runGit(['switch', 'main']);
execFileSync('git', ['init', '--bare', remote], { windowsHide: true });
runGit(['remote', 'add', 'origin', remote]);
fs.appendFileSync(path.join(workspace, 'README.md'), '\nPending change\n', 'utf8');

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
      && typeof refreshTaskGitStatus === 'function'
      && document.querySelector('#taskGitToolsWrap')?.dataset.bound === 'true'
      && state.currentSession);

    await page.evaluate(async targetWorkspace => {
      const updated = await window.yan.setSessionWorkspace(state.currentSession.id, targetWorkspace, false);
      state.currentSession.workspace = updated.workspace;
      state.config = await window.yan.activateWorkspace(updated.workspace);
      syncCurrentSessionWorkspace(updated.workspace);
      updateTaskBar();
      await refreshTaskGitStatus({ force: true });
    }, workspace);

    assert.equal(await page.locator('#rs-git').count(), 0);
    assert.equal(await page.locator('[data-rs-open-tool="git"]').count(), 0);
    assert.equal(await page.locator('#taskGitBranchName').textContent(), 'main');

    await page.locator('#taskGitHubBtn').click();
    await page.locator('#taskGitPanel:not(.hidden)').waitFor();
    assert.equal(await page.locator('#taskGitDiffStats').textContent(), '+2-0');
    await page.locator('#taskGitChangesBtn').click();
    await page.locator('#rs-review:not(.hidden)').waitFor();
    await page.waitForFunction(() => document.querySelector('#reviewFileList')?.textContent.includes('README.md'));
    assert.match(await page.locator('#reviewRunLabel').textContent(), /Git 工作区更改/);
    assert.match(await page.locator('#reviewFileList').textContent(), /README\.md/);
    assert.match(await page.locator('#reviewDiffRows').textContent(), /Pending change/);

    await page.locator('#taskGitHubBtn').click();
    await page.locator('#taskGitPanel:not(.hidden)').waitFor();
    await page.locator('#taskGitCommitOpenBtn').click();
    await page.locator('#taskGitCommitDialog[open]').waitFor();
    assert.equal(await page.locator('#taskGitPanel').isVisible(), false);

    await page.locator('#taskGitCommitBranchBtn').click();
    assert.equal(await page.locator('[data-task-git-commit-branch="main"]').count(), 1);
    assert.equal(await page.locator('[data-task-git-commit-branch="feature/test"]').count(), 1);
    await page.locator('[data-task-git-commit-branch="feature/test"]').click();
    assert.equal(await page.locator('#taskGitCommitBranch').textContent(), 'feature/test');

    await page.locator('#taskGitGenerateMessageBtn').click();
    await page.waitForFunction(() => document.querySelector('#taskGitCommitMessageInput')?.value.trim().length > 0);
    const generatedMessage = await page.locator('#taskGitCommitMessageInput').inputValue();
    assert.equal(await page.locator('#taskGitCommitDialog kbd').count(), 0);
    await page.screenshot({ path: dialogScreenshotPath, fullPage: false });
    await page.locator('[data-task-git-action="commit"]').click();
    await page.locator('#taskGitCommitDialog:not([open])').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#taskGitBranchName')?.textContent === 'feature/test');
    assert.equal(runGit(['show', '-s', '--format=%s', 'HEAD']), generatedMessage);

    await page.locator('#taskGitBranchBtn').click();
    await page.locator('#taskGitGraphBtn').click();
    await page.locator('#taskGitGraphDialog[open]').waitFor();
    await page.waitForFunction(() => document.querySelector('#taskGitGraphList')?.textContent.includes('Merged PR work'));
    assert.match(await page.locator('#taskGitGraphList').textContent(), /origin\/pr-1/);
    const prRow = page.locator('.task-git-graph-row', { hasText: 'Merged PR work' });
    assert.equal(await prRow.locator('.task-git-graph-node.lane-1').count(), 1);
    const commonParentRow = page.locator('.task-git-graph-row', { hasText: 'Initial UI commit' });
    assert.ok(await commonParentRow.locator('path.task-git-lane.lane-1').count() > 0);
    assert.ok(await commonParentRow.locator('path.task-git-lane.lane-1').evaluateAll(paths => paths.some(path => /C/.test(path.getAttribute('d') || ''))));
    await page.screenshot({ path: graphScreenshotPath, fullPage: false });

    const geometry = await page.locator('#taskGitGraphDialog').evaluate(dialog => ({
      horizontalOverflow: dialog.scrollWidth > dialog.clientWidth + 1,
      verticalOverflow: dialog.scrollHeight > dialog.clientHeight + 1
    }));
    assert.equal(geometry.horizontalOverflow, false, JSON.stringify(geometry));
    assert.equal(geometry.verticalOverflow, false, JSON.stringify(geometry));
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({ ok: true, dialogScreenshotPath, graphScreenshotPath, geometry }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

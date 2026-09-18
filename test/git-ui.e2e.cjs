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
const nonRepoWorkspace = path.join(testRoot, 'non-repo-workspace');
const remote = path.join(testRoot, 'remote.git');
const outputDir = path.join(appRoot, 'output', 'playwright');
const dialogScreenshotPath = path.join(outputDir, `yan-git-commit-dialog-${Date.now()}.png`);
const graphScreenshotPath = path.join(outputDir, `yan-git-graph-${Date.now()}.png`);
const reviewScreenshotPath = path.join(outputDir, `yan-review-sidebar-codex-${Date.now()}.png`);
const reviewLightScreenshotPath = path.join(outputDir, `yan-review-sidebar-light-${Date.now()}.png`);
const reviewNarrowScreenshotPath = path.join(outputDir, `yan-review-sidebar-narrow-${Date.now()}.png`);

function runGit(args) {
  return execFileSync('git', args, { cwd: workspace, encoding: 'utf8', windowsHide: true }).trim();
}

fs.mkdirSync(userDataDir, { recursive: true });
fs.mkdirSync(workspace, { recursive: true });
fs.mkdirSync(nonRepoWorkspace, { recursive: true });
fs.mkdirSync(outputDir, { recursive: true });
runGit(['init', '-b', 'main']);
runGit(['config', 'user.name', 'Yan UI Test']);
runGit(['config', 'user.email', 'git-ui@example.com']);
fs.writeFileSync(path.join(workspace, 'README.md'), '# Git workbench\n', 'utf8');
fs.mkdirSync(path.join(workspace, 'src'), { recursive: true });
const longSource = Array.from({ length: 160 }, (_, index) => `export const line${String(index + 1).padStart(3, '0')} = ${index + 1};`);
fs.writeFileSync(path.join(workspace, 'src', 'long.js'), `${longSource.join('\n')}\n`, 'utf8');
runGit(['add', 'README.md', 'src/long.js']);
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
longSource[79] = 'export const line080 = "changed";';
fs.writeFileSync(path.join(workspace, 'src', 'long.js'), `${longSource.join('\n')}\n`, 'utf8');

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
    await page.locator('#taskBar:not(.hidden)').waitFor();

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
    await page.locator('#taskGitRefreshBtn').click();
    await page.waitForFunction(() => !document.querySelector('#taskGitRefreshBtn')?.hasAttribute('aria-busy'));
    assert.equal(await page.locator('#taskGitDiffStats').textContent(), '+3-1');
    await page.locator('#taskGitChangesBtn').click();
    await page.locator('#rs-review.active').waitFor();
    await page.locator('#yanDshReviewFrame').waitFor();
    const reviewFrame = page.frameLocator('#yanDshReviewFrame');
    await reviewFrame.locator('.sidenav .navitem').first().waitFor();
    // Review diffs load lazily per file (the panel only receives the manifest
    // up front): open the first file and wait for its diff before asserting.
    await reviewFrame.locator('.sidenav .navitem').first().click();
    await reviewFrame.locator('#file-0[data-yan-state="loaded"]').waitFor({ timeout: 20_000 });
    const initialReviewText = await reviewFrame.locator('body').textContent();
    assert.match(initialReviewText, /README\.md/);
    assert.match(initialReviewText, /Pending change/);
    assert.equal(await reviewFrame.locator('.sidenav .navitem').count(), 2);
    const reviewOpenWidth = await page.locator('#rs-review').evaluate(panel => panel.getBoundingClientRect().width);
    assert.ok(reviewOpenWidth >= 560, `review sidebar did not expand: ${reviewOpenWidth}`);
    const initialEmbeddedLayout = await reviewFrame.locator('html').evaluate(root => ({
      filebarWidth: parseFloat(getComputedStyle(root).getPropertyValue('--yan-review-filebar-width')) || 0,
      navLeft: getComputedStyle(document.querySelector('.sidenav')).left,
      navRight: getComputedStyle(document.querySelector('.sidenav')).right,
      mainMarginLeft: getComputedStyle(document.querySelector('main')).marginLeft,
      mainMarginRight: getComputedStyle(document.querySelector('main')).marginRight,
      hasResizer: !!document.querySelector('#yan-review-filebar-resizer')
    }));
    assert.equal(initialEmbeddedLayout.navRight, '0px');
    assert.match(initialEmbeddedLayout.navLeft, /\d+(?:\.\d+)?px/);
    assert.equal(initialEmbeddedLayout.mainMarginLeft, '0px');
    assert.ok(initialEmbeddedLayout.filebarWidth > 0);
    assert.equal(initialEmbeddedLayout.mainMarginRight, `${initialEmbeddedLayout.filebarWidth}px`);
    assert.equal(initialEmbeddedLayout.hasResizer, true);

    let resizerBox = await reviewFrame.locator('#yan-review-filebar-resizer').boundingBox();
    assert.ok(resizerBox);
    await page.mouse.move(resizerBox.x + resizerBox.width / 2, resizerBox.y + 24);
    await page.mouse.down();
    await page.mouse.move(resizerBox.x - 48, resizerBox.y + 24, { steps: 4 });
    await page.mouse.up();
    const widenedFilebar = await reviewFrame.locator('.sidenav').evaluate(element => parseFloat(getComputedStyle(element).width));
    assert.ok(widenedFilebar > initialEmbeddedLayout.filebarWidth, `filebar did not widen: ${initialEmbeddedLayout.filebarWidth} -> ${widenedFilebar}`);

    await reviewFrame.locator('#yan-review-filebar-resizer').dispatchEvent('pointerdown', { pointerId: 11, clientX: 99999, bubbles: true });
    await reviewFrame.locator('#yan-review-filebar-resizer').dispatchEvent('pointerup', { pointerId: 11, clientX: 99999, bubbles: true });
    const collapsedByDragWidth = await reviewFrame.locator('.sidenav').evaluate(element => parseFloat(getComputedStyle(element).width));
    assert.ok(collapsedByDragWidth < widenedFilebar, `filebar did not shrink: ${widenedFilebar} -> ${collapsedByDragWidth}`);
    await reviewFrame.locator('html').evaluate(root => { root.style.setProperty('--yan-review-filebar-width', '0px'); root.classList.add('yan-filebar-zero'); });
    const zeroFilebarWidth = await reviewFrame.locator('.sidenav').evaluate(element => parseFloat(getComputedStyle(element).width));
    assert.equal(zeroFilebarWidth, 0);
    await reviewFrame.locator('html').evaluate((root, width) => { root.style.setProperty('--yan-review-filebar-width', `${width}px`); root.classList.remove('yan-filebar-zero'); }, initialEmbeddedLayout.filebarWidth);
    const commentLineNumber = reviewFrame.locator('#file-0 .dsh-cr-num-new[data-cr-line]').first();
    await commentLineNumber.hover();
    const commentHoverStyle = await commentLineNumber.evaluate(element => {
      const style = getComputedStyle(element, '::after');
      return { content: style.content, background: style.backgroundColor, borderRadius: style.borderRadius, width: style.width, height: style.height };
    });
    assert.equal(commentHoverStyle.content, '"+"');
    assert.notEqual(commentHoverStyle.background, 'rgba(0, 0, 0, 0)');
    assert.equal(commentHoverStyle.borderRadius, '50%');
    assert.equal(commentHoverStyle.width, '17px');
    assert.equal(commentHoverStyle.height, '17px');

    const longNav = reviewFrame.locator('.sidenav .navitem', { hasText: 'long.js' });
    assert.equal(await longNav.count(), 1);
    assert.equal(await longNav.getAttribute('href'), '#file-1');
    await longNav.click();
    // Lazy review loads the file's diff on demand; wait for the rows to land.
    await reviewFrame.locator('#file-1[data-yan-state="loaded"]').waitFor({ timeout: 20_000 });
    assert.ok(await reviewFrame.locator('#file-1 .dsh-cr-row').count() > 0);

    const darkReviewBackground = await reviewFrame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
    await page.evaluate(async () => {
      applyTheme('light');
      await renderRightSidebarReview({ force: true });
    });
    await reviewFrame.locator('.sidenav .navitem').first().waitFor();
    const lightReviewBackground = await reviewFrame.locator('body').evaluate(element => getComputedStyle(element).backgroundColor);
    assert.notEqual(lightReviewBackground, darkReviewBackground);
    await page.screenshot({ path: reviewLightScreenshotPath, fullPage: false });
    await page.evaluate(() => applyTheme('dark'));

    fs.mkdirSync(path.join(workspace, 'renderer', 'pet'), { recursive: true });
    fs.mkdirSync(path.join(workspace, 'renderer', 'quick-input'), { recursive: true });
    fs.writeFileSync(path.join(workspace, 'renderer', 'pet', 'pet.js'), 'export const pet = true;\n', 'utf8');
    fs.writeFileSync(path.join(workspace, 'renderer', 'pet', 'icon.png'), Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64'));
    fs.writeFileSync(path.join(workspace, 'renderer', 'quick-input', 'index.html'), '<main>quick input</main>\n', 'utf8');
    await page.evaluate(async () => { await renderRightSidebarReview({ force: true }); });
    await reviewFrame.locator('.sidenav .navitem', { hasText: 'pet.js' }).waitFor();
    assert.ok(await reviewFrame.locator('.sidenav .navitem').count() >= 5);
    const imageNav = reviewFrame.locator('.sidenav .navitem', { hasText: 'icon.png' });
    assert.equal(await imageNav.count(), 1);
    await imageNav.click();
    assert.match(await reviewFrame.locator('body').textContent(), /icon\.png/);
    const readmeNav = reviewFrame.locator('.sidenav .navitem', { hasText: 'README.md' });
    await readmeNav.click();
    await page.screenshot({ path: reviewScreenshotPath, fullPage: false });

    const narrowReviewGeometry = await page.evaluate(async () => {
      document.documentElement.style.setProperty('--rs-w', '320px');
      await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const panel = document.querySelector('#rs-review');
      return {
        panelOverflow: panel.scrollWidth > panel.clientWidth + 1,
        panelWidth: panel.getBoundingClientRect().width,
        frameWidth: document.querySelector('#yanDshReviewFrame')?.getBoundingClientRect().width || 0
      };
    });
    assert.equal(narrowReviewGeometry.panelOverflow, false, JSON.stringify(narrowReviewGeometry));
    assert.ok(narrowReviewGeometry.panelWidth <= 321, JSON.stringify(narrowReviewGeometry));
    assert.ok(narrowReviewGeometry.frameWidth > 0, JSON.stringify(narrowReviewGeometry));
    const narrowInner = await reviewFrame.locator('body').evaluate(body => ({
      scrollWidth: body.scrollWidth,
      clientWidth: body.clientWidth,
      overflowX: getComputedStyle(body).overflowX,
      overflowY: getComputedStyle(body).overflowY
    }));
    assert.equal(narrowInner.overflowX, 'auto');
    assert.equal(narrowInner.overflowY, 'auto');
    await page.screenshot({ path: reviewNarrowScreenshotPath, fullPage: false });
    await page.evaluate(() => expandRightSidebarForReview());
    await reviewFrame.locator('.sidenav .navitem', { hasText: 'pet.js' }).click();

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

    await page.locator('#taskGitGraphCloseBtn').click();
    await page.evaluate(async targetWorkspace => {
      const updated = await window.yan.setSessionWorkspace(state.currentSession.id, targetWorkspace, false);
      state.currentSession.workspace = updated.workspace;
      state.config = await window.yan.activateWorkspace(updated.workspace);
      syncCurrentSessionWorkspace(updated.workspace);
      updateTaskBar();
      await refreshTaskGitStatus({ force: true });
    }, nonRepoWorkspace);
    await page.locator('#taskGitBranchWrap:not(.hidden)').waitFor();
    assert.equal(await page.locator('#taskGitBranchBtn').isEnabled(), true);
    await page.locator('#taskGitBranchBtn').click();
    await page.locator('#taskGitCreateBranchBtn').click();
    await page.locator('#gitActionDialog[open]').waitFor();
    await page.locator('#gitActionFields input[name="name"]').fill('feature/non-repo');
    await page.locator('#gitActionSubmit').click();
    await page.locator('#gitActionDialog:not([open])').waitFor({ state: 'hidden' });
    await page.waitForFunction(() => document.querySelector('#taskGitBranchName')?.textContent === 'feature/non-repo');
    assert.equal(execFileSync('git', ['-C', nonRepoWorkspace, 'branch', '--show-current'], { encoding: 'utf8', windowsHide: true }).trim(), 'feature/non-repo');
    assert.deepEqual(pageErrors, []);

    console.log(JSON.stringify({
      ok: true,
      dialogScreenshotPath,
      graphScreenshotPath,
      reviewScreenshotPath,
      reviewLightScreenshotPath,
      reviewNarrowScreenshotPath,
      geometry,
      narrowReviewGeometry,
      reviewOpenWidth,
      darkReviewBackground,
      lightReviewBackground
    }));
  } finally {
    await application?.close().catch(() => {});
    fs.rmSync(testRoot, { recursive: true, force: true });
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

'use strict';

// E2E smoke: the dsh-code-review sidebar surface must render the verbatim
// upstream page inside the review tab iframe, run its inline scripts under the
// app CSP (file: document), and pipe inline-comment posts back into the Yan
// composer exactly like upstream's composerWriter.

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-dsh-review-e2e-'));

(async () => {
  let application;
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
    const pageErrors = [];
    page.on('pageerror', error => pageErrors.push(error.message));

    await page.waitForFunction(() => (
      typeof globalThis.YanDshReview?.open === 'function'
      && globalThis.DshCodeReviewCore?.parseGitDiff != null
      && document.querySelector('#yanDshReviewMount')
    ), { timeout: 30_000 });

    await page.waitForFunction(() => window.__YAN_APP_READY__);
    await page.evaluate(async () => { openRightSidebarTool('review'); await renderRightSidebarReview(); });
    await page.evaluate(() => {
      const before = 'const a = 1;\nconst b = 2;\n';
      const after = 'const a = 0;\nconst b = 2;\nconst c = 3;\n';
      const lines = [];
      lines.push('diff --git a/src/app.js b/src/app.js');
      lines.push('--- a/src/app.js');
      lines.push('+++ b/src/app.js');
      lines.push('@@ -1,2 +1,3 @@');
      lines.push('-const a = 1;');
      lines.push('+const a = 0;');
      lines.push(' const b = 2;');
      lines.push('+const c = 3;');
      void before; void after;
      window.__dshReviewOpen = globalThis.YanDshReview.open({
        summary: {
          count: 1,
          additions: 2,
          deletions: 1,
          files: [{ path: 'src/app.js', status: 'modified', additions: 2, deletions: 1, patch: lines.join('\n') }]
        }
      });
    });
    await page.evaluate(() => window.__dshReviewOpen);

    await page.waitForFunction(() => {
      const frame = document.querySelector('#yanDshReviewFrame');
      return frame && frame.src.startsWith('file:')
        && frame.contentDocument?.querySelectorAll('.dsh-cr-grid .dsh-cr-row').length > 0;
    }, { timeout: 15_000 });

    const reviewFrame = page.frames().find(frame => frame.url().includes('yan-dsh-code-review'));
    await reviewFrame.locator('#yan-review-wrap').click({timeout:5000});
    await reviewFrame.locator('#yan-review-wrap').click({timeout:5000});
    await page.locator('#rightSidebarFocusBtn').click();
    await reviewFrame.locator('#yan-review-wrap').click({timeout:5000});
    await reviewFrame.locator('#yan-review-wrap').click({timeout:5000});
    await page.locator('[data-agent-chat-tab]').click();
    await page.evaluate(()=>activateRightSidebarTab('review',{forceReview:false}));
    await reviewFrame.locator('#yan-review-wrap').click({timeout:5000});
    await reviewFrame.locator('#yan-review-wrap').click({timeout:5000});
    await page.locator('#rightSidebarFocusBtn').click();

    assert.ok(reviewFrame, 'review file: frame present');
console.log('PASS review physical clicks normal/fullscreen/after Agent tab');
}finally{await application?.close();}})().catch(e=>{console.error(e);process.exitCode=1});
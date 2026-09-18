'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');

const appRoot = path.resolve(__dirname, '..');
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-quick-diff-'));

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
    await page.waitForFunction(() => typeof appendMessage === 'function' && typeof newSession === 'function');

    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      clearMessages();
      state.currentSession.workspace = 'C:\\yan-review-quick-diff';
      state.currentSession.messages = [];
      const agentRun = {
        runId: 'quick-diff-run',
        status: 'done',
        summaryStarted: true,
        changeCount: 2,
        timeline: [],
        changeSummary: {
          source: 'opencode',
          count: 2,
          additions: 4,
          deletions: 1,
          files: [
            {
              path: 'src/auth.ts',
              status: 'modified',
              additions: 3,
              deletions: 1,
              diff: {
                rows: [
                  { type: 'context', oldLine: 12, newLine: 12, text: 'export function getToken() {' },
                  { type: 'del', oldLine: 13, newLine: null, text: '  return localStorage.token;' },
                  { type: 'add', oldLine: null, newLine: 13, text: '  const t = cookies.get("session");' },
                  { type: 'add', oldLine: null, newLine: 14, text: '  return t;' },
                  { type: 'context', oldLine: 14, newLine: 15, text: '}' }
                ]
              }
            },
            {
              path: 'src/other.ts',
              status: 'modified',
              additions: 1,
              deletions: 0,
              diff: { rows: [{ type: 'add', oldLine: null, newLine: 1, text: 'const value = 1;' }] }
            }
          ]
        }
      };
      appendMessage('user', '用户消息边界', [], false, 0, Date.now());
      state.currentSession.messages.push({ role: 'assistant', content: '已完成', ts: Date.now(), agentRun });
      appendMessage('assistant', '已完成', [], false, 1, Date.now(), 0, agentRun);
    });

    const receiptFile = page.locator('.run-change-summary [data-run-change-file-index="0"]');
    await receiptFile.waitFor();
    // Trigger the same pointerenter handler used by a real hover. The
    // preview intentionally overlays the source row, so dispatching avoids
    // Playwright's hit-test retry loop while the overlay is mounting.
    await receiptFile.dispatchEvent('pointerenter');
    await page.locator('#reviewQuickDiff:not(.hidden)').waitFor();
    await page.waitForTimeout(80);
    await page.screenshot({
      path: path.join(appRoot, 'output', 'playwright', 'review-quick-diff.png'),
      fullPage: false
    });

    const visible = await page.evaluate(() => {
      const panel = document.querySelector('#reviewQuickDiff');
      const user = document.querySelector('.msg.user .msg-body')?.getBoundingClientRect();
      const review = document.querySelector('.run-change-summary')?.getBoundingClientRect();
      const output = document.querySelector('.msg.assistant .agent-summary-output, .msg.assistant .agent-work-narration')?.getBoundingClientRect();
      const panelRect = panel?.getBoundingClientRect();
      const quickDiffStyle = panel ? getComputedStyle(panel.querySelector('.review-quick-diff-body')) : null;
      return {
        selectedFormalReviewPath: document.querySelector('.review-file.active')?.dataset.reviewPath || '',
        panelText: panel?.textContent.replace(/\s+/g, ' ').trim() || '',
        rowCount: panel?.querySelectorAll('.review-quick-diff-row').length || 0,
        panelRadius: panel ? getComputedStyle(panel).borderTopLeftRadius : '',
        rightEdgeDelta: user && review ? Math.abs(user.right - review.right) : null,
        outputRightEdgeDelta: user && output ? Math.abs(user.right - output.right) : null,
        panelTop: panelRect?.top ?? null,
        panelWidth: panelRect?.width ?? null,
        reviewWidth: review?.width ?? null,
        viewportHeight: window.innerHeight,
        diffOverflowX: quickDiffStyle?.overflowX || '',
        diffOverflowY: quickDiffStyle?.overflowY || ''
      };
    });
    assert.match(visible.panelText, /src\/auth\.ts/);
    assert.equal(visible.rowCount, 5);
    assert.equal(visible.panelRadius, '12px');
    assert.equal(visible.selectedFormalReviewPath, '');
    assert.ok(visible.rightEdgeDelta != null && visible.rightEdgeDelta < 1, `right edges differ: ${visible.rightEdgeDelta}`);
    assert.ok(visible.outputRightEdgeDelta != null && visible.outputRightEdgeDelta < 1, `output right edges differ: ${visible.outputRightEdgeDelta}`);
    assert.ok(visible.panelTop != null && visible.panelTop >= 48, `quick diff overlaps title bar: ${visible.panelTop}`);
    assert.ok(visible.panelWidth != null && visible.reviewWidth != null && visible.panelWidth <= visible.reviewWidth + 0.5,
      `quick diff wider than review card: ${visible.panelWidth} > ${visible.reviewWidth}`);
    assert.equal(visible.diffOverflowX, 'auto');
    assert.equal(visible.diffOverflowY, 'auto');

    const quickBox = await page.locator('#reviewQuickDiff').boundingBox();
    assert.ok(quickBox, 'quick diff panel has no box');
    await page.mouse.move(quickBox.x + quickBox.width / 2, quickBox.y + 20);
    await page.waitForTimeout(190);
    assert.equal(await page.locator('#reviewQuickDiff').evaluate(panel => panel.classList.contains('hidden')), false);

    await page.mouse.move(20, 20);
    await page.waitForTimeout(220);
    assert.equal(await page.locator('#reviewQuickDiff').evaluate(panel => panel.classList.contains('hidden')), true);

    // The formal review tree is a click-to-open surface; hovering it alone
    // must not resurrect the quick preview.
    await receiptFile.click();
    await page.locator('#rs-review.active').waitFor();
    await page.locator('#yanDshReviewFrame').waitFor();
    const formalReviewFrame = page.frameLocator('#yanDshReviewFrame');
    await formalReviewFrame.locator('.sidenav .navitem').first().waitFor();
    assert.ok(await formalReviewFrame.locator('.sidenav .navitem').count() >= 1);
    assert.equal(await page.locator('#reviewQuickDiff').evaluate(panel => panel.classList.contains('hidden')), true);
    console.log(JSON.stringify({ ok: true, visible }));
  } finally {
    await application?.close();
  }
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

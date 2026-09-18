'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = path.resolve(__dirname, '..');
const userData = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-layout-'));
(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [root], cwd: root,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: userData } });
    const page = await app.firstWindow();
    await page.waitForFunction(() => typeof YanDshReview !== 'undefined');
    await page.waitForFunction(() => state.config && document.querySelector('#app')?.getBoundingClientRect().height > 0);
    await page.waitForTimeout(1000);
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      const summary = { count: 2, additions: 100, deletions: 0, files: ['first.js', 'second.js'].map(name => ({
        path: name, status: 'added', additions: 50, deletions: 0,
        patch: `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,50 @@\n` + Array.from({ length: 50 }, (_, i) => `+const value${i} = ${i};`).join('\n')
      })) };
      window.__layoutSummary = summary;
      createRightSidebarTab('review');
      createRightSidebarTab('interjection');
      activateRightSidebarTab('review');
      setBrowserFocusMode(true);
      await renderRightSidebarReview();
      await YanDshReview.open({ summary, selectedPath: 'second.js' });
    });
    const waitReview = async () => {
      await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.getElementById('file-1'));
      await page.waitForTimeout(150);
      const position = await page.evaluate(() => {
        const frame = document.querySelector('#yanDshReviewFrame');
        return { y: frame.contentWindow.scrollY, target: frame.contentDocument.getElementById('file-1').getBoundingClientRect().top };
      });
      assert.ok(position.y > 100, JSON.stringify(position));
      assert.ok(position.target >= 0 && position.target < 60, 'selected file should remain below the toolbar');
    };
    await waitReview();
    const measure = () => page.evaluate(() => ({
      sidebar: document.querySelector('#rightSidebar').getBoundingClientRect().top,
      tabs: document.querySelector('#rightSidebarTabbar').getBoundingClientRect().top,
      scroll: document.scrollingElement.scrollTop
    }));
    const before = await measure();
    for (let i = 0; i < 3; i++) {
      await page.evaluate(async () => {
        activateRightSidebarTab('interjection');
        await new Promise(resolve => requestAnimationFrame(resolve));
        activateRightSidebarTab('review');
        await renderRightSidebarReview();
        await YanDshReview.open({ summary: window.__layoutSummary, selectedPath: 'second.js' });
      });
      await waitReview();
      assert.deepEqual(await measure(), before);
    }
    assert.ok(before.tabs >= 0);
    const text = await page.evaluate(() => {
      const label = document.querySelector('#modelQuickRouteModel');
      label.textContent = 'gpt-6-astra gyjp';
      const style = getComputedStyle(label);
      return { line: parseFloat(style.lineHeight), font: parseFloat(style.fontSize) };
    });
    assert.ok(text.line >= text.font * 1.35);
    console.log(JSON.stringify({ ok: true, before, text }));
  } finally {
    await app?.close();
    fs.rmSync(userData, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const appRoot = path.resolve(__dirname, '..');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-review-lifecycle-'));

(async () => {
  let application;
  try {
    application = await electron.launch({ executablePath: require('electron'), args: [appRoot], cwd: appRoot,
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await application.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.locator('#taskBar:not(.hidden)').waitFor();
    await application.evaluate(({ ipcMain }) => {
      globalThis.reviewCalls = { history: 0, writes: 0 };
      const write = ipcMain._invokeHandlers.get('dsh-review:write-html');
      ipcMain.removeHandler('dsh-review:write-html');
      ipcMain.handle('dsh-review:write-html', (event, html) => { globalThis.reviewCalls.writes++; return write(event, html); });
      const history = ipcMain._invokeHandlers.get('opencode:session-changes');
      ipcMain.removeHandler('opencode:session-changes');
      ipcMain.handle('opencode:session-changes', async (event, payload) => {
        globalThis.reviewCalls.history++;
        if (payload.runId === 'slow-review') return new Promise(resolve => { globalThis.releaseReview = resolve; });
        return history(event, payload);
      });
    });
    const openedAt = Date.now();
    await page.evaluate(() => {
      const files = Array.from({ length: 400 }, (_, index) => {
        const file = { path: `src/file-${index}.js`, status: 'modified', additions: 1000, deletions: 500 };
        Object.defineProperty(file, 'diff', { enumerable: true, get() { throw new Error('manifest read persisted rows'); } });
        return file;
      });
      const run = { runId: 'cached-review', status: 'done', completedAt: Date.now(), changeSummary: { source: 'opencode', files } };
      state.currentSession.messages = [{ role: 'assistant', agentRun: run }];
      openRunChangeReview(run, '');
      for (let i = 0; i < 20; i++) void renderRightSidebarReview({ force: true });
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelectorAll('main .file').length === 400);
    const openMs = Date.now() - openedAt;
    assert.equal(await page.frameLocator('#yanDshReviewFrame').locator('.dsh-cr-row').count(), 0);
    assert.deepEqual(await application.evaluate(() => globalThis.reviewCalls), { history: 0, writes: 1 });
    assert.ok(openMs < 5000, `cached manifest took ${openMs}ms`);

    // Closing while the backend is pending must not resurrect the iframe.
    await page.evaluate(() => {
      closeRightSidebarTool('review');
      const run = { runId: 'slow-review', status: 'done' };
      state.currentSession.messages = [{ role: 'assistant', agentRun: run }];
      openRunChangeReview(run, '');
      for (let i = 0; i < 15; i++) void renderRightSidebarReview({ force: true });
    });
    await application.evaluate(async () => {
      const deadline = Date.now() + 5000;
      while (!globalThis.releaseReview && Date.now() < deadline) await new Promise(resolve => setTimeout(resolve, 10));
      if (!globalThis.releaseReview) throw new Error('delayed review request did not start');
    });
    assert.equal((await application.evaluate(() => globalThis.reviewCalls)).history, 1);
    await page.evaluate(() => closeRightSidebarTool('review'));
    await application.evaluate(() => globalThis.releaseReview({ files: [{ path: 'stale.js', additions: 1, deletions: 0, status: 'created' }] }));
    await page.waitForTimeout(150);
    assert.equal(await page.evaluate(() => document.querySelector('#yanDshReviewPanel').classList.contains('hidden')), true);
    assert.equal((await application.evaluate(() => globalThis.reviewCalls)).writes, 1);

    // Refreshing while a file loads permits the new request for the same path;
    // an old completion must never write rows into the replacement document.
    await page.evaluate(async () => {
      const summary = { files: [{ path: 'same.js', additions: 1, deletions: 0, status: 'created' }] };
      globalThis.lifecycleSummary = summary;
      await YanDshReview.open({ summary, lazy: true, selectedPath: 'same.js', loadFile: () => new Promise(resolve => { globalThis.releaseOldFile = resolve; }) });
    });
    await page.waitForFunction(() => typeof globalThis.releaseOldFile === 'function');
    await page.evaluate(async () => {
      await YanDshReview.open({ summary: globalThis.lifecycleSummary, lazy: true, selectedPath: 'same.js',
        loadFile: async () => ({ path: 'same.js', status: 'created', diff: { rows: [{ type: 'add', newLine: 1, text: 'NEW_GENERATION' }] } }) });
    });
    await page.frameLocator('#yanDshReviewFrame').getByText('NEW_GENERATION', { exact: true }).waitFor({ state: 'attached' });
    await page.evaluate(() => globalThis.releaseOldFile({ path: 'same.js', status: 'created', diff: { rows: [{ type: 'add', newLine: 1, text: 'OLD_GENERATION' }] } }));
    await page.waitForTimeout(100);
    assert.equal(await page.frameLocator('#yanDshReviewFrame').getByText('OLD_GENERATION', { exact: true }).count(), 0);
    assert.equal(await page.frameLocator('#yanDshReviewFrame').getByText('NEW_GENERATION', { exact: true }).count(), 1);
    // Real embedded file tree: nested disclosure controls must not load rows.
    await page.evaluate(async () => {
      globalThis.treeLoads = 0;
      globalThis.treeOptions = {
        summary: { files: ['src/ui/a.js', 'src/core/b.js', 'README.md'].map(path => ({ path, status: 'created', additions: 1 })) },
        lazy: true,
        loadFile: async path => { treeLoads++; return { path, status: 'created', diff: { rows: [{ type: 'add', newLine: 1, text: 'TREE_CONTENT' }] } }; }
      };
      await YanDshReview.open(treeOptions);
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelectorAll('.yan-review-folder').length === 3);
    await page.evaluate(() => document.querySelector('#yanDshReviewFrame').contentDocument.querySelector('details[data-folder="src"] > summary').click());
    await page.waitForFunction(() => !document.querySelector('#yanDshReviewFrame').contentDocument.querySelector('details[data-folder="src"]').open);
    await page.waitForTimeout(50);
    await page.evaluate(() => YanDshReview.open(treeOptions));
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame').contentDocument.querySelector('details[data-folder="src"]')?.open === false);
    assert.equal(await page.evaluate(() => treeLoads), 0);
    await page.evaluate(() => {
      const doc = document.querySelector('#yanDshReviewFrame').contentDocument;
      doc.querySelector('details[data-folder="src"] > summary').click();
      doc.querySelector('.navitem[href="#file-0"]').click();
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame').contentDocument.querySelector('#file-0')?.dataset.yanState === 'loaded');
    assert.equal(await page.evaluate(() => treeLoads), 1);
    // Huge single lines are rejected before highlighter work. Large row sets
    // receive a clearly marked preview, not an unbounded DOM insertion.
    await page.evaluate(async () => {
      await YanDshReview.open({ summary: { files: [{ path: 'huge.js', status: 'created' }] }, lazy: true, selectedPath: 'huge.js',
        loadFile: async () => ({ path: 'huge.js', diff: { rows: [{ type: 'add', newLine: 1, text: 'x'.repeat(1000000) }] } }) });
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame').contentDocument.querySelector('#file-0')?.dataset.yanState === 'error');
    assert.equal(await page.frameLocator('#yanDshReviewFrame').locator('.dsh-cr-row').count(), 0);
    await page.evaluate(async () => {
      await YanDshReview.open({ summary: { files: [{ path: 'many.js', status: 'created' }] }, lazy: true, selectedPath: 'many.js',
        loadFile: async () => ({ path: 'many.js', diff: { rows: Array.from({ length: 3000 }, (_, i) => ({ type: 'add', newLine: i + 1, text: 'const n = 1;' })) } }) });
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame').contentDocument.querySelector('#file-0')?.dataset.yanState === 'loaded');
    const previewRows = await page.frameLocator('#yanDshReviewFrame').locator('.dsh-cr-row').count();
    assert.ok(previewRows > 0 && previewRows <= 1200);
    assert.equal(await page.frameLocator('#yanDshReviewFrame').locator('[data-copy-file]').isDisabled(), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, openMs, files: 400, duplicateOpens: 20, manifestHistoryReads: 0, staleCompletionsIgnored: true }));
  } finally {
    await application?.close();
    assert.equal(path.dirname(path.resolve(root)), path.resolve(os.tmpdir()));
    assert.ok(path.basename(root).startsWith('yan-review-lifecycle-'));
    fs.rmSync(root, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });

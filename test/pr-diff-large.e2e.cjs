'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { _electron: electron } = require('playwright');
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'yan-pr-large-'));

(async () => {
  let app;
  try {
    app = await electron.launch({ executablePath: require('electron'), args: [path.resolve(__dirname, '..')],
      env: { ...process.env, YAN_E2E_MODE: '1', YAN_E2E_USER_DATA_DIR: root } });
    const page = await app.firstWindow();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('console', message => { if (message.type() === 'error') errors.push(message.text()); });
    await page.waitForFunction(() => window.__YAN_APP_READY__);
    // These are literal source text, not instructions or HTML. Previously $`
    // and $' expanded into the entire page while inserting the control script.
    const special = '$& $` $\' $$ </script><svg viewBox="broken"> \\u003c';
    const patch = (name, lines) => `diff --git a/${name} b/${name}\nnew file mode 100644\n--- /dev/null\n+++ b/${name}\n@@ -0,0 +1,${lines.length} @@\n${lines.map(line => '+' + line).join('\n')}\n`;
    const rawDiff = Array.from({ length: 80 }, (_, i) => patch(`src/file-${i}.js`, Array.from({ length: 500 }, (_, n) => `const value${n} = ${JSON.stringify(special)};`))).join('')
      + patch('src/oversized.js', ['x'.repeat(9000)]);
    assert.ok(rawDiff.length < 4 * 1024 * 1024);
    await app.evaluate(({ ipcMain }, diff) => {
      ipcMain.removeHandler('gh:pr-diff');
      ipcMain.handle('gh:pr-diff', () => ({ ok: true, diff }));
    }, rawDiff);
    const started = Date.now();
    await page.evaluate(async () => {
      if (!state.currentSession) await newSession();
      showMainPage('code-review');
      await YanCodeReview.openDiff({ number: 13613, headRefName: 'feature', baseRefName: 'main' });
    });
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelectorAll('main .file').length === 81);
    const frame = page.frames().find(f => f.url().includes('yan-dsh-code-review'));
    assert.equal(await frame.locator('.dsh-cr-num').count(), 0);
    assert.equal(await frame.locator('main .file.yan-file-collapsed').count(), 81);
    assert.ok(await frame.locator('html').evaluate(el => el.outerHTML.length) < 400000);
    await frame.locator('#file-0 .filehead').click();
    await frame.locator('#file-0[data-yan-state="loaded"]').waitFor();
    assert.ok((await frame.locator('#file-0 .dsh-cr-grid').textContent()).includes(JSON.stringify(special)));
    assert.equal(await frame.locator('main .file[data-yan-state="loaded"]').count(), 1);
    await frame.locator('#file-80 .filehead').click();
    await frame.locator('#file-80[data-yan-state="error"]').waitFor();
    assert.ok((await frame.locator('#file-80 .yan-review-notice').textContent()).includes('超长行'));
    if (process.env.YAN_PR_DIFF_FIXTURE) {
      const actual = fs.readFileSync(process.env.YAN_PR_DIFF_FIXTURE, 'utf8');
      const count = actual.split(/^diff --git /m).length - 1;
      const start = Date.now();
      await page.evaluate(diff => YanDshReview.open({ rawDiff: diff, pr: true }), actual);
      await page.waitForFunction(count => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelectorAll('main .file').length === count, count);
      const actualFrame = page.frames().find(f => f.url().includes('yan-dsh-code-review'));
      assert.equal(await actualFrame.locator('.dsh-cr-num').count(), 0);
      await actualFrame.locator('#file-0 .filehead').click();
      await actualFrame.locator('#file-0[data-yan-state="loaded"]').waitFor();
      await page.locator('#rightResizeHandle').hover();
      await page.mouse.down();
      await page.mouse.move(550, 400, { steps: 12 });
      await page.mouse.up();
      assert.ok(await actualFrame.locator('html').evaluate(el => el.scrollWidth <= el.clientWidth + 1));
      await page.screenshot({ path: path.resolve(__dirname, '../output/pr-13613-fixed.png') });
      console.log(JSON.stringify({ actualPr: 13613, files: count, bytes: Buffer.byteLength(actual), openAndLoadMs: Date.now() - start }));
    }
    // Exercise the replacement-token path used by eager/custom callers too.
    await page.evaluate(diff => YanDshReview.open({ rawDiff: diff, lazy: false, pr: true }), patch('special.js', [special]));
    await page.waitForFunction(() => document.querySelector('#yanDshReviewFrame')?.contentDocument?.querySelector('.path')?.textContent.includes('special.js'));
    const eager = page.frames().find(f => f.url().includes('yan-dsh-code-review'));
    await eager.locator('#yan-review-wrap').click();
    assert.equal(await eager.locator('html').evaluate(el => el.classList.contains('yan-no-wrap')), true);
    assert.equal(await eager.locator('body').evaluate(el => el.childNodes.length < 30), true);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, files: 81, lines: 40001, elapsedMs: Date.now() - started }));
  } finally {
    await app?.close();
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
